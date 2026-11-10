// A call inside a macro clj-kondo cannot expand is analysed as if the macro evaluated its arguments, which it may
// not: such usages are heuristic, while core macros and macros the project teaches kondo stay proven.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { graphOf } from './helpers/inline-graph.ts';

const SRC = `(ns app.c)
(defn helper [x] x)
(defmacro ignore-body [& _] nil)
(defmacro taught [& body] (cons 'do body))
(defn plain [] (helper 1))
(defn core-macros [] (when true (let [a 1] (-> a (helper)))))
(defn via-macro [] (ignore-body (helper 4)))
(defn nested [] (ignore-body (let [a 1] (when a (helper 5)))))
(defn taught-use [] (taught (helper 6)))
(defn unknown-head [] (mystery-macro (helper 7)))
`;

const bandsFrom = (doc: Awaited<ReturnType<typeof graphOf>>, from: string) =>
  doc.edges
    .filter((e) => e.from === `definition:app.c/${from}` && e.to === 'definition:app.c/helper')
    .map((e) => `${e.band}${e.attrs?.via ? ` via ${e.attrs.via}` : ''}`);

describe('usages inside a macro kondo cannot expand', () => {
  it('are heuristic, with the macro named', async () => {
    const doc = await graphOf({ 'deps.edn': '{}', 'src/app/c.clj': SRC });
    assert.deepEqual(bandsFrom(doc, 'plain'), ['static_proven']);
    assert.deepEqual(bandsFrom(doc, 'core-macros'), ['static_proven']);
    assert.deepEqual(bandsFrom(doc, 'via-macro'), ['heuristic via unexpanded-macro']);
    assert.deepEqual(bandsFrom(doc, 'nested'), ['heuristic via unexpanded-macro']);
    assert.deepEqual(bandsFrom(doc, 'unknown-head'), ['heuristic via unexpanded-macro']);
    const e = doc.edges.find((x) => x.from === 'definition:app.c/via-macro' && x.to === 'definition:app.c/helper');
    assert.equal(e?.attrs?.in_macro, 'app.c/ignore-body');
    assert.equal(e?.attrs?.arity_band, 'heuristic');
  });

  it('the macro itself stays a proven expansion', async () => {
    const doc = await graphOf({ 'deps.edn': '{}', 'src/app/c.clj': SRC });
    const m = doc.edges.find((x) => x.from === 'definition:app.c/via-macro' && x.to === 'definition:app.c/ignore-body');
    assert.equal(m?.band, 'static_proven');
  });

  it('stay proven where the project teaches kondo the macro (lint-as in .clojure-atlas.edn or the kondo config)', async () => {
    const doc = await graphOf({
      'deps.edn': '{}',
      '.clj-kondo/config.edn': '{:lint-as {app.c/taught clojure.core/do}}',
      'src/app/c.clj': SRC,
    });
    assert.deepEqual(bandsFrom(doc, 'taught-use'), ['static_proven']);
    assert.deepEqual(bandsFrom(doc, 'via-macro'), ['heuristic via unexpanded-macro']);
    const viaAtlas = await graphOf({
      'deps.edn': '{}',
      '.clojure-atlas.edn': '{:lint-as {app.c/ignore-body clojure.core/do}}',
      'src/app/c.clj': SRC,
    });
    assert.deepEqual(bandsFrom(viaAtlas, 'via-macro'), ['static_proven']);
  });
});
