// Middleware applied around the whole routing table (a ring-handler wrapped by a middleware, a compojure route var
// wrapped in the app definition, ring-handler's own options) is read, and a route whose wrapping could not be read
// fully never gets the proven "NO permission check" verdict.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { indexGraph, parseDocument, type Graph } from '../src/mcp/graph.ts';
import { callers, contextForChange, permissionRoutes, routeAuthz, routeVerdict, type QueryResult } from '../src/mcp/queries.ts';
import { render } from '../src/mcp/render.ts';
import { graphOf } from './helpers/inline-graph.ts';

const EDN = '{:route-authz {:key :authz :permission :permission} :permission-middleware [app.auth/wrap-permission]}';
const AUTH = '(ns app.auth)\n(defn wrap-permission [h perm] (fn [r] (if (contains? (:perms r) perm) (h r) {:status 403})))\n'
  + '(defn wrap-auth [h] (fn [r] (if (:user r) (h r) {:status 401})))\n';

async function graphFor(files: Record<string, string>, edn = EDN): Promise<Graph> {
  const doc = await graphOf({ 'deps.edn': '{}', '.clojure-atlas.edn': edn, 'src/app/auth.clj': AUTH, ...files });
  return indexGraph(parseDocument(JSON.parse(JSON.stringify(doc))));
}

const verdict = (g: Graph, route: string) => {
  const id = g.byKind.get('route')?.find((n) => n.name.includes(route))?.id ?? '';
  return routeVerdict(g, id);
};
const BAND: Record<string, string> = { static_proven: 'S', heuristic: 'H', unknown: 'U' };
const rows = (r: QueryResult, section: string) => r.sections.filter((s) => s.name.endsWith(section)).flatMap((s) => s.rows.map((x) => `${x.label} [${BAND[x.band]}]`));

const REITIT = (app: string, opts = '') => `(ns app.web (:require [reitit.ring :as ring] [app.auth :refer [wrap-permission wrap-auth]]))
(defn h [_] {:status 200})
(def router (ring/router [["/a" {:get h :authz {:permission :read}}]
                          ["/b" {:get h}]
                          ["/c" {:get h :middleware [[wrap-permission :admin]]}]]${opts}))
${app}
`;

