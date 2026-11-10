// Shared row model and helpers of the graph queries: the QueryResult shape the renderer prints, row
// builders that cite file:line and band, name resolution, and the not-found / ambiguous answers.
import type { Band, Graph, GraphEdge, GraphNode } from './graph.ts';
import { NOT_USED } from '../shared/capability.ts';
import { capability, inEdges, compareText } from './graph.ts';
import { degradation, recoveredFor, skippedFor, strings, unanalyzedFor, unparsedFor } from './degraded.ts';

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
  // why the extractor could not see this kind of fact: an empty section then reads "not extracted", never "none"
  unextracted?: string;
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
  // the arguments were rejected before any search: there is no name to spell-check
  badArgument?: boolean;
  // the name was not found but its file could not be parsed: the answer is not a spelling matter
  unparsed?: string[];
  // the name was not found but the build saw it used, at these sites: defined by something clj-kondo cannot expand
  used?: string[];
}


export const site = (e: GraphEdge): { file: string; line: number | null } => ({ file: e.file, line: e.line ?? null });

// Entry point: a route handler, an event/subscription handler, or a definition with the handler role.
export function entryOf(g: Graph, id: string): string | undefined {
  const n = g.byId.get(id);
  if (!n) return undefined;
  const routes = inEdges(g, id, ['routes_to']);
  if (routes.length) {
    const more = routes.length - 1;
    return `route ${g.byId.get(routes[0].from)?.name ?? routes[0].from}${more ? ` (and ${more} more route${more > 1 ? 's' : ''})` : ''}`;
  }
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

const NOT_SPELLING = ': its definitions are not in the graph, so this is not a spelling problem';

export const MACRO_HINT = 'probably defined by a macro clj-kondo cannot expand; add :lint-as for the macro in .clj-kondo/config.edn';

// The names the build recorded as used but never defined that the query names: qualified, or bare when it has no namespace.
function usedUndefined(g: Graph, query: string): [string, string[]][] {
  const recorded = (g.doc as { stats?: { usages?: { unresolvedSites?: Record<string, unknown> } } }).stats?.usages?.unresolvedSites ?? {};
  const q = query.replace(/^definition:/, '');
  return Object.entries(recorded).flatMap(([name, sites]): [string, string[]][] => (name === q || (!q.includes('/') && name.endsWith(`/${q}`)) ? [[name, strings(sites)]] : []));
}

// Not found is only as strong as the capabilities that could have produced a match: their state is always named.
export function notFound(g: Graph, name: string, query: string, title: string, what: string, caps: string[], note?: string): QueryResult {
  const degraded = degradation(g.doc);
  const parseFailed = unparsedFor(degraded, query);
  const skipped = skippedFor(degraded, query);
  const recovered = recoveredFor(degraded, query);
  const { timedOut, unread } = unanalyzedFor(degraded, query);
  const unparsed = [...parseFailed, ...skipped, ...timedOut, ...unread];
  const used = what === 'definition' ? usedUndefined(g, query) : [];
  const at = (sites: string[]) => sites.join(', ');
  const cause = unparsed.length ? 'its definition is probably in the file named below'
    : recovered.length ? `probably a form clj-kondo could not read in the file with syntax errors named below, or a ${MACRO_HINT.replace(/^probably defined by a /, '')}`
    : MACRO_HINT;
  return {
    name, query, title, found: false, matches: [], sections: [], next: [],
    verdict: `no ${what} matches ${JSON.stringify(query)}${used.length ? `; used at ${used.map(([, s]) => at(s)).join('; ')} but no definition was found` : ''}`,
    notes: [
      ...used.map(([full, sites]) => `${full} is used at ${at(sites)} but no definition was found: ${cause}`),
      ...(parseFailed.length ? [`${query} probably lives in ${parseFailed.join(', ')}, which could not be parsed${NOT_SPELLING}`] : []),
      ...(recovered.length ? [`${query} may live in ${recovered.join(', ')}, which has syntax errors; some forms may be missing, so besides a spelling problem a form kondo could not read is possible`] : []),
      ...(skipped.length ? [`${query} probably lives in ${skipped.join(', ')}, which is over 2 MB and was skipped${NOT_SPELLING}`] : []),
      ...(timedOut.length ? [`${query} probably lives in ${timedOut.join(', ')}, which was not analyzed because clj-kondo did not finish on it${NOT_SPELLING}`] : []),
      ...(unread.length ? [`${query} probably lives in ${unread.join(', ')}, which git tracks but the build did not analyze${NOT_SPELLING}`] : []),
      ...capabilityNotes(g, caps), ...(note ? [note] : []),
    ],
    ...(unparsed.length ? { unparsed } : {}),
    ...(used.length ? { used: used.map(([full]) => full) } : {}),
  };
}

// The reason an empty section is no statement about the code: a capability the graph lacks or lists as absent.
export function unextractedBy(g: Graph, caps: string[]): string | undefined {
  const why = caps.flatMap((n) => {
    const c = capability(g, n);
    return !c ? [`${n} is not in this graph`] : c.status !== 'available' ? [`${n} is ${c.status}`] : [];
  });
  return why.length ? `not extracted (${why.join('; ')})` : undefined;
}

// The sections, each marked unextracted when the capability that fills it is missing.
export const gated = (g: Graph, caps: string[], sections: Section[]): Section[] => {
  const why = unextractedBy(g, caps);
  return why ? sections.map((s) => ({ ...s, unextracted: s.unextracted ?? why })) : sections;
};

// A missing capability makes an empty answer meaningless; say so instead of letting it read as "none".
export function capabilityNotes(g: Graph, names: string[]): string[] {
  const notes: string[] = [];
  for (const name of names) {
    const c = capability(g, name);
    if (!c) notes.push(`capability ${name} is not listed in this graph: an empty answer is not proof of absence`);
    else if (c.status !== 'available') notes.push(`capability ${name} is ${c.status}: an empty answer is not proof of absence`);
    else if (c.note === NOT_USED) {
      notes.push(`capability ${name} is available but not used (nothing in this codebase switches it on): an empty answer is not proof of absence`);
    }
    else if (c.note) notes.push(`${name}: ${c.note}`);
  }
  return notes;
}

// Dynamic resolution the build saw: a var reached by a symbol built at runtime is not followed, so a caller found that way is not listed.
export function dynamicResolveNote(g: Graph): string[] {
  const seen = (g.doc as { stats?: { usages?: { dynamicResolve?: { sites?: unknown; literal?: unknown } } } }).stats?.usages?.dynamicResolve;
  const sites = typeof seen?.sites === 'number' ? seen.sites : 0;
  const literal = typeof seen?.literal === 'number' ? seen.literal : 0;
  return sites ? [`dynamic resolution (requiring-resolve, resolve, ns-resolve) is used at ${sites} site(s), ${literal} naming a project var by a literal symbol `
    + '(HEURISTIC references); a symbol built at runtime is not followed, so a caller reached that way is not listed'] : [];
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
