// A method and path defined twice in one router: the router decides which definition serves, so neither the
// permission nor the exemption of one definition is the served route's check, and the two are never merged.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { indexGraph, parseDocument, type Graph } from '../src/mcp/graph.ts';
import { canonicalRoute, contextForChange, routeAuthz, routeVerdict, type QueryResult } from '../src/mcp/queries.ts';
import { canonicalPath } from '../src/shared/route-path.ts';
import { graphOf } from './helpers/inline-graph.ts';

const EDN = '{:route-authz {:key :authz :permission :permission :exempt :exempt}}';
const WEB = `(ns app.web (:require [reitit.ring :as ring]))
(defn a [_] {:status 200})
(defn b [_] {:status 200})
(def router (ring/router [["/one" {:get {:handler a :authz {:permission :admin}}}]
                          ["/one" {:get {:handler b}}]
                          ["/two" {:get {:handler a :authz {:permission :x}}}]
                          ["/two" {:get {:handler b :authz {:permission :y}}}]
                          ["/three" {:get {:handler a :authz {:permission :admin}}}]
                          ["/three" {:get {:handler b :authz {:exempt "public"}}}]
                          ["/single" {:get {:handler a :authz {:permission :admin}}}]
                          ["/open" {:get {:handler b :authz {:exempt "probe"}}}]]
                         {:conflicts nil}))
`;

async function graph(): Promise<Graph> {
  const doc = await graphOf({ 'deps.edn': '{}', '.clojure-atlas.edn': EDN, 'src/app/web.clj': WEB });
  return indexGraph(parseDocument(JSON.parse(JSON.stringify(doc))));
}

const routeId = (g: Graph, path: string) => g.byKind.get('route')?.find((n) => n.attrs?.path === path)?.id ?? '';
const BAND: Record<string, string> = { static_proven: 'S', heuristic: 'H', unknown: 'U' };
const rows = (r: QueryResult, section: string) => r.sections.filter((s) => s.name.endsWith(section)).flatMap((s) => s.rows.map((x) => `${x.label} [${BAND[x.band]}]`));

describe('conflicting route definitions', () => {
  it('never proves a permission one definition declares and the other lacks', async () => {
    const g = await graph();
    const v = routeVerdict(g, routeId(g, '/one'));
    assert.equal(v.state, 'unknown');
    assert.match(v.text, /^not provable: 2 definitions share this method and path/);
    assert.match(v.text, /declared across them: permission\(s\) :admin \(HEURISTIC/);
    assert.deepEqual(rows(routeAuthz(g, 'GET /one'), 'permissions'), [':admin [H]']);
  });

  it('does not merge two definitions\' permissions into one AND', async () => {
    const g = await graph();
    const v = routeVerdict(g, routeId(g, '/two'));
    assert.equal(v.state, 'unknown');
    assert.doesNotMatch(v.text, /AND/);
    assert.match(v.text, /permission\(s\) :x, :y/);
    assert.deepEqual(rows(routeAuthz(g, 'GET /two'), 'permissions').sort(), [':x [H]', ':y [H]']);
  });

  it('reports a permission and an exemption from different definitions as unprovable, both heuristic', async () => {
    const g = await graph();
    const v = routeVerdict(g, routeId(g, '/three'));
    assert.equal(v.state, 'unknown');
    assert.match(v.text, /permission\(s\) :admin; exemption\(s\) public/);
    const r = routeAuthz(g, 'GET /three');
    assert.deepEqual(rows(r, 'permissions'), [':admin [H]']);
    assert.deepEqual(rows(r, 'exempt'), ['public [H]']);
  });

  it('keeps single definitions proven', async () => {
    const g = await graph();
    assert.deepEqual(routeVerdict(g, routeId(g, '/single')), { state: 'permission', text: 'requires :admin' });
    assert.deepEqual(routeVerdict(g, routeId(g, '/open')), { state: 'exempt', text: 'exempt: probe' });
    assert.deepEqual(rows(routeAuthz(g, 'GET /open'), 'exempt'), ['probe [S]']);
  });

  it('context_for_change calls a conflicting route unprovable, not a runtime check', async () => {
    const g = await graph();
    const r = contextForChange(g, ['src/app/web.clj:3']);
    const text = JSON.stringify(r);
    assert.match(text, /2 definitions share this method and path/);
    assert.doesNotMatch(text, /permission check decided at runtime/);
  });
});

describe('one path canonicalization for the build and the MCP lookup', () => {
  const paths = ['/x/{a}-{b}', '/foo-{id}', '/foo-:id', '/x/:id.json', '/files/*rest', '/a/:b/c/{d}', '/plain/path'];
  for (const p of paths) {
    it(`${p} canonicalizes the same on both sides`, () => assert.equal(canonicalRoute(p).path, canonicalPath(p)));
  }
});
