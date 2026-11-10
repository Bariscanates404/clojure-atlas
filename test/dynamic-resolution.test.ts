// requiring-resolve, resolve and ns-resolve reach a var by a symbol: a literal 'ns/name is a HEURISTIC reference, and
// callers and blast_radius say that a symbol built at runtime is not followed whenever the codebase resolves dynamically.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { indexGraph, parseDocument, type Graph } from '../src/mcp/graph.ts';
import { blastRadius, callers } from '../src/mcp/queries.ts';
import { graphOf } from './helpers/inline-graph.ts';

const UTIL = '(ns app.util)\n(defn hidden [] 1)\n(defn other [] 2)\n(defn plain [] 3)\n';
const CORE = `(ns app.core)
(defn via-rr [] ((requiring-resolve 'app.util/hidden)))
(defn via-resolve [] (resolve 'app.util/other))
(defn via-ns-resolve [] (ns-resolve 'app.core 'app.util/hidden))
(defn via-quote-form [] (requiring-resolve (quote app.util/other)))
(defn computed [s] (requiring-resolve (symbol s)))
(defn outside [] (requiring-resolve 'clojure.string/join))
(defn bare [] (resolve 'plain))
`;

async function graphFor(files: Record<string, string>): Promise<Graph> {
  const doc = await graphOf({ 'deps.edn': '{}', ...files });
  return indexGraph(parseDocument(JSON.parse(JSON.stringify(doc))));
}

describe('dynamic resolution with a literal symbol', () => {
  it('is a HEURISTIC references edge to the named project var, one per site', async () => {
    const doc = await graphOf({ 'deps.edn': '{}', 'src/app/util.clj': UTIL, 'src/app/core.clj': CORE });
    const rows = doc.edges.filter((e) => e.kind === 'references' && e.to.startsWith('definition:app.util/')).map((e) => `${e.from} -> ${e.to} ${e.band} ${e.attrs?.via}`).sort();
    assert.deepEqual(rows, [
      'definition:app.core/via-ns-resolve -> definition:app.util/hidden heuristic ns-resolve',
      'definition:app.core/via-quote-form -> definition:app.util/other heuristic requiring-resolve',
      'definition:app.core/via-resolve -> definition:app.util/other heuristic resolve',
      'definition:app.core/via-rr -> definition:app.util/hidden heuristic requiring-resolve',
    ]);
  });

  it('callers lists it with include_references and says a computed symbol is not followed', async () => {
    const g = await graphFor({ 'src/app/util.clj': UTIL, 'src/app/core.clj': CORE });
    const all = callers(g, 'app.util/hidden', { includeReferences: true });
    assert.deepEqual(all.sections.find((s) => s.name === 'callers and references')?.rows.map((r) => `${r.label} [${r.band}]`).sort(),
      ['app.core/via-ns-resolve [heuristic]', 'app.core/via-rr [heuristic]']);
    const note = all.notes.find((n) => /requiring-resolve/.test(n));
    assert.equal(note, 'dynamic resolution (requiring-resolve, resolve, ns-resolve) is used at 7 site(s), 4 naming a project var by a literal symbol (HEURISTIC references); '
      + 'a symbol built at runtime is not followed, so a caller reached that way is not listed');
  });

  it('blast_radius carries the same caveat', async () => {
    const g = await graphFor({ 'src/app/util.clj': UTIL, 'src/app/core.clj': CORE });
    assert.ok(blastRadius(g, 'app.util/hidden').notes.some((n) => /^dynamic resolution \(requiring-resolve, resolve, ns-resolve\) is used at 7 site/.test(n)));
  });

  it('a codebase that never resolves dynamically gets no caveat', async () => {
    const g = await graphFor({ 'src/app/util.clj': UTIL, 'src/app/core.clj': '(ns app.core (:require [app.util :as u]))\n(defn go [] (u/hidden))\n' });
    assert.ok(!callers(g, 'app.util/hidden').notes.some((n) => /dynamic resolution/.test(n)));
    assert.ok(!blastRadius(g, 'app.util/hidden').notes.some((n) => /dynamic resolution/.test(n)));
  });
});
