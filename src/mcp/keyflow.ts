// signature_impact, key_flow and key_siblings over a version-2 code-graph (signature attrs on definitions,
// arity and passed keys on calls edges, *_key edges, key_table nodes). On a version-1 graph the answers say
// the capability is absent instead of "none".
import type { Band, Graph, GraphEdge, GraphNode } from './graph.ts';
import { BANDS, inEdges, compareText, weakest } from './graph.ts';
import {
  ambiguous, call, capabilityNotes, edgeRow, nodeRow, notFound, resolve, type QueryResult, type Row, type Section,
} from './rows.ts';
import { isTestFile } from '../shared/testfile.ts';


export interface ParamDesc {
  kind: string;
  name?: string;
  keys?: string[];
  as?: string;
  defaults?: string[];
  reads?: string[];
  reads_complete?: boolean;
  escapes?: string[];
}

export interface ArityDesc {
  params: ParamDesc[];
  variadic: boolean;
  platform?: string;
}

export interface CallArg {
  i: number;
  shape: string;
  keys?: string[];
  band: Band;
  dynamic_keys?: number;
  local?: string;
}

export interface CallAttrs {
  arity: number;
  arity_band: Band;
  args?: CallArg[];
  kwargs?: { keys: string[]; band: Band };
  arity_defined?: boolean;
}

