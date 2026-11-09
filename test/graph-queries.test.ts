import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Band } from '../src/mcp/graph.ts';
import { BANDS } from '../src/mcp/graph.ts';
import {
  attributeUsage, blastRadius, callers, canonicalRoute, eventFlow, findRoutes, permissionExpression, permissionRoutes,
  readLikeness, resolve, routeAuthz, testsCovering, testsFor, writeLikeness, type QueryResult,
} from '../src/mcp/queries.ts';
import { render } from '../src/mcp/render.ts';
import { GraphBuilder, graph } from './helpers/code-graph-fixture.ts';

const rows = (r: QueryResult, section?: string) =>
  r.sections.filter((s) => !section || s.name.endsWith(section)).flatMap((s) => s.rows);
const labels = (r: QueryResult, section?: string) => rows(r, section).map((x) => x.label);
const everyRowCited = (r: QueryResult) => {
  for (const x of rows(r)) {
    assert.equal(typeof x.file, 'string', `row ${x.label} has no file`);
    assert.ok(BANDS.includes(x.band), `row ${x.label} has band ${x.band}`);
  }
};

// ---------- resolve ----------

describe('resolve', () => {
  const g = graph((b) => {
    b.def('shop.cart/add');
    b.def('shop.ui/add', 'components/ui');
    b.def('shop.cart/remove');
    b.node('event', ':cart/add');
    b.node('data_attribute', ':cart/items');
    b.node('permission', ':edit-cart');
  });
  const cases: [string, string[], string, string[]][] = [
    ['exact id', ['definition'], 'definition:shop.cart/add', ['definition:shop.cart/add']],
    ['qualified name', ['definition'], 'shop.cart/add', ['definition:shop.cart/add']],
    ['bare name, two namespaces', ['definition'], 'add', ['definition:shop.cart/add', 'definition:shop.ui/add']],
    ['bare name, one namespace', ['definition'], 'remove', ['definition:shop.cart/remove']],
    ['keyword with colon', ['event'], ':cart/add', ['event::cart/add']],
    ['keyword without colon', ['event'], 'cart/add', ['event::cart/add']],
    ['attribute keyword', ['data_attribute'], ':cart/items', ['data_attribute::cart/items']],
    ['attribute without colon', ['data_attribute'], 'cart/items', ['data_attribute::cart/items']],
    ['permission', ['permission'], 'edit-cart', ['permission::edit-cart']],
    ['id of another kind is not returned', ['event'], 'definition:shop.cart/add', []],
    ['unknown name', ['definition'], 'nope/x', []],
    ['empty query', ['definition'], '  ', []],
    ['padded query', ['definition'], '  shop.cart/add ', ['definition:shop.cart/add']],
  ];
  for (const [name, kinds, q, expected] of cases) {
    it(name, () => assert.deepEqual(resolve(g, kinds, q).map((n) => n.id).sort(), expected));
  }
});

// ---------- callers ----------

