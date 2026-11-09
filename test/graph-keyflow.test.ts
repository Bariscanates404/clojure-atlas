import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Graph, GraphNode } from '../src/mcp/graph.ts';
import { indexGraph, parseDocument } from '../src/mcp/graph.ts';
import {
  arityFor, changeSignatureRows, commonPrefix, keyFlow, keySiblings, rowLabel, siblingAnalysis, signatureImpact, signatureOf, similarKeys, siteCalls, tablePool, tableRows,
  type ArityDesc, type TableRow,
} from '../src/mcp/keyflow.ts';
import { contextForChange, type QueryResult } from '../src/mcp/queries.ts';
import { render } from '../src/mcp/render.ts';
import { callTool } from '../src/mcp/server.ts';
import { GraphBuilder } from './helpers/code-graph-fixture.ts';

const KF_CAPS = ['signatures', 'key_flow', 'key_tables'].map((name) => ({ name, status: 'available' as const }));
const v2 = (b: GraphBuilder): Graph => indexGraph({ ...b.doc(), version: 2, capabilities: [...b.caps, ...KF_CAPS] });
const rows = (r: QueryResult, section: string) => r.sections.find((s) => s.name === section)?.rows ?? [];
const labels = (r: QueryResult, section: string) => rows(r, section).map((x) => x.label);

const MAP_SIG = {
  arities: [
    { params: [{ kind: 'map', keys: [':a', ':b', ':c'], defaults: [':c'], reads: [':a', ':b', ':c'], reads_complete: true }, { kind: 'symbol', name: 'x' }], variadic: false },
    { params: [{ kind: 'symbol', name: 'x' }, { kind: 'kwargs', keys: [':k1', ':k2'], reads: [':k1', ':k2'], reads_complete: true }], variadic: true },
  ],
};

// A use of the function as a value (apply, partial, a dispatch map): the call it ends in is not an edge with arguments.
const valueUse = (via: string, line = 50) => (b: GraphBuilder, f: string) =>
  void b.edge('definition:ui/one', 'references', f, { file: 'components/ui/src/one.clj', line, attrs: { via } });

function sigGraph(extra: (b: GraphBuilder, f: string) => void = () => {}): Graph {
  const b = new GraphBuilder();
  const f = b.def('core/f', 'components/core', { attrs: { signature: MAP_SIG } });
  const u1 = b.def('ui/one', 'components/ui');
  const u2 = b.def('api/two', 'components/api');
  b.edge(u1, 'calls', f, { file: 'components/ui/src/one.clj', line: 10, attrs: { arity: 2, arity_band: 'static_proven', args: [{ i: 0, shape: 'map', keys: [':a', ':z'], band: 'static_proven' }] } });
  b.edge(u2, 'calls', f, { file: 'components/api/src/two.clj', line: 20, attrs: { arity: 2, arity_band: 'static_proven', args: [{ i: 0, shape: 'local-map', keys: [':a'], band: 'heuristic', local: 'm' }] } });
  b.edge(u2, 'calls', f, { file: 'components/api/src/two.clj', line: 30, attrs: { arity: 0, arity_band: 'static_proven' } });
  b.edge(u1, 'calls', f, { file: 'components/ui/src/one.clj', line: 40, attrs: { arity: 3, arity_band: 'static_proven', kwargs: { keys: [':k1'], band: 'static_proven' } } });
  b.edge(b.node('namespace', 'ui'), 'references', f, { file: 'components/ui/src/one.clj', line: 1, attrs: { via: 'refer' } });
  extra(b, f);
  return v2(b);
}

describe('signature helpers', () => {
  const as = signatureOf(sigGraph().byId.get('definition:core/f')) as ArityDesc[];
  it('reads arities from attrs', () => {
    assert.equal(as.length, 2);
    assert.deepEqual(as[0].params[0].keys, [':a', ':b', ':c']);
  });
  it('picks an exact arity before a variadic one', () => {
    assert.equal(arityFor(as, 2), as[0]);
    assert.equal(arityFor(as, 1), as[1]);
    assert.equal(arityFor(as, 5), as[1]);
    assert.equal(arityFor(as, 0), undefined);
  });
  it('a definition without the attr has no signature', () => assert.equal(signatureOf({ id: 'x', kind: 'definition', name: 'x' }), null));
});