export interface TableRow {
  line: number;
  keys: string[];
  tags?: Record<string, string>;
  vecs?: Record<string, string[]>;
  dynamic_keys?: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const asBand = (v: unknown, d: Band): Band => (typeof v === 'string' && (BANDS as readonly string[]).includes(v) ? (v as Band) : d);

export function signatureOf(n: GraphNode | undefined): ArityDesc[] | null {
  const sig = n?.attrs?.signature;
  if (!isObj(sig) || !Array.isArray(sig.arities)) return null;
  return sig.arities.filter(isObj).map((a) => ({
    params: (Array.isArray(a.params) ? a.params.filter(isObj) : []).map((p) => ({
      kind: String(p.kind ?? 'other'),
      ...(typeof p.name === 'string' ? { name: p.name } : {}),
      ...(Array.isArray(p.keys) ? { keys: strs(p.keys) } : {}),
      ...(typeof p.as === 'string' ? { as: p.as } : {}),
      ...(Array.isArray(p.defaults) ? { defaults: strs(p.defaults) } : {}),
      ...(Array.isArray(p.reads) ? { reads: strs(p.reads) } : {}),
      ...(typeof p.reads_complete === 'boolean' ? { reads_complete: p.reads_complete } : {}),
      ...(Array.isArray(p.escapes) ? { escapes: strs(p.escapes) } : {}),
    })),
    variadic: a.variadic === true,
    ...(typeof a.platform === 'string' ? { platform: a.platform } : {}),
  }));
}

function callAttrs(e: GraphEdge): CallAttrs | null {
  const a = e.attrs;
  if (!a || typeof a.arity !== 'number') return null;
  const args: CallArg[] | undefined = Array.isArray(a.args)
    ? a.args.filter(isObj).map((x) => ({
      i: Number(x.i),
      shape: String(x.shape ?? '?'),
      band: asBand(x.band, 'unknown'),
      ...(Array.isArray(x.keys) ? { keys: strs(x.keys) } : {}),
      ...(typeof x.local === 'string' ? { local: x.local } : {}),
      ...(typeof x.dynamic_keys === 'number' ? { dynamic_keys: x.dynamic_keys } : {}),
    }))
    : undefined;
  return {
    arity: a.arity,
    arity_band: asBand(a.arity_band, 'static_proven'),
    ...(args ? { args } : {}),
    ...(isObj(a.kwargs) ? { kwargs: { keys: strs(a.kwargs.keys), band: asBand(a.kwargs.band, 'unknown') } } : {}),
    ...(a.arity_defined === false ? { arity_defined: false } : {}),
  };
}

const REST = new Set(['rest', 'kwargs']);
const fixedCount = (a: ArityDesc) => a.params.filter((p) => !REST.has(p.kind)).length;

export function arityFor(arities: ArityDesc[], n: number): ArityDesc | undefined {
  return arities.find((a) => !a.variadic && fixedCount(a) === n) ?? arities.find((a) => a.variadic && n >= fixedCount(a));
}

const bare = (k: string) => k.replace(/^:/, '');

function paramText(p: ParamDesc): string {
  if (p.kind === 'map' || p.kind === 'kwargs') {
    const inner = [`:keys [${(p.keys ?? []).map(bare).join(' ')}]`, ...(p.as ? [`:as ${p.as}`] : [])].join(' ');
    return `${p.kind === 'kwargs' ? '& ' : ''}{${inner}}`;
  }
  if (p.kind === 'rest') return `& ${p.name ?? '_'}`;
  if (p.kind === 'vector') return '[...]';
  return p.name ?? '_';
}

const arityText = (a: ArityDesc) => `[${a.params.map(paramText).join(' ')}]${a.platform ? ` (${a.platform} only)` : ''}`;

const keyList = (ks: string[]) => `{${ks.join(' ')}}`;
const normKey = (k: string) => (k.startsWith(':') ? k : `:${k}`);
const shortName = (n: GraphNode) => n.name.split('/').pop() ?? n.name;

// ---------- signature_impact ----------

export interface SignatureChange {
  addedKeys?: string[];
  removedKeys?: string[];
  arities?: number[];
}

interface CallSite {
  edge: GraphEdge;
  caller: string;
  attrs: CallAttrs | null;
  arity?: ArityDesc;
}

function passedAt(c: CallSite, arity: ArityDesc | undefined, i: number): { keys: string[]; band: Band } | null {
  if (!c.attrs || !arity) return null;
  if (arity.params[i]?.kind === 'kwargs') return c.attrs.kwargs && c.attrs.kwargs.band !== 'unknown' ? c.attrs.kwargs : null;
  const a = c.attrs.args?.find((x) => x.i === i);
  if (!a || a.band === 'unknown' || !a.keys) return null;
  return { keys: a.keys, band: weakest(a.band, c.attrs.arity_band) };
}

function callLabel(c: CallSite): string {
  if (!c.attrs) return `${c.caller} (arguments not recorded)`;
  const parts: string[] = [`arity ${c.attrs.arity}`];
  for (const a of c.attrs.args ?? []) {
    if (a.keys && a.band !== 'unknown') parts.push(`arg${a.i} ${keyList(a.keys)}${a.band === 'heuristic' && a.local ? ` via local ${a.local}` : ''}`);
    else parts.push(`arg${a.i} ${a.shape}${a.local ? ` ${a.local}` : ''} (keys unknown)`);
  }
  if (c.attrs.kwargs) parts.push(`kwargs ${keyList(c.attrs.kwargs.keys)}`);
  return `${c.caller}: ${parts.join(', ')}`;
}

interface Findings {
  arityMissing: Row[];
  neverPassed: Row[];
  unread: Row[];
  unprovable: string[];
}

// A key counts as never passed only when every caller is known. A use as a value is a `references` edge whose via is
// not `refer` (the graph records dispatch maps, apply and partial there): its arguments are not visible, so it leaves no
// claim at all. A use the graph records no edge for is outside what this can know.
function signatureFindings(g: Graph, fn: GraphNode, arities: ArityDesc[], calls: CallSite[], usedAsValue: boolean): Findings {
  const out: Findings = { arityMissing: [], neverPassed: [], unread: [], unprovable: [] };
  for (const c of calls) {
    if (c.attrs && !c.arity) {
      out.arityMissing.push(edgeRow(g, c.edge.from, c.edge, {
        label: `${c.caller} calls ${shortName(fn)} with ${c.attrs.arity} argument(s)`,
        finding: 'arity-missing',
        band: c.attrs.arity_band,
        detail: `arity ${c.attrs.arity} is not defined; ${shortName(fn)} takes ${arities.map(arityText).join(' or ')}`,
      }));
    }
  }
  for (const a of arities) {
    const using = calls.filter((c) => c.arity === a);
    a.params.forEach((p, i) => {
      if (p.kind !== 'map' && p.kind !== 'kwargs' && !p.reads?.length) return;
      const seen = using.map((c) => ({ c, passed: passedAt(c, a, i) }));
      const proven = seen.filter((x) => x.passed);
      const unknownN = seen.length - proven.length;
      for (const k of usedAsValue || !proven.length ? [] : (p.keys ?? [])) {
        if (p.defaults?.includes(k) || proven.some((x) => x.passed?.keys.includes(k))) continue;
        out.neverPassed.push({
          label: `${shortName(fn)} destructures ${k} (param ${i}${arities.length > 1 ? `, arity ${fixedCount(a)}${a.variadic ? '+' : ''}` : ''}) but no caller passes it`,
          id: `${fn.id}#${i}${k}`,
          finding: 'never-passed',
          key: k,
          file: fn.file ?? null,
          line: fn.line ?? null,
          band: unknownN ? 'heuristic' : proven.reduce<Band>((b, x) => weakest(b, x.passed?.band ?? 'unknown'), 'static_proven'),
          ...(fn.component ? { component: fn.component } : {}),
          detail: `0 of ${proven.length} caller(s) with a known argument pass it${unknownN ? `; ${unknownN} caller(s) pass an argument whose keys are not provable` : ''}; no :or default`,
        });
      }
      if (proven.length && p.reads_complete === false) {
        out.unprovable.push(`param ${i} of ${arityText(a)} is passed on (${(p.escapes ?? []).join(', ') || 'escapes'}): keys it never reads are not provable`);
      }
      if (p.reads_complete !== true) return;
      const reads = new Set([...(p.reads ?? []), ...(p.keys ?? [])]);
      for (const x of proven) {
        const extra = (x.passed?.keys ?? []).filter((k) => !reads.has(k));
        if (!extra.length) continue;
        out.unread.push(edgeRow(g, x.c.edge.from, x.c.edge, {
          label: `${x.c.caller} passes ${extra.join(' ')} which ${shortName(fn)} never reads`,
          finding: 'unread',
          band: x.passed?.band ?? 'heuristic',
          detail: `param ${i} reads ${keyList([...reads])}`,
        }));
      }
    });
  }
  return out;
}

function keysOf(as: ArityDesc[]): Set<string> {
  return new Set(as.flatMap((a) => a.params.flatMap((p) => [...(p.keys ?? []), ...(p.reads ?? [])])));
}

// Only a destructured map or keyword-args parameter that is handed on; a plain symbol's type is unknown, and incomplete
// reads alone (a :strs entry) are not a hand-on.
const passesMapOn = (p: ParamDesc): boolean => (p.kind === 'map' || p.kind === 'kwargs') && !!p.escapes?.length;

function requiredKeys(as: ArityDesc[]): Set<string> {
  return new Set(as.flatMap((a) => a.params.flatMap((p) => (p.keys ?? []).filter((k) => !p.defaults?.includes(k)))));
}

function affectedByChange(g: Graph, fn: GraphNode, head: ArityDesc[], base: ArityDesc[] | null, change: SignatureChange, calls: CallSite[]): { rows: Row[]; summary: string[] } {
  const rows: Row[] = [];
  const summary: string[] = [];
  let added = (change.addedKeys ?? []).map(normKey);
  let removed = (change.removedKeys ?? []).map(normKey);
  let arityOk: ((n: number) => boolean) | null = change.arities?.length ? (n) => !!change.arities?.includes(n) : null;
  if (base) {
    const bk = keysOf(base);
    const hk = keysOf(head);
    added = [...new Set([...added, ...[...requiredKeys(head)].filter((k) => !bk.has(k))])];
    removed = [...new Set([...removed, ...[...bk].filter((k) => !hk.has(k))])];
    const gone = base.filter((ba) => !head.some((ha) => ha.variadic === ba.variadic && fixedCount(ha) === fixedCount(ba)));
    if (gone.length) summary.push(`arities removed: ${gone.map(arityText).join(', ')}`);
    arityOk ??= (n) => !!arityFor(head, n);
  }
  if (added.length) summary.push(`new keys: ${added.join(' ')}`);
  if (removed.length) summary.push(`keys no longer read: ${removed.join(' ')}`);
  const target = shortName(fn);
  for (const c of calls) {
    const at = (extra: Partial<Row>) => rows.push(edgeRow(g, c.edge.from, c.edge, extra));
    if (!c.attrs) {
      at({ band: 'unknown', label: `${c.caller} (arguments not recorded)`, reason: 'call site arguments unknown' });
      continue;
    }
    if (arityOk && !arityOk(c.attrs.arity)) {
      at({ band: c.attrs.arity_band, label: `${c.caller} calls ${target} with ${c.attrs.arity} argument(s)`, detail: 'that arity is gone after the change' });
      continue;
    }
    const arity = arityFor(head, c.attrs.arity);
    if (!arity) continue;
    arity.params.forEach((p, i) => {
      if (p.kind !== 'map' && p.kind !== 'kwargs') return;
      const passed = passedAt(c, arity, i);
      if (!passed) {
        if (added.length) at({ band: 'unknown', label: `${c.caller} may not pass ${added.join(' ')}`, reason: `argument ${i} is not a literal map; its keys are not provable` });
        return;
      }
      const missing = added.filter((k) => !passed.keys.includes(k));
      const still = removed.filter((k) => passed.keys.includes(k));
      if (missing.length) at({ band: passed.band, label: `${c.caller} does not pass ${missing.join(' ')}`, detail: `argument ${i} passes ${keyList(passed.keys)}` });
      if (still.length) at({ band: passed.band, label: `${c.caller} still passes ${still.join(' ')}`, detail: `${target} no longer reads it` });
    });
  }
  return { rows, summary };
}

// One edge per call site: the same site can come both from its namespace (usage table) and from the dispatch
// arm or handler that holds it; the more specific caller and the edge carrying arguments win.
export function siteCalls(g: Graph, id: string): GraphEdge[] {
  const best = new Map<string, GraphEdge>();
  const score = (e: GraphEdge) => (callAttrs(e) ? 2 : 0) + (g.byId.get(e.from)?.kind === 'namespace' ? 0 : 1);
  for (const e of inEdges(g, id, ['calls'])) {
    const k = `${e.file}:${e.line ?? 0}`;
    const cur = best.get(k);
    if (!cur || score(e) > score(cur)) best.set(k, e);
  }
  return [...best.values()];
}

export function signatureImpact(g: Graph, query: string, opts: { base?: Graph; change?: SignatureChange } = {}): QueryResult {
  const title = `signature impact of ${query}`;
  const hits = resolve(g, ['definition'], query);
  if (!hits.length) return notFound(g, 'signature_impact', query, title, 'definition', ['signatures'], 'use a fully qualified name (ns/name)');
  if (hits.length > 1) return ambiguous('signature_impact', query, title, hits, 'fn');
  const fn = hits[0];
  const notes = capabilityNotes(g, ['signatures']);
  const arities = signatureOf(fn);
  if (!arities) {
    return {
      name: 'signature_impact', query, title, found: true, matches: [fn.id], sections: [],
      verdict: `no signature recorded for ${fn.name}: not a defn/defn- (a def, macro or multimethod), or the graph has no signatures`,
      notes, next: [call('callers', { var: fn.name })],
    };
  }
  const calls: CallSite[] = siteCalls(g, fn.id).map((edge) => {
    const attrs = callAttrs(edge);
    return { edge, caller: g.byId.get(edge.from)?.name ?? edge.from, attrs, arity: attrs ? arityFor(arities, attrs.arity) : undefined };
  });
  const valueEdges = inEdges(g, fn.id, ['references', 'passes_callback', 'registers_handler']).filter((e) => e.attrs?.via !== 'refer');
  const f = signatureFindings(g, fn, arities, calls, valueEdges.length > 0);
  const callerRows: Row[] = calls.map((c) => {
    const r = edgeRow(g, c.edge.from, c.edge, { label: callLabel(c) });
    if (!c.attrs) return { ...r, band: 'unknown' as Band, reason: 'call site arguments were not recorded' };
    const keyBands = (c.attrs.args ?? []).filter((a) => a.keys && a.band !== 'unknown').map((a) => a.band);
    return { ...r, band: keyBands.reduce(weakest, weakest(r.band, c.attrs.arity_band)), cross: !!r.component && r.component !== fn.component };
  });
  const valueRows: Row[] = valueEdges.map((e) => edgeRow(g, e.from, e, {
    band: 'unknown',
    label: `${g.byId.get(e.from)?.name ?? e.from} uses ${shortName(fn)} via ${typeof e.attrs?.via === 'string' ? e.attrs.via : 'a value'}`,
    reason: 'arity and arguments decided at runtime',
  }));
  const callerSection = [...callerRows, ...valueRows];
  const arityRows: Row[] = arities.map((a, i) => nodeRow(fn, {
    id: `${fn.id}@${i}`,
    label: arityText(a),
    detail: `${calls.filter((c) => c.arity === a).length} caller(s)${a.params.some(passesMapOn) ? '; passes a map parameter on' : ''}`,
  }));
  const sections: Section[] = [];
  const verdict: string[] = [];
  const change = opts.change ?? {};
  if (opts.base || change.addedKeys?.length || change.removedKeys?.length || change.arities?.length) {
    const baseNode = opts.base ? (opts.base.byId.get(fn.id) ?? resolve(opts.base, ['definition'], fn.name)[0]) : undefined;
    if (opts.base && !baseNode) notes.push(`${fn.name} is not in the base graph: a new function, every caller is new`);
    const a = affectedByChange(g, fn, arities, baseNode ? signatureOf(baseNode) : null, change, calls);
    sections.push({ name: 'affected by the change', short: 'affected', rows: a.rows, ordered: true, searched: 'callers whose arity disappears, that do not pass a new key, or still pass a removed one' });
    verdict.push(`${a.rows.filter((r) => r.band !== 'unknown').length} caller(s) affected by the change${a.summary.length ? ` (${a.summary.join('; ')})` : ''}`);
  }
  const findings = [...f.arityMissing, ...f.neverPassed, ...f.unread];
  sections.push(
    { name: 'findings', rows: findings, ordered: true, searched: 'arity mismatches, destructured keys no caller passes, passed keys the function never reads' },
    { name: 'arities', rows: arityRows, ordered: true },
    { name: 'callers', rows: callerSection, searched: 'calls edges into the definition, plus value uses (apply, partial)' },
  );
  notes.push(...f.unprovable);
  if (valueRows.length) notes.push(`${valueRows.length} use(s) through apply, partial or as a value: their arity and keys are not provable`);
  const comps = new Set(callerSection.map((r) => r.component ?? '(no component)'));
  const blind = callerRows.filter((r) => r.band === 'unknown').length;
  const unknownTotal = callerSection.filter((r) => r.band === 'unknown').length;
  const unknownParts = [...(valueRows.length ? [`${valueRows.length} via apply/partial/value`] : []), ...(blind ? [`${blind} with arguments not recorded`] : [])];
  verdict.push(
    `${callerSection.length} caller(s) in ${comps.size} component(s)${unknownTotal ? `, ${unknownTotal} UNKNOWN (${unknownParts.join(', ')})` : ''}`,
    `arities ${arities.map((a) => (a.variadic ? `${fixedCount(a)}+` : String(fixedCount(a)))).join(', ')}`,
    findings.length ? `${findings.length} finding(s): ${f.arityMissing.length} arity not defined, ${f.neverPassed.length} key never passed, ${f.unread.length} unread key passed` : 'no finding',
  );
  const neverKey = f.neverPassed[0]?.key;
  const crossCaller = calls.find((c) => g.byId.get(c.edge.from)?.component !== fn.component);
  return {
    name: 'signature_impact', query, title, found: true, matches: [fn.id], sections,
    verdict: verdict.join('; '),
    notes,
    next: [
      ...(neverKey ? [call('key_flow', { key: neverKey })] : []),
      ...(crossCaller ? [call('signature_impact', { fn: crossCaller.caller })] : []),
      call('blast_radius', { var: fn.name, depth: 2 }),
    ],
  };
}

// ---------- key_flow ----------

const KEY_EDGES = ['produces_key', 'consumes_key', 'removes_key'] as const;

function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}

