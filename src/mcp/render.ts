// Agent-facing text for a QueryResult: verdict first, counts with band mix, ranked rows grouped per component,
// trees with written edge types, UNKNOWN as "not provable; evidence at", empty sections say what was searched, a
// hard budget with a step-by-step fallback and the exact call for the rest, then 1-3 next calls.
import { BANDS } from './graph.ts';
import type { QueryResult, Row, Section } from './queries.ts';

export type ResponseFormat = 'concise' | 'detailed' | 'json';
export type GroupBy = 'component' | 'file' | 'none';

export interface RenderOptions {
  format?: ResponseFormat;
  limit?: number;
  offset?: number;
  section?: string;
  maxTokens?: number;
  groupBy?: GroupBy;
  header?: string | null;
}

// The tool arguments every answer honours, shared by the servers' input schemas.
export const PAGING_PROPS = {
  response_format: { type: 'string', enum: ['concise', 'detailed', 'json'], description: 'concise (default): verdict, counts, top rows; detailed: adds details for the top rows and a legend; json: the structured result' },
  limit: { type: 'number', description: 'rows per section (default 10 concise, 25 detailed, max 500)' },
  offset: { type: 'number', description: 'skip this many rows per section (paging; truncated sections print the next offset)' },
  section: { type: 'string', description: 'only sections whose name contains this text' },
  max_tokens: { type: 'number', description: 'answer budget (default 1500 concise, 4000 detailed); over it the answer shortens step by step' },
};

// The one shape of a json answer in both servers: the query result plus `source`. `stale` says whether the answer
// rests on a source behind its base; `notice` is the one-line text of that (or of the distance within threshold), null
// when there is nothing to say; a server adds the facts of its own source beside them.
export interface JsonSource {
  stale: boolean;
  notice: string | null;
  [fact: string]: unknown;
}

export const withSource = (json: string, source: JsonSource): string => JSON.stringify({ ...JSON.parse(json), source });

// The render options a tool call's arguments carry; anything of the wrong type is left to the renderer's default.
export function renderOptionsOf(args: Record<string, unknown>): RenderOptions {
  const n = (k: string) => (typeof args[k] === 'number' ? (args[k] as number) : undefined);
  return {
    format: ['concise', 'detailed', 'json'].includes(String(args.response_format)) ? (args.response_format as ResponseFormat) : undefined,
    limit: n('limit'),
    offset: n('offset'),
    maxTokens: n('max_tokens'),
    section: typeof args.section === 'string' ? args.section : undefined,
  };
}

export const DEFAULT_LIMIT = { concise: 10, detailed: 25 } as const;
export const MAX_LIMIT = 500;
export const DEFAULT_MAX_TOKENS = { concise: 1500, detailed: 4000 } as const;
export const CHARS_PER_TOKEN = 4;
const DETAIL_TOP = 5;

const BAND_CODE: Record<string, string> = { static_proven: 'S', declared: 'D', heuristic: 'H', unknown: '?' };
const LEGEND = 'legend: [S] static_proven  [D] declared  [H] heuristic (name or pattern match; the cited line is the evidence)  [?] unknown, not provable';

export function clampLimit(limit: number | undefined, format: ResponseFormat = 'concise'): number {
  const def = format === 'detailed' ? DEFAULT_LIMIT.detailed : DEFAULT_LIMIT.concise;
  if (limit === undefined || !Number.isFinite(limit)) return def;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit)));
}

export function where(r: Pick<Row, 'file' | 'line'>): string {
  return r.line ? `${r.file ?? '(no file)'}:${r.line}` : (r.file ?? '(no file)');
}

const tag = (r: Row) => `[${BAND_CODE[r.band] ?? '?'}]`;

export function why(r: Row, crossShownInGroup = false): string {
  const parts: string[] = [];
  if (r.entry) parts.push(`entry: ${r.entry}`);
  if (r.cross && !crossShownInGroup) parts.push('cross-comp');
  if ((r.fanIn ?? 0) >= 3) parts.push(`fan-in ${r.fanIn}`);
  if (r.band === 'heuristic') parts.push('heuristic match');
  return parts.slice(0, 2).join(', ');
}

function rankKey(r: Row): (number | string)[] {
  return [BANDS.indexOf(r.band), r.depth ?? 0, r.entry ? 0 : 1, -(r.fanIn ?? 0), r.cross ? 0 : 1, r.label];
}

function compareRows(a: Row, b: Row): number {
  const ka = rankKey(a);
  const kb = rankKey(b);
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] < kb[i]) return -1;
    if (ka[i] > kb[i]) return 1;
  }
  return 0;
}

