// Each fixture under test/fixtures is a small Clojure codebase; its expected.txt holds every graph row the builder
// must produce for it (nodes, edges, usage counts, adapter switches), reviewed against the sources by hand.
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { buildGraph } from '../src/build/index.ts';
import { parseDocument } from '../src/mcp/graph.ts';
import { buildFixture, fixtureDir, rowsText } from './helpers/atlas-fixture.ts';

const FIXTURES: [string, string][] = [
  ['core', 'definitions, defines, requires, calls vs references, tests, protocol impls, not-vars, language namespaces'],
  ['project-config', "the project's .clj-kondo lint-as honored: a def-like macro and a defrecord-like macro; record constructors ->R, map->R, R. and the class; a usage of a var its namespace never defines is unresolved"],
  ['relations', 'calls vs references vs passed callbacks (vector, partial, comp, apply, alias, closure, empty map), a handler registered with add-watch, macro expansion, binding/with-redefs as UNKNOWN, dispatch candidates for defmulti, extend-type, extend-protocol, reify'],
  ['multimethods', 'defmethod nodes, resolved keyword dispatch, heuristic dispatch edges, a library multimethod'],
  ['reframe', 'events, subscriptions, inline and var handlers, :<- inputs, an unregistered event, the re-frame.alpha re-exports'],
  ['routes', 'compojure context mounts (also through route vars and non-literal paths), reitit route data with middleware and router interceptors, pedestal table routes and interceptors, handler calls, branching bodies, duplicate routes'],
  ['authz', '.clojure-atlas.edn: route-data authz (one, any of, all of, runtime), inherited exemption, permission middleware and fn, mounted route fns, router data, route macro, lint-as'],
  ['data', 'Datomic schema in edn, transact/q/pull proven, query literal heuristic, references with context, datascript schema'],
  ['system', 'integrant init-key, refs in edn and code, composite keys, mount defstate, component system-map'],
  ['client', 'reitit client routes named by :name or :view, nested paths, parameters as {p}, secretary defroute'],
  ['requests', 'http-xhrio and project effect maps, cljs-ajax, cljs-http and js/fetch requests joined to server routes by method and path, URL helpers read through their body, query strings dropped from the join'],
  ['keys', 'map keys produced, consumed and removed (threaded slots heuristic), a key table, signatures with destructuring and call args'],
  ['schema', 'spec s/def and uses inside spec calls, malli schema defs and uses inside malli calls'],
];

describe('builder fixtures', () => {
  for (const [name, what] of FIXTURES) {
    it(`${name}: ${what}`, async () => {
      const doc = await buildFixture(name);
      assert.equal(rowsText(doc), readFileSync(path.join(fixtureDir(name), 'expected.txt'), 'utf8'));
      assert.doesNotThrow(() => parseDocument(JSON.parse(JSON.stringify(doc))), 'the MCP loader accepts the document');
    });
  }
});

describe("the project's own clj-kondo config", () => {
  const copy = mkdtempSync(path.join(tmpdir(), 'atlas-no-config-'));
  after(() => rmSync(copy, { recursive: true, force: true }));

  it('is what resolves the macro-made definitions: without it they are unknown symbols', async () => {
    cpSync(path.join(fixtureDir('project-config'), 'src'), path.join(copy, 'src'), { recursive: true });
    const u = (await buildGraph(copy)).stats.usages;
    assert.deepEqual([u.resolved, u.unresolved, u.unknown], [6, 1, 7]);
    assert.deepEqual(u.topUnresolved, [['app.macros/never-defined', 1]]);
    assert.deepEqual(u.topUnknown, [['Variable', 3], ['widget', 2], ['->Variable', 1], ['map->Variable', 1]]);
  });
});
