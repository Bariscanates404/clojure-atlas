// What the core and every adapter share: the read-only build context, the rows they return, and how a usage
// finds the node it belongs to (its var, else the top-level form that holds it, else its namespace).
import type { GraphEdge, GraphNode } from '../mcp/graph.ts';
import { keywordName, type Analysis, type Keyword, type Span, type VarDef, type VarUse } from './analysis.ts';
import type { ProjectConfig } from './config.ts';
import type { Playwright } from './typescript.ts';
import { contains, kids, readForms, textOf, walk, type Form } from './reader.ts';

export interface Rows {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// A top-level form whose usages belong to a node of its own (a defmethod, a protocol impl, an event handler).
export interface Container {
  id: string;
  span: Span;
}

export interface Context {
  analysis: Analysis;
  config: ProjectConfig;
  playwright: Playwright;
  projectNs: ReadonlySet<string>;
  // "ns/name" to its definition (the first one, see merged)
  defs: ReadonlyMap<string, VarDef>;
  edn: readonly string[];
  forms: (file: string) => Form[];
  componentOf: (file: string) => string | undefined;
  // the var usage whose symbol starts at this place, and the project definition it names
  useAt: (file: string, row: number, col: number) => VarUse | undefined;
  defAt: (file: string, row: number, col: number) => string | undefined;
  // a keyword at this place, resolved (::x and ::alias/x included), with its leading colon
  keywordAt: (file: string, row: number, col: number) => string | undefined;
  // the resolved keyword where kondo saw one (code), else the form's text (.edn files kondo does not read)
  nameOf: (file: string, f: Form) => string;
  // the collection or wrapper directly holding the form that starts at this place, and its index there
  parentOf: (file: string, row: number, col: number) => { parent: Form; index: number } | undefined;
}

export interface Adapter {
  // the capability it fills
  name: string;
  edgeKinds: readonly string[];
  // what switched it on (a required library), or null: it then adds nothing and says so
  detect: (ctx: Context) => string | null;
  // why it could not run although its subject is there (a missing tool): the capability is then absent, not empty
  unavailable?: (ctx: Context) => string | null;
  containers?: (ctx: Context) => Container[];
  run: (ctx: Context, owner: Owner) => Rows;
}

export interface Site {
  file: string;
  row: number;
  col: number;
  from: string;
  fromVar?: string;
}

export type Owner = (site: Site) => string;

const LANGUAGE_NS = /^(clojure|cljs)\.(core|string|set|walk|test|edn|zip|data|pprint|repl|template|spec\.alpha|core\.async)$/;

export const CORE_NS = /^(clojure|cljs)\.core$/;

export function groupBy<T>(xs: Iterable<T>, key: (x: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    const list = out.get(k);
    if (list) list.push(x);
    else out.set(k, [x]);
  }
  return out;
}

export const defId = (fullName: string) => `definition:${fullName}`;
export const nsId = (ns: string) => `namespace:${ns}`;

const isDeclare = (d: VarDef) => /(^|\/)declare$/.test(d.definedBy ?? '');

// The definitions of one name: the first one stands, unless it is a (declare ...) and a later one is the real
// definition; the platforms they are defined for add up (the same namespace in a .clj and a .cljs file).
function merged(prev: VarDef, d: VarDef): VarDef {
  const winner = isDeclare(prev) && !isDeclare(d) ? d : prev;
  return { ...winner, langs: [...new Set([...prev.langs, ...d.langs])].sort() };
}

export function createContext(analysis: Analysis, config: ProjectConfig, playwright: Playwright, sources: ReadonlyMap<string, string>, edn: readonly string[], componentOf: (file: string) => string | undefined): Context {
  const defs = new Map<string, VarDef>();
  for (const d of analysis.varDefs) {
    if (!d.name || LANGUAGE_NS.test(d.ns)) continue;
    const full = `${d.ns}/${d.name}`;
    const prev = defs.get(full);
    defs.set(full, prev ? merged(prev, d) : d);
  }
  const cache = new Map<string, Form[]>();
  const parents = new Map<string, Map<string, { parent: Form; index: number }>>();
  const at = (file: string, row: number, col: number) => `${file}:${row}:${col}`;
  const uses = new Map<string, VarUse>();
  for (const u of analysis.varUses) if (!u.defmethod) uses.set(at(u.file, u.nameRow, u.nameCol), u);
  const keywords = new Map<string, Keyword>();
  for (const k of analysis.keywords) keywords.set(at(k.file, k.row, k.col), k);
  const useAt = (file: string, row: number, col: number) => uses.get(at(file, row, col));
  const forms = (file: string): Form[] => {
    let f = cache.get(file);
    if (!f) {
      f = readForms(sources.get(file) ?? '').forms;
      cache.set(file, f);
    }
    return f;
  };
  return {
    config,
    playwright,
    useAt,
    defAt: (file, row, col) => {
      const u = useAt(file, row, col);
      return u && defs.has(`${u.to}/${u.name}`) ? `${u.to}/${u.name}` : undefined;
    },
    keywordAt: (file, row, col) => {
      const k = keywords.get(at(file, row, col));
      return k && keywordName(k);
    },
    parentOf: (file, row, col) => {
      let m = parents.get(file);
      if (!m) {
        m = new Map();
        for (const f of walk(forms(file))) kids(f).forEach((c, index) => m?.set(`${c.row}:${c.col}`, { parent: f, index }));
        parents.set(file, m);
      }
      return m.get(`${row}:${col}`);
    },
    nameOf: (file, f) => {
      const k = keywords.get(at(file, f.row, f.col));
      return k ? keywordName(k) : textOf(f) ?? '';
    },
    analysis,
    // the language's own namespaces are never the project's, even where a repo declares them in test fixtures
    projectNs: new Set(analysis.nsDefs.map((d) => d.name).filter((n) => !LANGUAGE_NS.test(n))),
    defs,
    edn,
    componentOf,
    forms,
  };
}

const size = (s: Span) => (s.endRow - s.row) * 100000 + (s.endCol - s.col);

export function makeOwner(ctx: Context, containers: readonly Container[]): Owner {
  const byFile = groupBy(containers, (c) => c.span.file);
  // a site read from the forms has no var: the definition whose span holds it stands in
  const defsByFile = groupBy([...ctx.defs.values()].map((d) => ({ id: defId(`${d.ns}/${d.name}`), span: d as Span })), (c) => c.span.file);
  const innermost = (cs: readonly Container[] | undefined, site: Site) => {
    let best: Container | undefined;
    for (const c of cs ?? []) if (contains(c.span, site.row, site.col) && (!best || size(c.span) < size(best.span))) best = c;
    return best;
  };
  return (site) => {
    if (site.fromVar && ctx.defs.has(`${site.from}/${site.fromVar}`)) return defId(`${site.from}/${site.fromVar}`);
    return (innermost(byFile.get(site.file), site) ?? innermost(defsByFile.get(site.file), site))?.id ?? nsId(site.from);
  };
}
