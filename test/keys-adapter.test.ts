// Map key flow and key tables read from small inline sources.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { edgeRows, graphOf } from './helpers/inline-graph.ts';

const flow = async (src: string) => {
  const doc = await graphOf({ 'src/app/k.cljc': `(ns app.k)\n${src}\n` });
  return ['produces_key', 'consumes_key', 'removes_key'].flatMap((kind) => edgeRows(doc, kind).map((r) => `${kind} ${r}`)).sort();
};

describe('key tables', () => {
  it('keep every key when a reader conditional stands in a map', async () => {
    const doc = await graphOf({
      'src/app/t.cljc': `(ns app.t)
(def tbl [{:a 1 #?@(:clj [:b 2 :c 3])} {:a 2} {:a 3}])
(def tbl2 [{:id 1 :v #?(:clj 1 :cljs 2) :z 3} {:id 2} {:id 3}])
`,
    });
    const rows = (v: string) => (doc.nodes.find((n) => n.kind === 'key_table' && n.attrs?.var === `app.t/${v}`)?.attrs?.rows as { keys: string[]; dynamic_keys?: number }[])[0];
    assert.deepEqual(rows('tbl'), { line: 2, keys: [':a', ':b', ':c'] });
    assert.deepEqual(rows('tbl2'), { line: 3, keys: [':id', ':v', ':z'] });
  });
});

describe('key flow through threading forms', () => {
  it('reads the keys of as-> steps, where the threaded value is written out', async () => {
    assert.deepEqual(await flow('(defn f [m] (as-> m $ (assoc $ :as-prod 1) (get $ :as-cons)))'), [
      'consumes_key definition:app.k/f -> key::as-cons static_proven',
      'produces_key definition:app.k/f -> key::as-prod static_proven',
    ]);
  });

  it('reads a get in the test position of cond-> as a plain call and a keyword step as threaded', async () => {
    assert.deepEqual(await flow('(defn f [m opts] (cond-> m (get opts :flag) (assoc :c-prod 1) true :c-cons))'), [
      'consumes_key definition:app.k/f -> key::c-cons heuristic',
      'consumes_key definition:app.k/f -> key::flag static_proven',
      'produces_key definition:app.k/f -> key::c-prod heuristic',
    ]);
  });

  it('does not treat the first form of -> as a step', async () => {
    assert.deepEqual(await flow('(defn f [m] (-> (assoc m :first 1) (dissoc :gone)))'), [
      'produces_key definition:app.k/f -> key::first static_proven',
      'removes_key definition:app.k/f -> key::gone heuristic',
    ]);
  });
});

describe('keys that share a name with destructuring syntax', () => {
  it('keeps :keys, :or and :as used as data and drops them where they are binding syntax', async () => {
    assert.deepEqual(
      await flow('(defn a [m] {:keys 1 :or 2 :as 3})\n(defn b [{:keys [x] :or {x 1} :as all {:keys [c]} :child}] [x all c])\n(defn c [m] (get m :keys))'),
      [
        'consumes_key definition:app.k/b -> key::c static_proven',
        'consumes_key definition:app.k/b -> key::child static_proven',
        'consumes_key definition:app.k/b -> key::x static_proven',
        'consumes_key definition:app.k/c -> key::keys static_proven',
        'produces_key definition:app.k/a -> key::as static_proven',
        'produces_key definition:app.k/a -> key::keys static_proven',
        'produces_key definition:app.k/a -> key::or static_proven',
      ],
    );
  });
});