describe('signature_impact', () => {
  const r = signatureImpact(sigGraph(), 'core/f');
  const rv = signatureImpact(sigGraph(valueUse('apply')), 'core/f');
  it('verdict first with counts', () => {
    assert.match(r.verdict, /^4 caller\(s\) in 2 component\(s\); arities 2, 1\+; /);
    assert.match(rv.verdict, /1 UNKNOWN \(apply\/partial\/value\)/);
  });
  it('flags an arity no definition has', () => {
    assert.ok(labels(r, 'findings').some((l) => /api\/two calls f with 0 argument/.test(l)));
  });
  it('flags a destructured key no caller passes, but not one with a default', () => {
    const l = labels(r, 'findings');
    assert.ok(l.some((x) => /destructures :b .* but no caller passes it/.test(x)));
    assert.ok(!l.some((x) => /destructures :c /.test(x)));
    assert.ok(!l.some((x) => /destructures :a /.test(x)));
    assert.ok(l.some((x) => /destructures :k2 /.test(x)), 'kwargs keys count too');
  });
  it('flags a passed key the function never reads when reads are complete', () => {
    assert.ok(labels(r, 'findings').some((l) => /ui\/one passes :z which f never reads/.test(l)));
  });
  it('lists callers with arity and passed keys, apply as UNKNOWN, refers dropped', () => {
    const c = rows(rv, 'callers');
    assert.ok(c.some((x) => x.label === 'ui/one: arity 2, arg0 {:a :z}' && x.band === 'static_proven'));
    assert.ok(c.some((x) => x.label === 'api/two: arity 2, arg0 {:a} via local m' && x.band === 'heuristic'));
    assert.ok(c.some((x) => x.band === 'unknown' && /via apply/.test(x.label)));
    assert.ok(!c.some((x) => /refer/.test(x.label)));
  });
  it('renders UNKNOWN as not provable with evidence', () => {
    assert.match(render(rv), /UNKNOWN: ui\/one uses f via apply .* not provable; evidence at components\/ui\/src\/one.clj:50/);
  });
  it('does not claim unread keys when the parameter escapes', () => {
    const b = new GraphBuilder();
    const f = b.def('core/g', 'components/core', { attrs: { signature: { arities: [{ params: [{ kind: 'map', keys: [':a'], as: 'm', reads: [':a'], reads_complete: false, escapes: ['passed to h'] }], variadic: false }] } } });
    b.edge(b.def('ui/u'), 'calls', f, { attrs: { arity: 1, arity_band: 'static_proven', args: [{ i: 0, shape: 'map', keys: [':a', ':zz'], band: 'static_proven' }] } });
    const res = signatureImpact(v2(b), 'core/g');
    assert.deepEqual(labels(res, 'findings'), []);
    assert.ok(res.notes.some((n) => /passed on \(passed to h\)/.test(n)));
  });
  it('a never-passed key is heuristic when some caller argument is unknown', () => {
    const g = sigGraph((b, f) => b.edge(b.def('x/three'), 'calls', f, { attrs: { arity: 2, arity_band: 'static_proven', args: [{ i: 0, shape: 'symbol', band: 'unknown' }] } }));
    const row = rows(signatureImpact(g, 'core/f'), 'findings').find((x) => /destructures :b/.test(x.label));
    assert.equal(row?.band, 'heuristic');
    assert.match(row?.detail ?? '', /1 caller\(s\) pass an argument whose keys are not provable/);
  });
  // The dispatch-map case of a real PR: the only call with arguments is a test helper, the production caller reaches the
  // function through a map of handlers, so "no caller passes it" is not known.
  for (const via of ['value', 'apply', 'partial', 'comp']) {
    it(`a use as a value (${via}) leaves callers unknown: no never-passed claim, the use stays an UNKNOWN row`, () => {
      const res = signatureImpact(sigGraph(valueUse(via)), 'core/f');
      assert.ok(!labels(res, 'findings').some((x) => /but no caller passes it/.test(x)));
      assert.ok(labels(res, 'findings').some((x) => /ui\/one passes :z which f never reads/.test(x)), 'claims about a known call stay');
      assert.ok(rows(res, 'callers').some((x) => x.band === 'unknown' && new RegExp(`via ${via}`).test(x.label)));
    });
  }
  it('a use as a value leaves no never-passed row in the change signature rows either', () => {
    const rowsOf = (g: Graph) => changeSignatureRows(g, [g.byId.get('definition:core/f') as GraphNode]);
    const baseline = rowsOf(sigGraph());
    assert.deepEqual(baseline.map((x) => x.finding).sort(), ['arity-missing', 'never-passed', 'never-passed']);
    assert.deepEqual(rowsOf(sigGraph(valueUse('value'))).map((x) => x.finding), ['arity-missing']);
  });
  it('finding rows carry their kind and key as data', () => {
    const res = signatureImpact(sigGraph(), 'core/f');
    const never = rows(res, 'findings').filter((x) => x.finding === 'never-passed');
    assert.deepEqual(never.map((x) => x.key).sort(), [':b', ':k2']);
    assert.ok(never.every((x) => /but no caller passes it/.test(x.label)));
    assert.deepEqual(res.next.filter((n) => n.startsWith('key_flow')), ['key_flow(key=":b")']);
    assert.equal(rows(res, 'findings').filter((x) => x.finding === 'arity-missing').length, 1);
    assert.equal(rows(res, 'findings').filter((x) => x.finding === 'unread').length, 1);
  });
  it('a call without recorded arguments is an UNKNOWN row', () => {
    const g = sigGraph((b, f) => b.edge(b.def('x/bare'), 'calls', f, { file: 'components/x/src/bare.clj', line: 7 }));
    assert.ok(rows(signatureImpact(g, 'core/f'), 'callers').some((x) => x.band === 'unknown' && /arguments not recorded/.test(x.label)));
  });
  it('one row per call site: the arm holding the site wins over its namespace', () => {
    const b = new GraphBuilder();
    const f = b.def('core/f', 'components/core', { attrs: { signature: MAP_SIG } });
    const ns = b.node('namespace', 'ui');
    const arm = b.node('dispatch_arm', 'view :x');
    b.edge(ns, 'calls', f, { file: 'a.clj', line: 3, attrs: { arity: 2, arity_band: 'static_proven' } });
    b.edge(arm, 'calls', f, { file: 'a.clj', line: 3, attrs: { arity: 2, arity_band: 'static_proven' } });
    assert.deepEqual(siteCalls(v2(b), f).map((e) => e.from), [arm]);
  });
  it('no signature: says why', () => {
    const b = new GraphBuilder();
    b.def('core/v');
    assert.match(signatureImpact(v2(b), 'core/v').verdict, /no signature recorded/);
  });
  it('unknown and ambiguous names', () => {
    assert.equal(signatureImpact(sigGraph(), 'nope/x').found, false);
    const b = new GraphBuilder();
    b.def('a/f');
    b.def('b/f');
    assert.match(signatureImpact(v2(b), 'f').verdict, /ambiguous/);
  });
});

