// Function signatures as the builder records them on definition nodes.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { graphOf } from './helpers/inline-graph.ts';

interface P { keys?: string[]; defaults?: string[]; reads?: string[]; reads_complete?: boolean }

const params = async (src: string): Promise<P[]> => {
  const doc = await graphOf({ 'src/app/other.clj': '(ns app.other)', 'src/app/s.clj': `(ns app.s (:require [app.other :as o]))\n${src}` });
  const sig = doc.nodes.find((n) => n.id === 'definition:app.s/f')?.attrs?.signature as { arities: { params: P[] }[] };
  return sig.arities[0].params;
};
const pick = ({ keys, defaults, reads, reads_complete }: P): P => ({ ...(keys ? { keys } : {}), ...(defaults ? { defaults } : {}), ...(reads ? { reads } : {}), reads_complete });

describe('destructuring', () => {
  it('resolves the alias of ::alias/keys', async () => {
    assert.deepEqual((await params('(defn f [{::o/keys [a b]}] a)')).map(pick), [{ keys: [':app.other/a', ':app.other/b'], reads_complete: true }]);
  });

  it('gives :or defaults the namespace of their keys', async () => {
    assert.deepEqual((await params('(defn f [{:person/keys [name] :or {name ""}}] name)')).map(pick), [{ keys: [':person/name'], defaults: [':person/name'], reads_complete: true }]);
  });

  it('is not complete when :strs or :syms take keys it cannot name', async () => {
    assert.deepEqual((await params('(defn f [{:strs [a]}] a)')).map(pick), [{ keys: [], reads_complete: false }]);
  });

  it('takes the key of a nested destructuring pattern', async () => {
    assert.deepEqual((await params('(defn f [{{:keys [c]} :child}] c)')).map(pick), [{ keys: [':child'], reads_complete: true }]);
  });
});

describe('reads of a parameter alias', () => {
  it('ignores a let that binds the name again', async () => {
    assert.deepEqual((await params('(defn f [{:keys [a] :as m}] (let [m (inc 1)] (:y m)))')).map(pick), [{ keys: [':a'], reads_complete: true }]);
  });

  it('ignores a fn whose parameter hides the name', async () => {
    assert.deepEqual((await params('(defn f [{:keys [a] :as m}] (fn [m] (:z m)))')).map(pick), [{ keys: [':a'], reads_complete: true }]);
  });

  it('hides the name only from the arity of a multi-arity fn that binds it', async () => {
    assert.deepEqual((await params('(defn f [{:keys [a] :as m}] (fn ([m] (:z m)) ([n] (:w m))))')).map(pick), [{ keys: [':a'], reads: [':w'], reads_complete: true }]);
  });

  it('still reads the name where nothing hides it', async () => {
    assert.deepEqual((await params('(defn f [{:keys [a] :as m}] (let [x (:y m)] (fn [n] (:z m))))')).map(pick), [{ keys: [':a'], reads: [':y', ':z'], reads_complete: true }]);
  });
});