describe('callers', () => {
  const b = new GraphBuilder();
  const target = b.def('core/save');
  const c1 = b.def('ui/a', 'components/ui');
  const c2 = b.def('ui/b', 'components/ui');
  const c3 = b.def('api/c', 'bases/api');
  const r1 = b.def('api/ref', 'bases/api');
  b.edge(c1, 'calls', target).edge(c2, 'calls', target).edge(c3, 'calls', target, { band: 'heuristic' }).edge(r1, 'references', target);
  const g = b.build();

  it('lists direct callers with file:line and band', () => {
    const r = callers(g, 'core/save');
    assert.ok(r.found);
    assert.deepEqual(labels(r, 'callers').sort(), ['api/c', 'ui/a', 'ui/b']);
    everyRowCited(r);
    for (const x of rows(r, 'callers')) assert.equal(typeof x.line, 'number');
  });

  it('counts callers per component', () => {
    assert.deepEqual(callers(g, 'core/save').counts, { 'components/ui': 2, 'bases/api': 1 });
  });

  it('keeps the heuristic band of a heuristic call', () => {
    assert.equal(rows(callers(g, 'core/save'), 'callers').find((x) => x.label === 'api/c')?.band, 'heuristic');
  });

  it('references only on request', () => {
    assert.ok(!labels(callers(g, 'core/save')).includes('api/ref'));
    assert.ok(labels(callers(g, 'core/save', { includeReferences: true })).includes('api/ref'));
  });

  it('counts a caller once however many call sites it has, and agrees with blast radius', () => {
    const x = new GraphBuilder();
    const t = x.def('a/t');
    const c = x.def('a/c');
    const d = x.def('a/d');
    x.edge(c, 'calls', t).edge(c, 'calls', t, { band: 'heuristic' }).edge(c, 'calls', t).edge(d, 'calls', t);
    const gx = x.build();
    const r = callers(gx, 'a/t');
    assert.match(r.verdict, /^2 direct caller\(s\)/);
    assert.deepEqual(labels(r, 'callers').sort(), ['a/c', 'a/d']);
    assert.equal(rows(r, 'callers').find((y) => y.label === 'a/c')?.band, 'static_proven', 'the strongest band of its sites');
    assert.match(rows(r, 'callers').find((y) => y.label === 'a/c')?.detail ?? '', /3 sites/);
    assert.match(blastRadius(gx, 'a/t').verdict, /^2 caller\(s\)/);
  });

  it('a definition only referenced or passed as a callback says so instead of reading as unused', () => {
    const r = callers(g, 'core/save');
    assert.match(r.notes.join(' '), /1 more definition\(s\) reference it without calling it.*include_references/);
    assert.doesNotMatch(callers(g, 'core/save', { includeReferences: true }).notes.join(' '), /reference it without calling it/);
    assert.doesNotMatch(callers(g, 'ui/a').notes.join(' '), /without calling it/);
    const x = new GraphBuilder();
    const cb = x.def('a/cb');
    x.edge(x.def('a/user'), 'passes_callback', cb);
    const only = callers(x.build(), 'a/cb');
    assert.match(only.verdict, /^0 direct caller/);
    assert.match(only.notes.join(' '), /1 more definition\(s\) reference it/);
  });

  it('a definition nobody calls has an empty, found answer', () => {
    const r = callers(g, 'ui/a');
    assert.ok(r.found);
    assert.equal(rows(r, 'callers').length, 0);
  });

  it('an unknown definition is not found, with a hint', () => {
    const r = callers(g, 'nope/x');
    assert.equal(r.found, false);
    assert.match(r.verdict, /no definition matches/);
    assert.match(r.notes.join(' '), /fully qualified/);
  });

  it('an ambiguous bare name lists candidates instead of picking one', () => {
    const g2 = graph((x) => { x.def('a.one/run'); x.def('a.two/run'); });
    const r = callers(g2, 'run');
    assert.equal(r.found, false);
    assert.equal(r.matches.length, 2);
    assert.match(r.notes[0], /2 nodes match/);
    assert.match(r.verdict, /ambiguous \(2 matches\)/);
    assert.deepEqual(r.next, ['callers(var="a.one/run")', 'callers(var="a.two/run")']);
  });

  it('a clj and a cljs file of one namespace: one definition, callers from both files', () => {
    const x = new GraphBuilder();
    const t = x.def('a.core/f', 'components/a', { file: 'components/a/src/a/core.cljc' });
    const fromClj = x.def('a.server/s', 'components/a', { file: 'components/a/src/a/server.clj' });
    const fromCljs = x.def('a.client/c', 'components/a', { file: 'components/a/src/a/client.cljs' });
    x.edge(fromClj, 'calls', t, { file: 'components/a/src/a/server.clj' }).edge(fromCljs, 'calls', t, { file: 'components/a/src/a/client.cljs' });
    const r = callers(x.build(), 'a.core/f');
    assert.deepEqual(rows(r, 'callers').map((y) => y.file).sort(), ['components/a/src/a/client.cljs', 'components/a/src/a/server.clj']);
  });

  it('notes an absent capability so an empty answer is not read as none', () => {
    const x = new GraphBuilder();
    x.def('a/f');
    x.caps = x.caps.filter((c) => c.name !== 'definitions');
    assert.match(callers(x.build(), 'a/f').notes.join(' '), /not listed .* not proof of absence/);
    const y = new GraphBuilder();
    y.def('a/f');
    y.caps = y.caps.map((c) => (c.name === 'definitions' ? { ...c, status: 'absent' as const } : c));
    assert.match(callers(y.build(), 'a/f').notes.join(' '), /absent: an empty answer is not proof/);
  });

  it('carries a capability note (known losses)', () => {
    const x = new GraphBuilder();
    x.def('a/f');
    x.caps = x.caps.map((c) => (c.name === 'definitions' ? { ...c, note: '3 sites lost' } : c));
    assert.match(callers(x.build(), 'a/f').notes.join(' '), /3 sites lost/);
  });

  for (const band of BANDS) {
    it(`shows a ${band} caller`, () => {
      const x = new GraphBuilder();
      const t = x.def('a/t');
      x.edge(x.def('a/c'), 'calls', t, { band });
      const r = callers(x.build(), 'a/t');
      assert.deepEqual(rows(r, 'callers').map((y) => y.band), [band]);
      if (band === 'unknown') assert.match(r.notes.join(' '), /UNKNOWN.*not absence/);
    });
  }
});

// ---------- blast radius ----------