describe('signature_impact diff mode', () => {
  it('added keys: callers that do not pass them, unknown arguments as UNKNOWN', () => {
    const g = sigGraph((b, f) => b.edge(b.def('x/three'), 'calls', f, { attrs: { arity: 2, arity_band: 'static_proven', args: [{ i: 0, shape: 'symbol', band: 'unknown' }] } }));
    const r = signatureImpact(g, 'core/f', { change: { addedKeys: ['scope'] } });
    const a = rows(r, 'affected by the change');
    assert.ok(a.some((x) => x.label === 'ui/one does not pass :scope'));
    assert.ok(a.some((x) => x.label === 'x/three may not pass :scope' && x.band === 'unknown'));
    assert.match(r.verdict, /^\d+ caller\(s\) affected by the change \(new keys: :scope\)/);
  });
  it('removed keys and a narrowed arity list', () => {
    const r = signatureImpact(sigGraph(), 'core/f', { change: { removedKeys: [':a'], arities: [2] } });
    const l = labels(r, 'affected by the change');
    assert.ok(l.includes('ui/one still passes :a'));
    assert.ok(l.some((x) => /ui\/one calls f with 3 argument/.test(x)));
  });
  it('base graph: a new required key and a removed arity', () => {
    const base = sigGraph();
    const head = (() => {
      const b = new GraphBuilder();
      const f = b.def('core/f', 'components/core', { attrs: { signature: { arities: [{ params: [{ kind: 'map', keys: [':a', ':b', ':c', ':scope'], defaults: [':c'], reads_complete: true }, { kind: 'symbol', name: 'x' }], variadic: false }] } } });
      b.edge(b.def('ui/one', 'components/ui'), 'calls', f, { attrs: { arity: 2, arity_band: 'static_proven', args: [{ i: 0, shape: 'map', keys: [':a', ':b'], band: 'static_proven' }] } });
      b.edge(b.def('api/two', 'components/api'), 'calls', f, { attrs: { arity: 3, arity_band: 'static_proven' } });
      return v2(b);
    })();
    const r = signatureImpact(head, 'core/f', { base });
    const l = labels(r, 'affected by the change');
    assert.ok(l.includes('ui/one does not pass :scope'));
    assert.ok(l.some((x) => /api\/two calls f with 3 argument/.test(x)));
    assert.match(r.verdict, /arities removed: \[x & \{:keys \[k1 k2\]\}\]/);
  });
  it('a function missing from the base graph is new', () => {
    const r = signatureImpact(sigGraph(), 'core/f', { base: v2(new GraphBuilder()) });
    assert.ok(r.notes.some((n) => /not in the base graph/.test(n)));
  });
});