export function rankRows(rows: Row[]): Row[] {
  return rows.slice().sort(compareRows);
}

export function bandMix(rows: Row[]): string {
  return BANDS.map((b) => ({ code: BAND_CODE[b], n: rows.filter((r) => r.band === b).length })).filter((x) => x.n).map((x) => `${x.code}${x.n}`).join(' ');
}

const shortName = (s: Section) => s.short ?? s.name;

// section= takes the long name (or part of it) or the short name the paging hints print.
const sectionMatches = (s: Section, want: string | undefined): boolean => !want || s.name.includes(want) || s.short === want;

function rowLine(r: Row, n: number | null, withDetail: boolean, indent = '  ', grouped = false): string {
  const w = why(r, grouped);
  const detail = withDetail && (r.detail || r.reason) ? `  (${[r.detail, r.reason].filter(Boolean).join('; ')})` : '';
  const depth = r.depth && r.depth > 1 ? ` d${r.depth}` : '';
  return `${indent}${n === null ? '' : `${n}. `}${r.label}  ${where(r)} ${tag(r)}${depth}${w ? `  ${w}` : ''}${detail}`;
}

function unknownLine(r: Row): string {
  const reason = r.reason ? ` (${r.reason})` : '';
  return `  UNKNOWN: ${r.label} at ${where(r)}${r.detail ? ` [${r.detail}]` : ''}${reason} — not provable; evidence at ${where(r)}`;
}

function groupKey(r: Row, by: GroupBy): string {
  if (by === 'file') return r.file ?? '(no file)';
  if (by === 'component') return r.component ?? '(no component)';
  return '';
}

function treeOrder(rows: Row[]): { row: Row; level: number }[] {
  const ids = new Set(rows.map((r) => r.id));
  const kids = new Map<string, Row[]>();
  const roots: Row[] = [];
  for (const r of rows) {
    if (r.parentId && ids.has(r.parentId)) {
      const k = kids.get(r.parentId) ?? [];
      k.push(r);
      kids.set(r.parentId, k);
    } else roots.push(r);
  }
  const out: { row: Row; level: number }[] = [];
  const walk = (r: Row, level: number) => {
    out.push({ row: r, level });
    for (const c of rankRows(kids.get(r.id) ?? [])) walk(c, level + 1);
  };
  for (const r of rankRows(roots)) walk(r, 0);
  return out;
}

const EDGE_WORDS: Record<string, string> = {
  calls: 'called by', references: 'referenced by', passes_callback: 'passed as a callback by', registers_handler: 'registered as a handler by', expands_via: 'expanded by',
  may_dispatch_to: 'may be dispatched to by', rebinds: 'rebound by',
};
const edgeWord = (r: Row) => EDGE_WORDS[r.kind ?? ''] ?? `${r.kind ?? 'linked'} by`;

interface Level {
  details: boolean;
  rows: boolean;
  groups: boolean;
}

interface SectionOpts {
  format: 'concise' | 'detailed';
  groupBy: GroupBy;
  limit: number;
  offset: number;
}

function displayOrder(s: Section, known: Row[], by: GroupBy): { row: Row; level: number; group: string }[] {
  if (s.ordered) return known.map((row) => ({ row, level: 0, group: '' }));
  if (s.tree) {
    let current = '';
    const flat = treeOrder(known).map(({ row, level }) => {
      if (level === 0) current = groupKey(row, by);
      return { row, level, group: current };
    });
    const groups = [...new Set(flat.map((x) => x.group))];
    return groups.flatMap((g) => flat.filter((x) => x.group === g));
  }
  const ranked = rankRows(known);
  const groups = [...new Set(ranked.map((r) => groupKey(r, by)))];
  return groups.flatMap((g) => ranked.filter((r) => groupKey(r, by) === g).map((row) => ({ row, level: 0, group: g })));
}

