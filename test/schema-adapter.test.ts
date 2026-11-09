// Malli schemas read from small inline sources.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { edgeRows, graphOf, nodeRows } from './helpers/inline-graph.ts';

describe('malli schemas', () => {
  it('treats a def of a scalar or comparator schema as a schema and links the schemas built from it', async () => {
    const doc = await graphOf({
      'src/app/m.clj': `(ns app.m (:require [malli.core :as m]))
(def Id [:string {:min 1}])
(def Age [:int {:min 0}])
(def Pos [:> 0])
(def Tags [:vector :keyword])
(def Names [:name :id])
(def User [:map [:id Id] [:age Age]])
(defn check [x] (m/validate User x))
`,
    });
    assert.deepEqual(nodeRows(doc, 'schema'), ['schema:app.m/Age', 'schema:app.m/Id', 'schema:app.m/Pos', 'schema:app.m/Tags', 'schema:app.m/User']);
    assert.deepEqual(edgeRows(doc, 'uses_schema'), [
      'definition:app.m/check -> schema:app.m/User static_proven',
      'schema:app.m/User -> schema:app.m/Age static_proven',
      'schema:app.m/User -> schema:app.m/Id static_proven',
    ]);
  });
});