function keyGraph(): Graph {
  const b = new GraphBuilder();
  const k = b.node('key', ':scope', { id: 'key::scope', attrs: { other_uses: 3 } });
  b.node('key', ':scopes', { id: 'key::scopes' });
  b.node('key', ':app/scope', { id: 'key::app/scope' });
  const p = b.def('paths/dd', 'components/model');
  const c = b.def('runtime/eval', 'components/engine');
  const t = b.def('paths-test/t', 'components/model', { file: 'components/model/test/paths_test.clj' });
  b.edge(p, 'produces_key', k, { file: 'components/model/src/paths.cljc', line: 5, attrs: { via: 'map-literal' } });
  b.edge(c, 'consumes_key', k, { file: 'components/engine/src/eval.clj', line: 9, attrs: { via: 'get' } });
  b.edge(c, 'consumes_key', k, { file: 'components/engine/src/eval.clj', line: 11, band: 'heuristic', attrs: { via: 'pull' } });
  b.edge(c, 'removes_key', k, { file: 'components/engine/src/eval.clj', line: 12, attrs: { via: 'dissoc' } });
  b.edge(t, 'produces_key', k, { file: 'components/model/test/paths_test.clj', line: 3, attrs: { via: 'map-literal' } });
  const only = b.node('key', ':orphan', { id: 'key::orphan' });
  b.edge(c, 'consumes_key', only, { file: 'components/engine/src/eval.clj', line: 20, attrs: { via: 'keyword-fn' } });
  b.node('key', ':orphans', { id: 'key::orphans' });
  b.edge(p, 'produces_key', 'key::orphans', { file: 'components/model/src/paths.cljc', line: 6, attrs: { via: 'assoc' } });
  return v2(b);
}

describe('key_flow', () => {
  const g = keyGraph();
  it('producers, consumers, removers, tests apart', () => {
    const r = keyFlow(g, ':scope');
    assert.match(r.verdict, /^1 producer\(s\), 2 consumer\(s\), 1 remover\(s\) in 2 component\(s\); 1 site\(s\) in tests$/);
    assert.deepEqual(labels(r, 'producers'), ['paths/dd (map-literal)']);
    assert.equal(rows(r, 'consumers').length, 2);
    assert.equal(rows(r, 'in tests')[0].label, 'paths-test/t (map-literal) produces');
  });
  it('accepts the key with or without its colon and the key: prefix', () => {
    for (const q of ['scope', ':scope', 'key::scope']) assert.equal(keyFlow(g, q).matches[0], 'key::scope');
  });
  it('other uses are an UNKNOWN note, never dropped', () => {
    assert.ok(keyFlow(g, ':scope').notes.some((n) => /^UNKNOWN: 3 other use\(s\) of :scope .* not provable/.test(n)));
  });
  it('consumed but never produced: says so and names similar keys', () => {
    const r = keyFlow(g, ':orphan');
    assert.match(r.verdict, /consumed but never produced/);
    assert.ok(r.notes.some((n) => /similar keys: :orphans \(P1 C0\)/.test(n)));
    assert.deepEqual(r.next, ['key_flow(key=":orphans")']);
  });
  it('a bare name matching two qualified keys is ambiguous', () => {
    const b = new GraphBuilder();
    b.node('key', ':a/x', { id: 'key::a/x' });
    b.node('key', ':b/x', { id: 'key::b/x' });
    assert.match(keyFlow(v2(b), 'x').verdict, /ambiguous/);
  });
  it('a missing key: 0 proven sites, never "absent"', () => {
    const r = keyFlow(g, ':scop');
    assert.equal(r.found, false);
    assert.match(r.verdict, /0 proven producer or consumer sites/);
    assert.ok(r.notes.some((n) => /not proof of absence/.test(n)));
    assert.ok(r.notes.some((n) => /similar keys: .*:scope \(P2 C2\)/.test(n)));
  });
  it('similar keys by local name and small edit distance', () => {
    assert.deepEqual(similarKeys(g, ':scope').map((n) => n.name), [':app/scope', ':scopes']);
  });
  it('a version-1 graph says the capability is missing', () => {
    const b = new GraphBuilder();
    const r = keyFlow(b.build(), ':scope');
    assert.ok(r.notes.some((n) => /capability key_flow is not listed/.test(n)));
  });
});

