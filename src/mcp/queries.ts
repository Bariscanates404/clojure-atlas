// The graph queries. Each returns a structured QueryResult: a verdict, sections of rows (every row carries
// file, line and band plus the facts the renderer ranks by), notes and ready next calls. Text rendering
// lives in render.ts and never needs to look anything up again.
import type { Band, Graph, GraphEdge, GraphNode } from './graph.ts';
import { BANDS, capability, inEdges, outEdges, weakest, compareText } from './graph.ts';
import {
  ambiguous, call, capabilityNotes, countBy, edgeRow, nodeRow, notFound, resolve, unknownNote,
  type QueryResult, type Row, type Section,
} from './rows.ts';
import { changeKeyRows, changeSignatureRows, WEAK_PATTERN_ABSENT } from './keyflow.ts';

export { entryOf, resolve, type QueryResult, type Row, type Section } from './rows.ts';

const MAX_DEPTH = 3;

// ---------- callers / blast radius ----------

// Every relation through which a change to a definition can reach another: an actual call, a value use, a function
// passed as a callback or registered as a handler, a macro expansion, a dispatch candidate and a dynamic rebinding.
const DEPENDENCY_KINDS = ['calls', 'references', 'passes_callback', 'registers_handler', 'expands_via', 'may_dispatch_to', 'rebinds'] as const;

// One row per calling definition and relation kind, however many sites it has: its strongest edge (earliest site on a
// tie), with the number of sites in the detail.
function callerRows(g: Graph, edges: GraphEdge[]): Row[] {
  const byCaller = new Map<string, GraphEdge[]>();
  for (const e of edges) byCaller.set(`${e.kind}\0${e.from}`, [...(byCaller.get(`${e.kind}\0${e.from}`) ?? []), e]);
  return [...byCaller.values()].map((sites) => {
    const [best] = [...sites].sort((a, b) => BANDS.indexOf(a.band) - BANDS.indexOf(b.band) || compareText(a.file, b.file) || (a.line ?? 0) - (b.line ?? 0));
    return edgeRow(g, best.from, best, sites.length > 1 ? { detail: `${sites.length} sites, strongest shown` } : {});
  });
}

export function callers(g: Graph, query: string, opts: { includeReferences?: boolean } = {}): QueryResult {
  const title = `callers of ${query}`;
  const hits = resolve(g, ['definition'], query);
  if (!hits.length) return notFound('callers', query, title, 'definition', 'use a fully qualified name (ns/name)');
  if (hits.length > 1) return ambiguous('callers', query, title, hits, 'var');
  const target = hits[0];
  const kinds = opts.includeReferences ? DEPENDENCY_KINDS : (['calls'] as const);
  const rows = callerRows(g, inEdges(g, target.id, kinds)).map((r) => ({ ...r, cross: !!r.component && r.component !== target.component }));
  rows.sort((a, b) => compareText(a.file ?? '', b.file ?? '') || (a.line ?? 0) - (b.line ?? 0));
  const notes = [...capabilityNotes(g, ['definitions']), ...unknownNote(rows)];
  if (!opts.includeReferences) {
    const called = new Set(rows.map((r) => r.id));
    const referencing = new Set(inEdges(g, target.id, DEPENDENCY_KINDS).map((e) => e.from).filter((from) => !called.has(from)));
    if (referencing.size) {
      notes.push(`${referencing.size} more definition(s) reference it without calling it (value use, callback, handler, macro, dispatch, rebinding): pass include_references=true to list them`);
    }
  }
  const comps = new Set(rows.map((r) => r.component ?? '(no component)'));
  const entries = rows.filter((r) => r.entry).length;
  return {
    name: 'callers',
    query,
    title: `callers of ${target.name}`,
    verdict: `${rows.length} direct caller(s) in ${comps.size} component(s)${entries ? `, ${entries} entry point(s)` : ''}`,
    found: true,
    matches: [target.id],
    sections: [
      { name: 'definition', rows: [nodeRow(target)], ordered: true },
      { name: opts.includeReferences ? 'callers and references' : 'callers', rows, searched: 'call edges into this definition' },
    ],
    counts: countBy(rows, (r) => r.component ?? '(no component)'),
    notes,
    next: [call('blast_radius', { var: target.name, depth: 2 }), call('tests_for', { symbol: target.name })],
  };
}

interface Reach {
  id: string;
  band: Band;
  depth: number;
  via: string;
  edge: GraphEdge;
}

// Reverse breadth-first walk over calls and references, each node once at its shallowest depth.
function reverseReach(g: Graph, start: string, max: number): { reached: Reach[]; beyond: boolean } {
  const seen = new Set<string>([start]);
  const reached: Reach[] = [];
  let frontier: { id: string; band: Band }[] = [{ id: start, band: 'static_proven' }];
  for (let d = 1; d <= max && frontier.length; d++) {
    const next: { id: string; band: Band }[] = [];
    for (const f of frontier) {
      for (const e of inEdges(g, f.id, DEPENDENCY_KINDS)) {
        if (seen.has(e.from)) continue;
        seen.add(e.from);
        const band = weakest(f.band, e.band);
        reached.push({ id: e.from, band, depth: d, via: f.id, edge: e });
        next.push({ id: e.from, band });
      }
    }
    frontier = next;
  }
  const beyond = frontier.some((f) => inEdges(g, f.id, DEPENDENCY_KINDS).some((e) => !seen.has(e.from)));
  return { reached, beyond };
}

// Rows at these depths form the first section; deeper rows get their own section so they page separately.
const SHALLOW_DEPTH = 2;
const TOP_NAMES = 8;

const countLine = (label: string, counts: Map<string, number>, sort: boolean, top = TOP_NAMES): string => {
  const all = [...counts];
  if (sort) all.sort((x, y) => y[1] - x[1] || compareText(x[0], y[0]));
  const shown = all.slice(0, top).map(([k, v]) => `${k}=${v}`).join(' ');
  return `${label}: ${shown}${all.length > top ? ` (+${all.length - top} more)` : ''}`;
};

