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

// role, key and band without the owner: where the pattern stands decides the role, not which node holds it
const roles = async (src: string) => (await flow(src)).map((r) => r.replace(/ \S+ -> /, ' '));

describe('a map literal in a body and a binding pattern are told apart', () => {
  it('keeps the keys of maps in a vector a function returns, and reads no value keyword as a pattern', async () => {
    assert.deepEqual(await roles('(defn users [] [{:name "a" :role :admin}])'), [
      'produces_key key::name static_proven', 'produces_key key::role static_proven',
    ]);
  });

  it('keeps them in hiccup, in the body of a let and in the body of a fn', async () => {
    assert.deepEqual(
      await roles('(defn view [label] (let [m {:init 1}] [:button {:type :submit :on-click (fn [e] [{:event e}])} label m]))'),
      ['produces_key key::event static_proven', 'produces_key key::init static_proven', 'produces_key key::on-click static_proven',
        'produces_key key::type static_proven'],
    );
  });

  it('reads the pattern in every arity of a multi-arity fn and keeps the map its other arity returns', async () => {
    assert.deepEqual(
      await roles('(defn f ([a] [{:made a}]) ([a {:keys [depth] x :renamed :as opts}] [depth x opts]))'),
      ['consumes_key key::depth static_proven', 'consumes_key key::renamed static_proven', 'produces_key key::made static_proven'],
    );
  });

  it('reads a pattern nested in a vector pattern', async () => {
    assert.deepEqual(await roles('(defn f [[a {x :inner}]] [a x])'), ['consumes_key key::inner static_proven']);
  });

  it('finds the parameter vector behind a type hint or a reader conditional, so the vector after it is a body', async () => {
    const body = ['produces_key key::id static_proven', 'produces_key key::role static_proven'];
    assert.deepEqual(await roles('(defn f ^String [x] [{:id x :role :admin}])'), body);
    assert.deepEqual(await roles('(def g (fn ^long [x] [{:id x :role :admin}]))'), body);
    assert.deepEqual(await roles('(defn h #?(:clj [x] :cljs [x]) [{:id x :role :admin}])'), body);
    assert.deepEqual(await roles('(defn p ^long [^:foo {x :k} #?(:clj {y :j} :cljs {y :j})] [x y])'),
      ['consumes_key key::j static_proven', 'consumes_key key::k static_proven']);
  });

  it('reads the schema after :- as data, in the parameters and as the result of s/defn and mu/defn', async () => {
    assert.deepEqual(
      await roles('(mu/defn f :- [:map {:closed true}] [a :- [:map [:in {:default :none} :int]] {x :k} :- {:opt :val}] [{:body [a x]}])'),
      ['consumes_key key::k static_proven', 'produces_key key::body static_proven', 'produces_key key::closed static_proven',
        'produces_key key::default static_proven', 'produces_key key::opt static_proven'],
    );
  });

  it('reads a pattern without :keys in when-first, go-loop and a let macro called through an alias', async () => {
    assert.deepEqual(
      await roles('(defn g [xs s] [(when-first [{y :wf :as m} xs] [y m]) (a/go-loop [{x :gl :as m} s] [x m]) (p/let [{z :pl :as m} s] [z m])])'),
      ['consumes_key key::gl static_proven', 'consumes_key key::pl static_proven', 'consumes_key key::wf static_proven'],
    );
  });

  it('reads a :keys pattern wherever clj-kondo proves the binding: a record method, letfn, a for :let', async () => {
    assert.deepEqual(
      await roles(`(defprotocol P (m [this o]))
(defrecord R [] P (m [this {:keys [rk] renamed :rn :as o}] [rk renamed o]))
(defn g [xs] (letfn [(h [{:keys [lf] :as all}] [lf all])] (for [x xs :let [{:keys [fl] :or {fl 1}} x]] (h fl))))`),
      ['consumes_key key::fl static_proven', 'consumes_key key::lf static_proven', 'consumes_key key::rk static_proven',
        'consumes_key key::rn static_proven'],
    );
  });
});