const row = (line: number, keys: string[], tags: Record<string, string> = {}, vecs: Record<string, string[]> = {}): TableRow => ({ line, keys, tags, vecs });

describe('sibling analysis', () => {
  it('a row lacking a key 60%+ of siblings have', () => {
    const rs = [row(1, [':p', ':x']), row(2, [':p', ':x']), row(3, [':p', ':x']), row(4, [':p'])];
    const a = siblingAnalysis(rs, rs);
    assert.equal(a.findings.length, 1);
    assert.equal(a.findings[0].row.line, 4);
    assert.deepEqual(a.findings[0].missing[0], { key: ':x', have: 3, of: 3, reasons: ['3 of 3 sibling rows have it'] });
  });
  it('a minority key counts only through a path sibling', () => {
    const rs = [
      row(1, [':path', ':scope'], {}, { ':path': [':docs', ':els', 'KEY', ':expression'] }),
      row(2, [':path'], {}, { ':path': [':docs', ':els', 'KEY', ':show-if'] }),
      row(3, [':path'], {}, { ':path': [':name'] }),
      row(4, [':path'], {}, { ':path': [':email'] }),
    ];
    const a = siblingAnalysis(rs, rs);
    assert.deepEqual(a.findings.map((f) => [f.row.line, f.missing.map((m) => m.key)]), [[2, [':scope']]]);
    assert.match(a.findings[0].missing[0].reasons[0], /path sibling :path \[:docs :els KEY :expression\] at line 1/);
  });
  it('an absence shared by rows of the same kind is explained, not reported', () => {
    const rs = [row(1, [':out', ':priv'], { ':node-type': ':el' }), row(2, [':out', ':priv'], { ':node-type': ':el' }), row(3, [':out', ':priv'], { ':node-type': ':el' }), row(4, [':mime'], { ':node-type': ':asset' })];
    const other = [row(9, [':mime'], { ':node-type': ':asset' })];
    const a = siblingAnalysis(rs, [...rs, ...other]);
    assert.equal(a.findings.length, 0);
    assert.equal(a.explained.length, 2);
    assert.match(a.explained[0].why, /rows with :node-type :asset \(same form\) lack it too: 0 of 1/);
  });
  it('peers from any table when the form has none', () => {
    const rs = [row(1, [':priv']), row(2, [':priv']), row(3, [':priv']), row(4, [], { ':node-type': ':asset' })];
    const a = siblingAnalysis(rs, rs, [...rs, row(50, [], { ':node-type': ':asset' })]);
    assert.match(a.explained[0].why, /\(all tables\)/);
  });
  it('same-kind rows that mostly have the key do not explain it away', () => {
    const rs = [row(1, [':priv'], { ':t': ':v' }), row(2, [':priv'], { ':t': ':v' }), row(3, [], { ':t': ':v' })];
    const a = siblingAnalysis(rs, rs);
    assert.equal(a.findings.length, 1);
    assert.ok(a.findings[0].missing[0].reasons.some((x) => /rows with :t :v: 2 of 2 have it/.test(x)));
  });
  it('fewer than 3 rows is no table', () => assert.deepEqual(siblingAnalysis([row(1, [':a']), row(2, [])], []).findings, []));
  it('common prefix stops at a non-literal element', () => {
    assert.equal(commonPrefix([':a', ':b', ':c'], [':a', ':b', ':d']), 2);
    assert.equal(commonPrefix(['_', ':b'], ['_', ':b']), 0);
  });
  it('row label prefers the most literal vector', () => {
    assert.equal(rowLabel(row(1, [], {}, { ':out-path': ['_', 'KEY', '_'], ':path': [':docs', 'KEY', ':x'] })), ':path [:docs KEY :x]');
    assert.equal(rowLabel(row(1, [':a'], { ':t': ':v' })), ':t :v');
    assert.equal(rowLabel(row(1, [':a', ':b'])), '{:a :b}');
  });
});

