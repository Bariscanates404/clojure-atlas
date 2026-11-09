// Datomic attributes read from small inline sources.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { graphOf } from './helpers/inline-graph.ts';

const DB = `(ns app.n (:require [datomic.api :as d]))\n`;

const attrEdges = async (src: string, kinds = ['writes', 'reads', 'references']) => {
  const doc = await graphOf({ 'src/app/n.clj': DB + src });
  return doc.edges.filter((e) => kinds.includes(e.kind) && e.to.startsWith('data_')).map((e) => `${e.kind} ${e.to} ${e.band}`).sort();
};

describe('namespaced maps in transaction data', () => {
  it('resolves #::{} to the namespace of the file', async () => {
    assert.deepEqual(await attrEdges('(defn w [conn] (d/transact conn [#::{:name "a"}]))'), ['writes data_attribute::app.n/name static_proven']);
  });
});

describe('schema in edn', () => {
  it('reads a namespaced map #:db{:ident ...} as a schema definition', async () => {
    const doc = await graphOf({
      'resources/schema.edn': '[#:db{:ident :person/name :valueType :db.type/string :cardinality :db.cardinality/one}]',
      'src/app/n.clj': DB + '(defn r [db] (d/pull db [:person/name] 1))',
    });
    const node = doc.nodes.find((n) => n.id === 'data_attribute::person/name');
    assert.deepEqual(node?.attrs, { schema: true });
    assert.equal(node?.file, 'resources/schema.edn');
  });
});

const SCHEMA = `{:db/ident :person/name :db/valueType :db.type/string :db/cardinality :db.cardinality/one}`;
const withSchema = async (src: string) => {
  const doc = await graphOf({
    'src/app/schema.clj': `(ns app.schema)\n(def schema [${SCHEMA}])`,
    'src/app/n.clj': `(ns app.n (:require [datomic.api :as d] [datomic.client.api :as dc]))\n${src}`,
  });
  return doc.edges.filter((e) => e.to.startsWith('data_') && e.file === 'src/app/n.clj').map((e) => `${e.kind} ${e.to.replace(/^data_attribute:/, '')} ${e.band}`).sort();
};

describe('transaction data', () => {
  it('reads the attributes inside the :tx-data of the datomic client, not the argument map key', async () => {
    assert.deepEqual(await withSchema('(defn f [conn] (dc/transact conn {:tx-data [{:person/name "a" :person/age 3}]}))'), [
      'writes :person/age static_proven',
      'writes :person/name static_proven',
    ]);
  });

  it('keeps the pairs of a map with a reader conditional value', async () => {
    assert.deepEqual(await withSchema('(defn f [] (d/transact nil [{:person/city #?(:clj "x" :cljs "y") :person/zip 1}]))'), [
      'writes :person/city static_proven',
      'writes :person/zip static_proven',
    ]);
  });

  it('does not take the arguments of a :db.fn/call as attributes', async () => {
    assert.deepEqual(await withSchema('(defn f [conn] (d/transact conn [[:db.fn/call my-fn :person/fnarg] [:db/add 1 :person/name "x"]]))'), [
      'writes :person/name static_proven',
    ]);
  });

  it('counts a reverse reference as the forward attribute', async () => {
    assert.deepEqual(await withSchema('(defn f [db] (d/pull db [:person/name {:person/_friends [:person/age]}] 1))'), [
      'reads :person/age static_proven',
      'reads :person/friends static_proven',
      'reads :person/name static_proven',
    ]);
  });
});

describe('queries and pulls', () => {
  it('reads attribute expressions of a pull pattern', async () => {
    assert.deepEqual(await withSchema('(defn f [db] (d/pull db [(:person/nick :as "n") (limit :person/friends 10) (default :person/age 0)] 1))'), [
      'reads :person/age static_proven',
      'reads :person/friends static_proven',
      'reads :person/nick static_proven',
    ]);
  });

  it('reads the attribute of get-else, get-some and missing? clauses', async () => {
    assert.deepEqual(
      await withSchema("(defn f [db] (d/q '[:find ?v :where [?e :person/name _] [(get-else $ ?e :person/score 0) ?v] [(get-some $ ?e :person/a :person/b) ?w] [(missing? $ ?e :person/c)]] db))"),
      ['reads :person/a static_proven', 'reads :person/b static_proven', 'reads :person/c static_proven', 'reads :person/name static_proven', 'reads :person/score static_proven'],
    );
  });

  it('reads a data pattern whose entity is a constant and not an entity ident as an attribute', async () => {
    assert.deepEqual(await withSchema("(defn f [db] (d/q '[:find ?v :where [17 :person/name ?v] [:person.status/active :person/label ?v]] db))"), [
      'reads :person/label static_proven',
      'reads :person/name static_proven',
    ]);
  });

  it('reads the attribute argument of index-range and datoms', async () => {
    assert.deepEqual(await withSchema('(defn f [db] [(d/index-range db :person/year 1 2) (d/datoms db :aevt :person/age) (d/datoms db :eavt 1 :person/zip) (d/datoms db :eavt :person.status/active)])'), [
      'reads :person/age static_proven',
      'reads :person/year static_proven',
      'reads :person/zip static_proven',
    ]);
  });
});

describe('attribute definitions', () => {
  it('keeps an attribute with a value type an attribute although an alter map without one comes first', async () => {
    const doc = await graphOf({
      'src/app/a_alter.clj': `(ns app.a-alter (:require [datomic.api :as d]))\n(def alter [{:db/ident :person/name :db/doc "the name" :db/index true}])\n(defn r [db] (d/pull db [:person/name] 1))`,
      'src/app/b_schema.clj': `(ns app.b-schema)\n(def schema [${SCHEMA}])`,
    });
    assert.deepEqual(doc.nodes.filter((n) => /person\/name$/.test(n.id)).map((n) => `${n.id} ${n.file}`), ['data_attribute::person/name src/app/b_schema.clj']);
    assert.deepEqual(doc.edges.filter((e) => e.kind === 'reads').map((e) => e.to), ['data_attribute::person/name']);
  });
});
