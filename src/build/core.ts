// The core graph every codebase gets: namespaces and definitions, and the edges kondo resolves statically:
// defines (namespace -> definition), requires (namespace -> namespace), each var usage as the relation relations.ts
// names (calls, references, passes_callback, registers_handler, expands_via, rebinds) and tests (a deftest -> what it uses).
import type { Band, GraphEdge, GraphNode } from '../mcp/graph.ts';
import { isTestFile } from '../mcp/keyflow.ts';
import type { NsUse, VarDef, VarUse } from './analysis.ts';
import { defId, nsId, isSpecialForm, UNKNOWN_NS, type Context, type Owner, type Rows } from './model.ts';
import { formAt, kids, textOf } from './reader.ts';
import { classify } from './relations.ts';
import { callArgs, signatureOf, type Arity } from './signatures.ts';

// How usages of vars came out: resolved to a project definition, naming a project namespace but no definition
// in it, not resolved by kondo at all, or pointing into a library.
export interface UsageStats {
  // symbols that can never be vars: special forms and auto-gensyms in syntax-quote, &, and the head of an
  // assertion inside clojure.test's `is` (thrown?, match?: dispatch values of its assert-expr multimethod)
  notVars: number;
  resolved: number;
  unresolved: number;
  unknown: number;
  external: number;
  // the most frequent unresolved names, to explain the gap
  topUnresolved: [string, number][];
  topUnknown: [string, number][];
}

const TEST_NS = /^(clojure|cljs)\.test$/;

// Places where a list is the assertion of an `is`: its head symbol is an assert-expr dispatch value.
function assertionHeads(ctx: Context): (u: VarUse) => boolean {
  const byFile = new Map<string, Set<string>>();
  for (const u of ctx.analysis.varUses) {
    if (u.name !== 'is' || !TEST_NS.test(u.to)) continue;
    const form = formAt(ctx.forms(u.file), u.row, u.col);
    const arg = form ? kids(form)[1] : undefined;
    const head = arg && arg.t === 'list' ? arg.children[0] : undefined;
    if (head) byFile.set(u.file, (byFile.get(u.file) ?? new Set()).add(`${head.row}:${head.col}`));
  }
  return (u) => byFile.get(u.file)?.has(`${u.nameRow}:${u.nameCol}`) ?? false;
}

// `[lib :as-alias x]` only names a namespace for ::x/kw keywords; nothing is loaded, unless the same vector also
// says :as or :refer.
function loadsNamespace(ctx: Context, u: NsUse): boolean {
  const spec = ctx.parentOf(u.file, u.row, u.col)?.parent;
  const words = spec?.t === 'vector' ? kids(spec).map(textOf) : [];
  return !words.includes(':as-alias') || words.includes(':as') || words.includes(':refer');
}

const isTestDef = (d: VarDef) => d.test || /(^|\/)(deftest|defspec)$/.test(d.definedBy ?? '');

function definitionNode(ctx: Context, d: VarDef, signature?: Arity[] | null): GraphNode {
  const component = ctx.componentOf(d.file);
  const test = isTestDef(d) || isTestFile(d.file);
  return {
    id: defId(`${d.ns}/${d.name}`),
    kind: 'definition',
    name: `${d.ns}/${d.name}`,
    file: d.file,
    line: d.row,
    end_line: d.endRow,
    ...(component ? { component } : {}),
    ...(test ? { roles: ['test'] } : {}),
    attrs: {
      ...(d.definedBy ? { defined_by: d.definedBy } : {}),
      ...(d.macro ? { macro: true } : {}),
      ...(d.private ? { private: true } : {}),
      ...(d.langs.length > 1 ? { platforms: d.langs } : {}),
      ...(signature ? { signature: { arities: signature } } : {}),
    },
  };
}