function tableGraph(): Graph {
  const b = new GraphBuilder();
  const file = 'components/app/src/paths/dd.cljc';
  b.node('key_table', 'cfg :doc :dynamics', {
    id: `key_table:${file}:10:5`, file, line: 10, end_line: 30, component: 'components/app',
    attrs: {
      var: 'cfg', form_line: 1, shape: 'vector',
      rows: [
        { line: 11, keys: [':path', ':out-path', ':node-type', ':private?'], tags: { ':node-type': ':EL' }, vecs: { ':path': [':name'] } },
        { line: 13, keys: [':path', ':out-path', ':node-type', ':private?'], tags: { ':node-type': ':EL' }, vecs: { ':path': [':email'] } },
        { line: 15, keys: [':path', ':out-path', ':node-type', ':private?', ':scope'], tags: { ':node-type': ':EL' }, vecs: { ':path': [':docs', ':els', 'KEY', ':expression'] } },
        { line: 20, keys: [':path', ':out-path', ':node-type'], tags: { ':node-type': ':visibility-EL' }, vecs: { ':path': [':docs', ':els', 'KEY', ':show-if'] } },
      ],
      other_rows: [{ line: 25, shape: 'symbol' }],
    },
  });
  return v2(b);
}

describe('key_siblings', () => {
  const g = tableGraph();
  it('flags the row lacking :private? and :scope with evidence', () => {
    const r = keySiblings(g, 'components/app/src/paths/dd.cljc');
    assert.match(r.verdict, /^1 row\(s\) lack a key their siblings have, in 1 table\(s\) with 4 map rows; 1 row\(s\) not provable \(UNKNOWN\)$/);
    const f = rows(r, 'findings')[0];
    assert.equal(f.label, 'cfg :doc :dynamics: row :path [:docs :els KEY :show-if] lacks :private? :scope');
    assert.equal(f.line, 20);
    assert.equal(f.band, 'heuristic');
    assert.match(f.detail ?? '', /:private\?: 3 of 3 sibling rows have it/);
    assert.match(f.detail ?? '', /:scope: path sibling :path \[:docs :els KEY :expression\] at line 15 has it/);
  });
  it('the finding row carries its first missing key as data, and the next call names it', () => {
    const r = keySiblings(g, 'components/app/src/paths/dd.cljc');
    const f = rows(r, 'findings')[0];
    assert.equal(f.finding, 'lacks-key');
    assert.equal(f.key, ':private?');
    assert.ok(r.next.includes('key_flow(key=":private?")'));
  });
  it('the shared pool holds all rows and the rows of one form only', () => {
    const b = new GraphBuilder();
    const mk = (id: string, form: number, keys: string[][]) => b.node('key_table', id, { id, file: 'a.cljc', attrs: { form_line: form, rows: keys.map((k, i) => ({ line: i + 1, keys: k })) } });
    const t1 = mk('t1', 1, [[':a'], [':b']]);
    const t2 = mk('t2', 1, [[':c']]);
    const t3 = mk('t3', 9, [[':d']]);
    const g2 = v2(b);
    const pool = tablePool(g2);
    const keys = (rs: TableRow[]) => rs.map((r) => r.keys[0]).sort();
    assert.deepEqual(keys(pool.allRows), [':a', ':b', ':c', ':d']);
    assert.deepEqual(keys(pool.formRows(g2.byId.get(t1) as GraphNode)), [':a', ':b', ':c']);
    assert.deepEqual(keys(pool.formRows(g2.byId.get(t3) as GraphNode)), [':d']);
    assert.deepEqual(pool.formRows(g2.byId.get(t2) as GraphNode), pool.formRows(g2.byId.get(t1) as GraphNode));
    assert.deepEqual(tableRows(g2.byId.get(t3) as GraphNode).length, 1);
  });
  it('a non-map row is UNKNOWN, never absent', () => {
    const r = keySiblings(g, 'cfg');
    assert.equal(rows(r, 'rows not provable')[0].band, 'unknown');
    assert.match(render(r), /UNKNOWN: cfg :doc :dynamics: row is a symbol, not a map literal .* not provable; evidence at components\/app\/src\/paths\/dd.cljc:25/);
  });
  it('resolves by file:line inside the table, by id, by var and by file suffix', () => {
    for (const t of ['components/app/src/paths/dd.cljc:20', 'key_table:components/app/src/paths/dd.cljc:10:5', 'cfg', 'paths/dd.cljc']) {
      assert.equal(keySiblings(g, t).found, true, t);
    }
    assert.equal(keySiblings(g, 'nowhere.clj').found, false);
  });
  it('table summary row with key frequencies', () => {
    assert.match(rows(keySiblings(g, 'cfg'), 'tables')[0].detail ?? '', /4 map rows; :node-type 4\/4, :out-path 4\/4, :path 4\/4, :private\? 3\/4/);
  });
  it('next calls follow the first finding', () => {
    assert.deepEqual(keySiblings(g, 'cfg').next, ['key_flow(key=":private?")', 'callers(var="cfg")']);
  });
});