const localName = (k: string) => bare(k).split('/').pop() ?? bare(k);

export function similarKeys(g: Graph, key: string, max = 5): GraphNode[] {
  const ln = localName(key);
  return (g.byKind.get('key') ?? [])
    .filter((n) => n.name !== key)
    .map((n) => {
      const other = localName(n.name);
      const score = other === ln ? 0 : ln.length >= 4 && Math.abs(other.length - ln.length) <= 2 ? editDistance(other, ln) : 9;
      return { n, score };
    })
    .filter((x) => x.score <= 2)
    .sort((a, b) => a.score - b.score || compareText(a.n.name, b.n.name))
    .slice(0, max)
    .map((x) => x.n);
}

function resolveKey(g: Graph, query: string): GraphNode[] {
  const q = query.trim().replace(/^key:/, '');
  if (!q) return [];
  const exact = g.byId.get(`key:${normKey(q)}`);
  if (exact) return [exact];
  const ln = q.replace(/^:+/, '');
  return ln.includes('/') ? [] : sameLocalName(g, ln);
}

const sameLocalName = (g: Graph, ln: string): GraphNode[] => (g.byKind.get('key') ?? []).filter((n) => localName(n.name) === ln);

function roleCount(g: Graph, id: string): string {
  const es = inEdges(g, id, KEY_EDGES);
  return `P${es.filter((e) => e.kind === 'produces_key').length} C${es.filter((e) => e.kind === 'consumes_key').length}`;
}

