import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BANDS } from '../src/mcp/graph.ts';
import { parseCommand } from '../src/cli.ts';
import { DEFAULT_GRAPH } from '../src/build/index.ts';
import { callers, type QueryResult, type Row } from '../src/mcp/queries.ts';
import {
  bandMix, CHARS_PER_TOKEN, clampLimit, DEFAULT_LIMIT, DEFAULT_MAX_TOKENS, MAX_LIMIT, rankRows, render, where, why,
} from '../src/mcp/render.ts';
import { callTool, handleLine, handleMessage, TOOLS, toolList } from '../src/mcp/server.ts';
import { DEFAULT_MAX_DISTANCE, sameCommit, staleness } from '../src/mcp/staleness.ts';
import { GraphBuilder, graph } from './helpers/code-graph-fixture.ts';

const row = (i: number, extra: Partial<Row> = {}): Row => ({ label: `r${i}`, id: `definition:r${i}`, file: `src/f${i}.clj`, line: i + 1, band: 'static_proven', ...extra });
const result = (n: number, extra: Partial<QueryResult> = {}): QueryResult => ({
  name: 'callers', query: 'q', title: 'title', verdict: `${n} caller(s)`, found: true, matches: ['x'], notes: ['a note'], next: ['blast_radius(var="q")'],
  sections: [{ name: 'rows', rows: Array.from({ length: n }, (_, i) => row(i)) }], ...extra,
});
const rowLines = (text: string) => text.split('\n').filter((l) => /^\s+(\d+\. |└─ )/.test(l));

// ---------- render ----------

