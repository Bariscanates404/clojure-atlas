// A citation names the file and line where the thing is written: a check in a handler file is cited in that file,
// a guard or authz entry inherited from a route tree in another file keeps its own file.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AtlasDocument } from '../src/build/assemble.ts';
import { graphOf } from './helpers/inline-graph.ts';

const EDN = '{:route-authz {:key :authz :permission :permission :exempt :exempt} :permission-fns [app.auth/require!]}';
const at = (doc: AtlasDocument, kind: string, to: string) => doc.edges.filter((e) => e.kind === kind && e.to === to).map((e) => `${e.file}:${e.line}`);
const nodeAt = (doc: AtlasDocument, id: string) => doc.nodes.filter((n) => n.id === id).map((n) => `${n.file}:${n.line}`);

describe('citations point at the place the thing is written', () => {
  it('a permission checked inside a handler in another file is cited in the handler file', async () => {
    const doc = await graphOf({
      'deps.edn': '{}', '.clojure-atlas.edn': EDN,
      'src/app/auth.clj': '(ns app.auth)\n(defn require! [req perm] req)\n',
      'src/app/handlers.clj': '(ns app.handlers (:require [app.auth :as auth]))\n\n(defn delete-user [req]\n  (auth/require! req :delete-user)\n  req)\n',
      'src/app/compojure_routes.clj': '(ns app.compojure-routes (:require [compojure.core :refer [DELETE defroutes]] [app.handlers :as h]))\n\n(defroutes admin\n  (DELETE "/admin/users/:id" [] h/delete-user))\n',
    });
    assert.deepEqual(at(doc, 'requires_permission', 'permission::delete-user'), ['src/app/handlers.clj:4']);
    assert.deepEqual(nodeAt(doc, 'permission::delete-user'), ['src/app/handlers.clj:4']);
  });

  it('a guard and an authz entry a route inherits from a tree in another file keep the file they are written in', async () => {
    const doc = await graphOf({
      'deps.edn': '{}', '.clojure-atlas.edn': EDN,
      'src/app/mw.clj': '(ns app.mw)\n(defn guard [h] h)\n',
      'src/app/web.clj': '(ns app.web (:require [reitit.ring :as ring] [app.mw :as mw] [app.leaf :as leaf]))\n\n(def router\n  (ring/router\n    ["/api" {:middleware [mw/guard] :authz {:permission :base :exempt "probe"}}\n     leaf/routes]))\n',
      'src/app/leaf.clj': '(ns app.leaf)\n(defn h [_] {})\n\n\n\n(def routes\n  ["/leaf" ["" {:get h}]])\n',
    });
    assert.deepEqual(at(doc, 'guarded_by', 'definition:app.mw/guard'), ['src/app/web.clj:5']);
    assert.deepEqual(at(doc, 'requires_permission', 'permission::base'), ['src/app/web.clj:5']);
    assert.deepEqual(at(doc, 'exempted_by', 'authz_exemption:probe'), ['src/app/web.clj:5']);
  });
});