const DYNAMIC_NOTE = 'a key read or written only dynamically (held in a local, built with keyword, merged from another map) is not tracked';

export function keyFlow(g: Graph, query: string): QueryResult {
  const title = `key flow of ${query}`;
  const notes = capabilityNotes(g, ['key_flow']);
  const hits = resolveKey(g, query);
  if (hits.length > 1) return ambiguous('key_flow', query, title, hits, 'key');
  if (!hits.length) {
    const near = similarKeys(g, normKey(query.trim()));
    return {
      name: 'key_flow', query, title, found: false, matches: [], sections: [],
      verdict: `0 proven producer or consumer sites of ${normKey(query.trim())} in this graph`,
      notes: [...notes, `${DYNAMIC_NOTE}: 0 sites is not proof of absence`,
        ...(near.length ? [`similar keys: ${near.map((n) => `${n.name} (${roleCount(g, n.id)})`).join(', ')}`] : [])],
      next: near.slice(0, 2).map((n) => call('key_flow', { key: n.name })),
    };
  }
  const key = hits[0];
  const row = (e: GraphEdge, suffix = ''): Row => {
    const via = typeof e.attrs?.via === 'string' ? e.attrs.via : e.kind;
    return edgeRow(g, e.from, e, {
      label: `${g.byId.get(e.from)?.name ?? e.from} (${via})${suffix}`,
      ...(e.band === 'heuristic' ? { reason: `${via}: matched by form name or a threading shift` } : {}),
    });
  };
  const es = inEdges(g, key.id, KEY_EDGES);
  const live = es.filter((e) => !isTestFile(e.file));
  const prod = live.filter((e) => e.kind === 'produces_key').map((e) => row(e));
  const cons = live.filter((e) => e.kind === 'consumes_key').map((e) => row(e));
  const rem = live.filter((e) => e.kind === 'removes_key').map((e) => row(e));
  const tests = es.filter((e) => isTestFile(e.file)).map((e) => row(e, ` ${e.kind.replace('_key', '')}`));
  const other = typeof key.attrs?.other_uses === 'number' ? key.attrs.other_uses : 0;
  const comps = new Set([...prod, ...cons, ...rem].map((r) => r.component ?? '(no component)'));
  const signal = !prod.length && cons.length
    ? 'consumed but never produced as a literal key outside tests: produced dynamically, outside the repo, or a stale name'
    : !cons.length && prod.length
      ? 'produced but never read through a literal key outside tests: read dynamically, outside the repo, or dead'
      : '';
  if (other) notes.push(`UNKNOWN: ${other} other use(s) of ${key.name} as a value or an argument — not provable as produce or consume; evidence: textual occurrences of ${key.name}`);
  if (!notes.some((n) => /dynamic key access/.test(n))) notes.push(DYNAMIC_NOTE);
  if (!key.name.slice(1).includes('/')) {
    notes.push(`${key.name} is unqualified: every map using that name is joined here`);
    const qualified = sameLocalName(g, localName(key.name)).filter((n) => n !== key).map((n) => n.name).sort(compareText);
    if (qualified.length) notes.push(`other keys with the local name ${localName(key.name)}: ${qualified.slice(0, 5).join(', ')}${qualified.length > 5 ? ` +${qualified.length - 5} more` : ''}; query one by its qualified name`);
  }
  const near = signal ? similarKeys(g, key.name, 3) : [];
  if (near.length) notes.push(`similar keys: ${near.map((n) => `${n.name} (${roleCount(g, n.id)})`).join(', ')}`);
  const table = (g.byKind.get('key_table') ?? []).find((t) => tableRows(t).some((r) => r.keys.includes(key.name)));
  return {
    name: 'key_flow', query, title, found: true, matches: [key.id],
    verdict: `${prod.length} producer(s), ${cons.length} consumer(s)${rem.length ? `, ${rem.length} remover(s)` : ''} in ${comps.size} component(s); ${tests.length} site(s) in tests${signal ? `; ${signal}` : ''}`,
    sections: [
      { name: 'producers', rows: prod, searched: 'map-literal keys, assoc / assoc-in / update paths, hash-map, [:db/add e k v]' },
      { name: 'consumers', rows: cons, searched: 'keyword as fn, get / get-in / contains? / find / select-keys, destructuring, pull patterns, datalog queries' },
      ...(rem.length ? [{ name: 'removed by', short: 'removed', rows: rem }] : []),
      { name: 'in tests', short: 'tests', rows: tests },
    ],
    notes,
    next: [
      ...(table?.file ? [call('key_siblings', { target: table.file })] : []),
      ...near.slice(0, 1).map((n) => call('key_flow', { key: n.name })),
    ],
  };
}