function renderSection(s: Section, o: SectionOpts, lv: Level): string[] {
  if (!s.rows.length) return [`${s.name}: none${s.searched ? ` (searched: ${s.searched})` : ''}`];
  const known = s.rows.filter((r) => r.band !== 'unknown');
  const unknown = s.rows.filter((r) => r.band === 'unknown');
  const out = [known.length
    ? `${s.name} (${s.rows.length}${s.rows.length > 1 ? ` ${bandMix(s.rows)}` : ''})`
    : `${s.name}: none proven (${unknown.length} uncertain)`];
  const by: GroupBy = s.ordered || (o.groupBy === 'component' && !s.rows.some((r) => r.component)) ? 'none' : o.groupBy;
  if (!lv.rows) {
    if (lv.groups && by !== 'none') {
      const counts = new Map<string, number>();
      for (const r of s.rows) counts.set(groupKey(r, by), (counts.get(groupKey(r, by)) ?? 0) + 1);
      out.push(`  ${[...counts].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    }
    // UNKNOWN rows stay listed while counts per group are shown: an unprovable row is never folded into a number
    if (lv.groups) {
      for (const u of unknown.slice(0, o.limit)) out.push(unknownLine(u));
      if (unknown.length > o.limit) out.push(`  +${unknown.length - o.limit} more UNKNOWN (all: section="${shortName(s)}" limit=${unknown.length})`);
    }
    return out;
  }
  const ordered = displayOrder(s, known, by);
  const totals = new Map<string, number>();
  for (const x of ordered) totals.set(x.group, (totals.get(x.group) ?? 0) + 1);
  const page = ordered.slice(o.offset, o.offset + o.limit);
  const withDetail = (i: number) => lv.details && (!!s.ordered || (o.format === 'detailed' && i < DETAIL_TOP));
  let lastGroup: string | null = null;
  page.forEach((x, i) => {
    const grouped = by !== 'none';
    if (grouped && x.group !== lastGroup) {
      out.push(`  ${x.group}: ${totals.get(x.group)}${by === 'component' && x.row.cross ? ' (cross-comp)' : ''}`);
      lastGroup = x.group;
    }
    const indent = grouped ? '    ' : '  ';
    const inGroup = by === 'component';
    if (x.level === 0) out.push(rowLine(x.row, o.offset + i + 1, withDetail(i), indent, inGroup));
    else out.push(`${indent}${'    '.repeat(x.level - 1)}  └─ ${edgeWord(x.row)} ${rowLine(x.row, null, withDetail(i), '', inGroup)}`);
  });
  const rest = ordered.length - o.offset - page.length;
  if (rest > 0) out.push(`  +${rest} more (next page: offset=${o.offset + page.length} section="${shortName(s)}")`);
  for (const u of unknown.slice(0, o.limit)) out.push(unknownLine(u));
  if (unknown.length > o.limit) out.push(`  +${unknown.length - o.limit} more UNKNOWN (all: section="${shortName(s)}" limit=${unknown.length})`);
  return out;
}

function sectionOpts(o: RenderOptions): SectionOpts {
  const format = o.format === 'detailed' ? 'detailed' : 'concise';
  return {
    format,
    groupBy: o.groupBy ?? 'component',
    limit: clampLimit(o.limit, format),
    offset: Math.max(0, Math.floor(Number.isFinite(o.offset) ? (o.offset ?? 0) : 0)),
  };
}

// The lines before the sections (header, verdict, counts, legend, notes) and after them (next calls).
function frame(res: QueryResult, o: RenderOptions, sections: Section[]): { head: string[]; tail: string[] } {
  const head: string[] = [];
  if (o.header) head.push(o.header);
  head.push(`${res.name.toUpperCase()} ${res.query} — ${res.verdict}`);
  const counted = sections.filter((s) => s.rows.length && !(s.name === 'definition' && s.rows.length === 1));
  if (counted.length) head.push(`counts: ${counted.map((s) => `${shortName(s)}=${s.rows.length} [${bandMix(s.rows)}]`).join('  ')}`);
  if (o.format === 'detailed') head.push(LEGEND);
  for (const n of res.notes) head.push(`note: ${n}`);
  if (o.section && !sections.length) head.push(`no section matches ${JSON.stringify(o.section)}; sections: ${res.sections.map(shortName).join(', ')}`);
  const tail: string[] = [];
  if (!res.found && !res.sections.length) tail.push('searched: names, ids and kind-prefixed ids; check the spelling or pass the fully qualified name');
  if (res.next.length) tail.push(`next: ${res.next.slice(0, 3).join('  ')}`);
  return { head, tail };
}

const LADDER: { level: Level; step: string }[] = [
  { level: { details: true, rows: true, groups: true }, step: '' },
  { level: { details: false, rows: true, groups: true }, step: 'details dropped' },
  { level: { details: false, rows: false, groups: true }, step: 'rows→counts per group' },
  { level: { details: false, rows: false, groups: false }, step: 'rows→section totals' },
];

// JSON honours section=, offset= and limit= like the text formats, and fits max_tokens (default: the detailed
// budget) by halving the rows per section; `truncated` and each section's `total` say what was left out.
function renderJson(res: QueryResult, opts: RenderOptions): string {
  const budget = (opts.maxTokens !== undefined && Number.isFinite(opts.maxTokens) && opts.maxTokens > 0 ? opts.maxTokens : DEFAULT_MAX_TOKENS.detailed) * CHARS_PER_TOKEN;
  const offset = Math.max(0, Math.floor(Number.isFinite(opts.offset) ? (opts.offset ?? 0) : 0));
  const paged = opts.limit !== undefined || offset > 0;
  const sections = res.sections.filter((s) => sectionMatches(s, opts.section));
  const most = Math.max(0, ...sections.map((s) => s.rows.length));
  const shape = (limit: number, truncated: boolean): string => JSON.stringify({
    ...res,
    sections: sections.map((s) => {
      const rows = s.rows.slice(offset, offset + limit);
      return rows.length === s.rows.length ? s : { ...s, rows, total: s.rows.length, offset };
    }),
    ...(truncated ? { truncated: `rows cut to fit ${Math.floor(budget / CHARS_PER_TOKEN)} tokens; page with offset= and limit=` } : {}),
  });
  let limit = paged ? clampLimit(opts.limit, 'detailed') : most;
  let out = shape(limit, false);
  while (out.length > budget && limit > 0) {
    limit = Math.floor(limit / 2);
    out = shape(limit, true);
  }
  return out;
}

const CUT_NOTE = '\n... cut at the budget';

// Last resort: cut at the last whole line that fits (a single over-long line at its last space).
function hardCut(text: string, budget: number): string {
  let head = text.slice(0, Math.max(0, budget - CUT_NOTE.length));
  const nl = head.lastIndexOf('\n');
  const sp = head.lastIndexOf(' ');
  if (nl > 0) head = head.slice(0, nl);
  else if (sp > 0) head = head.slice(0, sp);
  return `${head}${CUT_NOTE}`;
}

// Over the budget, sections step down the ladder one at a time, the largest first and the risk section last, so a
// small section keeps its rows while a big one becomes counts.
export function render(res: QueryResult, opts: RenderOptions = {}): string {
  if (opts.format === 'json') return renderJson(res, opts);
  const format = opts.format === 'detailed' ? 'detailed' : 'concise';
  const tokens = opts.maxTokens !== undefined && Number.isFinite(opts.maxTokens) && opts.maxTokens > 0 ? opts.maxTokens : DEFAULT_MAX_TOKENS[format];
  const budget = tokens * CHARS_PER_TOKEN;
  const so = sectionOpts(opts);
  const sections = res.sections.filter((s) => sectionMatches(s, opts.section));
  const { head, tail } = frame(res, opts, sections);
  const cache = new Map<string, string[]>();
  const linesOf = (i: number, l: number): string[] => {
    const key = `${i}:${l}`;
    let hit = cache.get(key);
    if (hit === undefined) {
      hit = renderSection(sections[i], so, LADDER[l].level);
      cache.set(key, hit);
    }
    return hit;
  };
  const levels = sections.map(() => 0);
  const last = LADDER.length - 1;
  const note = (): string | null => {
    const deepest = Math.max(0, ...levels);
    if (deepest === 0) return null;
    // when only some sections stepped down, name them (at most three) so the others read as complete
    const which = sections.filter((_s, i) => levels[i] > 0).map(shortName);
    const scope = which.length < sections.length ? ` in ${which.slice(0, 3).join(', ')}${which.length > 3 ? ` +${which.length - 3} more` : ''}` : '';
    return `truncated: ${LADDER[deepest].step}${scope} (budget ${tokens} tokens; narrow with section= or offset=, or raise max_tokens)`;
  };
  const compose = (): string => {
    const n = note();
    const top = n === null ? head : [...head.slice(0, opts.header ? 2 : 1), n, ...head.slice(opts.header ? 2 : 1)];
    return [...top, ...sections.flatMap((_s, i) => linesOf(i, levels[i])), ...tail].join('\n');
  };
  for (;;) {
    const text = compose();
    if (text.length <= budget) return text;
    const size = (i: number) => linesOf(i, levels[i]).reduce((n, l) => n + l.length + 1, 0);
    const open = sections.map((_s, i) => i).filter((i) => levels[i] < last);
    const pool = open.some((i) => sections[i].name !== 'risk') ? open.filter((i) => sections[i].name !== 'risk') : open;
    if (!pool.length) return hardCut(text, budget);
    const pick = pool.reduce((a, b) => (size(b) > size(a) ? b : a));
    levels[pick] += 1;
  }
}
