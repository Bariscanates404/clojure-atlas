import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BANDS } from '../src/mcp/graph.ts';
import {
  attributeUsage, blastRadius, callers, contextForChange, entryOf, eventFlow, isUnitTest, parseChange, permissionRoutes,
  routeAuthz, routeSiblings, routeVerdict, testsCovering, testsFor, type QueryResult,
} from '../src/mcp/queries.ts';
import { GraphBuilder, graph } from './helpers/code-graph-fixture.ts';

const rows = (r: QueryResult, section: string) => r.sections.filter((s) => s.name === section).flatMap((s) => s.rows);
const labels = (r: QueryResult, section: string) => rows(r, section).map((x) => x.label);

// unit tests: t.core-test/direct calls core/f; helper (test role, defn) calls core/f; t.core-test/via-helper
// calls helper; deep chain core/f <- a <- b <- c <- t.deep-test/far (depth 4, beyond the limit)
function unitGraph() {
  const b = new GraphBuilder();
  const f = b.def('core/f', 'components/core');
  const direct = b.def('t.core-test/direct', 'components/core', { roles: ['test'], attrs: { defined_by: 'clojure.test/deftest' } });
  const helper = b.def('t.core-test/helper', 'components/core', { roles: ['test'], attrs: { defined_by: 'clojure.core/defn' } });
  const viaHelper = b.def('t.core-test/via-helper', 'components/core', { roles: ['test'], attrs: { defined_by: 'clojure.test/deftest' } });
  const other = b.def('t.ui-test/renders', 'components/ui', { roles: ['test'] });
  const view = b.def('ui/view', 'components/ui');
  const a = b.def('x/a');
  const bb = b.def('x/b');
  const c = b.def('x/c');
  const far = b.def('t.deep-test/far', 'components/core', { roles: ['test'], attrs: { defined_by: 'clojure.test/deftest' } });
  const heur = b.def('t.core-test/guessed', 'components/core', { roles: ['test'], attrs: { defined_by: 'clojure.test/deftest' } });
  b.edge(direct, 'calls', f).edge(helper, 'calls', f).edge(viaHelper, 'calls', helper)
    .edge(view, 'calls', f).edge(other, 'calls', view)
    .edge(a, 'calls', f).edge(bb, 'calls', a).edge(c, 'calls', bb).edge(far, 'calls', c)
    .edge(heur, 'calls', f, { band: 'heuristic' });
  const sel = b.node('selector', 'view-box');
  const m = b.node('page_object_member', 'Page.view');
  b.edge(view, 'renders', sel).edge(m, 'uses_selector', sel).edge(b.node('test', 'ui > shows view', { file: 'e2e/ui.spec.ts', line: 3 }), 'calls', m);
  const attr = b.node('data_attribute', ':core/n');
  b.edge(f, 'writes', attr);
  return b.build();
}

describe('isUnitTest and entryOf', () => {
  const g = unitGraph();
  const cases: [string, boolean][] = [
    ['definition:t.core-test/direct', true],
    ['definition:t.core-test/helper', false],
    ['definition:t.ui-test/renders', true],
    ['definition:core/f', false],
    ['definition:none', false],
  ];
  for (const [id, expected] of cases) it(`${id} is ${expected ? '' : 'not '}a unit test`, () => assert.equal(isUnitTest(g.byId.get(id)), expected));

  it('entry points: route handler, event handler, handler role; tests are not entries', () => {
    const b = new GraphBuilder();
    const h = b.def('r/h');
    b.edge(b.route('GET', '/x'), 'routes_to', h);
    const eh = b.node('handler', 'handler of :e/x');
    const role = b.def('r/role', 'components/core', { roles: ['handler'] });
    const t = b.def('r/t', 'components/core', { roles: ['test'] });
    const x = b.build();
    assert.equal(entryOf(x, h), 'route GET /api/x @app');
    assert.equal(entryOf(x, eh), 'event handler');
    assert.equal(entryOf(x, role), 'handler');
    assert.equal(entryOf(x, t), undefined);
    assert.equal(entryOf(x, 'definition:none'), undefined);
  });
});