describe('server tools and context_for_change', () => {
  it('the three tools answer through callTool, with argument errors', () => {
    const g = sigGraph();
    assert.match(callTool(g, 'signature_impact', { fn: 'core/f' }).text, /^SIGNATURE_IMPACT core\/f — /);
    assert.match(callTool(g, 'signature_impact', { fn: 'core/f', added_keys: [':new'] }).text, /affected by the change/);
    assert.match(callTool(keyGraph(), 'key_flow', { key: ':scope' }).text, /^KEY_FLOW :scope — 1 producer/);
    assert.match(callTool(tableGraph(), 'key_siblings', { target: 'cfg' }).text, /^KEY_SIBLINGS cfg — 1 row/);
    assert.equal(callTool(g, 'key_flow', {}).isError, true);
    assert.equal(callTool(g, 'key_siblings', { target: ' ' }).isError, true);
  });
  it('no output asks a human for anything', () => {
    const texts = [
      callTool(sigGraph(), 'signature_impact', { fn: 'core/f', response_format: 'detailed' }).text,
      callTool(keyGraph(), 'key_flow', { key: ':orphan', response_format: 'detailed' }).text,
      callTool(tableGraph(), 'key_siblings', { target: 'cfg', response_format: 'detailed' }).text,
    ];
    for (const t of texts) assert.doesNotMatch(t, /confirm|please|check with|intended\?|ask /i);
  });
  it('context_for_change lists sibling findings on the changed lines and arity findings of changed definitions', () => {
    const r = contextForChange(tableGraph(), ['components/app/src/paths/dd.cljc:18-21']);
    // :scope is absent in 2 of 3 siblings: no sibling pattern, so only :private? (3 of 3) is left
    assert.ok(labels(r, 'signatures and key siblings').some((l) => /lacks :private\?$/.test(l)), labels(r, 'signatures and key siblings').join());
    const s = contextForChange(sigGraph(), [`components/core/src/core_f.clj`]);
    assert.ok(labels(s, 'signatures and key siblings').some((l) => /calls f with 0 argument/.test(l)));
  });
  it('context_for_change drops a row whose missing keys are all absent in 30%+ of siblings, and says so', () => {
    const b = new GraphBuilder();
    const file = 'components/app/src/t.cljc';
    // each row without :b sees it in 3 of 5 siblings: a 60% majority, absent in 40%
    const trows = [[':a', ':b'], [':a', ':b'], [':a', ':b'], [':a'], [':a'], [':a']].map((keys, i) => ({ line: 2 + i, keys, tags: {}, vecs: {} }));
    b.node('key_table', 'tbl', { id: `key_table:${file}:1:1`, file, line: 1, end_line: 9, component: 'components/app', attrs: { var: 'tbl', form_line: 1, shape: 'vector', rows: trows } });
    const r = contextForChange(v2(b), [`${file}:1-9`]);
    assert.deepEqual(labels(r, 'signatures and key siblings'), []);
    assert.ok(r.notes.some((n) => /^3 key-sibling row\(s\) dropped: the key they lack is absent in 30%\+ of sibling rows/.test(n)), r.notes.join());
    assert.equal(rows(keySiblings(v2(b), file), 'findings').length, 3);
  });
  it('a version-2 document passes the loader; version 1 still loads', () => {
    assert.equal(parseDocument({ ...new GraphBuilder().doc(), version: 2 }).version, 2);
    assert.equal(parseDocument(new GraphBuilder().doc()).version, 1);
  });
});