// Transitive callers until no new caller appears; an explicit `depth` caps the walk. Cycles stop at the first visit.
export function blastRadius(g: Graph, query: string, depth?: number): QueryResult {
  const title = `blast radius of ${query}`;
  const hits = resolve(g, ['definition'], query);
  if (!hits.length) return notFound('blast_radius', query, title, 'definition');
  if (hits.length > 1) return ambiguous('blast_radius', query, title, hits, 'var');
  const target = hits[0];
  const capped = depth !== undefined && Number.isFinite(depth);
  const max = capped ? Math.max(1, Math.floor(depth)) : Number.POSITIVE_INFINITY;
  const { reached, beyond } = reverseReach(g, target.id, max);
  const rows = reached.map((r) => {
    const row = edgeRow(g, r.id, r.edge, {
      band: r.band, depth: r.depth, parentId: r.via, parentLabel: g.byId.get(r.via)?.name ?? r.via,
    });
    return { ...row, cross: !!row.component && row.component !== target.component };
  });
  const deepest = rows.reduce((m, r) => Math.max(m, r.depth ?? 0), 0);
  const byDepth = new Map<string, number>();
  for (const r of rows) byDepth.set(String(r.depth), (byDepth.get(String(r.depth)) ?? 0) + 1);
  const byComp = new Map<string, number>();
  for (const r of rows) byComp.set(r.component ?? '(no component)', (byComp.get(r.component ?? '(no component)') ?? 0) + 1);
  const entryRows = rows.filter((r) => r.entry);
  const byEntry = new Map<string, number>();
  for (const r of entryRows) {
    const kind = r.entry?.startsWith('route ') ? 'route' : (r.entry ?? '');
    byEntry.set(kind, (byEntry.get(kind) ?? 0) + 1);
  }
  const shallow = rows.filter((r) => (r.depth ?? 0) <= SHALLOW_DEPTH);
  const deeper = rows.filter((r) => (r.depth ?? 0) > SHALLOW_DEPTH);
  const notes = [...capabilityNotes(g, ['definitions']), ...unknownNote(rows)];
  if (rows.length) {
    notes.push(countLine('by depth', byDepth, false, byDepth.size));
    notes.push(countLine('by component', byComp, true));
  }
  if (entryRows.length) {
    const routes = entryRows.filter((r) => r.entry?.startsWith('route ')).slice(0, 3).map((r) => (r.entry ?? '').slice(6));
    notes.push(`${countLine('entry points reached', byEntry, true)}${routes.length ? `; first routes: ${routes.join(', ')}` : ''}`);
  }
  if (beyond) notes.push(`callers continue beyond depth ${max}; omit depth to walk to the end`);
  notes.push('potential impact over known dependency relations (calls, value uses, callbacks, registered handlers, macro expansions, dispatch candidates, rebindings): a path here may never run');
  if (deeper.length) notes.push(`${deeper.length} caller(s) at depth ${SHALLOW_DEPTH + 1}+ are in section "deeper": page with section="deeper" offset= limit=`);
  const scope = capped ? `depth ${max}` : 'all depths';
  const sections: Section[] = [{ name: 'affected', rows: shallow, tree: true, searched: `call and reference edges up to depth ${SHALLOW_DEPTH}` }];
  if (deeper.length) sections.push({ name: 'deeper', rows: deeper, tree: true });
  return {
    name: 'blast_radius',
    query,
    title: `blast radius of ${target.name} (${scope})`,
    verdict: `${rows.length} caller(s) over ${deepest} depth(s) in ${byComp.size} component(s)${entryRows.length ? `, ${entryRows.length} entry point(s) reach it` : ''}${capped ? ` (depth capped at ${max}${beyond ? ', more callers exist' : ''})` : ''}`,
    found: true,
    matches: [target.id],
    sections,
    counts: countBy(rows, (r) => r.component ?? '(no component)'),
    notes,
    next: [
      ...(deeper.length ? [call('blast_radius', { var: target.name, section: 'deeper', limit: 100 })] : []),
      call('tests_for', { symbol: target.name }),
      ...rows.filter((r) => r.entry?.startsWith('route ')).slice(0, 1).map((r) => call('route_authz', { route: (r.entry ?? '').slice(6) })),
    ],
  };
}

// ---------- routes ----------

const METHOD = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|ANY)\s+/i;

