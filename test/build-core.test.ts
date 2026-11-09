// Corner cases of the core graph, read from test/fixtures/edges: which definition a declare stands for, what a
// namespace form really loads, one edge per call site, what counts as a callback, platforms, self recursion.
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import type { AtlasDocument } from '../src/build/assemble.ts';
import { buildFixture } from './helpers/atlas-fixture.ts';

let doc: AtlasDocument;
before(async () => {
  doc = await buildFixture('edges');
});

const edges = (from: string, to: string, kind?: string) =>
  doc.edges.filter((e) => e.from === from && e.to === to && (!kind || e.kind === kind));
const def = (name: string) => `definition:app.core/${name}`;

describe('core graph corner cases', () => {
  it('a declare does not stand for the definition it forwards to', () => {
    const helper = doc.nodes.find((n) => n.id === def('helper'));
    assert.equal(helper?.line, 11);
    assert.equal(helper?.attrs?.defined_by, 'clojure.core/defn');
    assert.ok(helper?.attrs?.signature, 'the real definition carries the signature');
    assert.deepEqual(edges(def('run'), def('helper')).map((e) => e.kind), ['passes_callback']);
  });

  it('a namespace defined for two platforms in separate files merges their definitions', () => {
    const x = doc.nodes.find((n) => n.id === 'definition:app.dup/x');
    assert.deepEqual(x?.attrs?.platforms, ['clj', 'cljs']);
    assert.equal(doc.nodes.find((n) => n.id === 'definition:app.dup/y')?.attrs?.platforms, undefined);
  });
});