describe('blast radius', () => {
  // chain: d4 -> d3 -> d2 -> d1 -> t ; plus a cycle d1 <-> d1b and a self call on t
  const b = new GraphBuilder();
  const t = b.def('core/t');
  const d1 = b.def('l1/a', 'components/l1');
  const d1b = b.def('l1/b', 'components/l1');
  const d2 = b.def('l2/a', 'components/l2');
  const d3 = b.def('l3/a', 'components/l3');
  const d4 = b.def('l4/a', 'components/l4');
  b.edge(d1, 'calls', t).edge(d1b, 'calls', d1).edge(d1, 'calls', d1b).edge(t, 'calls', t)
    .edge(d2, 'calls', d1, { band: 'heuristic' }).edge(d3, 'references', d2).edge(d4, 'calls', d3);
  const g = b.build();

  const depthCases: [number, string[]][] = [
    [1, ['l1/a']],
    [2, ['l1/a', 'l1/b', 'l2/a']],
    [3, ['l1/a', 'l1/b', 'l2/a', 'l3/a']],
  ];
  for (const [depth, expected] of depthCases) {
    it(`depth ${depth} reaches ${expected.length}`, () => assert.deepEqual(labels(blastRadius(g, 'core/t', depth)).sort(), expected));
  }

  it('without depth walks to the end: a chain longer than 3 is fully reached', () => {
    const r = blastRadius(g, 'core/t');
    assert.deepEqual(labels(r).sort(), ['l1/a', 'l1/b', 'l2/a', 'l3/a', 'l4/a']);
    assert.match(r.title, /all depths/);
    assert.match(r.verdict, /^5 caller\(s\) over 4 depth\(s\) in 4 component\(s\)/);
    assert.doesNotMatch(r.notes.join(' '), /continue beyond/);
  });

  it('an explicit depth caps the walk and says more callers exist', () => {
    const r = blastRadius(g, 'core/t', 2);
    assert.deepEqual(labels(r).sort(), ['l1/a', 'l1/b', 'l2/a']);
    assert.match(r.title, /depth 2\)/);
    assert.match(r.verdict, /depth capped at 2, more callers exist/);
    assert.match(r.notes.join(' '), /callers continue beyond depth 2/);
  });

  const depthForms: [number, string][] = [[0, 'depth 1)'], [-5, 'depth 1)'], [1.7, 'depth 1)'], [99, 'depth 99)'], [Number.NaN, 'all depths)']];
  for (const [given, shown] of depthForms) {
    it(`depth ${given} is shown as ${shown}`, () => assert.ok(blastRadius(g, 'core/t', given).title.endsWith(shown)));
  }

  it('summary notes carry counts per depth and per component', () => {
    const notes = blastRadius(g, 'core/t').notes.join('\n');
    assert.match(notes, /by depth: 1=1 2=2 3=1 4=1/);
    assert.match(notes, /by component: components\/l1=2 components\/l2=1 components\/l3=1 components\/l4=1/);
  });

  it('does not claim more callers when the graph ends at the depth', () => {
    assert.doesNotMatch(blastRadius(g, 'l3/a', 3).notes.join(' '), /continue beyond/);
  });

  it('cycles and self calls are visited once and never include the target', () => {
    const r = blastRadius(g, 'core/t', 3);
    const ls = labels(r);
    assert.equal(new Set(ls).size, ls.length);
    assert.ok(!ls.includes('core/t'));
  });

  it('records the depth and the weakest band along the path', () => {
    const r = blastRadius(g, 'core/t', 3);
    const by = Object.fromEntries(rows(r).map((x) => [x.label, x]));
    assert.equal(by['l1/a'].depth, 1);
    assert.equal(by['l2/a'].depth, 2);
    assert.equal(by['l2/a'].band, 'heuristic');
    assert.equal(by['l3/a'].band, 'heuristic', 'a proven edge after a heuristic one stays heuristic');
  });

  it('counts per component', () => {
    assert.deepEqual(blastRadius(g, 'core/t', 3).counts, { 'components/l1': 2, 'components/l2': 1, 'components/l3': 1 });
    assert.equal(blastRadius(g, 'core/t').counts?.['components/l4'], 1);
  });

  it('every row is cited', () => everyRowCited(blastRadius(g, 'core/t', 3)));

  it('a node reached by a heuristic and a proven path at one depth gets the proven band, in any edge order', () => {
    for (const heuristicFirst of [true, false]) {
      const x = new GraphBuilder();
      const [t, viaH, viaP, z] = ['n/t', 'n/x', 'n/y', 'n/z'].map((n) => x.def(n));
      x.edge(viaH, 'calls', t, { band: 'heuristic' }).edge(viaP, 'calls', t);
      if (heuristicFirst) x.edge(z, 'calls', viaH).edge(z, 'calls', viaP);
      else x.edge(z, 'calls', viaP).edge(z, 'calls', viaH);
      const hit = rows(blastRadius(x.build(), 'n/t')).find((y) => y.label === 'n/z');
      assert.equal(hit?.band, 'static_proven', `heuristic path first: ${heuristicFirst}`);
      assert.equal(hit?.depth, 2);
    }
  });

  it('a node at the shallowest depth wins when two paths reach it', () => {
    const x = new GraphBuilder();
    const tt = x.def('t/t');
    const a = x.def('a/a');
    const c = x.def('c/c');
    x.edge(a, 'calls', tt).edge(c, 'calls', a).edge(c, 'calls', tt);
    assert.equal(rows(blastRadius(x.build(), 't/t', 3)).find((y) => y.label === 'c/c')?.depth, 1);
  });

  it('unknown target and ambiguous target', () => {
    assert.equal(blastRadius(g, 'zz/zz').found, false);
    const x = graph((y) => { y.def('p/run'); y.def('q/run'); });
    assert.equal(blastRadius(x, 'run').matches.length, 2);
  });

  it('a wide fan-in stays fast and complete', () => {
    const x = new GraphBuilder();
    const tt = x.def('t/t');
    for (let i = 0; i < 2000; i++) x.edge(x.def(`c${i % 7}.ns/f${i}`, `components/c${i % 7}`), 'calls', tt);
    const r = blastRadius(x.build(), 't/t', 1);
    assert.equal(rows(r).length, 2000);
    assert.equal(Object.values(r.counts ?? {}).reduce((a, c) => a + c, 0), 2000);
  });
});