// "/article/:id/font", "/article/{article-id}/font/" and "GET /article/{p}/font @x" all canonicalise to
// "/article/{p}/font"; the method, if any, is returned separately.
export function canonicalRoute(input: string): { method: string | null; path: string } {
  let s = input.trim();
  if (s.startsWith('route:')) s = s.slice('route:'.length);
  const m = s.match(METHOD);
  const method = m ? m[1].toUpperCase() : null;
  if (m) s = s.slice(m[0].length);
  s = s.replace(/\s+@.*$/, '').replace(/[?#].*$/, '');
  const segs = s.split('/').map((seg) => (/^(:.+|\{.*\}|\*.*)$/.test(seg) ? '{p}' : seg));
  let path = segs.join('/');
  if (!path.startsWith('/')) path = `/${path}`;
  if (path.length > 1) path = path.replace(/\/+$/, '');
  return { method, path };
}

function routePaths(n: GraphNode): string[] {
  const a = n.attrs ?? {};
  return [a.path, a.full_path].filter((p): p is string => typeof p === 'string').map((p) => canonicalRoute(p).path);
}

function routeMethod(n: GraphNode): string | null {
  const m = n.attrs?.method;
  return typeof m === 'string' ? m.replace(/^:/, '').toUpperCase() : null;
}

export function findRoutes(g: Graph, query: string): GraphNode[] {
  const byId = g.byId.get(query.trim()) ?? g.byId.get(`route:${query.trim()}`);
  if (byId && byId.kind === 'route') return [byId];
  const { method, path } = canonicalRoute(query);
  const routes = (g.byKind.get('route') ?? []).filter((n) => !method || routeMethod(n) === method || routeMethod(n) === 'ANY');
  const exact = routes.filter((n) => routePaths(n).includes(path));
  if (exact.length) return exact;
  // otherwise the query's segments must appear as whole consecutive segments of the path: "/font" finds
  // /article/{p}/font, but "/" or "/fo" finds nothing
  const want = path.split('/').filter((x) => x !== '');
  if (!want.length) return [];
  const has = (p: string) => {
    const segs = p.split('/').filter((x) => x !== '');
    for (let i = 0; i + want.length <= segs.length; i++) if (want.every((w, k) => segs[i + k] === w)) return true;
    return false;
  };
  return routes.filter((n) => routePaths(n).some(has));
}

// route_authz answers this many matching routes in full; the rest are counted
const MAX_ROUTE_ANSWERS = 10;

interface PermEdge {
  edge: GraphEdge;
  check: number;
  checks: number;
  alternative: number;
  alternatives: number;
  allOf: number;
}

const num = (v: unknown, d: number): number => (typeof v === 'number' ? v : d);

function permEdges(edges: GraphEdge[]): PermEdge[] {
  return edges.map((e) => ({
    edge: e,
    check: num(e.attrs?.check, 1),
    checks: num(e.attrs?.checks, 1),
    alternative: num(e.attrs?.alternative, 1),
    alternatives: num(e.attrs?.alternatives, 1),
    allOf: num(e.attrs?.all_of, 1),
  }));
}

// (a OR b) AND c: every check must pass, any alternative of a check passes it, all permissions of an
// alternative are needed.
export function permissionExpression(g: Graph, edges: GraphEdge[]): string {
  const ps = permEdges(edges);
  const checks = [...new Set(ps.map((p) => p.check))].sort((a, b) => a - b);
  const name = (p: PermEdge) => g.byId.get(p.edge.to)?.name ?? p.edge.to;
  const parts = checks.map((c) => {
    const inCheck = ps.filter((p) => p.check === c);
    const alts = [...new Set(inCheck.map((p) => p.alternative))].sort((a, b) => a - b);
    const altText = alts.map((a) => {
      const perms = inCheck.filter((p) => p.alternative === a).map(name).sort();
      return perms.length > 1 ? `(${perms.join(' AND ')})` : perms[0];
    });
    return altText.length > 1 ? `(${altText.join(' OR ')})` : altText[0];
  });
  return parts.join(' AND ');
}

function permDetail(p: PermEdge): string {
  const bits = [`check ${p.check}/${p.checks}`];
  if (p.alternatives > 1) bits.push(`any of ${p.alternatives} (alt ${p.alternative})`);
  if (p.allOf > 1) bits.push(`all of ${p.allOf}`);
  if (typeof p.edge.attrs?.tenant === 'string') bits.push(`scope ${p.edge.attrs.tenant}`);
  return bits.join(', ');
}

export type AuthzState = 'permission' | 'exempt' | 'none' | 'unknown';

// Without an available route_authz capability no route's check was extracted: a route with no edge is unknown, not unguarded.
const routeAuthzMissing = (g: Graph): boolean => capability(g, 'route_authz')?.status !== 'available';
const ROUTE_AUTHZ_MISSING = 'not provable: route authz not in this graph';

export function routeVerdict(g: Graph, routeId: string): { state: AuthzState; text: string } {
  const permE = outEdges(g, routeId, ['requires_permission']);
  const exempt = outEdges(g, routeId, ['exempted_by']);
  if (!permE.length && !exempt.length && routeAuthzMissing(g)) return { state: 'unknown', text: ROUTE_AUTHZ_MISSING };
  if (permE.length) {
    const unknown = permE.some((e) => e.band === 'unknown');
    const text = `requires ${permissionExpression(g, permE)}${unknown ? ' (includes an UNKNOWN check: decided at runtime, not absent)' : ''}`;
    return { state: unknown ? 'unknown' : 'permission', text };
  }
  if (exempt.length) return { state: 'exempt', text: `exempt: ${exempt.map((e) => g.byId.get(e.to)?.name ?? e.to).join('; ')}` };
  return { state: 'none', text: 'NO permission check and NO exemption recorded' };
}

// The other routes defined in the same file and what they have: the odd one out is the finding.
export function routeSiblings(g: Graph, route: GraphNode): { text: string; odd: boolean } | null {
  if (!route.file) return null;
  // the same base and mount only; another served copy of the same path is the same route, not a sibling
  const mount = (n: GraphNode) => `${String(n.attrs?.base ?? '')}\0${String(n.attrs?.mount ?? '')}`;
  const samePath = (n: GraphNode) => n.attrs?.path !== undefined && n.attrs.path === route.attrs?.path && n.attrs?.method === route.attrs?.method;
  const sibs = (g.byKind.get('route') ?? []).filter((n) => n.file === route.file && n.id !== route.id && mount(n) === mount(route) && !samePath(n));
  if (!sibs.length) return null;
  const states = sibs.map((s) => routeVerdict(g, s.id).state);
  const perm = states.filter((s) => s === 'permission' || s === 'unknown').length;
  const exempt = states.filter((s) => s === 'exempt').length;
  const none = states.filter((s) => s === 'none').length;
  const mine = routeVerdict(g, route.id).state;
  const odd = mine === 'none' && perm > sibs.length / 2;
  return {
    text: `${sibs.length} sibling route(s) in ${route.file}: ${perm} check a permission, ${exempt} exempt, ${none} neither${odd ? '; this route lacks the check its siblings have' : ''}`,
    odd,
  };
}

export function routeAuthz(g: Graph, query: string): QueryResult {
  const title = `route authz of ${query}`;
  const found = findRoutes(g, query);
  if (!found.length) return notFound('route_authz', query, title, 'route', 'paths match with :param and {param} segments treated alike');
  const routes = found.slice(0, MAX_ROUTE_ANSWERS);
  const sections: Section[] = [];
  const notes: string[] = [...capabilityNotes(g, ['route_authz'])];
  const verdicts: string[] = [];
  const next: string[] = [];
  if (found.length > routes.length) notes.push(`${found.length} routes match; the first ${routes.length} are answered, pass a longer path or a method for the rest`);
  else if (routes.length > 1) notes.push(`${routes.length} routes match; each served copy is listed separately`);
  for (const r of routes) {
    const a = r.attrs ?? {};
    const where = [a.base && `base ${String(a.base)}`, a.mount && `mount ${String(a.mount)}`].filter(Boolean).join(', ');
    const head = `${r.name}${where ? ` (${where})` : ''}`;
    const handler = outEdges(g, r.id, ['routes_to']).map((e) => edgeRow(g, e.to, e));
    const mw = outEdges(g, r.id, ['guarded_by'])
      .slice()
      .sort((x, y) => num(x.attrs?.order, 0) - num(y.attrs?.order, 0))
      .map((e) => edgeRow(g, e.to, e, {
        detail: [`#${num(e.attrs?.order, 0)}`, e.attrs?.level && `${String(e.attrs.level)}`, e.attrs?.inherited_from && `inherited from ${String(e.attrs.inherited_from)}`]
          .filter(Boolean).join(' '),
      }));
    const permE = outEdges(g, r.id, ['requires_permission']);
    const perms = permEdges(permE)
      .sort((x, y) => x.check - y.check || x.alternative - y.alternative)
      .map((p) => edgeRow(g, p.edge.to, p.edge, { detail: permDetail(p) }));
    const exempt = outEdges(g, r.id, ['exempted_by']).map((e) => edgeRow(g, e.to, e, { detail: 'exempt' }));
    const verdict = routeVerdict(g, r.id).text;
    verdicts.push(routes.length > 1 ? `${r.name}: ${verdict}` : verdict);
    sections.push(
      { name: `${head}: verdict ${verdict}`, short: 'route', rows: [nodeRow(r)], ordered: true },
      { name: `${head}: handler`, short: 'handler', rows: handler, ordered: true, searched: 'routes_to edges' },
      { name: `${head}: middleware (outermost first)`, short: 'middleware', rows: mw, ordered: true, searched: 'guarded_by edges' },
      { name: `${head}: permissions`, short: 'permissions', rows: perms, ordered: true, searched: 'requires_permission edges' },
      { name: `${head}: exempt`, short: 'exempt', rows: exempt, ordered: true, searched: 'exempted_by edges' },
    );
    const sib = routeSiblings(g, r);
    if (sib) notes.push(`${r.name}: ${sib.text}`);
    notes.push(...unknownNote([...handler, ...mw, ...perms]));
    for (const p of perms.slice(0, 1)) next.push(call('permission_routes', { permission: p.label }));
  }
  next.push(call('tests_covering', { target: query }));
  return { name: 'route_authz', query, title, verdict: `${verdicts.join('; ')}${found.length > routes.length ? `; +${found.length - routes.length} more routes` : ''}`, found: true, matches: routes.map((r) => r.id), sections, notes: [...new Set(notes)], next: [...new Set(next)].slice(0, 3) };
}

export function permissionRoutes(g: Graph, query: string): QueryResult {
  const title = `routes requiring ${query}`;
  const hits = resolve(g, ['permission'], query);
  if (!hits.length) return notFound('permission_routes', query, title, 'permission');
  if (hits.length > 1) return ambiguous('permission_routes', query, title, hits, 'permission');
  const perm = hits[0];
  const perms = permEdges(inEdges(g, perm.id, ['requires_permission']));
  const rows = perms
    .map((p) => {
      const route = g.byId.get(p.edge.from);
      const write = /^(POST|PUT|PATCH|DELETE)\b/.test(route ? String(routeMethod(route) ?? '') : '');
      return edgeRow(g, p.edge.from, p.edge, { detail: permDetail(p), ...(route?.component ? { component: route.component } : {}), ...(write ? { entry: 'write method' } : {}) });
    })
    .sort((a, b) => compareText(a.label, b.label));
  const alone = perms.filter((p) => p.alternatives === 1).length;
  return {
    name: 'permission_routes',
    query,
    title: `routes requiring ${perm.name}`,
    verdict: `guards ${rows.length} route copy(ies): ${alone} require it, ${rows.length - alone} accept it as one of alternatives`,
    found: true,
    matches: [perm.id],
    sections: [{ name: 'routes', rows, searched: 'requires_permission edges into this permission' }],
    counts: { required: alone, 'one of alternatives': rows.length - alone },
    notes: [...capabilityNotes(g, ['route_authz']), ...unknownNote(rows)],
    next: rows.slice(0, 1).map((r) => call('route_authz', { route: r.id.replace(/^route:/, '') })),
  };
}

// ---------- data attributes ----------

export interface Likeness {
  score: number;
  why: string;
}

const TX_NAME = /(^|[-!])(tx|txes|transact)([-!?]|$)/;
const WRITE_NAME = /(^|-)(save|publish|update|create|set|delete|retract|upsert|add|import|migrate)/;
const TEST_FILE = /(^|\/)test\//;
const READ_NAME = /(^|[-/.>])(get|find|load|query|pull|pattern|by|fetch|read|list)/;

// How much an unproven attribute reference looks like a write, from its DB context label and caller name.
export function writeLikeness(context: string, caller: string, file: string | null): Likeness {
  const name = caller.slice(caller.lastIndexOf('/') + 1);
  let score = 0;
  const why: string[] = [];
  if (/:db\/(add|retract|cas)|:db\.fn\//.test(context)) { score += 8; why.push(`${context} op`); }
  else if (/transact|datomic\.api\/with/.test(context)) { score += 6; why.push('inside transaction data'); }
  else if (/:db\/id-map/.test(context)) { score += 4; why.push('map with :db/id'); }
  if (TX_NAME.test(name)) { score += 3; why.push(`name ${name}`); }
  if (WRITE_NAME.test(name)) { score += 2; if (!why.some((w) => w.startsWith('name'))) why.push(`name ${name}`); }
  if (file && TEST_FILE.test(file)) { score -= 5; why.push('test code'); }
  return { score, why: why.join(', ') || 'no write signal' };
}

export function readLikeness(context: string, caller: string, file: string | null): Likeness {
  const name = caller.slice(caller.lastIndexOf('/') + 1);
  let score = 0;
  const why: string[] = [];
  if (/@datomic\.api\/(q|pull|entity)|non-write-position/.test(context)) { score += 6; why.push(`${context}`); }
  if (READ_NAME.test(name)) { score += 2; why.push(`name ${name}`); }
  if (file && TEST_FILE.test(file)) { score -= 5; why.push('test code'); }
  return { score, why: why.join(', ') || 'no read signal' };
}

// Proven readers and writers; references whose role is unproven become UNKNOWN rows under writers or
// readers (whichever they look more like), ranked by that likeness, so "none" never hides an unproven writer.
export function attributeUsage(g: Graph, query: string): QueryResult {
  const title = `usage of ${query}`;
  const hits = resolve(g, ['data_attribute', 'data_value'], query);
  if (!hits.length) return notFound('attribute_usage', query, title, 'data attribute');
  if (hits.length > 1) return ambiguous('attribute_usage', query, title, hits, 'attr');
  const attr = hits[0];
  const rowsOf = (kind: string) => inEdges(g, attr.id, [kind]).map((e) => edgeRow(g, e.from, e));
  const readers = rowsOf('reads');
  const writers = rowsOf('writes');
  const uncertainW: { row: Row; score: number }[] = [];
  const uncertainR: { row: Row; score: number }[] = [];
  for (const e of inEdges(g, attr.id, ['references'])) {
    const context = typeof e.attrs?.context === 'string' ? e.attrs.context : 'reference';
    const caller = g.byId.get(e.from)?.name ?? e.from;
    const w = writeLikeness(context, caller, e.file);
    const r = readLikeness(context, caller, e.file);
    const asWrite = w.score >= r.score;
    const l = asWrite ? w : r;
    const row = edgeRow(g, e.from, e, { band: 'unknown', detail: `${asWrite ? 'possible write' : 'possible read'}: ${l.why}; context ${context}` });
    (asWrite ? uncertainW : uncertainR).push({ row, score: l.score });
  }
  const ranked = (xs: { row: Row; score: number }[]) => xs
    .sort((x, y) => y.score - x.score || compareText(x.row.file ?? '', y.row.file ?? '') || (x.row.line ?? 0) - (y.row.line ?? 0))
    .map((x) => x.row);
  const wRows = [...writers, ...ranked(uncertainW)];
  const rRows = [...readers, ...ranked(uncertainR)];
  const sections: Section[] = [
    { name: 'definition', rows: [nodeRow(attr)], ordered: true },
    { name: 'writers', rows: wRows, searched: 'proven write edges and unproven references' },
    { name: 'readers', rows: rRows, searched: 'proven read edges and unproven references' },
  ];
  const notes = [...capabilityNotes(g, ['data_attributes'])];
  if (uncertainW.length || uncertainR.length) {
    notes.push(`${uncertainW.length + uncertainR.length} reference(s) are not proven reads or writes; listed as UNKNOWN under the role they look more like`);
  }
  const firstWriter = writers[0] ?? wRows[0];
  return {
    name: 'attribute_usage',
    query,
    title: `usage of ${attr.name}`,
    verdict: `${writers.length} proven writer(s), ${uncertainW.length} uncertain; ${readers.length} proven reader(s), ${uncertainR.length} uncertain`,
    found: true,
    matches: [attr.id],
    sections,
    counts: { 'proven writers': writers.length, 'uncertain writers': uncertainW.length, 'proven readers': readers.length, 'uncertain readers': uncertainR.length },
    notes,
    next: [call('tests_for', { symbol: attr.name }), ...(firstWriter ? [call('blast_radius', { var: firstWriter.label })] : [])],
  };
}

// ---------- events ----------

export function eventFlow(g: Graph, query: string): QueryResult {
  const title = `event flow of ${query}`;
  const hits = resolve(g, ['event', 'subscription'], query);
  if (!hits.length) return notFound('event_flow', query, title, 'event or subscription');
  const sections: Section[] = [];
  const all: Row[] = [];
  const verdicts: string[] = [];
  for (const n of hits) {
    const head = `${n.kind} ${n.name}`;
    const handlers = outEdges(g, n.id, ['registers']).map((e) => edgeRow(g, e.to, e));
    if (n.kind === 'event') {
      const dispatchers = inEdges(g, n.id, ['dispatches']).map((e) => edgeRow(g, e.from, e));
      const next = handlers.flatMap((h) => outEdges(g, h.id, ['dispatches']).map((e) => edgeRow(g, e.to, e, { parentLabel: h.label })));
      const requests = handlers.flatMap((h) => outEdges(g, h.id, ['issues_request']).map((e) => edgeRow(g, e.to, e, {
        detail: [e.attrs?.method, e.attrs?.path].filter(Boolean).map(String).join(' '),
      })));
      sections.push(
        { name: `${head}: dispatched by`, short: 'dispatched by', rows: dispatchers, searched: 'dispatches edges' },
        { name: `${head}: handler`, short: 'handler', rows: handlers, ordered: true, searched: 'registers edges' },
        { name: `${head}: handler dispatches`, short: 'handler dispatches', rows: next, ordered: true, searched: 'dispatches edges out of the handler' },
        { name: `${head}: handler requests`, short: 'handler requests', rows: requests, ordered: true, searched: 'issues_request edges out of the handler' },
      );
      verdicts.push(`${n.name}: dispatched from ${dispatchers.length} site(s), ${handlers.length} handler(s), fires ${next.length} event(s) and ${requests.length} request(s)`);
      all.push(...dispatchers, ...handlers, ...next, ...requests);
    } else {
      const subscribers = inEdges(g, n.id, ['subscribes']).map((e) => edgeRow(g, e.from, e));
      const inputs = handlers.flatMap((h) => outEdges(g, h.id, ['subscribes']).map((e) => edgeRow(g, e.to, e)));
      sections.push(
        { name: `${head}: handler`, short: 'handler', rows: handlers, ordered: true, searched: 'registers edges' },
        { name: `${head}: handler reads subscriptions`, short: 'handler reads subscriptions', rows: inputs, ordered: true, searched: 'subscribes edges out of the handler' },
        { name: `${head}: subscribed by`, short: 'subscribed by', rows: subscribers, searched: 'subscribes edges' },
      );
      verdicts.push(`${n.name}: ${handlers.length} handler(s), ${inputs.length} input subscription(s), ${subscribers.length} subscriber(s)`);
      all.push(...handlers, ...inputs, ...subscribers);
    }
    if (!handlers.length) sections.push({ name: `${head}: no registered handler in this graph`, rows: [] });
  }
  return {
    name: 'event_flow',
    query,
    title,
    verdict: verdicts.join('; '),
    found: true,
    matches: hits.map((n) => n.id),
    sections,
    notes: [...capabilityNotes(g, ['events']), ...unknownNote(all)],
    next: [call('tests_for', { symbol: hits[0].name })],
  };
}

// ---------- browser tests ----------

interface Hit {
  test: string;
  band: Band;
  via: string;
  depth?: number;
}

function addHit(acc: Map<string, Hit>, hit: Hit): void {
  const prev = acc.get(hit.test);
  if (!prev || BANDS.indexOf(hit.band) < BANDS.indexOf(prev.band)
    || (hit.band === prev.band && (hit.depth ?? 0) < (prev.depth ?? 0))) acc.set(hit.test, hit);
}

// Tests that reach a page-object member: directly (calls / asserts_on) or through one member that calls it.
function testsOfMember(g: Graph, member: string, band: Band, via: string, acc: Map<string, Hit>, depth?: number): void {
  for (const e of inEdges(g, member, ['calls', 'asserts_on'])) {
    const from = g.byId.get(e.from);
    if (from?.kind === 'test') addHit(acc, { test: e.from, band: weakest(band, e.band), via, depth });
    else if (from?.kind === 'page_object_member') {
      for (const e2 of inEdges(g, e.from, ['calls', 'asserts_on'])) {
        if (g.byId.get(e2.from)?.kind === 'test') addHit(acc, { test: e2.from, band: weakest(weakest(band, e.band), e2.band), via: `${via} via ${from.name}`, depth });
      }
    }
  }
}

function testsOfSelector(g: Graph, selector: string, band: Band, acc: Map<string, Hit>, depth?: number, prefix = ''): void {
  const name = g.byId.get(selector)?.name ?? selector;
  for (const e of inEdges(g, selector, ['uses_selector'])) {
    testsOfMember(g, e.from, weakest(band, e.band), `${prefix}${name} <- ${g.byId.get(e.from)?.name ?? e.from}`, acc, depth);
  }
}

function testsOfRoute(g: Graph, route: string, band: Band, acc: Map<string, Hit>, depth?: number, prefix = ''): void {
  const name = g.byId.get(route)?.name ?? route;
  for (const e of inEdges(g, route, ['requests_route'])) {
    for (const e2 of inEdges(g, e.from, ['awaits_request', 'issues_request'])) {
      if (g.byId.get(e2.from)?.kind === 'test') addHit(acc, { test: e2.from, band: weakest(weakest(band, e.band), e2.band), via: `${prefix}route ${name}`, depth });
    }
  }
}

function testsOfDefinition(g: Graph, def: string, band: Band, acc: Map<string, Hit>, depth?: number, prefix = ''): void {
  for (const e of outEdges(g, def, ['renders'])) testsOfSelector(g, e.to, weakest(band, e.band), acc, depth, prefix);
  for (const e of inEdges(g, def, ['routes_to'])) testsOfRoute(g, e.from, weakest(band, e.band), acc, depth, prefix);
}

function hitRows(g: Graph, acc: Map<string, Hit>, kind: string): Row[] {
  return [...acc.values()]
    .map((h) => {
      const t = g.byId.get(h.test);
      return {
        label: t?.name ?? h.test, id: h.test, file: t?.file ?? null, line: t?.line ?? null, band: h.band, kind, detail: h.via,
        ...(t?.component ? { component: t.component } : {}), ...(h.depth !== undefined ? { depth: h.depth } : {}),
      };
    })
    .sort((a, b) => compareText(a.file ?? '', b.file ?? '') || (a.line ?? 0) - (b.line ?? 0));
}

const TARGET_KINDS = ['selector', 'selector_pattern', 'route', 'definition', 'page_object_member'] as const;

export function testsCovering(g: Graph, query: string): QueryResult {
  const title = `tests covering ${query}`;
  const q = query.trim();
  const acc = new Map<string, Hit>();
  let matches: GraphNode[] = [];
  const fileNodes = g.doc.nodes.filter((n) => n.file === q);
  if (fileNodes.length) {
    matches = fileNodes;
    for (const n of fileNodes) {
      if (n.kind === 'definition') testsOfDefinition(g, n.id, 'static_proven', acc);
      else if (n.kind === 'route') testsOfRoute(g, n.id, 'static_proven', acc);
      else if (n.kind === 'test') addHit(acc, { test: n.id, band: 'static_proven', via: 'declared in this file' });
    }
  } else {
    matches = resolve(g, TARGET_KINDS, q);
    if (!matches.length) matches = findRoutes(g, q);
    for (const n of matches) {
      if (n.kind === 'selector' || n.kind === 'selector_pattern') testsOfSelector(g, n.id, 'static_proven', acc);
      else if (n.kind === 'route') testsOfRoute(g, n.id, 'static_proven', acc);
      else if (n.kind === 'definition') testsOfDefinition(g, n.id, 'static_proven', acc);
      else if (n.kind === 'page_object_member') testsOfMember(g, n.id, 'static_proven', n.name, acc);
    }
  }
  if (!matches.length) return notFound('tests_covering', q, title, 'file, definition, selector or route');
  const rows = hitRows(g, acc, 'test');
  const notes = [...capabilityNotes(g, ['selectors', 'browser_tests']), ...unknownNote(rows)];
  if (!rows.length) notes.push('no browser test reaches this target through selectors, page objects or requests');
  return {
    name: 'tests_covering',
    query: q,
    title,
    verdict: `${rows.length} browser test(s) in ${new Set(rows.map((r) => r.file)).size} spec file(s)`,
    found: true,
    matches: matches.map((n) => n.id),
    sections: [{ name: 'tests', rows, searched: 'selector, page-object and request edges' }],
    counts: countBy(rows, (r) => r.file ?? '(no file)'),
    notes,
    next: [],
  };
}

// ---------- tests_for: unit tests and browser tests of one symbol ----------

// A test definition proper; helpers and fixtures in test code carry the test role too and are walked through.
export function isUnitTest(n: GraphNode | undefined): boolean {
  if (!n?.roles?.includes('test')) return false;
  const by = n.attrs?.defined_by;
  return typeof by !== 'string' || /deftest|defspec/.test(by);
}

const TESTS_FOR_LIMITS = 'static links only: tests reaching the target through multimethods, resolve/apply or HTTP fixtures are not counted; 0 tests means no static link, not untested';

export function testsFor(g: Graph, query: string, depth = MAX_DEPTH): QueryResult {
  const title = `tests for ${query}`;
  const hits = resolve(g, ['definition', 'data_attribute', 'data_value', 'event', 'subscription'], query);
  if (!hits.length) {
    const viaBrowser = testsCovering(g, query);
    if (!viaBrowser.found) return notFound('tests_for', query, title, 'definition, attribute, event, selector or route');
    return { ...viaBrowser, name: 'tests_for', title };
  }
  if (hits.length > 1) return ambiguous('tests_for', query, title, hits, 'symbol');
  const target = hits[0];
  const max = Math.max(1, Math.min(MAX_DEPTH, Math.floor(Number.isFinite(depth) ? depth : MAX_DEPTH)));
  // seeds: the definition itself, or the readers/writers/dispatchers/subscribers of a non-code target
  const seeds: { id: string; band: Band }[] = target.kind === 'definition'
    ? [{ id: target.id, band: 'static_proven' }]
    : inEdges(g, target.id, ['reads', 'writes', 'dispatches', 'subscribes', 'references'])
      .map((e) => ({ id: e.from, band: e.band }));
  const unit = new Map<string, Hit>();
  const browser = new Map<string, Hit>();
  let beyond = false;
  for (const seed of seeds) {
    const seedNode = g.byId.get(seed.id);
    const seedDepth = target.kind === 'definition' ? 0 : 1;
    if (target.kind !== 'definition' && isUnitTest(seedNode)) addHit(unit, { test: seed.id, band: seed.band, via: 'direct', depth: seedDepth || 1 });
    testsOfDefinition(g, seed.id, seed.band, browser, seedDepth || 1);
    const r = reverseReach(g, seed.id, max - seedDepth);
    beyond ||= r.beyond;
    for (const x of r.reached) {
      const n = g.byId.get(x.id);
      const band = weakest(seed.band, x.band);
      const d = x.depth + seedDepth;
      if (isUnitTest(n)) addHit(unit, { test: x.id, band, via: d === 1 ? 'direct' : `via ${g.byId.get(x.via)?.name ?? x.via}`, depth: d });
      testsOfDefinition(g, x.id, band, browser, d, `${n?.name ?? x.id} -> `);
    }
  }
  const unitRows = hitRows(g, unit, 'clojure.test');
  const browserRows = hitRows(g, browser, 'browser test');
  const ns = new Map<string, Set<string>>();
  for (const r of unitRows) {
    const i = r.label.lastIndexOf('/');
    if (i <= 0) continue;
    const comp = r.component ?? '(no component)';
    if (!ns.has(comp)) ns.set(comp, new Set());
    ns.get(comp)?.add(r.label.slice(0, i));
  }
  const notes = [TESTS_FOR_LIMITS, ...capabilityNotes(g, ['definitions', 'browser_tests']), ...unknownNote([...unitRows, ...browserRows])];
  if (beyond) notes.push(`callers continue beyond depth ${max}; tests further out are not listed`);
  for (const [comp, set] of ns) notes.push(`run in ${comp}: ${[...set].sort().join(' ')}`);
  const direct = unitRows.filter((r) => r.depth === 1).length;
  return {
    name: 'tests_for',
    query,
    title: `tests for ${target.name}`,
    verdict: `${unitRows.length} unit test(s) (${direct} direct, ${unitRows.length - direct} transitive) and ${browserRows.length} browser test(s) reach it`,
    found: true,
    matches: [target.id],
    sections: [
      { name: 'clojure.test', rows: unitRows, searched: `test definitions calling it up to depth ${max}` },
      { name: 'browser tests', rows: browserRows, searched: 'selectors rendered and routes handled along the same callers' },
    ],
    counts: { 'unit direct': direct, 'unit transitive': unitRows.length - direct, browser: browserRows.length },
    notes,
    next: target.kind === 'definition' ? [call('blast_radius', { var: target.name, depth: 2 })] : [],
  };
}

// ---------- context_for_change: one call per review ----------

export interface Change {
  file: string;
  ranges: [number, number][];
}

// "src/a.clj", "src/a.clj:12", "src/a.clj:10-20", "src/a.clj:3-4,9-12"
export function parseChange(spec: string): Change {
  const s = spec.trim();
  const m = s.match(/^(.*?):((?:\d+(?:-\d+)?)(?:,\d+(?:-\d+)?)*)$/);
  if (!m) return { file: s, ranges: [] };
  const ranges = m[2].split(',').map((p) => {
    const [a, b] = p.split('-').map((x) => Number.parseInt(x, 10));
    return [Math.min(a, b ?? a), Math.max(a, b ?? a)] as [number, number];
  });
  return { file: m[1], ranges };
}

const CHANGE_KINDS = new Set(['definition', 'route', 'handler', 'data_attribute', 'page_object_member', 'test']);

function touched(n: GraphNode, c: Change): boolean {
  if (n.file !== c.file || !CHANGE_KINDS.has(n.kind)) return false;
  if (!c.ranges.length) return true;
  if (n.line === undefined) return false;
  const end = n.end_line ?? n.line;
  return c.ranges.some(([a, b]) => n.line !== undefined && n.line <= b && end >= a);
}

export interface ChangeOptions {
  // files the change deletes (base paths): their symbols are gone, so a caller outside the diff breaks
  deleted?: readonly string[];
  // files the change adds, against a graph that predates them: new, so their lack of nodes says nothing
  added?: readonly string[];
}

// A file's language family: a graph that indexes one Clojure (or one JS/TS) dialect is taken to cover the others.
const FAMILIES: Record<string, string> = { '.clj': 'clj', '.cljs': 'clj', '.cljc': 'clj', '.bb': 'clj', '.ts': 'js', '.tsx': 'js', '.js': 'js', '.jsx': 'js', '.mjs': 'js', '.cjs': 'js' };
const extOf = (f: string): string => {
  const ext = /\.[^./]+$/.exec(f)?.[0] ?? '';
  return FAMILIES[ext] ?? ext;
};

// A finding of one step: its row, and whether it makes the whole risk HIGH.
interface Risk {
  row: Row;
  high: boolean;
}

const risks = (rows: Row[], high: boolean): Risk[] => rows.map((row) => ({ row, high }));

// Callers of the changed symbols that are not in the diff; a caller of a symbol the change deletes is a HIGH risk.
function outsideCallers(g: Graph, changed: GraphNode[], deleted: Set<string>): { outside: Row[]; broken: Risk[] } {
  const changedIds = new Set(changed.map((n) => n.id));
  const outside: Row[] = [];
  const broken: Row[] = [];
  for (const n of changed) {
    const gone = n.file !== undefined && deleted.has(n.file);
    for (const e of inEdges(g, n.id, DEPENDENCY_KINDS)) {
      if (changedIds.has(e.from)) continue;
      const r = edgeRow(g, e.from, e, { parentId: n.id, parentLabel: n.name, depth: 1 });
      const row = { ...r, cross: !!r.component && r.component !== n.component, ...(gone ? { detail: `calls ${n.name}, which this change deletes` } : {}) };
      outside.push(row);
      if (gone) broken.push({ ...row, detail: `broken candidate: calls ${n.name}, which this change deletes` });
    }
  }
  return { outside, broken: risks(broken, true) };
}

// Routes touched directly or through their handler: their authz rows, and the routes without a provable check as HIGH risks.
function routeAuthzRows(g: Graph, changed: GraphNode[]): { routeIds: Set<string>; authz: Row[]; risk: Risk[] } {
  const routeIds = new Set<string>();
  for (const n of changed) {
    if (n.kind === 'route') routeIds.add(n.id);
    for (const e of inEdges(g, n.id, ['routes_to'])) routeIds.add(e.from);
  }
  const authz: Row[] = [];
  const risk: Risk[] = [];
  const noAuthz = routeAuthzMissing(g);
  for (const id of routeIds) {
    const route = g.byId.get(id);
    if (!route) continue;
    const v = routeVerdict(g, id);
    const sib = routeSiblings(g, route);
    authz.push(nodeRow(route, { detail: v.text + (sib ? `; ${sib.text}` : '') }));
    if (v.state === 'none') risk.push(...risks([nodeRow(route, { detail: `route has no permission check and no exemption${sib?.odd ? '; its siblings check one' : ''}` })], true));
    // without the capability nothing was extracted: say so once in the notes, never as a finding about the route
    if (v.state === 'unknown' && !noAuthz) risk.push(...risks([nodeRow(route, { band: 'unknown', detail: 'permission check decided at runtime; not provable; evidence in the route data' })], true));
  }
  return { routeIds, authz, risk };
}

// Attributes the changed code reads or writes; a write to an attribute that is read elsewhere is a risk.
function attributeRows(g: Graph, changed: GraphNode[]): { attrs: Row[]; risk: Risk[] } {
  const attrs: Row[] = [];
  const risk: Row[] = [];
  for (const n of changed) {
    for (const e of outEdges(g, n.id, ['reads', 'writes'])) {
      const writers = inEdges(g, e.to, ['writes']).length;
      const readers = inEdges(g, e.to, ['reads']).length;
      attrs.push(edgeRow(g, e.to, e, { detail: `${e.kind} by ${n.name}; ${writers} writer(s), ${readers} reader(s) in total` }));
      if (e.kind === 'writes' && readers > 0) risk.push(edgeRow(g, e.to, e, { detail: `changed code writes ${g.byId.get(e.to)?.name ?? e.to}, read in ${readers} place(s)` }));
    }
  }
  return { attrs, risk: risks(risk, false) };
}

// Tests to run, each naming the changed symbol it reaches (parentLabel, the nearest one when it reaches several), and
// the changed definitions no test reaches.
function testRows(g: Graph, changed: GraphNode[]): { run: Row[]; add: Row[] } {
  const runById = new Map<string, Row>();
  const add: Row[] = [];
  for (const n of changed.filter((x) => x.kind === 'definition' && !x.roles?.includes('test'))) {
    const ts = testsFor(g, n.id, 2).sections.flatMap((s) => s.rows);
    for (const r of ts) {
      const prev = runById.get(r.id);
      if (prev === undefined || (r.depth ?? 0) < (prev.depth ?? 0)) runById.set(r.id, { ...r, parentId: n.id, parentLabel: n.name });
    }
    if (!ts.length) add.push(nodeRow(n, { detail: 'no test reaches it statically' }));
  }
  return { run: [...runById.values()], add };
}

// Notes on what the graph cannot speak for: files with no node on the changed lines, added files, file types it never indexes.
function coverageNotes(g: Graph, changes: Change[], changed: GraphNode[], added: Set<string>): { uncovered: number; notes: string[] } {
  const unmatched = changes.filter((c) => !changed.some((n) => n.file === c.file));
  // a file in a language the graph covers but with no node on the changed lines: the graph cannot speak for it
  const graphExts = new Set(g.doc.nodes.map((n) => (n.file ? extOf(n.file) : '')).filter((x) => x !== ''));
  const uncovered = unmatched.filter((c) => graphExts.has(extOf(c.file)));
  const missing = uncovered.filter((c) => !added.has(c.file));
  const newFiles = uncovered.length - missing.length;
  const otherTypes = unmatched.filter((c) => !added.has(c.file) && !graphExts.has(extOf(c.file)));
  const notes: string[] = [];
  // one note per cause: an existing file in a language the graph indexes but with no node is a coverage gap; an
  // added file is new code the graph predates; a file type the graph never indexes (translations, styles, docs) is counted
  if (missing.length) {
    const names = missing.slice(0, 3).map((c) => c.file).join(', ');
    notes.push(`no graph node in ${missing.length} file(s): ${names}${missing.length > 3 ? ` +${missing.length - 3} more` : ''} (or outside the given lines): not covered by this graph`);
  }
  if (newFiles) notes.push(`${newFiles} added file(s) are newer than this graph: their routes, writes and callers are not in it`);
  if (otherTypes.length) notes.push(`${otherTypes.length} changed file(s) of a type this graph does not index (${[...new Set(otherTypes.map((c) => /\.[^./]+$/.exec(c.file)?.[0] ?? 'no extension'))].slice(0, 4).join(', ')})`);
  return { uncovered: uncovered.length, notes };
}

export function contextForChange(g: Graph, specs: string[], opts: ChangeOptions = {}): QueryResult {
  const changes = specs.map(parseChange).filter((c) => c.file);
  const title = `context for change (${changes.length} file(s))`;
  const changed = g.doc.nodes.filter((n) => changes.some((c) => touched(n, c)));
  const { outside, broken } = outsideCallers(g, changed, new Set(opts.deleted ?? []));
  const { routeIds, authz, risk: routeRisk } = routeAuthzRows(g, changed);
  const { attrs, risk: attrRisk } = attributeRows(g, changed);
  const { run, add } = testRows(g, changed);
  const entryRisk = risks(outside.filter((x) => x.cross && x.entry).map((r) => ({ ...r, detail: `entry point in another component calls ${r.parentLabel}` })), false);
  const tableKeys = changeKeyRows(g, changes);
  const keyRows = [...changeSignatureRows(g, changed.filter((x) => x.kind === 'definition')), ...tableKeys.rows];
  const found = [...broken, ...routeRisk, ...attrRisk, ...entryRisk, ...risks(keyRows.map((r) => ({ ...r, detail: r.label })), false)];
  const risk = found.map((x) => x.row);
  const cover = coverageNotes(g, changes, changed, new Set(opts.added ?? []));
  const coverage = cover.uncovered ? ` (${cover.uncovered} of ${changes.length} file(s) not covered)` : '';
  const level = found.some((x) => x.high) ? 'HIGH' : risk.length ? 'MEDIUM' : cover.uncovered ? 'UNKNOWN' : 'LOW';
  const notes = [
    ...unknownNote([...outside, ...authz, ...attrs]),
    ...(routeIds.size ? capabilityNotes(g, ['route_authz']) : []),
    ...(tableKeys.weak ? [`${tableKeys.weak} key-sibling row(s) dropped: the key they lack is absent in ${Math.round(WEAK_PATTERN_ABSENT * 100)}%+ of sibling rows, no sibling pattern`] : []),
    ...cover.notes,
  ];
  return {
    name: 'context_for_change',
    query: specs.join(' '),
    title,
    verdict: `${changes.length} file(s), ${changed.length} changed symbol(s), ${routeIds.size} route(s), ${new Set(attrs.map((a) => a.id)).size} attribute(s); risk ${level}${coverage}`,
    found: changed.length > 0,
    matches: changed.map((n) => n.id),
    sections: [
      { name: 'risk', rows: risk, ordered: true, searched: 'routes without a check, writes to read attributes, entry points in other components' },
      { name: 'changed symbols', rows: changed.map((n) => nodeRow(n)), searched: 'definitions, routes, handlers and attributes on the given lines' },
      { name: 'callers outside the diff', rows: outside, searched: 'call and reference edges into the changed symbols' },
      { name: 'route authz', rows: authz, ordered: true, searched: 'routes defined or handled by the changed code' },
      { name: 'attributes', rows: attrs, searched: 'reads and writes of the changed code' },
      { name: 'signatures and key siblings', short: 'keys', rows: keyRows, ordered: true, searched: 'callers of changed definitions with an undefined arity or a never-passed key; table rows on the changed lines lacking a sibling key' },
      { name: 'tests to run', rows: run, searched: 'unit tests up to depth 2 and browser tests' },
      { name: 'tests to add', rows: add, ordered: true, searched: 'changed definitions with no static test' },
    ],
    counts: { changed: changed.length, 'callers outside': outside.length, routes: routeIds.size, 'tests to run': run.length, 'tests to add': add.length },
    notes,
    next: [
      ...authz.slice(0, 1).map((r) => call('route_authz', { route: r.id.replace(/^route:/, '') })),
      ...changed.filter((n) => n.kind === 'definition').slice(0, 1).map((n) => call('blast_radius', { var: n.name, depth: 2 })),
    ],
  };
}
