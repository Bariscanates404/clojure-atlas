// Multimethod arms read from small inline sources.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { edgeRows, graphOf, nodeRows } from './helpers/inline-graph.ts';

describe('arms of the same multimethod and dispatch value', () => {
  it('stay separate arms, each with its own defines and dispatch edge', async () => {
    const doc = await graphOf({
      'src/app/mm.clj': '(ns app.mm)\n(defmulti speak :t)\n(defmethod speak ::animal [s] 1)\n(defmethod speak ::animal [s] 2)',
      'src/app/mm2.clj': '(ns app.mm2 (:require [app.mm :as mm]))\n(defmethod mm/speak :x [s] 1)',
      'src/app/mm3.clj': '(ns app.mm3 (:require [app.mm :as mm]))\n(defmethod mm/speak :x [s] 2)',
    });
    assert.deepEqual(nodeRows(doc, 'dispatch_arm'), [
      'dispatch_arm:app.mm/speak@:app.mm/animal',
      'dispatch_arm:app.mm/speak@:app.mm/animal#src/app/mm.clj:4',
      'dispatch_arm:app.mm/speak@:x',
      'dispatch_arm:app.mm/speak@:x#src/app/mm3.clj:2',
    ]);
    assert.equal(edgeRows(doc, 'may_dispatch_to').length, 4);
    assert.equal(edgeRows(doc, 'defines').filter((r) => r.includes('dispatch_arm')).length, 4);
  });
});