describe('key_flow and key_siblings answers stay honest', () => {
  const tableNode = (b: GraphBuilder, file: string, trows: Record<string, unknown>[]) =>
    b.node('key_table', `tbl ${file}`, { id: `key_table:${file}:1:1`, file, line: 1, end_line: 20, component: 'components/app', attrs: { var: 'tbl', form_line: 1, shape: 'vector', rows: trows } });
  const plain = (line: number, keys: string[], extra: Record<string, unknown> = {}) => ({ line, keys, tags: {}, vecs: {}, ...extra });

  it('a row with a dynamic key is not reported as lacking a key it may carry; it is an UNKNOWN row', () => {
    const b = new GraphBuilder();
    tableNode(b, 'src/app/core.clj', [plain(2, [':a', ':auth']), plain(3, [':a', ':auth']), plain(4, [':a', ':auth']), plain(5, [':a'], { dynamic_keys: 1 }), plain(6, [':a'])]);
    const r = keySiblings(v2(b), 'src/app/core.clj');
    assert.deepEqual(rows(r, 'findings').map((f) => f.line), [6]);
    const unknown = rows(r, 'rows not provable');
    assert.equal(unknown.length, 1);
    assert.equal(unknown[0].band, 'unknown');
    assert.equal(unknown[0].line, 5);
    assert.match(unknown[0].label, /1 dynamic key\(s\).* :auth/);
    assert.match(r.verdict, /1 row\(s\) not provable \(UNKNOWN\)/);
  });

  it('an unqualified query that hits a bare key exactly still names the qualified keys of the same local name', () => {
    const b = new GraphBuilder();
    const bare = b.node('key', ':email', { id: 'key::email' });
    b.node('key', ':user/email', { id: 'key::user/email' });
    b.node('key', ':other/email', { id: 'key::other/email' });
    const p = b.def('a/p', 'components/a');
    b.edge(p, 'produces_key', bare, { file: 'components/a/src/p.clj', line: 1, attrs: { via: 'assoc' } });
    const r = keyFlow(v2(b), 'email');
    assert.deepEqual(r.matches, ['key::email']);
    assert.ok(r.notes.some((n) => /other keys with the local name email: :other\/email, :user\/email/.test(n)), r.notes.join('|'));
  });

  it('test files are told apart by one predicate: test/, tests/ and _test(s).clj', () => {
    const b = new GraphBuilder();
    const k = b.node('key', ':k', { id: 'key::k' });
    const d = b.def('a/d', 'components/a');
    const sites = ['src/a/test/x.clj', 'src/a/tests/x.clj', 'src/a/x_test.clj', 'src/a/x_tests.cljc', 'src/a/contest.clj'];
    sites.forEach((file, i) => b.edge(d, 'consumes_key', k, { file, line: i + 1, attrs: { via: 'get' } }));
    const r = keyFlow(v2(b), ':k');
    assert.deepEqual(rows(r, 'in tests').map((x) => x.line).sort(), [1, 2, 3, 4]);
    assert.deepEqual(rows(r, 'consumers').map((x) => x.file), ['src/a/contest.clj']);
  });

  it('a bare file name matching several files is ambiguous, an exact path is not', () => {
    const b = new GraphBuilder();
    const rs = [plain(2, [':a']), plain(3, [':a']), plain(4, [':a'])];
    tableNode(b, 'src/app/core.clj', rs);
    tableNode(b, 'src/web/core.clj', rs);
    const g = v2(b);
    const r = keySiblings(g, 'core.clj');
    assert.equal(r.found, false);
    assert.match(r.verdict, /matches 2 files/);
    assert.deepEqual(r.next, ['key_siblings(target="src/app/core.clj")', 'key_siblings(target="src/web/core.clj")']);
    assert.equal(keySiblings(g, 'src/app/core.clj').found, true);
  });
});