describe('render: shape', () => {
  it('snapshot: verdict, counts, note, section, next', () => {
    assert.equal(render(result(2)), [
      'CALLERS q — 2 caller(s)',
      'counts: rows=2 [S2]',
      'note: a note',
      'rows (2 S2)',
      '  1. r0  src/f0.clj:1 [S]',
      '  2. r1  src/f1.clj:2 [S]',
      'next: blast_radius(var="q")',
    ].join('\n'));
  });

  it('snapshot: grouped per component with cross-comp marked on the group', () => {
    const r = result(0, {
      sections: [{ name: 'callers', rows: [
        row(1, { component: 'components/a' }),
        row(2, { component: 'bases/api', cross: true, entry: 'route GET /x' }),
        row(3, { component: 'bases/api', cross: true }),
      ] }],
    });
    assert.equal(render(r).split('\n').slice(3).join('\n'), [
      'callers (3 S3)',
      '  bases/api: 2 (cross-comp)',
      '    1. r2  src/f2.clj:3 [S]  entry: route GET /x',
      '    2. r3  src/f3.clj:4 [S]',
      '  components/a: 1',
      '    3. r1  src/f1.clj:2 [S]',
      'next: blast_radius(var="q")',
    ].join('\n'));
  });

  it('snapshot: a tree with the edge type written out', () => {
    const r = result(0, {
      sections: [{ name: 'affected', tree: true, rows: [
        row(1, { depth: 1, kind: 'calls', parentId: 'definition:target' }),
        row(2, { depth: 2, kind: 'references', parentId: 'definition:r1' }),
        row(3, { depth: 3, kind: 'calls', parentId: 'definition:r2', band: 'heuristic' }),
      ] }],
    });
    assert.deepEqual(rowLines(render(r, { groupBy: 'none' })), [
      '  1. r1  src/f1.clj:2 [S]',
      '    └─ referenced by r2  src/f2.clj:3 [S] d2',
      '        └─ called by r3  src/f3.clj:4 [H] d3  heuristic match',
    ]);
  });

  it('snapshot: an ordered chain keeps its order and shows details', () => {
    const r = result(0, { sections: [{ name: 'middleware', ordered: true, rows: [row(9, { detail: '#1 path' }), row(1, { detail: '#2 method', band: 'heuristic' })] }] });
    assert.deepEqual(rowLines(render(r)), ['  1. r9  src/f9.clj:10 [S]  (#1 path)', '  2. r1  src/f1.clj:2 [H]  heuristic match  (#2 method)']);
  });

  it('UNKNOWN rows get their own "not provable; evidence at" line', () => {
    const text = render(result(0, { sections: [{ name: 's', rows: [row(1), row(2, { band: 'unknown', reason: 'glob matches 3 routes' })] }] }));
    assert.match(text, /^ {2}UNKNOWN: r2 at src\/f2.clj:3 \(glob matches 3 routes\) — not provable; evidence at src\/f2.clj:3$/m);
    assert.equal(rowLines(text).length, 1);
  });

  it('a section with only UNKNOWN rows says none proven and lists them', () => {
    const text = render(result(0, { sections: [{ name: 'writers', rows: [row(1, { band: 'unknown', detail: 'possible write: name save' }), row(2, { band: 'unknown' })] }] }));
    assert.match(text, /^writers: none proven \(2 uncertain\)$/m);
    assert.match(text, /^ {2}UNKNOWN: r1 at src\/f1.clj:2 \[possible write: name save\] — not provable; evidence at src\/f1.clj:2$/m);
    assert.doesNotMatch(text, /^writers: none \(/m);
  });

  it('UNKNOWN rows keep the order the query ranked them in', () => {
    const text = render(result(0, { sections: [{ name: 's', rows: [row(9, { band: 'unknown' }), row(1, { band: 'unknown' })] }] }));
    assert.ok(text.indexOf('UNKNOWN: r9') < text.indexOf('UNKNOWN: r1'));
  });

  it('a row without a line shows the file alone', () => {
    assert.match(render(result(0, { sections: [{ name: 's', rows: [row(1, { line: null })] }] })), /^ {2}1\. r1 {2}src\/f1.clj \[S\]$/m);
  });

  it('an empty section says what was searched', () => {
    assert.match(render(result(0, { sections: [{ name: 'writers', rows: [], searched: 'proven write edges' }] })), /^writers: none \(searched: proven write edges\)$/m);
    assert.match(render(result(0, { sections: [{ name: 'writers', rows: [] }] })), /^writers: none$/m);
  });

  it('not found says what was searched and how to fix the query', () => {
    const text = render(result(0, { found: false, sections: [], verdict: 'no definition matches "x"', next: [] }));
    assert.match(text, /^CALLERS q — no definition matches "x"$/m);
    assert.match(text, /searched: names, ids and kind-prefixed ids/);
  });

  it('a STALE header goes above the verdict', () => {
    assert.deepEqual(render(result(1), { header: 'STALE: x' }).split('\n').slice(0, 2), ['STALE: x', 'CALLERS q — 1 caller(s)']);
  });

  it('detailed mode adds a legend and details for the top 5 rows only', () => {
    const r = result(8);
    for (const x of r.sections[0].rows) x.detail = 'd';
    const text = render(r, { format: 'detailed' });
    assert.match(text, /^legend: \[S\] static_proven/m);
    assert.equal(rowLines(text).filter((l) => l.endsWith('(d)')).length, 5);
    assert.equal(rowLines(render(r)).filter((l) => l.endsWith('(d)')).length, 0, 'concise shows no details on ranked rows');
  });

  it('json mode returns the structured result', () => {
    assert.deepEqual(JSON.parse(render(result(2), { format: 'json' })), result(2));
  });

  it('at most 3 next calls', () => {
    assert.match(render(result(1, { next: ['a()', 'b()', 'c()', 'd()'] })), /^next: a\(\) {2}b\(\) {2}c\(\)$/m);
  });

  it('names and file:line, never ids', () => {
    for (const l of rowLines(render(result(5)))) assert.doesNotMatch(l, /definition:/);
  });
});

describe('render: ranking', () => {
  const bands: Row['band'][] = ['unknown', 'heuristic', 'declared', 'static_proven'];
  it('band first', () => {
    assert.deepEqual(rankRows(bands.map((b, i) => row(i, { band: b }))).map((x) => x.band), ['static_proven', 'declared', 'heuristic', 'unknown']);
  });
  it('then depth', () => assert.deepEqual(rankRows([row(1, { depth: 3 }), row(2, { depth: 1 }), row(3, { depth: 2 })]).map((x) => x.depth), [1, 2, 3]));
  it('then entry point', () => assert.deepEqual(rankRows([row(1), row(2, { entry: 'route' })]).map((x) => x.label), ['r2', 'r1']));
  it('then fan-in', () => assert.deepEqual(rankRows([row(1, { fanIn: 2 }), row(2, { fanIn: 9 })]).map((x) => x.label), ['r2', 'r1']));
  it('then cross-component', () => assert.deepEqual(rankRows([row(1), row(2, { cross: true })]).map((x) => x.label), ['r2', 'r1']));
  it('then name', () => assert.deepEqual(rankRows([row(2), row(1)]).map((x) => x.label), ['r1', 'r2']));
  it('band beats every other key', () => {
    assert.deepEqual(rankRows([row(1, { band: 'heuristic', entry: 'route', fanIn: 99, cross: true }), row(2, { depth: 3 })]).map((x) => x.label), ['r2', 'r1']);
  });

  const whyCases: [Partial<Row>, string][] = [
    [{}, ''],
    [{ entry: 'route GET /x' }, 'entry: route GET /x'],
    [{ cross: true }, 'cross-comp'],
    [{ fanIn: 2 }, ''],
    [{ fanIn: 3 }, 'fan-in 3'],
    [{ band: 'heuristic' }, 'heuristic match'],
    [{ entry: 'handler', cross: true, fanIn: 5 }, 'entry: handler, cross-comp'],
  ];
  for (const [extra, expected] of whyCases) it(`why ${JSON.stringify(extra)}`, () => assert.equal(why(row(0, extra)), expected));

  const mixCases: [Row['band'][], string][] = [[[], ''], [['static_proven'], 'S1'], [['unknown', 'static_proven', 'heuristic', 'heuristic', 'declared'], 'S1 D1 H2 ?1']];
  for (const [bs, expected] of mixCases) it(`band mix ${expected || 'empty'}`, () => assert.equal(bandMix(bs.map((b, i) => row(i, { band: b }))), expected));

  const whereCases: [Pick<Row, 'file' | 'line'>, string][] = [
    [{ file: 'a.clj', line: 3 }, 'a.clj:3'],
    [{ file: 'a.clj', line: null }, 'a.clj'],
    [{ file: null, line: null }, '(no file)'],
  ];
  for (const [r, s] of whereCases) it(`where ${s}`, () => assert.equal(where(r), s));
});

describe('render: paging and budget', () => {
  const limitCases: [number | undefined, 'concise' | 'detailed', number][] = [
    [undefined, 'concise', DEFAULT_LIMIT.concise], [undefined, 'detailed', DEFAULT_LIMIT.detailed], [0, 'concise', 1], [-3, 'concise', 1],
    [7, 'concise', 7], [7.9, 'concise', 7], [MAX_LIMIT + 1, 'concise', MAX_LIMIT], [Number.NaN, 'concise', DEFAULT_LIMIT.concise],
  ];
  for (const [given, fmt, used] of limitCases) it(`limit ${given} (${fmt}) -> ${used}`, () => assert.equal(clampLimit(given, fmt), used));

  it('caps rows and prints the exact offset to ask for', () => {
    const text = render(result(30), { limit: 10 });
    assert.equal(rowLines(text).length, 10);
    assert.match(text, /^ {2}\+20 more \(next page: offset=10 section="rows"\)$/m);
  });

  it('offset pages through, numbering continues', () => {
    const text = render(result(30), { limit: 10, offset: 10 });
    assert.match(rowLines(text)[0], /^ {2}11\. r\d+ /);
    assert.match(text, /\+10 more \(next page: offset=20/);
    assert.doesNotMatch(render(result(30), { limit: 10, offset: 20 }), /more \(ask/);
  });

  it('section filter, and a filter that matches nothing lists the sections', () => {
    const r = result(0, { sections: [{ name: 'readers', rows: [row(1)] }, { name: 'writers', rows: [row(2)] }] });
    assert.doesNotMatch(render(r, { section: 'writers' }), /readers/);
    assert.match(render(r, { section: 'nope' }), /no section matches "nope"; sections: readers, writers/);
  });

  it('group_by file and none', () => {
    const r = result(0, { sections: [{ name: 's', rows: [row(1, { component: 'c/a' }), row(2, { component: 'c/a' })] }] });
    assert.match(render(r, { groupBy: 'file' }), /^ {2}src\/f1.clj: 1$/m);
    assert.doesNotMatch(render(r, { groupBy: 'none' }), /c\/a/);
  });

  it('within the budget nothing is truncated', () => {
    assert.doesNotMatch(render(result(5)), /truncated/);
  });

  it('over the budget: details dropped first', () => {
    const r = result(3);
    for (const x of r.sections[0].rows) x.detail = 'x'.repeat(300);
    const text = render(r, { format: 'detailed', maxTokens: 120 });
    assert.match(text.split('\n')[1], /^truncated: details dropped \(budget 120 tokens/);
    assert.doesNotMatch(text, /x{300}/);
  });

  it('then rows become counts per group', () => {
    const r = result(0, { sections: [{ name: 's', rows: Array.from({ length: 40 }, (_, i) => row(i, { component: `c/${i % 3}`, label: `a-long-name-${'n'.repeat(40)}-${i}` })) }] });
    const text = render(r, { maxTokens: 60, limit: 40 });
    assert.match(text, /truncated: rows→counts per group/);
    assert.match(text, /c\/0=14, c\/1=13, c\/2=13/);
    assert.equal(rowLines(text).length, 0);
  });

  it('then section totals only', () => {
    const r = result(0, { sections: Array.from({ length: 6 }, (_, k) => ({ name: `s${k}`, rows: Array.from({ length: 30 }, (_, i) => row(i, { component: `component/${'c'.repeat(30)}${i}` })) })) });
    const text = render(r, { maxTokens: 70, limit: 30 });
    assert.match(text, /truncated: rows→section totals/);
    assert.match(text, /^s0 \(30 S30\)$/m);
  });

  it('never exceeds the budget', () => {
    for (const tokens of [20, 50, 100, 400]) {
      const r = result(200);
      assert.ok(render(r, { maxTokens: tokens, limit: 200 }).length <= tokens * CHARS_PER_TOKEN, `budget ${tokens}`);
    }
  });

  it('the default budgets', () => {
    assert.equal(DEFAULT_MAX_TOKENS.concise, 1500);
    assert.equal(DEFAULT_MAX_TOKENS.detailed, 4000);
    assert.ok(render(result(5000), { limit: 500 }).length <= 1500 * CHARS_PER_TOKEN);
  });

  it('an invalid budget falls back to the default', () => {
    for (const t of [0, -5, Number.NaN]) assert.doesNotMatch(render(result(3), { maxTokens: t }), /truncated/);
  });
});

describe('render: paging tells the truth', () => {
  const tree = () => result(0, {
    sections: [{ name: 'affected', tree: true, rows: [
      row(1, { depth: 1, kind: 'calls', parentId: 'definition:target' }),
      row(2, { depth: 2, kind: 'calls', parentId: 'definition:r1' }),
      row(3, { depth: 3, kind: 'calls', parentId: 'definition:r2' }),
      row(4, { depth: 1, kind: 'calls', parentId: 'definition:target' }),
    ] }],
  });

  it('a tree page that starts inside a subtree first shows the rows it hangs under', () => {
    const lines = render(tree(), { groupBy: 'none', limit: 2, offset: 1 }).split('\n');
    const at = (re: RegExp) => lines.findIndex((l) => re.test(l));
    assert.ok(at(/continued from the previous page/) >= 0, lines.join('\n'));
    assert.ok(at(/r1 /) > at(/continued/) && at(/r1 /) < at(/└─ called by r2/), lines.join('\n'));
    assert.ok(at(/└─ called by r3/) > at(/└─ called by r2/));
    assert.equal(lines.filter((l) => /^ +\d+\. /.test(l)).length, 0, 'the context root carries no number');
  });

  it('a page that starts at a root has no context', () => {
    assert.doesNotMatch(render(tree(), { groupBy: 'none', limit: 3 }), /continued/);
  });

  it('an offset past the end says so instead of printing a bare header', () => {
    const text = render(result(3), { offset: 10 });
    assert.match(text, /offset 10 is past the end of the 3 row\(s\)/);
  });

  it('json and text page the same known rows, unknown rows stay in every page', () => {
    const r = result(0, { sections: [{ name: 's', rows: [row(0, { band: 'unknown', reason: 'dynamic' }), row(1, { band: 'heuristic' }), row(2), row(3)] }] });
    const text = render(r, { groupBy: 'none', limit: 1, offset: 1 });
    assert.match(rowLines(text)[0], /^ {2}2\. r3 /);
    const json = JSON.parse(render(r, { format: 'json', groupBy: 'none', limit: 1, offset: 1 })) as { sections: { rows: { label: string }[]; total: number }[] };
    assert.deepEqual(json.sections[0].rows.map((x) => x.label), ['r3', 'r0']);
    assert.equal(json.sections[0].total, 4);
  });

  it('a key query longer than the budget still keeps its verdict', () => {
    const q = 'k'.repeat(10000);
    const r = result(0, { query: q, verdict: `0 proven producer or consumer sites of :${q} in this graph`, sections: [], found: false, notes: [`nothing for ${q}`] });
    const text = render(r);
    assert.match(text, /0 proven producer or consumer sites of :k+.* in this graph/);
    assert.ok(text.length <= DEFAULT_MAX_TOKENS.concise * CHARS_PER_TOKEN);
  });
});

describe('render: every row line of a real query is cited', () => {
  it('callers with mixed bands', () => {
    const g = new GraphBuilder();
    const t = g.def('t/t');
    for (let i = 0; i < 30; i++) g.edge(g.def(`c/f${i}`, `components/c${i % 3}`), 'calls', t, { band: BANDS[i % 3] });
    g.edge(g.def('c/unk'), 'calls', t, { band: 'unknown' });
    const text = render(callers(g.build(), 't/t'), { limit: 500, maxTokens: 100000 });
    const lines = rowLines(text);
    assert.equal(lines.length, 31, '30 callers and the definition row');
    for (const l of lines) assert.match(l, /\S+(:\d+)? \[(S|D|H|\?)\]/);
    assert.match(text, /UNKNOWN: c\/unk at src\/site.x:\d+/);
  });
});

describe('staleness', () => {
  const g = graph(() => {});
  const sha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const at = (n: number | null) => () => n;

  it('no base, no header', () => assert.deepEqual(staleness(g, undefined), { stale: false, distance: null, header: null }));
  it('blank base, no header', () => assert.equal(staleness(g, '  ').header, null));

  const same: [string, boolean][] = [[sha, true], ['aaaaaaa', true], ['AAAAAAAAAA', true], ['aaaaaa', false], ['bbbbbbbbbb', false], ['', false]];
  for (const [base, eq] of same) it(`sameCommit(${base || '""'}) = ${eq}`, () => assert.equal(sameCommit(sha, base), eq));

  it('the same commit (short sha) is fresh at distance 0', () => assert.deepEqual(staleness(g, 'aaaaaaaaaa', { distance: at(99) }), { stale: false, distance: 0, header: null }));

  const thresholds: [number, number | undefined, boolean][] = [
    [0, undefined, false], [1, undefined, false], [DEFAULT_MAX_DISTANCE, undefined, false], [DEFAULT_MAX_DISTANCE + 1, undefined, true],
    [5, 5, false], [6, 5, true], [0, 0, false], [1, 0, true], [500, 1000, false],
  ];
  for (const [d, max, stale] of thresholds) {
    it(`distance ${d} with threshold ${max ?? DEFAULT_MAX_DISTANCE} is ${stale ? 'STALE' : 'fresh'}`, () => {
      const s = staleness(g, 'bbbbbbbbbb', { distance: at(d), maxDistance: max });
      assert.equal(s.stale, stale);
      assert.equal(s.distance, d);
      if (stale) assert.match(s.header ?? '', new RegExp(`^STALE: graph built at aaaaaaaaaa is ${d} commits behind base bbbbbbbbbb`));
      else assert.match(s.header ?? '', /within threshold/);
    });
  }

  it('an unmeasurable distance is STALE, never fresh', () => {
    const s = staleness(g, 'bbbbbbbbbb', { distance: at(null) });
    assert.equal(s.stale, true);
    assert.match(s.header ?? '', /distance unknown \(git could not compare them\)/);
  });

  it('without a repo a different sha is STALE with unknown distance', () => {
    assert.match(staleness(g, 'bbbbbbbbbb').header ?? '', /^STALE: .*no repo configured/);
  });

  it('the header reaches tool output', () => {
    const b = new GraphBuilder();
    b.def('a/f');
    const out = callTool(b.build(), 'callers', { var: 'a/f', base: 'cccccccccc' }, { distance: at(50) });
    assert.match(out.text.split('\n')[0], /^STALE: .* 50 commits behind/);
  });
});

// ---------- server ----------

function serverGraph() {
  const b = new GraphBuilder();
  const t = b.def('core/save');
  b.edge(b.def('ui/a', 'components/ui'), 'calls', t);
  const r = b.route('POST', '/articles/{p}/comments', 'editor', '/api');
  b.edge(r, 'requires_permission', b.node('permission', ':comment-write'), { attrs: { check: 1, checks: 1 } });
  b.edge(b.def('db/w'), 'writes', b.node('data_attribute', ':article/n'));
  b.edge(b.def('ui/v'), 'dispatches', b.node('event', ':article/save'));
  b.node('selector', 'sel-x');
  return b.build();
}

describe('MCP server', () => {
  const g = serverGraph();
  const call = (name: string, args: Record<string, unknown>, id = 1) =>
    handleMessage(g, { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }) as {
      result: { content: { type: string; text: string }[]; isError: boolean };
    };

  it('initialize echoes the protocol version and declares tools', () => {
    const r = handleMessage(g, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } }) as { result: Record<string, unknown> };
    assert.equal(r.result.protocolVersion, '2025-03-26');
    assert.deepEqual(r.result.capabilities, { tools: {} });
    assert.deepEqual(r.result.serverInfo, { name: 'clojure-atlas', version: '0.1.0' });
  });

  it('initialize without a version uses the default', () => {
    const r = handleMessage(g, { jsonrpc: '2.0', id: 1, method: 'initialize' }) as { result: Record<string, unknown> };
    assert.equal(r.result.protocolVersion, '2025-06-18');
  });

  it('notifications get no response', () => {
    assert.equal(handleMessage(g, { jsonrpc: '2.0', method: 'notifications/initialized' }), null);
    assert.equal(handleMessage(g, { jsonrpc: '2.0', method: 'ping' }), null);
    assert.equal(handleMessage(g, { jsonrpc: '2.0', method: 'whatever' }), null);
  });

  it('ping', () => assert.deepEqual(handleMessage(g, { jsonrpc: '2.0', id: 'p', method: 'ping' }), { jsonrpc: '2.0', id: 'p', result: {} }));

  it('tool texts use examples that exist in public repositories', () => {
    const texts = JSON.stringify(toolList());
    assert.match(texts, /\/api\/articles\/:slug/);
  });

  it('tools/list names every tool with an object schema and required args', () => {
    const r = handleMessage(g, { jsonrpc: '2.0', id: 2, method: 'tools/list' }) as { result: { tools: { name: string; inputSchema: { type: string; required?: string[]; properties: Record<string, unknown> } }[] } };
    assert.deepEqual(r.result.tools.map((t) => t.name), ['callers', 'blast_radius', 'route_authz', 'permission_routes', 'attribute_usage', 'event_flow', 'tests_covering', 'tests_for', 'signature_impact', 'key_flow', 'key_siblings', 'context_for_change', 'graph_info']);
    for (const t of r.result.tools) {
      assert.equal(t.inputSchema.type, 'object');
      assert.ok('base' in t.inputSchema.properties, `${t.name} takes base`);
    }
    assert.equal(toolList().length, TOOLS.length + 1);
  });

  const happy: [string, Record<string, unknown>, RegExp][] = [
    ['callers', { var: 'core/save' }, /^CALLERS core\/save — 1 direct caller\(s\) in 1 component\(s\)/],
    ['blast_radius', { var: 'core/save', depth: 3 }, /depth capped at 3/],
    ['route_authz', { route: '/articles/:slug/comments' }, /verdict requires :comment-write/],
    ['permission_routes', { permission: ':comment-write' }, /POST \/api\/articles\/\{p\}\/comments/],
    ['attribute_usage', { attr: ':article/n' }, /1 proven writer\(s\), 0 uncertain; 0 proven reader\(s\), 0 uncertain/],
    ['event_flow', { name: ':article/save' }, /ui\/v/],
    ['tests_covering', { target: 'sel-x' }, /no browser test reaches/],
    ['tests_for', { symbol: 'core/save' }, /static links only/],
    ['context_for_change', { changes: ['components/core/src/core_save.clj'] }, /1 changed symbol\(s\)/],
    ['graph_info', {}, /graph demo @ main sha a{40}/],
  ];
  for (const [name, args, re] of happy) {
    it(`tools/call ${name}`, () => {
      const r = call(name, args);
      assert.equal(r.result.isError, false);
      assert.equal(r.result.content[0].type, 'text');
      assert.match(r.result.content[0].text, re);
    });
  }

  const missing: [string, string][] = [['tests_for', 'symbol'], ['context_for_change', 'changes'], ['callers', 'var'], ['blast_radius', 'var'], ['route_authz', 'route'], ['permission_routes', 'permission'], ['attribute_usage', 'attr'], ['event_flow', 'name'], ['tests_covering', 'target']];
  for (const [name, arg] of missing) {
    it(`${name} without ${arg} is a tool error`, () => {
      const r = call(name, {});
      assert.equal(r.result.isError, true);
      assert.match(r.result.content[0].text, new RegExp(`missing required argument\\(s\\) ${arg}`));
    });
    it(`${name} with a blank ${arg} is a tool error`, () => assert.equal(call(name, { [arg]: '  ' }).result.isError, true));
  }

  it('context_for_change takes an array; an array of blanks or non-strings is missing', () => {
    assert.equal(call('context_for_change', { changes: ['src/core_save.clj'] }).result.isError, false);
    assert.equal(call('context_for_change', { changes: ['  ', 3] }).result.isError, true);
    assert.equal(call('context_for_change', { changes: 'src/a.clj' }).result.isError, false, 'a string is accepted as present');
  });

  it('tests_for through the tool', () => {
    assert.match(call('tests_for', { symbol: 'core/save' }).result.content[0].text, /^TESTS_FOR core\/save — 0 unit test/);
  });

  it('response_format json is one JSON object: the structured result plus source { stale, notice }', () => {
    const r = JSON.parse(callTool(g, 'callers', { var: 'core/save', response_format: 'json' }).text);
    assert.equal(r.name, 'callers');
    assert.deepEqual(r.source, { stale: false, notice: null });
    const stale = JSON.parse(callTool(g, 'callers', { var: 'core/save', response_format: 'json', base: 'bbbbbbbbbb' }).text);
    assert.equal(stale.name, 'callers');
    assert.equal(stale.source.stale, true);
    assert.match(stale.source.notice, /^STALE/);
  });

  it('response_format detailed adds the legend; an unknown format falls back to concise', () => {
    assert.match(callTool(g, 'callers', { var: 'core/save', response_format: 'detailed' }).text, /^legend:/m);
    assert.doesNotMatch(callTool(g, 'callers', { var: 'core/save', response_format: 'fancy' }).text, /^legend:/m);
  });

  it('offset, section, group_by and max_tokens reach the renderer', () => {
    const b = new GraphBuilder();
    const t = b.def('t/t');
    for (let i = 0; i < 20; i++) b.edge(b.def(`c/f${i}`), 'calls', t);
    const x = b.build();
    assert.match(callTool(x, 'callers', { var: 't/t', limit: 5, offset: 15 }).text, /^ {4}16\. /m);
    assert.doesNotMatch(callTool(x, 'callers', { var: 't/t', section: 'callers' }).text, /^definition/m);
    assert.doesNotMatch(callTool(x, 'callers', { var: 't/t', group_by: 'none' }).text, /components\/core: 20/);
    assert.match(callTool(x, 'callers', { var: 't/t', max_tokens: 60, limit: 20 }).text, /truncated:/);
  });

  it('every tool schema lists the shared rendering params', () => {
    for (const t of toolList() as { name: string; inputSchema: { properties: Record<string, unknown> } }[]) {
      if (t.name === 'graph_info') continue;
      for (const k of ['base', 'response_format', 'limit', 'offset', 'section', 'max_tokens', 'group_by']) assert.ok(k in t.inputSchema.properties, `${t.name}.${k}`);
    }
  });

  it('an unknown tool is invalid params on the wire and a tool error from callTool', () => {
    assert.equal((handleMessage(g, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'nope' } }) as { error: { code: number } }).error.code, -32602);
    assert.match(callTool(g, 'nope', {}).text, /unknown tool nope/);
  });
  it('a wrong-typed optional argument is an error naming it, never silently ignored', () => {
    const bad: [string, Record<string, unknown>, RegExp][] = [
      ['blast_radius', { var: 'x', depth: '1' }, /depth must be a number, got string/],
      ['callers', { var: 'x', limit: '3' }, /limit must be a number/],
      ['callers', { var: 'x', group_by: 'bogus' }, /group_by must be one of component, file, none/],
      ['callers', { var: 'x', response_format: 'xml' }, /response_format must be one of concise, detailed, json/],
      ['signature_impact', { fn: 'x', arities: ['1'] }, /arities must be a list of number/],
      ['callers', { var: 'x', include_references: 'yes' }, /include_references must be a boolean/],
      ['graph_info', { base: 5 }, /base must be a string/],
    ];
    for (const [name, args, why] of bad) {
      const r = callTool(g, name, args);
      assert.equal(r.isError, true, name);
      assert.match(r.text, why);
      assert.ok(r.text.startsWith(`${name}: invalid argument(s): `), r.text);
    }
    assert.equal(callTool(g, 'callers', { var: 'x', limit: 3, group_by: 'file', depth: null }).isError, false);
  });
  it('tools/call without a name is invalid params', () => {
    assert.deepEqual((handleMessage(g, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: {} }) as { error: unknown }).error, { code: -32602, message: 'tools/call needs params.name' });
  });
  it('an unknown method is method-not-found', () => {
    assert.equal((handleMessage(g, { jsonrpc: '2.0', id: 4, method: 'resources/list' }) as { error: { code: number } }).error.code, -32601);
  });
  it('a request that is not an object is invalid', () => {
    for (const bad of [null, 3, 'x', []]) assert.equal((handleMessage(g, bad) as { error: { code: number } }).error.code, -32600);
  });
  it('a request without a method is invalid', () => assert.equal((handleMessage(g, { id: 9 }) as { error: { code: number } }).error.code, -32600));
  it('an unparsable line is a parse error', () => assert.equal((handleLine(g, '{nope') as { error: { code: number } }).error.code, -32700));
  it('a blank line is ignored', () => assert.equal(handleLine(g, '   '), null));
  it('a line round-trips', () => assert.equal((handleLine(g, '{"jsonrpc":"2.0","id":7,"method":"ping"}') as { id: number }).id, 7));
  it('limit is honoured through the tool', () => {
    const b = new GraphBuilder();
    const t = b.def('t/t');
    for (let i = 0; i < 20; i++) b.edge(b.def(`c/f${i}`), 'calls', t);
    const r = callTool(b.build(), 'callers', { var: 't/t', limit: 5 });
    assert.match(r.text, /\+15 more \(next page: offset=5 section="callers"\)/);
  });
  it('graph_info lists capabilities and notes', () => {
    const b = new GraphBuilder();
    b.caps = [{ name: 'definitions', status: 'available', edges: 3, bands: { static_proven: 3 }, note: 'x lost' }];
    assert.match(callTool(b.build(), 'graph_info', {}).text, /definitions: available, 3 edges \{"static_proven":3\} \(x lost\)/);
  });
});

// ---------- entry point and library ----------

describe('entry point args', () => {
  const cases: [string[], Record<string, unknown>][] = [
    [['--graph', 'g.json'], { graph: 'g.json' }],
    [['--graph', 'g.json', '--repo', '/r'], { graph: 'g.json', repo: '/r' }],
    [['--graph', 'g.json', '--max-distance', '7'], { graph: 'g.json', maxDistance: 7 }],
    [['--max-distance', '0', '--graph', 'x'], { graph: 'x', maxDistance: 0 }],
  ];
  for (const [argv, expected] of cases) it(argv.join(' '), () => assert.deepEqual(parseCommand(['mcp', ...argv]), { cmd: 'mcp', ...expected }));
  it('no graph serves the project graph a build writes by default', () => assert.deepEqual(parseCommand(['mcp']), { cmd: 'mcp', graph: DEFAULT_GRAPH }));
  it('a bad max distance is rejected', () => assert.throws(() => parseCommand(['mcp', '--graph', 'g', '--max-distance', 'x']), /non-negative integer/));
});