describe('permission middleware around the routing table', () => {
  it('reitit: (wrap-permission (ring/ring-handler router) :admin) is the check of every route, as a guess', async () => {
    const g = await graphFor({ 'src/app/web.clj': REITIT('(def app (wrap-permission (ring/ring-handler router) :admin))') });
    assert.match(verdict(g, '/b').text, /^requires :admin \(HEURISTIC/);
    assert.equal(verdict(g, '/b').state, 'permission');
    assert.match(verdict(g, '/a').text, /:read AND :admin/);
    const r = routeAuthz(g, '/b');
    assert.deepEqual(rows(r, 'permissions'), [':admin [H]']);
    assert.deepEqual(rows(r, 'middleware (outermost first)'), ['app.auth/wrap-permission [H]']);
    const all = permissionRoutes(g, ':admin');
    assert.equal(rows(all, 'routes').length, 4, '/a, /b and /c twice: its own check and the wrapper');
  });

  it('reitit: the threading form and the nesting form read alike', async () => {
    const thread = await graphFor({ 'src/app/web.clj': REITIT('(def app (-> (ring/ring-handler router) (wrap-permission :admin)))') });
    assert.match(verdict(thread, '/b').text, /^requires :admin/);
    const nest = await graphFor({ 'src/app/web.clj': REITIT('(def app (wrap-auth (wrap-permission (ring/ring-handler router (ring/create-default-handler)) :admin)))') });
    assert.match(verdict(nest, '/b').text, /^requires :admin/);
    assert.deepEqual(rows(routeAuthz(nest, '/b'), 'middleware (outermost first)'), ['app.auth/wrap-auth [H]', 'app.auth/wrap-permission [H]']);
  });

  it('reitit: ring-handler options {:middleware [...]} apply to every route', async () => {
    const g = await graphFor({ 'src/app/web.clj': REITIT('(def app (ring/ring-handler router nil {:middleware [[wrap-permission :admin] wrap-auth]}))') });
    assert.match(verdict(g, '/b').text, /^requires :admin/);
    assert.deepEqual(rows(routeAuthz(g, '/b'), 'middleware (outermost first)'), ['app.auth/wrap-permission [H]', 'app.auth/wrap-auth [H]']);
  });

  it('reitit: a plain middleware around the handler is listed as the route middleware, not none', async () => {
    const g = await graphFor({ 'src/app/web.clj': REITIT('(def app (wrap-auth (ring/ring-handler router)))') });
    assert.deepEqual(rows(routeAuthz(g, '/b'), 'middleware (outermost first)'), ['app.auth/wrap-auth [H]']);
    assert.equal(verdict(g, '/b').state, 'unknown');
  });

  it('reitit: a router handed to something the build cannot follow has middleware UNKNOWN, not none', async () => {
    const g = await graphFor({ 'src/app/web.clj': REITIT('(def app (build-app (ring/ring-handler router)))') });
    const v = verdict(g, '/b');
    assert.equal(v.state, 'unknown');
    assert.match(routeAuthz(g, '/b').sections.map((s) => s.unextracted ?? '').join(' '), /UNKNOWN/);
  });

  it('compojure: (wrap-permission rts :admin) and wrap-routes arguments are read', async () => {
    const cj = (app: string) => `(ns app.cj (:require [compojure.core :refer [defroutes GET wrap-routes]] [app.auth :refer [wrap-permission]]))
(defn h [_] {:status 200})
(defroutes rts (GET "/cj" req (h req)))
${app}
`;
    const outer = await graphFor({ 'src/app/cj.clj': cj('(def app (wrap-permission rts :admin))') });
    assert.match(verdict(outer, '/cj').text, /^requires :admin/);
    const thread = await graphFor({ 'src/app/cj.clj': cj('(def app (-> rts (wrap-permission :admin)))') });
    assert.match(verdict(thread, '/cj').text, /^requires :admin/);
    const wr = await graphFor({ 'src/app/cj.clj': cj('(def app (wrap-routes rts wrap-permission :admin))') });
    assert.match(verdict(wr, '/cj').text, /^requires :admin/);
  });

  it('reitit: permission middleware in the router :data is the check of every route', async () => {
    const g = await graphFor({ 'src/app/web.clj': `(ns app.web (:require [reitit.ring :as ring] [app.auth :refer [wrap-permission]]))
(defn h [_] {:status 200})
(def app (ring/ring-handler (ring/router [["/a" {:get h}] ["/b" {:get h}]] {:data {:middleware [[wrap-permission :admin]]}})))
` });
    assert.match(verdict(g, '/a').text, /^requires :admin$/);
    assert.match(verdict(g, '/b').text, /^requires :admin$/);
  });

  it('a permission middleware without an argument is a wrapper but no permission', async () => {
    const g = await graphFor({ 'src/app/web.clj': REITIT('(def app (-> (ring/ring-handler router) wrap-permission))') });
    assert.doesNotMatch(verdict(g, '/b').text, /^requires/);
  });

  it('context_for_change does not call a route with a permission wrapper HIGH', async () => {
    const g = await graphFor({ 'src/app/web.clj': REITIT('(def app (wrap-permission (ring/ring-handler router) :admin))') });
    const r = contextForChange(g, ['src/app/web.clj:4']);
    assert.doesNotMatch(r.verdict, /risk HIGH/);
  });
});

describe('a verdict never proves absence from what could not be read', () => {
  it('a route whose guard is only a guess is UNKNOWN, with the words of what was read', async () => {
    const g = await graphFor({ 'src/app/web.clj': REITIT('(def app (wrap-auth (ring/ring-handler router)))') });
    const v = verdict(g, '/b');
    assert.equal(v.state, 'unknown');
    assert.match(v.text, /no permission check found in what could be read/);
    assert.doesNotMatch(v.text, /NO permission check and NO exemption/);
  });

  it('a route with nothing around it and a proven chain stays NONE', async () => {
    const g = await graphFor({ 'src/app/web.clj': REITIT('(def app (ring/ring-handler router))') });
    assert.equal(verdict(g, '/b').state, 'none');
    assert.match(verdict(g, '/b').text, /NO permission check/);
  });

  it('permission_routes says routes with unread wrapping may also require the permission', async () => {
    const g = await graphFor({ 'src/app/web.clj': REITIT('(def app (build-app (ring/ring-handler router)))') });
    const r = permissionRoutes(g, ':admin');
    assert.match(r.notes.join('\n'), /could not be read fully.*not proof/s);
  });

  it('context_for_change calls an unreadable route UNKNOWN, not HIGH', async () => {
    const g = await graphFor({ 'src/app/web.clj': REITIT('(def app (build-app (ring/ring-handler router)))') });
    const r = contextForChange(g, ['src/app/web.clj:4']);
    assert.match(r.verdict, /risk UNKNOWN/);
    assert.doesNotMatch(render(r, { format: 'detailed' }), /no permission check and no exemption/);
  });
});

describe('a handler defined by a macro clj-kondo cannot expand', () => {
  const files = {
    'src/app/macros.clj': '(ns app.macros)\n(defmacro defhandler [n args & body] `(defn ~n ~args ~@body))\n',
    'src/app/core.clj': `(ns app.core (:require [app.macros :refer [defhandler]] [compojure.core :refer [defroutes GET]]))
(defhandler secret-handler [req] {:status 200})
(defroutes rts (GET "/secret" req (secret-handler req)))
`,
    'src/app/other.clj': '(ns app.other (:require [app.core :as c]))\n(defn go [] (c/secret-handler {}))\n',
  };

  it('callers names the sites and the macro, not a spelling problem', async () => {
    const g = await graphFor(files);
    const r = callers(g, 'app.core/secret-handler');
    const text = render(r, { format: 'detailed' });
    assert.match(text, /used at src\/app\/other\.clj:2/);
    assert.match(text, /probably defined by a macro clj-kondo cannot expand; add :lint-as for the macro in \.clj-kondo\/config\.edn/);
    assert.doesNotMatch(text, /check the spelling/);
  });

  it('route_authz says the handler is not resolved (UNKNOWN), and the verdict is UNKNOWN', async () => {
    const g = await graphFor(files);
    const r = routeAuthz(g, '/secret');
    const text = render(r, { format: 'detailed' });
    assert.match(text, /handler: not resolved \(UNKNOWN\)/);
    assert.equal(verdict(g, '/secret').state, 'unknown');
  });

  it('with :lint-as the answer is proven again', async () => {
    const g = await graphFor({ ...files, '.clj-kondo/config.edn': '{:lint-as {app.macros/defhandler clojure.core/defn}}' });
    const r = callers(g, 'app.core/secret-handler');
    assert.ok(r.found);
    assert.deepEqual(rows(r, 'callers'), ['app.core/rts [S]', 'app.other/go [S]']);
    assert.equal(verdict(g, '/secret').state, 'none');
    assert.match(render(routeAuthz(g, '/secret'), { format: 'detailed' }), /app\.core\/secret-handler/);
  });

  it('a name nothing uses is still a plain spelling answer', async () => {
    const g = await graphFor(files);
    assert.match(render(callers(g, 'app.core/nothing-here'), { format: 'detailed' }), /check the spelling/);
  });
});
