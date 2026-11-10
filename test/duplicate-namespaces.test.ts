// The same namespace defined in two source roots of a monorepo: one graph node per name cannot say which definition
// a usage means, so nothing derived from it may read STATIC_PROVEN, and the build says it merged them.
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import type { AtlasDocument } from '../src/build/assemble.ts';
import { degradation, degradedLine } from '../src/mcp/degraded.ts';
import { indexGraph } from '../src/mcp/graph.ts';
import { callTool } from '../src/mcp/server.ts';
import { graphOf } from './helpers/inline-graph.ts';

const files = {
  'svc-a/deps.edn': '{}',
  'svc-a/src/app/core.clj': '(ns app.core)\n(defn handle [x] (inc x))\n(defn only-a [] (handle 1))\n',
  'svc-b/deps.edn': '{}',
  'svc-b/src/app/core.clj': '(ns app.core)\n(defn handle [x y] (+ x y))\n(defn only-b [] (handle 1 2))\n',
  // one namespace in a .clj and a .cljs file of the same path is one namespace, not a duplicate
  'svc-a/src/app/shared.clj': '(ns app.shared)\n(defn f [] 1)\n',
  'svc-a/src/app/shared.cljs': '(ns app.shared)\n(defn f [] 2)\n',
};

let doc: AtlasDocument;
before(async () => {
  doc = await graphOf(files);
});

describe('a namespace defined in two source roots', () => {
  it('reports it in the build stats with both files, and not the .clj/.cljs pair', () => {
    assert.deepEqual(doc.stats.duplicate_namespaces, [{ ns: 'app.core', files: ['svc-a/src/app/core.clj', 'svc-b/src/app/core.clj'] }]);
  });

  it('says so in the DEGRADED line', () => {
    const d = degradation(doc);
    assert.ok(d);
    assert.match(degradedLine(d), /1 namespace\(s\) defined in more than one file \(app\.core\)/);
  });

  it('keeps both files on the definition node and the union of the arities', () => {
    const n = doc.nodes.find((x) => x.id === 'definition:app.core/handle');
    assert.deepEqual(n?.attrs?.defined_in, ['svc-a/src/app/core.clj', 'svc-b/src/app/core.clj']);
    const arities = (n?.attrs?.signature as { arities: unknown[] }).arities;
    assert.equal(arities.length, 2);
  });

  it('proves no call into it: the calls edges and their arities are heuristic', () => {
    const calls = doc.edges.filter((e) => e.kind === 'calls' && e.to === 'definition:app.core/handle');
    assert.equal(calls.length, 2);
    for (const e of calls) {
      assert.equal(e.band, 'heuristic');
      assert.equal(e.attrs?.arity_band, 'heuristic');
      assert.equal(e.attrs?.via, 'duplicate-namespace');
    }
  });

  it('signature_impact reports no arity finding as proven', () => {
    const t = callTool(indexGraph(doc), 'signature_impact', { fn: 'app.core/handle' }).text;
    assert.doesNotMatch(t, /is not defined/);
    assert.doesNotMatch(t, /STATIC_PROVEN.*arity/i);
  });

  it('a namespace defined once keeps its proven calls', () => {
    const f = doc.edges.filter((e) => e.to === 'definition:app.shared/f');
    assert.ok(f.every((e) => e.band === 'static_proven'));
    assert.equal(doc.stats.duplicate_namespaces.length, 1);
  });
});
