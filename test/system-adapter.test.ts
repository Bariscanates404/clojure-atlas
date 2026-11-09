// Integrant, mount and component system keys read from small inline sources.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { edgeRows, graphOf } from './helpers/inline-graph.ts';

describe('component dependencies', () => {
  it('reads the dependency map of a threaded system-using and the vector of a threaded using', async () => {
    const doc = await graphOf({
      'src/app/comp.clj': `(ns app.comp (:require [com.stuartsierra.component :as component]))
(defn new-db [] {})
(defn new-web [] {})
(defn sys1 []
  (-> (component/system-map :db (new-db) :web (new-web))
      (component/system-using {:web [:db]})))
(defn sys2 []
  (component/system-map
    :db2 (new-db)
    :web2 (component/using (new-web) [:db2])
    :web3 (-> (new-web) (component/using [:db2]))))
`,
    });
    assert.deepEqual(edgeRows(doc, 'depends_on'), [
      'system_key::web -> system_key::db static_proven',
      'system_key::web2 -> system_key::db2 static_proven',
      'system_key::web3 -> system_key::db2 static_proven',
    ]);
  });
});

describe('integrant composite keys', () => {
  it('depends_on a key written as a vector and registers its init-key method', async () => {
    const doc = await graphOf({
      'src/app/ig.clj': `(ns app.ig (:require [integrant.core :as ig]))
(defmethod ig/init-key :app/db [_ opts] opts)
(defmethod ig/init-key [:app/x :app/y] [_ opts] opts)
(def config
  {:app/db {:url "x"}
   :app/web {:db (ig/ref :app/db) :xy (ig/ref [:app/x :app/y])}
   [:app/x :app/y] {:q 1}
   :app/job {:w #ig/ref [:app/x :app/y]}})
`,
    });
    assert.deepEqual(edgeRows(doc, 'depends_on'), [
      'system_key::app/job -> system_key:[:app/x :app/y] static_proven',
      'system_key::app/web -> system_key::app/db static_proven',
      'system_key::app/web -> system_key:[:app/x :app/y] static_proven',
    ]);
    assert.ok(edgeRows(doc, 'registers').includes('system_key:[:app/x :app/y] -> dispatch_arm:integrant.core/init-key@[:app/x :app/y] static_proven'));
  });
});