// ---------- key_siblings ----------

const rowCache = new WeakMap<GraphNode, TableRow[]>();

// Parsed once per node, so a row is the same object in its table, its form and the whole graph.
export function tableRows(n: GraphNode): TableRow[] {
  const hit = rowCache.get(n);
  if (hit) return hit;
  const parsed = parseRows(n);
  rowCache.set(n, parsed);
  return parsed;
}

function parseRows(n: GraphNode): TableRow[] {
  const rows = n.attrs?.rows;
  if (!Array.isArray(rows)) return [];
  return rows.filter(isObj).map((r) => ({
    line: typeof r.line === 'number' ? r.line : 0,
    keys: strs(r.keys),
    ...(isObj(r.tags) ? { tags: Object.fromEntries(Object.entries(r.tags).filter((kv): kv is [string, string] => typeof kv[1] === 'string')) } : {}),
    ...(isObj(r.vecs) ? { vecs: Object.fromEntries(Object.entries(r.vecs).map(([k, v]) => [k, strs(v)])) } : {}),
    ...(typeof r.dynamic_keys === 'number' ? { dynamic_keys: r.dynamic_keys } : {}),
  }));
}

function otherRows(n: GraphNode): { line: number; shape: string }[] {
  const o = n.attrs?.other_rows;
  return Array.isArray(o) ? o.filter(isObj).map((x) => ({ line: Number(x.line) || 0, shape: String(x.shape ?? '?') })) : [];
}