describe('tests_for', () => {
  const g = unitGraph();

  it('direct and transitive unit tests with depth; helpers are walked through, not listed', () => {
    const r = testsFor(g, 'core/f');
    const byLabel = Object.fromEntries(rows(r, 'clojure.test').map((x) => [x.label, x]));
    assert.equal(byLabel['t.core-test/direct'].depth, 1);
    assert.equal(byLabel['t.core-test/via-helper'].depth, 2);
    assert.match(byLabel['t.core-test/via-helper'].detail ?? '', /via t.core-test\/helper/);
    assert.equal(byLabel['t.ui-test/renders'].depth, 2);
    assert.ok(!byLabel['t.core-test/helper']);
  });

  it('respects the depth limit and says tests further out are not listed', () => {
    const r = testsFor(g, 'core/f');
    assert.ok(!labels(r, 'clojure.test').includes('t.deep-test/far'));
    assert.match(r.notes.join(' '), /beyond depth 3/);
    const d1 = testsFor(g, 'core/f', 1);
    assert.deepEqual(labels(d1, 'clojure.test').sort(), ['t.core-test/direct', 't.core-test/guessed']);
  });

  const clamp: [number, number][] = [[9, 3], [Number.NaN, 3]];
  for (const [given, used] of clamp) {
    it(`depth ${given} is used as ${used}`, () => assert.match(testsFor(g, 'core/f', given).sections[0].searched ?? '', new RegExp(`depth ${used}$`)));
  }

  it('keeps the band of the path', () => {
    assert.equal(rows(testsFor(g, 'core/f'), 'clojure.test').find((x) => x.label === 't.core-test/guessed')?.band, 'heuristic');
  });

  it('browser tests through a caller that renders a selector', () => {
    const r = testsFor(g, 'core/f');
    assert.deepEqual(labels(r, 'browser tests'), ['ui > shows view']);
    assert.match(rows(r, 'browser tests')[0].detail ?? '', /ui\/view -> view-box/);
  });

  it('states its limits and the namespaces to run per component', () => {
    const notes = testsFor(g, 'core/f').notes.join('\n');
    assert.match(notes, /static links only/);
    assert.match(notes, /0 tests means no static link, not untested/);
    assert.match(notes, /run in components\/core: t.core-test/);
    assert.match(notes, /run in components\/ui: t.ui-test/);
  });

  it('a data attribute starts from its writers and readers', () => {
    const r = testsFor(g, ':core/n');
    assert.ok(labels(r, 'clojure.test').includes('t.core-test/direct'));
    assert.equal(rows(r, 'clojure.test').find((x) => x.label === 't.core-test/direct')?.depth, 2);
  });

  it('an event starts from its dispatchers', () => {
    const b = new GraphBuilder();
    const ev = b.node('event', ':e/go');
    const v = b.def('ui/button');
    b.edge(v, 'dispatches', ev).edge(b.def('t/button-test', 'components/core', { roles: ['test'] }), 'calls', v);
    assert.deepEqual(labels(testsFor(b.build(), ':e/go'), 'clojure.test'), ['t/button-test']);
  });

  it('a selector or route falls back to browser coverage', () => {
    const r = testsFor(g, 'view-box');
    assert.equal(r.name, 'tests_for');
    assert.equal(r.sections[0].rows.length, 1);
  });

  it('a symbol with no tests says so in its verdict', () => {
    const x = graph((b) => { b.def('lonely/f'); });
    const r = testsFor(x, 'lonely/f');
    assert.match(r.verdict, /0 unit test\(s\) .* 0 browser test/);
  });

  it('unknown and ambiguous symbols', () => {
    assert.equal(testsFor(g, 'nope/nope').found, false);
    const x = graph((b) => { b.def('a/run'); b.def('b/run'); });
    assert.equal(testsFor(x, 'run').matches.length, 2);
  });

  it('a test that is itself the target counts as direct', () => {
    assert.deepEqual(labels(testsFor(g, 't.core-test/direct'), 'clojure.test'), []);
  });
});

describe('parseChange', () => {
  const cases: [string, unknown][] = [
    ['src/a.clj', { file: 'src/a.clj', ranges: [] }],
    ['src/a.clj:12', { file: 'src/a.clj', ranges: [[12, 12]] }],
    ['src/a.clj:10-20', { file: 'src/a.clj', ranges: [[10, 20]] }],
    ['src/a.clj:20-10', { file: 'src/a.clj', ranges: [[10, 20]] }],
    ['src/a.clj:3-4,9-12', { file: 'src/a.clj', ranges: [[3, 4], [9, 12]] }],
    [' src/a.clj:7 ', { file: 'src/a.clj', ranges: [[7, 7]] }],
    ['C:/x.clj', { file: 'C:/x.clj', ranges: [] }],
    ['src/weird:name.clj', { file: 'src/weird:name.clj', ranges: [] }],
  ];
  for (const [spec, expected] of cases) it(spec, () => assert.deepEqual(parseChange(spec), expected));
});

