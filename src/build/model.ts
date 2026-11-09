// What the core and every adapter share: the read-only build context, the rows they return, and how a usage
// finds the node it belongs to (its var, else the top-level form that holds it, else its namespace).
import type { GraphEdge, GraphNode } from '../mcp/graph.ts';
import { keywordName, type Analysis, type Keyword, type Span, type VarDef, type VarUse } from './analysis.ts';
import { contains, readForms, type Form } from './reader.ts';

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
  projectNs: ReadonlySet<string>;
  // "ns/name" to its first definition
  defs: ReadonlyMap<string, VarDef>;
  edn: readonly string[];
  forms: (file: string) => Form[];
  componentOf: (file: string) => string | undefined;
  // the var usage whose symbol starts at this place, and the project definition it names
  useAt: (file: string, row: number, col: number) => VarUse | undefined;
  defAt: (file: string, row: number, col: number) => string | undefined;
  // a keyword at this place, resolved (::x and ::alias/x included), with its leading colon
  keywordAt: (file: string, row: number, col: number) => string | undefined;
}

export interface Adapter {
  // the capability it fills
  name: string;
  edgeKinds: readonly string[];
  // what switched it on (a required library), or null: it then adds nothing and says so
  detect: (ctx: Context) => string | null;
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

export const defId = (fullName: string) => `definition:${fullName}`;
export const nsId = (ns: string) => `namespace:${ns}`;

export function createContext(analysis: Analysis, sources: ReadonlyMap<string, string>, edn: readonly string[], componentOf: (file: string) => string | undefined): Context {
  const defs = new Map<string, VarDef>();
  for (const d of analysis.varDefs) if (d.name && !LANGUAGE_NS.test(d.ns) && !defs.has(`${d.ns}/${d.name}`)) defs.set(`${d.ns}/${d.name}`, d);
  const cache = new Map<string, Form[]>();
  const at = (file: string, row: number, col: number) => `${file}:${row}:${col}`;
  const uses = new Map<string, VarUse>();
  for (const u of analysis.varUses) if (!u.defmethod) uses.set(at(u.file, u.nameRow, u.nameCol), u);
  const keywords = new Map<string, Keyword>();
  for (const k of analysis.keywords) keywords.set(at(k.file, k.row, k.col), k);
  const useAt = (file: string, row: number, col: number) => uses.get(at(file, row, col));
  return {
    useAt,
    defAt: (file, row, col) => {
      const u = useAt(file, row, col);
      return u && defs.has(`${u.to}/${u.name}`) ? `${u.to}/${u.name}` : undefined;
    },
    keywordAt: (file, row, col) => {
      const k = keywords.get(at(file, row, col));
      return k && keywordName(k);
    },
    analysis,
    // the language's own namespaces are never the project's, even where a repo declares them in test fixtures
    projectNs: new Set(analysis.nsDefs.map((d) => d.name).filter((n) => !LANGUAGE_NS.test(n))),
    defs,
    edn,
    componentOf,
    forms: (file) => {
      let f = cache.get(file);
      if (!f) {
        f = readForms(sources.get(file) ?? '').forms;
        cache.set(file, f);
      }
      return f;
    },
  };
}

const size = (s: Span) => (s.endRow - s.row) * 100000 + (s.endCol - s.col);

export function makeOwner(ctx: Context, containers: readonly Container[]): Owner {
  const byFile = new Map<string, Container[]>();
  for (const c of containers) {
    const xs = byFile.get(c.span.file) ?? [];
    xs.push(c);
    byFile.set(c.span.file, xs);
  }
  return (site) => {
    if (site.fromVar && ctx.defs.has(`${site.from}/${site.fromVar}`)) return defId(`${site.from}/${site.fromVar}`);
    let best: Container | undefined;
    for (const c of byFile.get(site.file) ?? []) {
      if (contains(c.span, site.row, site.col) && (!best || size(c.span) < size(best.span))) best = c;
    }
    return best ? best.id : nsId(site.from);
  };
}