export function commonPrefix(a: string[], b: string[]): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i] && a[i] !== '_') i++;
  return i;
}

export function rowLabel(r: TableRow): string {
  const literal = (xs: string[]) => xs.filter((x) => x !== '_').length;
  const v = Object.entries(r.vecs ?? {}).filter(([, xs]) => literal(xs) > 0).sort((a, b) => literal(b[1]) - literal(a[1]))[0];
  if (v) return `${v[0]} [${v[1].join(' ')}]`;
  const t = Object.entries(r.tags ?? {})[0];
  return t ? `${t[0]} ${t[1]}` : `{${r.keys.slice(0, 3).join(' ')}${r.keys.length > 3 ? ' ...' : ''}}`;
}

export interface SiblingFinding {
  row: TableRow;
  // have: sibling rows that carry the key, of: sibling rows in the table
  missing: { key: string; reasons: string[]; have: number; of: number }[];
}

export interface SiblingAnalysis {
  findings: SiblingFinding[];
  explained: { row: TableRow; key: string; why: string }[];
}

const MAJORITY = 0.6;
const SAME_KIND_MAX = 0.25;
// context_for_change: a key absent in this share of sibling rows or more is no sibling pattern, the row is not shown
export const WEAK_PATTERN_ABSENT = 0.3;

function sameKind(r: TableRow, k: string, pools: [string, TableRow[]][]): { explained: string | null; note: string | null } {
  let note: string | null = null;
  for (const [d, v] of Object.entries(r.tags ?? {})) {
    if (d === k) continue;
    for (const [scope, pool] of pools) {
      const peers = pool.filter((s) => s !== r && s.tags?.[d] === v);
      if (!peers.length) continue;
      const n = peers.filter((s) => s.keys.includes(k)).length;
      if (n / peers.length <= SAME_KIND_MAX) return { explained: `rows with ${d} ${v} (${scope}) lack it too: ${n} of ${peers.length} have it`, note: null };
      note ??= `rows with ${d} ${v}: ${n} of ${peers.length} have it`;
      break;
    }
  }
  return { explained: null, note };
}

