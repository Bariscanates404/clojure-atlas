// An empty section is "none" only when the extractor could see that kind of fact: a route whose middleware the adapter
// could not read, and a graph without the capability, say "not extracted", never "none".
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Capability } from '../src/mcp/graph.ts';
import { routeVerdict } from '../src/mcp/queries.ts';
import { callTool } from '../src/mcp/server.ts';
import { GraphBuilder } from './helpers/code-graph-fixture.ts';

const withoutCaps = (b: GraphBuilder, ...names: string[]) => {
  b.caps = b.caps.map((c): Capability => (names.includes(c.name) ? { ...c, status: 'absent' } : c));
};
const markUnknown = (b: GraphBuilder, id: string) => {
  const n = b.nodes.find((x) => x.id === id);
  if (n) n.attrs = { ...n.attrs, middleware: 'unknown' };
};
const authz = (b: GraphBuilder, route: string, extra: Record<string, unknown> = {}) => callTool(b.build(), 'route_authz', { route, ...extra });

describe('route middleware the adapter could not read', () => {
  it('prints "middleware: not extracted (UNKNOWN)", not "none"', () => {
    const b = new GraphBuilder();
    markUnknown(b, b.route('GET', '/things'));
    const t = authz(b, '/things').text;
    assert.match(t, /middleware: not extracted \(UNKNOWN\)/);
    assert.doesNotMatch(t, /middleware[^\n]*: none/);
  });

  it('a route with a chain that was read still says none for an empty chain', () => {
    const b = new GraphBuilder();
    b.route('GET', '/things');
    assert.match(authz(b, '/things').text, /middleware \(outermost first\): none \(searched: guarded_by edges\)/);
  });

  it('its guards are unknown in the verdict, never none', () => {
    const b = new GraphBuilder();
    const id = b.route('GET', '/things');
    markUnknown(b, id);
    const v = routeVerdict(b.build(), id);
    assert.equal(v.state, 'unknown');
    assert.match(v.text, /middleware could not be read/);
    assert.doesNotMatch(authz(b, '/things').text, /NO permission check and NO exemption/);
  });

  it('a recorded permission stays a permission, with the caveat that the chain is unread', () => {
    const b = new GraphBuilder();
    const id = b.route('GET', '/things');
    markUnknown(b, id);
    b.edge(id, 'requires_permission', b.node('permission', ':thing/read'), { attrs: { check: 1, checks: 1, alternative: 1, alternatives: 1, all_of: 1 } });
    const v = routeVerdict(b.build(), id);
    assert.equal(v.state, 'permission');
    assert.match(v.text, /middleware not extracted: further checks UNKNOWN/);
  });

  it('an exemption stays an exemption', () => {
    const b = new GraphBuilder();
    const id = b.route('GET', '/things');
    markUnknown(b, id);
    b.edge(id, 'exempted_by', b.node('exemption', 'public'));
    assert.equal(routeVerdict(b.build(), id).state, 'exempt');
  });

  it('a middleware chain that is listed but flagged unknown is called partial', () => {
    const b = new GraphBuilder();
    const id = b.route('GET', '/things');
    markUnknown(b, id);
    b.edge(id, 'guarded_by', b.def('app/wrap-a'), { attrs: { order: 1 } });
    const r = authz(b, '/things');
    assert.match(r.text, /note: .*middleware not extracted \(UNKNOWN\); the chain listed is partial/);
  });

  it('a sibling with unread middleware counts as unknown, and context_for_change does not call it undecided at runtime', () => {
    const b = new GraphBuilder();
    const h = b.def('app/handler');
    for (const p of ['/a', '/b', '/c']) {
      const r = b.route('GET', p);
      b.nodes.find((n) => n.id === r)!.file = 'src/routes.clj';
      if (p !== '/c') b.edge(r, 'requires_permission', b.node('permission', `:p${p}`), { attrs: { check: 1, checks: 1, alternative: 1, alternatives: 1, all_of: 1 } });
      else markUnknown(b, r);
      b.edge(r, 'routes_to', h);
    }
    const t = authz(b, '/a').text;
    assert.match(t, /1 unknown \(not provable from this graph\)/);
    const ctx = callTool(b.build(), 'context_for_change', { changes: ['src/routes.clj'], response_format: 'detailed' }).text;
    assert.match(ctx, /middleware could not be read/);
    assert.doesNotMatch(ctx, /decided at runtime; not provable; evidence in the route data[^\n]*\/c/);
  });
});

describe('an empty section whose capability is missing', () => {
  it('route_authz: permissions and exempt are not extracted when the capability is absent', () => {
    const b = new GraphBuilder();
    withoutCaps(b, 'route_authz');
    b.route('GET', '/things');
    const t = authz(b, '/things').text;
    assert.match(t, /permissions: not extracted \(route_authz is absent\)/);
    assert.match(t, /exempt: not extracted \(route_authz is absent\)/);
    assert.doesNotMatch(t, /permissions: none/);
  });

  it('attribute_usage: readers and writers are not extracted without data_attributes', () => {
    const b = new GraphBuilder();
    withoutCaps(b, 'data_attributes');
    b.node('data_attribute', ':order/bid');
    const t = callTool(b.build(), 'attribute_usage', { attr: ':order/bid' }).text;
    assert.match(t, /writers: not extracted \(data_attributes is absent\)/);
    assert.match(t, /readers: not extracted \(data_attributes is absent\)/);
  });

  it('a capability that is listed and available keeps the plain none', () => {
    const b = new GraphBuilder();
    b.node('data_attribute', ':order/bid');
    const t = callTool(b.build(), 'attribute_usage', { attr: ':order/bid' }).text;
    assert.match(t, /writers: none \(searched: /);
  });

  it('a capability the graph does not list at all is not extracted either', () => {
    const b = new GraphBuilder();
    b.caps = b.caps.filter((c) => c.name !== 'events');
    b.node('event', ':go');
    const t = callTool(b.build(), 'event_flow', { name: ':go' }).text;
    assert.match(t, /not extracted \(events is not in this graph\)/);
  });
});
