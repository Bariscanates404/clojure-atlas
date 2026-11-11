// How route trees are reached: a var that only names the var holding a router, child routes passed to a route
// function as arguments, a multi-arity function standing for another, and a path named by a var.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { edgeRows, graphOf, nodeRows } from './helpers/inline-graph.ts';

const routes = async (files: Record<string, string>) => nodeRows(await graphOf({ 'deps.edn': '{}', ...files }), 'route');

describe('route trees', () => {
  it('a definition whose value is only the var holding the router is not a second router', async () => {
    const got = await routes({
      'src/shop/web.clj': `(ns shop.web (:require [reitit.ring :as ring]))
(defn h [_] {:status 200})
(defn wrap-a [x] x)
(defn list-routes [] [["/list" {:get h}]])
(def app-routes (wrap-a (ring/ring-handler (ring/router ["" (list-routes)]))))
(defn app [] #'app-routes)
` });
    assert.deepEqual(got, ['route:GET /list @shop.web/app-routes']);
  });

  it('child routes passed as arguments are served where the parameter is placed, spliced or wrapped alike', async () => {
    const doc = await graphOf({ 'deps.edn': '{}',
      'src/shop/web.clj': `(ns shop.web (:require [reitit.ring :as ring]))
(defn h [_] {:status 200})
(defn parent-routes [& child-routes]
  [["/list" {:get h}]
   ["/thing" {}
    (into ["/:thing-id" {} ["" {:get h}]] child-routes)]])
(defn child-a [] [["/send" {:post {:handler h}}]])
(defn child-c [] [["/c1" {:get h}] ["/c2" {:get h}]])
(def app (ring/ring-handler (ring/router ["/api" {} (apply parent-routes (concat [(child-a)] (child-c)))])))
` });
    assert.deepEqual(nodeRows(doc, 'route'), [
      'route:GET /api/list @shop.web/app', 'route:GET /api/thing/:thing-id @shop.web/app',
      'route:GET /api/thing/:thing-id/c1 @shop.web/app', 'route:GET /api/thing/:thing-id/c2 @shop.web/app',
      'route:POST /api/thing/:thing-id/send @shop.web/app',
    ]);
    assert.ok(edgeRows(doc, 'routes_to').includes('route:POST /api/thing/:thing-id/send @shop.web/app -> definition:shop.web/h static_proven'));
  });

  it('a positional parameter carries its argument; an argument no parameter carries is served at an unknown path', async () => {
    const got = await routes({
      'src/shop/web.clj': `(ns shop.web (:require [reitit.ring :as ring]))
(defn h [_] {:status 200})
(defn one [child] [["/one" {} child]])
(defn many ([] (many nil)) ([child] [["/many" {} child]]))
(defn kid-a [] ["/a" {:get h}])
(defn kid-b [] ["/b" {:get h}])
(defn kid-c [] ["/c" {:get h}])
(def app (ring/ring-handler (ring/router ["/api" (one (kid-a)) (many (kid-b)) (apply one [(kid-c)])])))
` });
    assert.deepEqual(got, ['route:GET /api/one/a @shop.web/app', 'route:GET /api{?}/b @shop.web/app', 'route:GET /api{?}/c @shop.web/app']);
  });

  it('a parameter the function binds again does not carry its argument', async () => {
    const got = await routes({
      'src/shop/web.clj': `(ns shop.web (:require [reitit.ring :as ring]))
(defn h [_] {:status 200})
(defn kid [] ["/kid" {:get h}])
(defn shadow [child] (let [child ["/local" {:get h}]] [["/s" {} child]]))
(defn inner [child] [["/i" {} (map (fn [child] child) [])]])
(def app (ring/ring-handler (ring/router ["/api" (shadow (kid)) (inner (kid))])))
` });
    assert.deepEqual(got, ['route:GET /api/local @shop.web/app', 'route:GET /api{?}/kid @shop.web/app']);
  });

  it('a multi-arity function whose every arity calls a route function stands for it, arguments and all', async () => {
    const got = await routes({
      'src/shop/auth/core.clj': `(ns shop.auth.core)
(defn config [_ _] {:status 200})
(defn make-handler [_ _] (fn [_] {:status 200}))
(defn auth-routes
  ([context] (auth-routes context {}))
  ([context {:keys [f g] :or {f (constantly false) g (constantly false)}}]
   [["/config.json" {:no-doc true :get (partial config context)}]
    ["/api/login" {:post (make-handler f g)}]]))
`,
      'src/shop/auth/interface.clj': `(ns shop.auth.interface (:require [shop.auth.core :as core]))
(defn auth-routes
  ([context] (core/auth-routes context))
  ([context opts] (core/auth-routes context opts)))
`,
      'src/shop/web.clj': `(ns shop.web (:require [reitit.ring :as ring] [shop.auth.interface :as auth]))
(defn enabled? [] true)
(def app (ring/ring-handler (ring/router ["" {} (auth/auth-routes :admin {:f (fn [] true) :g enabled?})])))
` });
    assert.deepEqual(got, ['route:GET /config.json @shop.web/app', 'route:POST /api/login @shop.web/app']);
  });

  it('a path named by a var is that var\'s string, also through a var in another namespace naming it', async () => {
    const got = await routes({
      'src/shop/impl.clj': '(ns shop.impl)\n(def info-path "/info")\n',
      'src/shop/iface.clj': '(ns shop.iface (:require [shop.impl :as impl]))\n(def info-path impl/info-path)\n',
      'src/shop/web.clj': `(ns shop.web (:require [reitit.ring :as ring] [shop.iface :as iface]))
(defn h [_] {:status 200})
(def app (ring/ring-handler (ring/router [[iface/info-path {:no-doc true :get h}]])))
` });
    assert.deepEqual(got, ['route:GET /info @shop.web/app']);
  });

  it('a route function returning one route with a private var path, mounted by when in the router vector', async () => {
    const got = await routes({
      'src/shop/preview.clj': `(ns shop.preview)
(defn enabled? [] true)
(defn page [_] {:status 200})
(def ^:private path "/_preview")
(defn preview-routes [] [path {:get page}])
`,
      'src/shop/web.clj': `(ns shop.web (:require [reitit.ring :as ring] [shop.preview :as preview]))
(defn h [_] {:status 200})
(def app (ring/ring-handler (ring/router [["/ok" {:get h}] (when (preview/enabled?) (preview/preview-routes))])))
` });
    assert.deepEqual(got, ['route:GET /_preview @shop.web/app', 'route:GET /ok @shop.web/app']);
  });
});