// A row lacks key k when 60%+ of its sibling rows, or a path sibling (same vector key, 2+ element literal
// prefix), have k; rows of the same kind tag (e.g. :node-type :asset) that mostly lack k explain it away.
export function siblingAnalysis(rows: TableRow[], formRows: TableRow[], allRows: TableRow[] = formRows): SiblingAnalysis {
  const out: SiblingAnalysis = { findings: [], explained: [] };
  if (rows.length < 3) return out;
  const m = rows.length - 1;
  const pools: [string, TableRow[]][] = [['same form', formRows], ['all tables', allRows]];
  for (const r of rows) {
    const candidates = [...new Set(rows.filter((s) => s !== r).flatMap((s) => s.keys))].filter((k) => !r.keys.includes(k)).sort();
    const missing: SiblingFinding['missing'] = [];
    for (const k of candidates) {
      const have = rows.filter((s) => s !== r && s.keys.includes(k));
      const majority = have.length >= 2 && have.length / m >= MAJORITY;
      const pathSibs = have.filter((s) => Object.entries(r.vecs ?? {}).some(([vk, xs]) => commonPrefix(xs, s.vecs?.[vk] ?? []) >= 2));
      if (!majority && !pathSibs.length) continue;
      const kind = sameKind(r, k, pools);
      if (kind.explained) {
        out.explained.push({ row: r, key: k, why: kind.explained });
        continue;
      }
      missing.push({
        key: k,
        have: have.length,
        of: m,
        reasons: [
          ...(majority ? [`${have.length} of ${m} sibling rows have it`] : []),
          ...pathSibs.slice(0, 2).map((s) => `path sibling ${rowLabel(s)} at line ${s.line} has it`),
          ...(kind.note ? [kind.note] : []),
        ],
      });
    }
    if (missing.length) out.findings.push({ row: r, missing });
  }
  return out;
}

// Every key_table row of the graph and the rows of each form, built once and shared by every table analysed.
export interface TablePool {
  allRows: TableRow[];
  formRows: (t: GraphNode) => TableRow[];
}

export function tablePool(g: Graph): TablePool {
  const tables = g.byKind.get('key_table') ?? [];
  const formKey = (t: GraphNode) => JSON.stringify([t.file, t.attrs?.form_line]);
  const byForm = new Map<string, TableRow[]>();
  for (const t of tables) byForm.set(formKey(t), [...(byForm.get(formKey(t)) ?? []), ...tableRows(t)]);
  return { allRows: tables.flatMap(tableRows), formRows: (t) => byForm.get(formKey(t)) ?? [] };
}

function resolveTables(g: Graph, target: string): GraphNode[] {
  const all = g.byKind.get('key_table') ?? [];
  const t = target.trim();
  if (!t) return [];
  const byId = g.byId.get(t);
  if (byId?.kind === 'key_table') return [byId];
  const inFile = (f: string) => {
    const exact = all.filter((n) => n.file === f);
    return exact.length ? exact : all.filter((n) => !!n.file && n.file.endsWith(`/${f}`));
  };
  const m = t.match(/^(.*?):(\d+)$/);
  if (m) {
    const line = Number.parseInt(m[2], 10);
    const holding = inFile(m[1]).filter((n) => (n.line ?? 0) <= line && line <= (n.end_line ?? n.line ?? 0));
    if (holding.length) return [holding.sort((a, b) => (b.line ?? 0) - (a.line ?? 0))[0]];
  }
  const files = inFile(t);
  if (files.length) return files;
  return all.filter((n) => n.attrs?.var === t || n.name === t || n.name.startsWith(`${t} `));
}

