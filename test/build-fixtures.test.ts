// Each fixture under test/fixtures is a small Clojure codebase; its expected.txt holds every graph row the builder
// must produce for it (nodes, edges, usage counts, adapter switches), reviewed against the sources by hand.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { parseDocument } from '../src/mcp/graph.ts';
import { buildFixture, fixtureDir, rowsText } from './helpers/atlas-fixture.ts';

const FIXTURES: [string, string][] = [
  ['core', 'definitions, defines, requires, calls vs references, tests, protocol impls, not-vars, language namespaces'],
  ['multimethods', 'defmethod nodes, resolved keyword dispatch, heuristic dispatch edges, a library multimethod'],
  ['reframe', 'events, subscriptions, inline and var handlers, :<- inputs, an unregistered event'],
  ['routes', 'compojure context mounts, reitit route data with middleware, pedestal table routes and interceptors'],
  ['data', 'Datomic schema in edn, transact/q/pull proven, query literal heuristic, references with context, datascript schema'],
  ['system', 'integrant init-key, refs in edn and code, composite keys, mount defstate, component system-map'],
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