function changeGraph() {
  const b = new GraphBuilder();
  const file = 'bases/api/src/routes.clj';
  const h1 = b.def('api.routes/list', 'bases/api', { file, line: 10, end_line: 20 });
  const h2 = b.def('api.routes/drop', 'bases/api', { file, line: 30, end_line: 40 });
  const helper = b.def('api.routes/helper', 'bases/api', { file, line: 50, end_line: 55 });
  const r1 = b.route('GET', '/items', 'api', '/api');
  const r2 = b.route('DELETE', '/items/{p}', 'api', '/api');
  const r3 = b.route('POST', '/items', 'api', '/api');
  const r4 = b.route('PUT', '/items/{p}', 'api', '/api');
  for (const r of [r1, r2, r3, r4]) {
    const n = b.nodes.find((x) => x.id === r);
    if (n) n.file = file;
  }
  const perm = b.node('permission', ':edit-items');
  b.edge(r1, 'routes_to', h1).edge(r2, 'routes_to', h2)
    .edge(r1, 'requires_permission', perm).edge(r3, 'requires_permission', perm).edge(r4, 'requires_permission', perm);
  const attr = b.node('data_attribute', ':item/name');
  b.edge(h2, 'writes', attr, { file, line: 35 }).edge(b.def('db/read', 'components/db'), 'reads', attr);
  const job = b.def('jobs/cleanup', 'components/jobs', { roles: ['handler'] });
  b.edge(job, 'calls', h2).edge(h1, 'calls', helper);
  b.edge(b.def('t.routes-test/list-test', 'bases/api', { roles: ['test'], attrs: { defined_by: 'clojure.test/deftest' } }), 'calls', h1);
  return b.build();
}

describe('context_for_change', () => {
  const g = changeGraph();
  const file = 'bases/api/src/routes.clj';

  it('a hunk selects only the symbols on its lines', () => {
    assert.deepEqual(contextForChange(g, [`${file}:31-33`]).matches, ['definition:api.routes/drop']);
    assert.deepEqual(contextForChange(g, [`${file}:20-30`]).matches.sort(), ['definition:api.routes/drop', 'definition:api.routes/list']);
    assert.deepEqual(contextForChange(g, [`${file}:45-49`]).matches, []);
  });

  it('a whole file selects every symbol in it', () => {
    assert.equal(contextForChange(g, [file]).matches.length, 7);
  });

  it('flags a route without a check whose siblings have one as HIGH risk', () => {
    const r = contextForChange(g, [`${file}:31-33`]);
    assert.match(r.verdict, /risk HIGH/);
    assert.ok(rows(r, 'risk').some((x) => /no permission check .* its siblings check one/.test(x.detail ?? '')));
  });

  it('route authz rows carry the verdict and the sibling comparison', () => {
    const r = contextForChange(g, [`${file}:31-33`]);
    assert.match(rows(r, 'route authz')[0].detail ?? '', /NO permission check .* 3 sibling route\(s\) .* 3 check a permission/);
  });

  it('callers outside the diff, cross-component entry points become risk', () => {
    const r = contextForChange(g, [`${file}:31-33`]);
    assert.deepEqual(labels(r, 'callers outside the diff'), ['jobs/cleanup']);
    assert.ok(rows(r, 'risk').some((x) => x.label === 'jobs/cleanup'));
  });

  it('callers inside the diff are not repeated', () => {
    assert.ok(!labels(contextForChange(g, [file]), 'callers outside the diff').includes('api.routes/list'));
  });

  it('attributes written by the change, with totals, and a write to a read attribute is a risk', () => {
    const r = contextForChange(g, [`${file}:31-33`]);
    assert.match(rows(r, 'attributes')[0].detail ?? '', /writes by api.routes\/drop; 1 writer\(s\), 1 reader\(s\)/);
    assert.ok(rows(r, 'risk').some((x) => /writes :item\/name, read in 1 place/.test(x.detail ?? '')));
  });

  it('tests to run and tests to add', () => {
    const r = contextForChange(g, [`${file}:10-40`]);
    assert.deepEqual(labels(r, 'tests to run'), ['t.routes-test/list-test']);
    assert.deepEqual(labels(r, 'tests to add'), ['api.routes/drop']);
  });

  it('tests to run reach as deep as tests_for does by default, and say when callers go further', () => {
    const b = new GraphBuilder();
    const target = b.def('lib/target', 'components/lib', { file: 'lib.clj', line: 1, end_line: 5 });
    const chain = ['lib/a', 'lib/b', 'lib/c'].map((n) => b.def(n));
    const deep = b.def('lib-test/deep', 'components/lib', { roles: ['test'], attrs: { defined_by: 'clojure.test/deftest' } });
    const far = b.def('lib-test/far', 'components/lib', { roles: ['test'], attrs: { defined_by: 'clojure.test/deftest' } });
    b.edge(chain[0], 'calls', target).edge(chain[1], 'calls', chain[0]).edge(deep, 'calls', chain[1]).edge(chain[2], 'calls', deep).edge(far, 'calls', chain[2]);
    const gx = b.build();
    assert.deepEqual(labels(testsFor(gx, 'lib/target'), 'clojure.test'), ['lib-test/deep']);
    const r = contextForChange(gx, ['lib.clj']);
    assert.deepEqual(labels(r, 'tests to run'), ['lib-test/deep']);
    assert.deepEqual(labels(r, 'tests to add'), []);
    assert.match(r.notes.join(' '), /tests further out are not listed/);
  });

  it('a file the graph does not know is reported, not silently empty', () => {
    const r = contextForChange(g, ['docs/readme.md']);
    assert.equal(r.found, false);
    assert.match(r.notes.join(' '), /1 changed file\(s\) of a type this graph does not index \(\.md\)/);
    assert.match(r.verdict, /risk UNKNOWN/);
  });

  it('risk is UNKNOWN, never LOW, when no changed symbol was matched', () => {
    const none: string[][] = [[], ['docs/readme.md'], [`${file}:45-49`], [`${file}:12-`], ['nowhere/x.clj']];
    for (const specs of none) {
      const r = contextForChange(g, specs);
      assert.equal(r.found, false, specs.join());
      assert.match(r.verdict, /0 changed symbol\(s\).*risk UNKNOWN/, specs.join());
      assert.match(r.notes.join(' '), /no changed symbol matched: the risk is not decidable/, specs.join());
    }
    assert.match(contextForChange(new GraphBuilder().build(), ['a.clj:1']).verdict, /risk UNKNOWN/);
    assert.match(contextForChange(g, [`${file}:10-40`]).verdict, /risk (MEDIUM|HIGH)/);
  });

  it('every empty section says what it searched', () => {
    for (const s of contextForChange(g, ['docs/readme.md']).sections) assert.ok(s.searched, s.name);
  });

  it('an UNKNOWN permission check is HIGH risk and stays UNKNOWN', () => {
    const b = new GraphBuilder();
    const h = b.def('r/h', 'bases/api', { file: 'r.clj', line: 1, end_line: 5 });
    const route = b.route('GET', '/dyn');
    b.edge(route, 'routes_to', h).edge(route, 'requires_permission', b.node('unknown', 'perm/dyn'), { band: 'unknown' });
    const r = contextForChange(b.build(), ['r.clj']);
    assert.match(r.verdict, /risk HIGH/);
    assert.equal(rows(r, 'risk')[0].band, 'unknown');
  });

  it('next calls point at the touched route and a changed definition', () => {
    const r = contextForChange(g, [`${file}:31-33`]);
    assert.ok(r.next.some((n) => n.startsWith('route_authz(')));
    assert.ok(r.next.some((n) => n.startsWith('blast_radius(var="api.routes/drop"')));
  });
});