describe('blast radius on a deep graph', () => {
  // a chain of 12 callers, each calling the one before; the last one is a route handler
  const b = new GraphBuilder();
  let prev = b.def('deep/t', 'components/core');
  const ids: string[] = [];
  for (let i = 1; i <= 12; i++) {
    const n = b.def(`deep/f${i}`, i % 2 ? 'components/odd' : 'components/even');
    b.edge(n, 'calls', prev);
    prev = n;
    ids.push(n);
  }
  b.edge(b.route('GET', '/deep'), 'routes_to', prev);
  const g = b.build();

  it('reaches every depth, with the shallow ones in one section and the rest in "deeper"', () => {
    const r = blastRadius(g, 'deep/t');
    assert.equal(r.sections.length, 2);
    assert.deepEqual(r.sections.map((s) => s.name), ['affected', 'deeper']);
    assert.equal(r.sections[0].rows.length, 2);
    assert.equal(r.sections[1].rows.length, 10);
    assert.ok(r.sections[1].rows.every((x) => (x.depth ?? 0) > 2));
    assert.match(r.verdict, /^12 caller\(s\) over 12 depth\(s\) in 2 component\(s\), 1 entry point\(s\) reach it/);
  });

  it('names the entry points reached and the call for the deeper rows', () => {
    const r = blastRadius(g, 'deep/t');
    assert.match(r.notes.join('\n'), /entry points reached: route=1; first routes: GET \/api\/deep/);
    assert.equal(r.next[0], 'blast_radius(var="deep/t", section="deeper", limit=100)');
  });

  it('the rendered answer pages the deep rows with the existing offset and limit', () => {
    const first = render(blastRadius(g, 'deep/t'), { limit: 3 });
    assert.match(first, /section="deeper"/);
    const page = render(blastRadius(g, 'deep/t'), { section: 'deeper', limit: 4, offset: 4 });
    assert.match(page, /deeper \(10/);
    assert.match(page, /d7|d8/);
    assert.doesNotMatch(page, /deep\/f12/);
    assert.match(page, /\+2 more \(next page: offset=8 section="deeper"\)/);
  });

  it('the per-depth line lists every depth', () => {
    assert.match(blastRadius(g, 'deep/t').notes.join('\n'), /by depth: 1=1 2=1 3=1 4=1 5=1 6=1 7=1 8=1 9=1 10=1 11=1 12=1(\n|$)/);
  });

  it('an explicit depth keeps the answer small', () => {
    const r = blastRadius(g, 'deep/t', 2);
    assert.deepEqual(r.sections.map((s) => s.name), ['affected']);
    assert.equal(r.sections[0].rows.length, 2);
  });
});

// ---------- routes ----------

describe('canonicalRoute', () => {
  const cases: [string, string | null, string][] = [
    ['/article/:id/font', null, '/article/{p}/font'],
    ['/article/{article-id}/font', null, '/article/{p}/font'],
    ['/article/{p}/font/', null, '/article/{p}/font'],
    ['GET /article/:id', 'GET', '/article/{p}'],
    ['post /x', 'POST', '/x'],
    ['DELETE /a/:b/c/:d', 'DELETE', '/a/{p}/c/{p}'],
    ['POST /article/{p}/font @editor/api', 'POST', '/article/{p}/font'],
    ['route:POST /article/{p}/font @editor/api', 'POST', '/article/{p}/font'],
    ['/x?y=1', null, '/x'],
    ['x/y', null, '/x/y'],
    ['/', null, '/'],
    ['/files/*rest', null, '/files/{p}'],
  ];
  for (const [input, method, path] of cases) {
    it(`${input} -> ${method ?? '*'} ${path}`, () => assert.deepEqual(canonicalRoute(input), { method, path }));
  }
});

function authzGraph() {
  const b = new GraphBuilder();
  const font = b.route('POST', '/article/{p}/font', 'editor', '/api');
  const fontPublic = b.route('GET', '/article/{p}/font', 'public', '');
  const usage = b.route('POST', '/billing/usage', 'editor', '/api');
  const copy = b.route('POST', '/copy', 'editor', '/api');
  const pub = b.route('GET', '/docs', 'editor', '');
  const open = b.route('GET', '/open', 'editor', '');
  const dyn = b.route('GET', '/dyn', 'editor', '');
  const handler = b.def('routes.articles/upload-font', 'bases/editor');
  const csp = b.def('mw/csp');
  const authn = b.def('mw/authn');
  const authz = b.def('mw/authz');
  const lib = b.node('external', 'var/lib/coerce');
  const edit = b.node('permission', ':edit-article');
  const view = b.node('permission', ':view-article');
  const bill = b.node('permission', ':billing');
  const admin = b.node('permission', ':admin');
  const readA = b.node('permission', ':read-a');
  const readT = b.node('permission', ':read-t');
  const create = b.node('permission', ':create');
  const ex = b.node('authz_exemption', 'public documentation');
  b.edge(font, 'routes_to', handler)
    .edge(font, 'guarded_by', authz, { attrs: { order: 4, level: 'path' } })
    .edge(font, 'guarded_by', csp, { attrs: { order: 1, level: 'router-data', inherited_from: 'bases/d/h.clj:10' } })
    .edge(font, 'guarded_by', lib, { attrs: { order: 2, level: 'router-data', inherited_from: 'bases/d/h.clj:10' } })
    .edge(font, 'guarded_by', authn, { attrs: { order: 3, level: 'path', inherited_from: 'bases/d/h.clj:20' } })
    .edge(font, 'requires_permission', edit, { attrs: { check: 1, checks: 1 } })
    .edge(fontPublic, 'requires_permission', view, { attrs: { check: 1, checks: 1 } })
    .edge(usage, 'requires_permission', bill, { attrs: { check: 1, checks: 1, alternative: 1, alternatives: 2 } })
    .edge(usage, 'requires_permission', admin, { attrs: { check: 1, checks: 1, alternative: 2, alternatives: 2 } })
    .edge(copy, 'requires_permission', create, { attrs: { check: 1, checks: 2, all_checks: true } })
    .edge(copy, 'requires_permission', readA, { attrs: { check: 2, checks: 2, all_checks: true, alternative: 1, alternatives: 2, all_of: 2 } })
    .edge(copy, 'requires_permission', readT, { attrs: { check: 2, checks: 2, all_checks: true, alternative: 1, alternatives: 2, all_of: 2 } })
    .edge(copy, 'requires_permission', admin, { attrs: { check: 2, checks: 2, all_checks: true, alternative: 2, alternatives: 2 } })
    .edge(pub, 'exempted_by', ex, { attrs: { label: 'public documentation' } })
    .edge(dyn, 'requires_permission', b.node('unknown', 'authz/dynamic'), { band: 'unknown', attrs: { check: 1, checks: 1, reason: 'runtime value' } });
  void open;
  return b.build();
}

describe('route authz', () => {
  const g = authzGraph();

  const findCases: [string, string[]][] = [
    ['/article/:id/font', ['route:GET /article/{p}/font @public', 'route:POST /article/{p}/font @editor/api']],
    ['/article/{article-id}/font', ['route:GET /article/{p}/font @public', 'route:POST /article/{p}/font @editor/api']],
    ['POST /article/:id/font', ['route:POST /article/{p}/font @editor/api']],
    ['GET /article/:id/font', ['route:GET /article/{p}/font @public']],
    ['/api/article/:id/font', ['route:POST /article/{p}/font @editor/api']],
    ['/font', ['route:GET /article/{p}/font @public', 'route:POST /article/{p}/font @editor/api']],
    ['route:POST /copy @editor/api', ['route:POST /copy @editor/api']],
    ['POST /copy @editor/api', ['route:POST /copy @editor/api']],
    ['/nothing', []],
  ];
  for (const [q, ids] of findCases) {
    it(`findRoutes ${q}`, () => assert.deepEqual(findRoutes(g, q).map((n) => n.id).sort(), ids));
  }

  it('the same path in two bases is two answers, each with base and mount', () => {
    const r = routeAuthz(g, '/article/:id/font');
    assert.equal(r.matches.length, 2);
    assert.match(r.notes.join(' '), /2 routes match/);
    assert.ok(r.sections.some((s) => /base editor, mount \/api/.test(s.name)));
    assert.ok(r.sections.some((s) => /base public/.test(s.name)));
  });

  it('single permission: verdict, handler, permission row with check', () => {
    const r = routeAuthz(g, 'POST /article/:id/font');
    assert.ok(r.sections.some((s) => /verdict requires :edit-article$/.test(s.name)));
    assert.deepEqual(labels(r, 'handler'), ['routes.articles/upload-font']);
    assert.deepEqual(rows(r, 'permissions').map((x) => x.detail), ['check 1/1']);
    everyRowCited(r);
  });

  it('middleware in chain order, outermost first, with inheritance', () => {
    const r = routeAuthz(g, 'POST /article/:id/font');
    assert.deepEqual(labels(r, 'middleware (outermost first)'), ['mw/csp', 'var/lib/coerce', 'mw/authn', 'mw/authz']);
    const details = rows(r, 'middleware (outermost first)').map((x) => x.detail);
    assert.match(details[0] ?? '', /#1 router-data inherited from bases\/d\/h.clj:10/);
    assert.equal(details[3], '#4 path');
  });

  it('alternatives read as OR', () => {
    const r = routeAuthz(g, '/billing/usage');
    assert.ok(r.sections.some((s) => /verdict requires \(:billing OR :admin\)$/.test(s.name)));
    assert.deepEqual(rows(r, 'permissions').map((x) => x.detail), ['check 1/1, any of 2 (alt 1)', 'check 1/1, any of 2 (alt 2)']);
  });

  it('all checks required, an alternative that is a set reads as AND inside OR', () => {
    const r = routeAuthz(g, '/copy');
    assert.ok(r.sections.some((s) => s.name.endsWith('verdict requires :create AND ((:read-a AND :read-t) OR :admin)')), r.sections.map((s) => s.name).join('|'));
    assert.ok(rows(r, 'permissions').some((x) => /all of 2/.test(x.detail ?? '')));
  });

  it('an exempt route shows the reason', () => {
    const r = routeAuthz(g, '/docs');
    assert.ok(r.sections.some((s) => /verdict exempt: public documentation/.test(s.name)));
    assert.deepEqual(labels(r, 'exempt'), ['public documentation']);
    assert.equal(rows(r, 'permissions').length, 0);
  });

  it('a route with neither permission nor exemption is flagged', () => {
    assert.ok(routeAuthz(g, '/open').sections.some((s) => /NO permission check and NO exemption recorded/.test(s.name)));
  });

  it('an UNKNOWN check is shown as undecided, never as no check', () => {
    const r = routeAuthz(g, '/dyn');
    const verdict = r.sections.find((s) => s.name.includes('verdict'))?.name ?? '';
    assert.match(verdict, /UNKNOWN check/);
    assert.doesNotMatch(verdict, /NO permission/);
    assert.match(r.notes.join(' '), /UNKNOWN/);
  });

  it('unknown route', () => {
    const r = routeAuthz(g, '/nothing');
    assert.equal(r.found, false);
    assert.match(r.notes.join(' '), /:param and \{param\}/);
  });

  it('permissionExpression of no edges is empty', () => assert.equal(permissionExpression(g, []), ''));
});

describe('permission routes', () => {
  const g = authzGraph();

  const cases: [string, string[]][] = [
    [':edit-article', ['POST /api/article/{p}/font @editor']],
    ['edit-article', ['POST /api/article/{p}/font @editor']],
    ['permission::edit-article', ['POST /api/article/{p}/font @editor']],
    [':admin', ['POST /api/billing/usage @editor', 'POST /api/copy @editor']],
    [':view-article', ['GET /article/{p}/font @public']],
  ];
  for (const [q, expected] of cases) {
    it(`routes for ${q}`, () => assert.deepEqual(labels(permissionRoutes(g, q)).sort(), expected));
  }

  it('says whether the permission is required alone or one of alternatives', () => {
    assert.deepEqual(permissionRoutes(g, ':admin').counts, { required: 0, 'one of alternatives': 2 });
    assert.deepEqual(permissionRoutes(g, ':edit-article').counts, { required: 1, 'one of alternatives': 0 });
  });

  it('a permission no route checks is found and empty; an unknown one is not found', () => {
    const x = graph((b) => { b.node('permission', ':lonely'); });
    assert.equal(permissionRoutes(x, ':lonely').found, true);
    assert.equal(rows(permissionRoutes(x, ':lonely')).length, 0);
    assert.equal(permissionRoutes(x, ':nope').found, false);
  });

  it('rows are cited', () => everyRowCited(permissionRoutes(g, ':admin')));
});

// ---------- attributes ----------

describe('attribute usage', () => {
  const b = new GraphBuilder();
  const attr = b.node('data_attribute', ':article/publish-number', { file: 'resources/migrations/001.edn' });
  const w = b.def('db.article/publish!', 'components/db');
  const r1 = b.def('db.article/load', 'components/db');
  const r2 = b.def('api.article/get', 'bases/api');
  const ref = b.def('test.article/fixture', 'components/db');
  b.edge(w, 'writes', attr).edge(r1, 'reads', attr).edge(r2, 'reads', attr).edge(ref, 'references', attr, { file: 'components/db/test/t.clj', attrs: { context: 'no-db-context' } });
  const ident = b.node('data_value', ':article.kind/dark');
  b.edge(r1, 'reads', ident);
  const g = b.build();
  const proven = (r: QueryResult, s: string) => rows(r, s).filter((x) => x.band !== 'unknown').map((x) => x.label);

  for (const q of [':article/publish-number', 'article/publish-number', 'data_attribute::article/publish-number']) {
    it(`proven readers and writers of ${q}`, () => {
      const r = attributeUsage(g, q);
      assert.deepEqual(proven(r, 'writers'), ['db.article/publish!']);
      assert.deepEqual(proven(r, 'readers').sort(), ['api.article/get', 'db.article/load']);
      assert.deepEqual(r.counts, { 'proven writers': 1, 'uncertain writers': 1, 'proven readers': 2, 'uncertain readers': 0 });
    });
  }

  it('an unproven reference is an UNKNOWN row, never dropped', () => {
    const r = attributeUsage(g, ':article/publish-number');
    const u = rows(r, 'writers').find((x) => x.label === 'test.article/fixture');
    assert.equal(u?.band, 'unknown');
    assert.match(u?.detail ?? '', /possible write: test code; context no-db-context/);
    assert.match(r.notes.join(' '), /1 reference\(s\) are not proven reads or writes/);
    assert.equal(r.verdict, '1 proven writer(s), 1 uncertain; 2 proven reader(s), 0 uncertain');
  });

  it('enum values resolve too', () => assert.deepEqual(labels(attributeUsage(g, ':article.kind/dark'), 'readers'), ['db.article/load']));
  it('the definition row cites the schema file', () => assert.equal(rows(attributeUsage(g, ':article/publish-number'), 'definition')[0].file, 'resources/migrations/001.edn'));
  it('unknown attribute', () => assert.equal(attributeUsage(g, ':no/such').found, false));
  it('rows are cited', () => everyRowCited(attributeUsage(g, ':article/publish-number')));
});

describe('attribute usage: unproven writers and readers', () => {
  // no proven writer; the unproven references must rank the real writer first
  const b = new GraphBuilder();
  const attr = b.node('data_attribute', ':t/n', { file: 'm/001.edn', line: 41 });
  const ref = (name: string, context: string, file = 'components/db/src/t.clj') =>
    b.edge(b.def(name, 'components/db'), 'references', attr, { file, attrs: { context } });
  ref('db.t/publish-article-tx', 'no-db-context');
  ref('db.t/pinned', 'no-db-context');
  ref('db.t/retract-all', ':db/retract');
  ref('db.t/import-effect', 'in-args-via-call@datomic.api/transact');
  ref('db.t/entity-map', ':db/id-map');
  ref('db.t/article-pattern', 'no-db-context');
  ref('db.t/by-number', 'in-args-via-call@datomic.api/q');
  ref('db.t-test/save-fixture', 'no-db-context', 'components/db/test/t_test.clj');
  b.edge(b.def('db.t/load'), 'reads', b.node('data_attribute', ':t/other'));
  const g = b.build();
  const r = attributeUsage(g, ':t/n');

  it('the verdict says 0 proven writers and how many are uncertain', () => {
    assert.equal(r.verdict, '0 proven writer(s), 6 uncertain; 0 proven reader(s), 2 uncertain');
  });

  it('uncertain writers rank by write-likeness: op, transaction, tx name, :db/id map; test code last', () => {
    assert.deepEqual(labels(r, 'writers'), ['db.t/retract-all', 'db.t/import-effect', 'db.t/publish-article-tx', 'db.t/entity-map', 'db.t/pinned', 'db.t-test/save-fixture']);
  });

  it('read-like references go under readers, ranked', () => {
    assert.deepEqual(labels(r, 'readers'), ['db.t/by-number', 'db.t/article-pattern']);
  });

  it('every uncertain row is UNKNOWN with its reason', () => {
    for (const x of [...rows(r, 'writers'), ...rows(r, 'readers')]) {
      assert.equal(x.band, 'unknown');
      assert.match(x.detail ?? '', /^possible (write|read): .*; context /);
    }
  });

  it('next calls point at the most likely writer', () => assert.ok(r.next.includes('blast_radius(var="db.t/retract-all")')));

  it('an attribute nobody references has empty sections and a zero verdict', () => {
    const x = attributeUsage(g, ':t/other');
    assert.equal(x.verdict, '0 proven writer(s), 0 uncertain; 1 proven reader(s), 0 uncertain');
    assert.equal(rows(x, 'writers').length, 0);
  });
});

describe('write and read likeness', () => {
  const w: [string, string, string | null, number][] = [
    [':db/add', 'a/f', null, 8],
    [':db/retract', 'a/f', null, 8],
    [':db/cas', 'a/f', null, 8],
    ['in-args-via-call@datomic.api/transact', 'a/f', null, 6],
    ['non-write-position@datomic.api/with', 'a/f', null, 6],
    [':db/id-map', 'a/f', null, 4],
    [':db/id-map(unanchored)', 'a/f', null, 4],
    ['no-db-context', 'a/publish-article-tx', null, 5],
    ['no-db-context', 'a/article-tx', null, 3],
    ['no-db-context', 'a/txes', null, 3],
    ['no-db-context', 'a/textual', null, 0],
    ['no-db-context', 'a/save!', null, 2],
    ['no-db-context', 'a/update-x', null, 2],
    ['no-db-context', 'a/load', null, 0],
    ['no-db-context', 'a/delete-article-test', 'components/a/test/x.clj', -3],
    [':db/add', 'a/transact-x', null, 11],
  ];
  for (const [ctx, caller, file, score] of w) {
    it(`write ${ctx} ${caller}${file ? ' (test file)' : ''} = ${score}`, () => assert.equal(writeLikeness(ctx, caller, file).score, score));
  }
  const rd: [string, string, number][] = [
    ['in-args-via-call@datomic.api/q', 'a/f', 6],
    ['x@datomic.api/pull', 'a/f', 6],
    ['no-db-context', 'a/article-pattern', 2],
    ['no-db-context', 'a/get-article', 2],
    ['no-db-context', 'a/f', 0],
  ];
  for (const [ctx, caller, score] of rd) it(`read ${ctx} ${caller} = ${score}`, () => assert.equal(readLikeness(ctx, caller, null).score, score));
  it('the why names the signals', () => {
    assert.equal(writeLikeness(':db/add', 'a/save', null).why, ':db/add op, name save');
    assert.equal(writeLikeness('no-db-context', 'a/save-x', 'c/test/t.clj').why, 'name save-x, test code');
  });
  it('test code reads rank below source reads', () => assert.ok(readLikeness('no-db-context', 'a/get', 'c/test/t.clj').score < readLikeness('no-db-context', 'a/get', null).score));
});

// ---------- events ----------

describe('event flow', () => {
  const b = new GraphBuilder();
  const save = b.node('event', ':article/save');
  const ok = b.node('event', ':article/save-ok');
  const orphan = b.node('event', ':article/orphan');
  const h = b.node('handler', 'handler of :article/save', { id: 'handler:src/events.cljs:10' });
  const view = b.def('ui.article/save-button', 'components/ui');
  const sub = b.node('subscription', ':article/current');
  const base = b.node('subscription', ':article/all');
  const sh = b.node('handler', 'handler of :article/current', { id: 'handler:src/subs.cljs:4' });
  const req = b.node('request', 'POST /article', { id: 'request:src/events.cljs:12' });
  b.edge(view, 'dispatches', save).edge(h, 'dispatches', ok, { band: 'heuristic' }).edge(save, 'registers', h)
    .edge(h, 'issues_request', req, { attrs: { method: 'post', path: '/article' } })
    .edge(sub, 'registers', sh).edge(sh, 'subscribes', base).edge(view, 'subscribes', sub);
  void orphan;
  const g = b.build();

  it('event: dispatchers, handler, next events and requests', () => {
    const r = eventFlow(g, ':article/save');
    assert.deepEqual(labels(r, 'dispatched by'), ['ui.article/save-button']);
    assert.deepEqual(labels(r, 'handler'), ['handler of :article/save']);
    assert.deepEqual(labels(r, 'handler dispatches'), [':article/save-ok']);
    assert.equal(rows(r, 'handler dispatches')[0].band, 'heuristic');
    assert.deepEqual(rows(r, 'handler requests').map((x) => x.detail), ['post /article']);
    everyRowCited(r);
  });

  it('subscription: handler, inputs, subscribers', () => {
    const r = eventFlow(g, 'article/current');
    assert.deepEqual(labels(r, 'subscribed by'), ['ui.article/save-button']);
    assert.deepEqual(labels(r, 'handler reads subscriptions'), [':article/all']);
  });

  it('an event without a handler says so', () => {
    assert.ok(eventFlow(g, ':article/orphan').sections.some((s) => /no registered handler/.test(s.name)));
  });

  it('a name that is both an event and a subscription answers both', () => {
    const x = graph((y) => { y.node('event', ':x/y'); y.node('subscription', ':x/y'); });
    assert.equal(eventFlow(x, ':x/y').matches.length, 2);
  });

  it('unknown event', () => assert.equal(eventFlow(g, ':nope/x').found, false));
});

// ---------- tests covering ----------

function coverageGraph() {
  const b = new GraphBuilder();
  const view = b.def('ui.article/list', 'components/ui', { file: 'components/ui/src/article.cljs' });
  const other = b.def('ui.article/helper', 'components/ui', { file: 'components/ui/src/article.cljs' });
  const sel = b.node('selector', 'qa-article-list');
  const pat = b.node('selector_pattern', 'qa-article-row-*');
  const m1 = b.node('page_object_member', 'ArticlePage.list');
  const m2 = b.node('page_object_member', 'ArticlePage.openFirst');
  const m3 = b.node('page_object_member', 'ArticlePage.row');
  const t1 = b.node('test', 'articles > lists articles', { id: 'test:tests/articles.spec.ts:10', file: 'tests/articles.spec.ts', line: 10 });
  const t2 = b.node('test', 'articles > opens one', { id: 'test:tests/articles.spec.ts:40', file: 'tests/articles.spec.ts', line: 40 });
  const t3 = b.node('test', 'api > font upload', { id: 'test:tests/api.spec.ts:5', file: 'tests/api.spec.ts', line: 5 });
  const t4 = b.node('test', 'rows > row', { id: 'test:tests/rows.spec.ts:1', file: 'tests/rows.spec.ts', line: 1 });
  const route = b.route('POST', '/article/{p}/font', 'editor', '/api');
  const h = b.def('routes.articles/upload', 'bases/api', { file: 'bases/api/src/articles.clj' });
  const req = b.node('request', 'glob **/font', { id: 'request:tests/api.spec.ts:7' });
  b.edge(view, 'renders', sel).edge(m1, 'uses_selector', sel).edge(t1, 'asserts_on', m1).edge(m2, 'calls', m1).edge(t2, 'calls', m2, { band: 'heuristic' })
    .edge(route, 'routes_to', h).edge(req, 'requests_route', route, { band: 'unknown' }).edge(t3, 'awaits_request', req)
    .edge(m3, 'uses_selector', pat).edge(t4, 'calls', m3).edge(t1, 'calls', m1, { band: 'heuristic' });
  void other;
  return b.build();
}

describe('tests covering', () => {
  const g = coverageGraph();

  const cases: [string, string[]][] = [
    ['qa-article-list', ['tests/articles.spec.ts:10', 'tests/articles.spec.ts:40']],
    ['selector:qa-article-list', ['tests/articles.spec.ts:10', 'tests/articles.spec.ts:40']],
    ['qa-article-row-*', ['tests/rows.spec.ts:1']],
    ['ui.article/list', ['tests/articles.spec.ts:10', 'tests/articles.spec.ts:40']],
    ['components/ui/src/article.cljs', ['tests/articles.spec.ts:10', 'tests/articles.spec.ts:40']],
    ['routes.articles/upload', ['tests/api.spec.ts:5']],
    ['bases/api/src/articles.clj', ['tests/api.spec.ts:5']],
    ['/article/:id/font', ['tests/api.spec.ts:5']],
    ['ArticlePage.list', ['tests/articles.spec.ts:10', 'tests/articles.spec.ts:40']],
    ['tests/rows.spec.ts', ['tests/rows.spec.ts:1']],
  ];
  for (const [q, expected] of cases) {
    it(`tests covering ${q}`, () => {
      const r = testsCovering(g, q);
      assert.ok(r.found);
      assert.deepEqual(rows(r).map((x) => `${x.file}:${x.line}`), expected);
      everyRowCited(r);
    });
  }

  it('keeps the strongest path per test', () => {
    const r = testsCovering(g, 'qa-article-list');
    assert.equal(rows(r).find((x) => x.line === 10)?.band, 'static_proven');
    assert.equal(rows(r).find((x) => x.line === 40)?.band, 'heuristic', 'only path is heuristic');
  });

  it('a path through an UNKNOWN request join stays UNKNOWN and is shown', () => {
    const r = testsCovering(g, '/article/:id/font');
    assert.equal(rows(r)[0].band, 'unknown');
    assert.match(r.notes.join(' '), /UNKNOWN/);
  });

  it('says how a test was reached', () => {
    assert.match(rows(testsCovering(g, 'qa-article-list')).find((x) => x.line === 40)?.detail ?? '', /via ArticlePage.openFirst/);
  });

  it('counts tests per spec file', () => assert.deepEqual(testsCovering(g, 'qa-article-list').counts, { 'tests/articles.spec.ts': 2 }));

  it('a target no test reaches is found and says so', () => {
    const x = graph((b) => { b.node('selector', 'qa-alone'); });
    const r = testsCovering(x, 'qa-alone');
    assert.ok(r.found);
    assert.match(r.notes.join(' '), /no browser test reaches/);
  });

  it('unknown target', () => assert.equal(testsCovering(g, 'qa-nope').found, false));
});

// ---------- every query cites every row, table driven ----------

describe('every row of every query carries file and band', () => {
  const g1 = authzGraph();
  const g2 = coverageGraph();
  const calls: [string, () => QueryResult][] = [
    ['route_authz copy', () => routeAuthz(g1, '/copy')],
    ['route_authz font', () => routeAuthz(g1, '/font')],
    ['permission_routes admin', () => permissionRoutes(g1, ':admin')],
    ['tests_covering selector', () => testsCovering(g2, 'qa-article-list')],
    ['tests_covering route', () => testsCovering(g2, '/article/:id/font')],
    ['callers ambiguous', () => callers(graph((b) => { b.def('a/x'); b.def('b/x'); }), 'x')],
  ];
  for (const [name, f] of calls) it(name, () => everyRowCited(f()));
});

// ---------- band rendering is never lost ----------

describe('bands survive every query', () => {
  for (const band of BANDS as readonly Band[]) {
    it(`${band} on a route permission`, () => {
      const b = new GraphBuilder();
      const r = b.route('GET', '/b', 'x', '');
      b.edge(r, 'requires_permission', b.node('permission', ':p'), { band });
      assert.deepEqual(rows(routeAuthz(b.build(), '/b'), 'permissions').map((x) => x.band), [band]);
    });
    it(`${band} on an attribute read`, () => {
      const b = new GraphBuilder();
      b.edge(b.def('a/r'), 'reads', b.node('data_attribute', ':a/b'), { band });
      assert.deepEqual(rows(attributeUsage(b.build(), ':a/b'), 'readers').map((x) => x.band), [band]);
    });
    it(`${band} on an event dispatch`, () => {
      const b = new GraphBuilder();
      b.edge(b.def('a/v'), 'dispatches', b.node('event', ':e/x'), { band });
      assert.deepEqual(rows(eventFlow(b.build(), ':e/x'), 'dispatched by').map((x) => x.band), [band]);
    });
    it(`${band} on a selector use`, () => {
      const b = new GraphBuilder();
      const m = b.node('page_object_member', 'P.m');
      b.edge(m, 'uses_selector', b.node('selector', 'qa-x'), { band });
      b.edge(b.node('test', 't', { file: 't.spec.ts', line: 3 }), 'calls', m);
      assert.deepEqual(rows(testsCovering(b.build(), 'qa-x')).map((x) => x.band), [band]);
    });
    it(`${band} in blast radius`, () => {
      const b = new GraphBuilder();
      const t = b.def('t/t');
      b.edge(b.def('c/c'), 'calls', t, { band });
      assert.deepEqual(rows(blastRadius(b.build(), 't/t', 1)).map((x) => x.band), [band]);
    });
  }
});

describe('a name that resolves to several nodes is ambiguous, never the first hit', () => {
  it('permission_routes lists both permissions', () => {
    const b = new GraphBuilder();
    const route = b.route('POST', '/a');
    for (const scope of ['editor', 'public']) b.edge(route, 'requires_permission', b.node('permission', ':edit', { id: `permission:${scope}/:edit` }));
    const r = permissionRoutes(b.build(), ':edit');
    assert.equal(r.found, false);
    assert.match(r.verdict, /ambiguous \(2 matches\)/);
    assert.deepEqual(r.matches.sort(), ['permission:editor/:edit', 'permission:public/:edit']);
  });
  it('attribute_usage lists the attribute and the enum value of one name', () => {
    const b = new GraphBuilder();
    b.node('data_attribute', ':article/kind', { id: 'data_attribute::article/kind' });
    b.node('data_value', ':article/kind', { id: 'data_value::article/kind' });
    const r = attributeUsage(b.build(), ':article/kind');
    assert.equal(r.found, false);
    assert.match(r.verdict, /ambiguous \(2 matches\)/);
    assert.deepEqual(r.matches.sort(), ['data_attribute::article/kind', 'data_value::article/kind']);
  });
  it('tests_for lists an event and a subscription of one name instead of taking the first', () => {
    const b = new GraphBuilder();
    b.node('event', ':cart/open', { id: 'event::cart/open' });
    b.node('subscription', ':cart/open', { id: 'subscription::cart/open' });
    const r = testsFor(b.build(), ':cart/open');
    assert.equal(r.found, false);
    assert.match(r.verdict, /ambiguous \(2 matches\)/);
    assert.deepEqual(r.matches.sort(), ['event::cart/open', 'subscription::cart/open']);
  });
});
