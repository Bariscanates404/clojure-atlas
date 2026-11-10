// A healthy build drops no edge: every end of every edge is a node. Each case below was a dropped edge on a real repo.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { edgeRows, graphOf } from './helpers/inline-graph.ts';

describe('system keys named by a ref', () => {
  const ig = (body: string) => `(ns app.ig (:require [integrant.core :as ig]))\n${body}`;

  it('keeps the edge to a key the config never declares and marks that key undeclared', async () => {
    const doc = await graphOf({ 'src/app/ig.clj': ig('(def config {:app/web {:db (ig/ref :app/db)}})') });
    assert.equal(doc.stats.dropped_edges, 0);
    assert.deepEqual(edgeRows(doc, 'depends_on'), ['system_key::app/web -> system_key::app/db static_proven']);
    const target = doc.nodes.find((n) => n.id === 'system_key::app/db');
    assert.deepEqual(target?.attrs, { library: 'integrant', undeclared: true });
    assert.equal(target?.line, 2);
    assert.equal(doc.nodes.find((n) => n.id === 'system_key::app/web')?.attrs?.undeclared, undefined);
  });

  it('points a composite ref at the declared composite key that holds its parts', async () => {
    const doc = await graphOf({ 'src/app/ig.clj': ig('(def config {:app/a (ig/ref [:app/b :app/c]), [:app/b :app/c :app/e] 1})') });
    assert.equal(doc.stats.dropped_edges, 0);
    assert.deepEqual(edgeRows(doc, 'depends_on'), ['system_key::app/a -> system_key:[:app/b :app/c :app/e] static_proven']);
  });

  it('names an undeclared composite ref with the same id scheme as a composite key', async () => {
    const doc = await graphOf({ 'src/app/ig.clj': ig('(def config {:app/a (ig/ref [:app/b :app/c])})') });
    assert.equal(doc.stats.dropped_edges, 0);
    assert.deepEqual(edgeRows(doc, 'depends_on'), ['system_key::app/a -> system_key:[:app/b :app/c] static_proven']);
    assert.equal(doc.nodes.find((n) => n.id === 'system_key:[:app/b :app/c]')?.attrs?.undeclared, true);
  });
});

describe('files without an ns form', () => {
  it('gives the default user namespace a node, so mount definitions keep their defines edge', async () => {
    const doc = await graphOf({
      'dev/user.clj': `(require '[mount.core :as mount :refer [defstate]])\n(defstate conn :start 1)\n(def x 2)\n`,
    });
    assert.equal(doc.stats.dropped_edges, 0);
    const user = doc.nodes.find((n) => n.id === 'namespace:user');
    assert.equal(user?.file, 'dev/user.clj');
    assert.ok(edgeRows(doc, 'defines').includes('namespace:user -> definition:user/x static_proven'));
  });

  it('gives it a node for keys produced from a data-only file too', async () => {
    const doc = await graphOf({ 'src/deps.cljs': `{:deps {:a 1}}\n(def m {:k 1})\n` });
    assert.equal(doc.stats.dropped_edges, 0);
    assert.ok(doc.nodes.some((n) => n.id === 'namespace:user'));
  });

  it('gives a namespace entered with in-ns a node', async () => {
    const doc = await graphOf({ 'src/dbg.clj': `(ns app.dbg)\n(in-ns 'clojure.core)\n(def thing 1)\n` });
    assert.equal(doc.stats.dropped_edges, 0);
    assert.ok(doc.nodes.some((n) => n.id === 'namespace:clojure.core'));
  });
});
