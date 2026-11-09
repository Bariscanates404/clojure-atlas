// Shared row model and helpers of the graph queries: the QueryResult shape the renderer prints, row
// builders that cite file:line and band, name resolution, and the not-found / ambiguous answers.
import type { Band, Graph, GraphEdge, GraphNode } from './graph.ts';
import { capability, inEdges, compareText } from './graph.ts';

export interface Row {
  label: string;
  id: string;
  file: string | null;
  line: number | null;
  band: Band;
  kind?: string;
  detail?: string;
  component?: string;
  depth?: number;
  // ranking facts
  entry?: string;
  fanIn?: number;
  cross?: boolean;
  parentId?: string;
  parentLabel?: string;
  reason?: string;
  // a finding row carries its kind and the map key it is about as data, so nothing reads the label back
  finding?: FindingKind;
  key?: string;
}

export type FindingKind = 'arity-missing' | 'never-passed' | 'unread' | 'lacks-key';

export interface Section {
  name: string;
  rows: Row[];
  // keep the given order (a middleware chain, a flow) instead of ranking
  ordered?: boolean;
  // rows form a tree through parentId (blast radius)
  tree?: boolean;
  // what an empty section searched, so "none" states its coverage
  searched?: string;
  // short name for counts and paging hints
  short?: string;
}

export interface QueryResult {
  name: string;
  query: string;
  title: string;
  verdict: string;
  found: boolean;
  matches: string[];
  sections: Section[];
  counts?: Record<string, number>;
  notes: string[];
  next: string[];
}


export const site = (e: GraphEdge): { file: string; line: number | null } => ({ file: e.file, line: e.line ?? null });

// Entry point: a route handler, an event/subscription handler, or a definition with the handler role.
export function entryOf(g: Graph, id: string): string | undefined {
  const n = g.byId.get(id);
  if (!n) return undefined;
  const route = inEdges(g, id, ['routes_to'])[0];
  if (route) return `route ${g.byId.get(route.from)?.name ?? route.from}`;
  if (n.kind === 'handler') return 'event handler';
  if (n.roles?.includes('handler')) return 'handler';
  return undefined;
}

// distinct calling definitions, not call sites
const fanInOf = (g: Graph, id: string) => new Set(inEdges(g, id, ['calls']).map((e) => e.from)).size;

export function edgeRow(g: Graph, nodeId: string, e: GraphEdge, extra: Partial<Row> = {}): Row {
  const n = g.byId.get(nodeId);
  const entry = entryOf(g, nodeId);
  const fanIn = fanInOf(g, nodeId);
  const reason = typeof e.attrs?.reason === 'string' ? e.attrs.reason : undefined;
  return {
    label: n?.name ?? nodeId,
    id: nodeId,
    ...site(e),
    band: e.band,
    kind: e.kind,
    ...(n?.component ? { component: n.component } : {}),
    ...(entry ? { entry } : {}),
    ...(fanIn ? { fanIn } : {}),
    ...(reason ? { reason } : {}),
    ...extra,
  };
}

const nodeSite = (n: GraphNode): { file: string | null; line: number | null } => ({ file: n.file ?? null, line: n.line ?? null });

export function nodeRow(n: GraphNode, extra: Partial<Row> = {}): Row {
  return { label: n.name, id: n.id, ...nodeSite(n), band: 'static_proven', kind: n.kind, ...(n.component ? { component: n.component } : {}), ...extra };
}

export const call = (tool: string, args: Record<string, string | number>) =>
  `${tool}(${Object.entries(args).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')})`;

export function notFound(name: string, query: string, title: string, what: string, note?: string): QueryResult {
  return {
    name, query, title, found: false, matches: [], sections: [], next: [],
    verdict: `no ${what} matches ${JSON.stringify(query)}`,
    notes: note ? [note] : [],
  };
}

// A missing capability makes an empty answer meaningless; say so instead of letting it read as "none".
export function capabilityNotes(g: Graph, names: string[]): string[] {
  const notes: string[] = [];
  for (const name of names) {
    const c = capability(g, name);
    if (!c) notes.push(`capability ${name} is not listed in this graph: an empty answer is not proof of absence`);
    else if (c.status !== 'available') notes.push(`capability ${name} is ${c.status}: an empty answer is not proof of absence`);
    else if (c.note) notes.push(`${name}: ${c.note}`);
  }
  return notes;
}

export function unknownNote(rows: Row[]): string[] {
  const n = rows.filter((r) => r.band === 'unknown').length;
  return n ? [`${n} row(s) are UNKNOWN: the producer could not decide them; they are boundaries, not absence`] : [];
}

// ---------- resolution ----------

function stripKw(q: string): string {
  return q.trim().replace(/^:/, '');
}

// Nodes of the given kinds a free-text query names: exact id, kind-prefixed id, exact name, then (for
// definitions) a bare name after the last "/". Several matches are returned, never silently picked.
export function resolve(g: Graph, kinds: readonly string[], query: string): GraphNode[] {
  const q = query.trim();
  if (!q) return [];
  const direct = g.byId.get(q);
  if (direct && kinds.includes(direct.kind)) return [direct];
  const kw = stripKw(q);
  for (const variant of [q, `:${kw}`, kw]) {
    const hits = kinds.map((k) => g.byId.get(`${k}:${variant}`)).filter((n): n is GraphNode => !!n);
    if (hits.length) return hits;
  }
  for (const variant of [q, `:${kw}`]) {
    const hits = (g.byName.get(variant) ?? []).filter((n) => kinds.includes(n.kind));
    if (hits.length) return hits;
  }
  if (kinds.includes('definition') && (!q.includes('/') || q === '/')) {
    return (g.byKind.get('definition') ?? []).filter((n) => n.name.endsWith(`/${q}`));
  }
  return [];
}


export function countBy(rows: Row[], key: (r: Row) => string): Record<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) out.set(key(r), (out.get(key(r)) ?? 0) + 1);
  return Object.fromEntries([...out].sort((a, b) => b[1] - a[1] || compareText(a[0], b[0])));
}

export function ambiguous(name: string, query: string, title: string, nodes: GraphNode[], argName: string): QueryResult {
  return {
    name, query, title, found: false,
    verdict: `${JSON.stringify(query)} is ambiguous (${nodes.length} matches); pass one fully qualified name`,
    matches: nodes.map((n) => n.id),
    sections: [{ name: 'candidates', rows: nodes.map((n) => nodeRow(n)) }],
    notes: [`${nodes.length} nodes match ${JSON.stringify(query)}; a fully qualified name selects one`],
    next: nodes.slice(0, 3).map((n) => call(name, { [argName]: n.name })),
  };
}