describe('route verdicts and siblings', () => {
  const g = changeGraph();
  const cases: [string, string][] = [
    ['route:GET /items @api/api', 'permission'],
    ['route:DELETE /items/{p} @api/api', 'none'],
  ];
  for (const [id, state] of cases) it(`${id} is ${state}`, () => assert.equal(routeVerdict(g, id).state, state));

  it('siblings are the other routes in the same file', () => {
    const route = g.byId.get('route:DELETE /items/{p} @api/api');
    assert.ok(route);
    const s = routeSiblings(g, route);
    assert.equal(s?.odd, true);
    assert.match(s?.text ?? '', /3 sibling route\(s\)/);
  });

  it('a route with no file or no siblings has no comparison', () => {
    const x = graph((b) => { b.route('GET', '/solo'); });
    const solo = x.byId.get('route:GET /solo @app/api');
    assert.ok(solo);
    assert.equal(routeSiblings(x, { ...solo, file: undefined }), null);
    assert.equal(routeSiblings(x, solo), null);
  });
});

describe('every query fills verdict, name and next', () => {
  const g = changeGraph();
  const u = unitGraph();
  const cases: [string, () => QueryResult][] = [
    ['callers', () => callers(g, 'api.routes/drop')],
    ['blast_radius', () => blastRadius(g, 'api.routes/drop')],
    ['route_authz', () => routeAuthz(g, '/items')],
    ['permission_routes', () => permissionRoutes(g, ':edit-items')],
    ['attribute_usage', () => attributeUsage(g, ':item/name')],
    ['event_flow', () => eventFlow(graph((b) => { b.node('event', ':e/x'); }), ':e/x')],
    ['tests_covering', () => testsCovering(u, 'view-box')],
    ['tests_for', () => testsFor(u, 'core/f')],
    ['context_for_change', () => contextForChange(g, ['bases/api/src/routes.clj'])],
  ];
  for (const [name, f] of cases) {
    it(name, () => {
      const r = f();
      assert.equal(r.name, name);
      assert.ok(r.verdict.length > 5);
      assert.ok(r.next.length <= 3);
      for (const n of r.next) assert.match(n, /^[a-z_]+\(.*\)$/);
      for (const s of r.sections) for (const x of s.rows) assert.ok(BANDS.includes(x.band));
    });
  }
});
