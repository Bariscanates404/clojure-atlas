// The core graph every codebase gets: namespaces and definitions, and the edges kondo resolves statically:
// defines (namespace -> definition), requires (namespace -> namespace), calls and references (a usage with and
// without an argument list), tests (a deftest -> what it uses) and protocol implementations.
import type { GraphEdge, GraphNode } from '../mcp/graph.ts';
import { isTestFile } from '../mcp/keyflow.ts';
import type { ProtocolImpl, VarDef, VarUse } from './analysis.ts';
import { defId, nsId, type Container, type Context, type Owner, type Rows } from './model.ts';
import { formAt, kids } from './reader.ts';

export const UNKNOWN_NS = 'clj-kondo/unknown-namespace';

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

const SPECIAL_FORMS = new Set(['def', 'if', 'do', 'let*', 'letfn*', 'loop*', 'recur', 'fn*', 'quote', 'var', 'throw', 'try', 'catch',
  'finally', 'monitor-enter', 'monitor-exit', 'new', 'set!', '.', 'case*', 'deftype*', 'reify*', 'import*', '&']);
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

const isTestDef = (d: VarDef) => d.test || /(^|\/)(deftest|defspec)$/.test(d.definedBy ?? '');

export function definitionNode(ctx: Context, d: VarDef): GraphNode {
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

// A protocol method implemented in a defrecord, deftype, extend-type, extend-protocol or reify form.
export const implId = (p: ProtocolImpl) => defId(`${p.protocolNs}/${p.method} impl ${p.file}:${p.row}`);

function implementations(ctx: Context): Rows {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  for (const p of ctx.analysis.protocolImpls) {
    const component = ctx.componentOf(p.file);
    const id = implId(p);
    nodes.push({
      id, kind: 'definition', name: `${p.protocolNs}/${p.method} impl ${p.file}:${p.row}`, file: p.file, line: p.row, end_line: p.endRow,
      ...(component ? { component } : {}),
      attrs: { defined_by: p.definedBy, protocol: `${p.protocolNs}/${p.protocolName}`, impl_ns: p.implNs },
    });
    edges.push({ from: nsId(p.implNs), to: id, kind: 'defines', band: 'static_proven', file: p.file, line: p.row });
    if (ctx.defs.has(`${p.protocolNs}/${p.method}`)) {
      edges.push({ from: defId(`${p.protocolNs}/${p.method}`), to: id, kind: 'calls', band: 'heuristic', file: p.file, line: p.row, attrs: { via: 'protocol dispatch' } });
    }
  }
  return { nodes, edges };
}

// Top-level protocol impls own the usages in their bodies; one inside a function stays with that function.
export function implementationContainers(ctx: Context): Container[] {
  return ctx.analysis.protocolImpls.map((p) => ({ id: implId(p), span: p }));
}

function top(counts: Map<string, number>, n = 15): [string, number][] {
  return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n);
}

export function core(ctx: Context, owner: Owner): Rows & { stats: UsageStats } {
  const nodes: GraphNode[] = [...namespaceNodes(ctx)];
  const edges: GraphEdge[] = [];
  const testIds = new Set<string>();
  for (const d of ctx.defs.values()) {
    const node = definitionNode(ctx, d);
    nodes.push(node);
    if (isTestDef(d)) testIds.add(node.id);
    edges.push({ from: nsId(d.ns), to: node.id, kind: 'defines', band: 'static_proven', file: d.file, line: d.row });
  }
  for (const u of ctx.analysis.nsUses) {
    if (ctx.projectNs.has(u.to) && u.to !== u.from) edges.push({ from: nsId(u.from), to: nsId(u.to), kind: 'requires', band: 'static_proven', file: u.file, line: u.row });
  }
  const impls = implementations(ctx);
  nodes.push(...impls.nodes);
  edges.push(...impls.edges);

  const stats: UsageStats = { notVars: 0, resolved: 0, unresolved: 0, unknown: 0, external: 0, topUnresolved: [], topUnknown: [] };
  const unresolved = new Map<string, number>();
  const unknown = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  const link = (from: string, to: string, kind: string, u: { file: string; nameRow: number }) => {
    if (from === to) return;
    edges.push({ from, to, kind, band: 'static_proven', file: u.file, line: u.nameRow });
    if (testIds.has(from)) edges.push({ from, to, kind: 'tests', band: 'static_proven', file: u.file, line: u.nameRow });
  };
  const isAssertion = assertionHeads(ctx);
  const usage = (u: VarUse) => {
    if (u.defmethod) return;
    if (u.to === UNKNOWN_NS && (SPECIAL_FORMS.has(u.name) || u.name.endsWith('#') || isAssertion(u))) {
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
    link(owner({ ...u, row: u.nameRow, col: u.nameCol }), defId(full), u.arity !== undefined ? 'calls' : 'references', u);
  };
  for (const u of ctx.analysis.varUses) usage(u);

  stats.topUnresolved = top(unresolved);
  stats.topUnknown = top(unknown);
  return { nodes, edges, stats };
}