// maxAbsent: drop a missing key absent in that share of sibling rows or more, and a row left with no missing key;
// onWeak gets the count of rows dropped that way
export function keySiblings(g: Graph, target: string, opts: { maxAbsent?: number; onWeak?: (rows: number) => void; pool?: TablePool } = {}): QueryResult {
  const title = `key siblings of ${target}`;
  const notes = capabilityNotes(g, ['key_tables']);
  const tables = resolveTables(g, target).sort((a, b) => compareText(a.file ?? '', b.file ?? '') || (a.line ?? 0) - (b.line ?? 0));
  if (!tables.length) {
    const nf = notFound(g, 'key_siblings', target, title, 'literal table (3+ map rows)', ['key_tables'], 'pass a repo-relative file, file:line, a key_table id or the var that holds the table');
    return { ...nf, notes: [...notes, ...nf.notes] };
  }
  const files = [...new Set(tables.map((t) => t.file ?? ''))];
  if (files.length > 1) {
    const firstPerFile = files.map((f) => tables.find((t) => (t.file ?? '') === f) as GraphNode);
    return {
      ...ambiguous('key_siblings', target, title, firstPerFile, 'target'),
      verdict: `${JSON.stringify(target)} matches ${files.length} files; pass one repo-relative path`,
      next: files.slice(0, 3).map((f) => call('key_siblings', { target: f })),
    };
  }
  const pool = opts.pool ?? tablePool(g);
  const findings: Row[] = [];
  const tableOut: Row[] = [];
  const unknown: Row[] = [];
  const explained: { row: TableRow; key: string; why: string; table: GraphNode }[] = [];
  let rowCount = 0;
  let weak = 0;
  for (const t of tables) {
    const rows = tableRows(t);
    rowCount += rows.length;
    const a = siblingAnalysis(rows, pool.formRows(t), pool.allRows);
    explained.push(...a.explained.map((x) => ({ ...x, table: t })));
    const strong = (x: SiblingFinding['missing'][number]) => opts.maxAbsent === undefined || (x.of - x.have) / x.of < opts.maxAbsent;
    for (const raw of a.findings) {
      const f = { ...raw, missing: raw.missing.filter(strong) };
      const dynamic = f.row.dynamic_keys ?? 0;
      if (dynamic && f.missing.length) {
        unknown.push({
          label: `${t.name}: row ${rowLabel(f.row)} has ${dynamic} dynamic key(s) and may carry ${f.missing.map((x) => x.key).join(' ')}`,
          id: `${t.id}@${f.row.line}`, file: t.file ?? null, line: f.row.line, band: 'unknown', ...(t.component ? { component: t.component } : {}),
          reason: 'a dynamic key is not provable, so the absence of the sibling keys is not either',
        });
        continue;
      }
      if (!f.missing.length) {
        weak += 1;
        continue;
      }
      findings.push({
        label: `${t.name}: row ${rowLabel(f.row)} lacks ${f.missing.map((x) => x.key).join(' ')}`,
        id: `${t.id}@${f.row.line}`,
        finding: 'lacks-key',
        key: f.missing[0].key,
        file: t.file ?? null,
        line: f.row.line,
        band: 'heuristic',
        ...(t.component ? { component: t.component } : {}),
        detail: f.missing.map((x) => `${x.key}: ${x.reasons.join('; ')}`).join(' | '),
        reason: 'the literal row lacks the key (proven); whether it should have it is a judgement',
      });
    }
    const freq = new Map<string, number>();
    for (const r of rows) for (const k of r.keys) freq.set(k, (freq.get(k) ?? 0) + 1);
    const top = [...freq].sort((x, y) => y[1] - x[1] || compareText(x[0], y[0])).slice(0, 6).map(([k, n]) => `${k} ${n}/${rows.length}`);
    tableOut.push(nodeRow(t, { detail: `${rows.length} map rows; ${top.join(', ')}${freq.size > 6 ? ', ...' : ''}` }));
    for (const o of otherRows(t)) {
      unknown.push({ label: `${t.name}: row is a ${o.shape}, not a map literal`, id: `${t.id}@${o.line}`, file: t.file ?? null, line: o.line, band: 'unknown', ...(t.component ? { component: t.component } : {}), reason: 'its keys are not provable' });
    }
  }
  opts.onWeak?.(weak);
  if (weak) notes.push(`${weak} row(s) not shown: the key they lack is absent in ${Math.round((opts.maxAbsent ?? 0) * 100)}%+ of sibling rows, no sibling pattern`);
  if (explained.length) {
    const ex = explained[0];
    notes.push(`${explained.length} absence(s) explained by same-kind rows, e.g. ${ex.table.name} row ${rowLabel(ex.row)} lacks ${ex.key}: ${ex.why}`);
  }
  const firstKey = findings[0]?.key;
  const holder = tables.find((t) => findings[0]?.id.startsWith(`${t.id}@`) && typeof t.attrs?.var === 'string') ?? tables.find((t) => typeof t.attrs?.var === 'string');
  return {
    name: 'key_siblings', query: target, title, found: true, matches: tables.map((t) => t.id),
    verdict: `${findings.length} row(s) lack a key their siblings have, in ${tables.length} table(s) with ${rowCount} map rows${unknown.length ? `; ${unknown.length} row(s) not provable (UNKNOWN)` : ''}`,
    sections: [
      { name: 'findings', rows: findings, ordered: true, searched: `rows missing a key that ${Math.round(MAJORITY * 100)}%+ of siblings or a path sibling have, minus absences shared by same-kind rows` },
      { name: 'tables', rows: tableOut, ordered: true },
      ...(unknown.length ? [{ name: 'rows not provable', short: 'unprovable', rows: unknown }] : []),
    ],
    notes,
    next: [
      ...(firstKey ? [call('key_flow', { key: firstKey })] : []),
      ...(holder?.file ? [call('callers', { var: String(holder.attrs?.var) })] : []),
    ],
  };
}

// ---------- context_for_change ----------

// Rows of the changed tables that lack a key, minus rows whose key is absent in 30%+ of siblings (weak: their count).
export function changeKeyRows(g: Graph, changes: { file: string; ranges: [number, number][] }[]): { rows: Row[]; weak: number } {
  const tables = (g.byKind.get('key_table') ?? []).filter((t) => changes.some((c) => c.file === t.file
    && (!c.ranges.length || c.ranges.some(([a, b]) => (t.line ?? 0) <= b && (t.end_line ?? t.line ?? 0) >= a))));
  let weak = 0;
  const pool = tablePool(g);
  const res = tables.map((t) => keySiblings(g, t.id, { maxAbsent: WEAK_PATTERN_ABSENT, onWeak: (n) => { weak += n; }, pool }));
  return { rows: res.flatMap((r) => r.sections.find((s) => s.name === 'findings')?.rows ?? []), weak };
}

export function changeSignatureRows(g: Graph, defs: GraphNode[]): Row[] {
  return defs.filter((n) => signatureOf(n)).flatMap((n) => {
    const r = signatureImpact(g, n.id);
    return (r.sections.find((s) => s.name === 'findings')?.rows ?? []).filter((x) => x.finding === 'arity-missing' || x.finding === 'never-passed');
  });
}