function namespaceNodes(ctx: Context): GraphNode[] {
  const seen = new Set<string>();
  const out: GraphNode[] = [];
  for (const d of ctx.analysis.nsDefs) {
    if (seen.has(d.name)) continue;
    seen.add(d.name);
    const component = ctx.componentOf(d.file);
    out.push({ id: nsId(d.name), kind: 'namespace', name: d.name, file: d.file, line: d.row, end_line: d.endRow, ...(component ? { component } : {}) });
  }
  return out;
}

function top(counts: Map<string, number>, n = 15): [string, number][] {
  return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n);
}

export function core(ctx: Context, owner: Owner): Rows & { stats: UsageStats } {
  const nodes: GraphNode[] = [...namespaceNodes(ctx)];
  const edges: GraphEdge[] = [];
  const testIds = new Set<string>();
  const signatures = new Map<string, Arity[]>();
  for (const d of ctx.defs.values()) {
    const form = /\/defn-?$/.test(d.definedBy ?? '') ? formAt(ctx.forms(d.file), d.row, d.col) : undefined;
    const sig = form ? signatureOf(form, (f) => ctx.nameOf(d.file, f)) : null;
    if (sig) signatures.set(`${d.ns}/${d.name}`, sig);
    const node = definitionNode(ctx, d, sig);
    nodes.push(node);
    if (isTestDef(d)) testIds.add(node.id);
    edges.push({ from: nsId(d.ns), to: node.id, kind: 'defines', band: 'static_proven', file: d.file, line: d.row });
  }
  for (const u of ctx.analysis.nsUses) {
    if (ctx.projectNs.has(u.to) && u.to !== u.from && loadsNamespace(ctx, u)) edges.push({ from: nsId(u.from), to: nsId(u.to), kind: 'requires', band: 'static_proven', file: u.file, line: u.row });
  }

  const stats: UsageStats = { notVars: 0, resolved: 0, unresolved: 0, unknown: 0, external: 0, topUnresolved: [], topUnknown: [] };
  const unresolved = new Map<string, number>();
  const unknown = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  const link = (from: string, to: string, kind: string, band: Band, u: { file: string; nameRow: number }, attrs?: Record<string, unknown>) => {
    if (from === to) return;
    edges.push({ from, to, kind, band, file: u.file, line: u.nameRow, ...(attrs ? { attrs } : {}) });
    if (testIds.has(from)) edges.push({ from, to, kind: 'tests', band, file: u.file, line: u.nameRow });
  };
  const isAssertion = assertionHeads(ctx);
  const usage = (u: VarUse) => {
    if (u.defmethod) return;
    if (u.to === UNKNOWN_NS && (isSpecialForm(u) || u.name.endsWith('#') || isAssertion(u))) {
      stats.notVars++;
      return;
    }
    if (u.to === UNKNOWN_NS) {
      stats.unknown++;
      bump(unknown, u.name);
      return;
    }
    if (!ctx.projectNs.has(u.to)) {
      stats.external++;
      return;
    }
    const full = `${u.to}/${u.name}`;
    if (!ctx.defs.has(full)) {
      stats.unresolved++;
      bump(unresolved, full);
      return;
    }
    stats.resolved++;
    const rel = classify(ctx, u);
    const call = rel.kind === 'calls' && u.arity !== undefined ? formAt(ctx.forms(u.file), u.row, u.col) : undefined;
    const attrs = {
      ...(rel.via ? { via: rel.via } : {}),
      ...(rel.kind === 'calls' && u.arity !== undefined
        ? { arity: u.arity, arity_band: 'static_proven', ...(call ? callArgs(call, u.arity, signatures.get(full) ?? null, (f) => ctx.nameOf(u.file, f)) : {}) }
        : {}),
    };
    link(owner({ ...u, row: u.nameRow, col: u.nameCol }), defId(full), rel.kind, rel.band, u, Object.keys(attrs).length ? attrs : undefined);
  };
  for (const u of ctx.analysis.varUses) usage(u);

  stats.topUnresolved = top(unresolved);
  stats.topUnknown = top(unknown);
  return { nodes, edges, stats };
}
