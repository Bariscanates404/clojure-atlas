// Regressions from the review: sibling routes, the risk level of an attribute write, paging and JSON output.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Graph } from '../src/mcp/graph.ts';
import {
  attributeUsage, blastRadius, contextForChange, eventFlow, permissionRoutes, routeAuthz, routeSiblings, testsCovering, testsFor,
} from '../src/mcp/queries.ts';
import { render } from '../src/mcp/render.ts';
import type { QueryResult } from '../src/mcp/rows.ts';
import { GraphBuilder } from './helpers/code-graph-fixture.ts';

const CORE = 'components/core/src/core.clj';

describe('sibling routes are the same base and mount, never another copy of the same path', () => {
  it('a route served under two bases is not the odd one out because the other copy has a check', () => {
    const b = new GraphBuilder();
    const f = 'components/api/src/routes.clj';
    const app = b.route('GET', '/article', 'app', '/api');
    const admin = b.route('GET', '/article', 'admin', '/admin');
    const other = b.route('GET', '/logo', 'app', '/api');
    for (const id of [app, admin, other]) Object.assign(b.nodes.find((n) => n.id === id) ?? {}, { file: f, line: 5 });
    b.edge(admin, 'requires_permission', b.node('permission', ':edit-article'));
    const g = b.build();
    const node = g.byId.get(app);
    assert.ok(node);
    const sib = routeSiblings(g, node);
    assert.equal(sib?.odd, false);
  });
});

describe('the risk level comes from the row kind, not a word in its text', () => {
  it('a write to an attribute named like "runtime" is MEDIUM, not HIGH', () => {
    const b = new GraphBuilder();
    const f = b.def('core/f', 'components/core', { file: CORE, line: 10, end_line: 20 });
    const attr = b.node('data_attribute', ':app/runtime-vars', { file: 'components/core/resources/schema.edn', line: 1 });
    b.edge(f, 'writes', attr, { file: CORE, line: 12 });
    b.edge(b.def('r/reader', 'components/report', { file: 'components/report/src/r.clj', line: 3 }), 'reads', attr);
    const res = contextForChange(b.build(), [`${CORE}:12-12`]);
    assert.match(res.verdict, /risk MEDIUM$/);
  });
});

function keysResult(n: number): QueryResult {
  const rows = Array.from({ length: n }, (_, i) => ({ label: `ns/f${i}`, id: `d:${i}`, file: `components/c/src/f${i}.clj`, line: i + 1, band: 'static_proven' as const, detail: 'x'.repeat(100) }));
  return {
    name: 'context_for_change', query: 'q', title: 't', verdict: `${n} rows`, found: true, matches: [], notes: [], next: [],
    sections: [{ name: 'signatures and key siblings', short: 'keys', rows, ordered: true }, { name: 'tests to run', rows: [] }],
  };
}

describe('the paging hint names a section that section= accepts', () => {
  it('section="keys" (the short name in the hint) selects the section', () => {
    const first = render(keysResult(30));
    assert.match(first, /next page: offset=\d+ section="keys"/);
    const next = render(keysResult(30), { section: 'keys', offset: 5 });
    assert.doesNotMatch(next, /no section matches/);
    assert.match(next, /ns\/f5/);
  });
});

describe('response_format json honours limit, offset, section and max_tokens', () => {
  it('limit and offset page the rows and the totals say what was left out', () => {
    const out = JSON.parse(render(keysResult(300), { format: 'json', limit: 2, offset: 4, section: 'keys' })) as { sections: { rows: { label: string }[]; total?: number }[] };
    assert.equal(out.sections.length, 1);
    assert.deepEqual(out.sections[0].rows.map((r) => r.label), ['ns/f4', 'ns/f5']);
    assert.equal(out.sections[0].total, 300);
  });
  it('max_tokens bounds the output', () => {
    const out = render(keysResult(300), { format: 'json', maxTokens: 500 });
    assert.ok(out.length <= 500 * 4, `json is ${out.length} chars`);
    assert.match(out, /"truncated"/);
  });
});

// A graph built the way a reviewer met it: routes found, but the capability that would answer is absent or unused.
function authzOff(status: 'absent' | 'unused') {
  const b = new GraphBuilder();
  const f = 'components/api/src/routes.clj';
  for (const p of ['/x', '/y', '/z']) {
    const id = b.route('GET', p);
    Object.assign(b.nodes.find((n) => n.id === id) ?? {}, { file: f });
  }
  const note = status === 'absent' ? 'not declared: no authz key' : 'not used: nothing in this codebase switches it on';
  b.caps = b.caps.map((c) => (['route_authz', 'events', 'data_attributes', 'browser_tests'].includes(c.name) ? { ...c, status: status === 'absent' ? 'absent' : 'available', note } : c));
  return b.build();
}

describe('route siblings do not count an unknown check as a permission check', () => {
  it('with route authz absent, siblings are reported unknown, never as checking a permission', () => {
    const out = render(routeAuthz(authzOff('absent'), '/x'));
    assert.match(out, /capability route_authz is absent/);
    assert.match(out, /0 check a permission, 0 exempt, 0 neither, 2 unknown/);
    assert.doesNotMatch(out, /lacks the check/);
  });
});

describe('every not-found answer names the capability state that bounds it', () => {
  const cases: [string, (g: Graph) => QueryResult, string][] = [
    ['route_authz', (g) => routeAuthz(g, '/nope'), 'route_authz'],
    ['permission_routes', (g) => permissionRoutes(g, ':admin'), 'route_authz'],
    ['attribute_usage', (g) => attributeUsage(g, ':a/b'), 'data_attributes'],
    ['event_flow', (g) => eventFlow(g, ':e/f'), 'events'],
    ['tests_covering', (g) => testsCovering(g, 'nope'), 'browser_tests'],
  ];
  for (const [name, run, cap] of cases) {
    it(`${name} with the capability absent`, () => {
      const out = render(run(authzOff('absent')));
      assert.match(out, new RegExp(`capability ${cap} is absent`));
    });
  }
  it('a capability that is available but not used warns like an absent one', () => {
    assert.match(render(eventFlow(authzOff('unused'), ':e/f')), /capability events is available but not used.*not proof of absence/);
    assert.match(render(attributeUsage(authzOff('unused'), ':a/b')), /capability data_attributes is available but not used/);
  });
  it('tests_for and callers say which capability bounds them', () => {
    assert.match(render(testsFor(authzOff('absent'), 'nope')), /capability (definitions|selectors|browser_tests|data_attributes|events) /);
  });
});

describe('a bad argument does not end with the spelling hint', () => {
  it('blast_radius with depth -3 says the depth is wrong and does not blame the spelling', () => {
    const b = new GraphBuilder();
    b.def('core/f');
    const out = render(blastRadius(b.build(), 'core/f', -3));
    assert.match(out, /depth -3 is not valid/);
    assert.doesNotMatch(out, /check the spelling/);
  });
  it('a name that matches nothing still gets the spelling hint', () => {
    assert.match(render(blastRadius(new GraphBuilder().build(), 'core/zzz')), /check the spelling/);
  });
});
