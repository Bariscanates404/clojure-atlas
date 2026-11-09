// callers counts calls by default; include_references adds every other dependency relation; blast_radius walks them
// all and says it is potential impact.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { graphFromJson } from '../src/mcp/graph.ts';
import { blastRadius, callers } from '../src/mcp/queries.ts';
import { callTool } from '../src/mcp/server.ts';
import { buildFixture } from './helpers/atlas-fixture.ts';
import { graphOf } from './helpers/inline-graph.ts';

describe('relation semantics through the MCP', () => {
  it('callers, callers with references and blast radius', async () => {
    const g = graphFromJson(JSON.stringify(await buildFixture('relations')));
    const direct = callers(g, 'app.core/save!');
    assert.deepEqual(direct.sections[1].rows.map((r) => `${r.label} ${r.kind} ${r.band}`).sort(), [
      'app.core/run-all calls heuristic', 'app.core/test-double calls static_proven',
    ]);
    const all = callers(g, 'app.core/save!', { includeReferences: true });
    assert.deepEqual([...new Set(all.sections[1].rows.map((r) => r.kind))].sort(), ['calls', 'passes_callback', 'rebinds', 'references']);
    assert.ok(all.sections[1].rows.some((r) => r.kind === 'rebinds' && r.band === 'unknown'));
    assert.deepEqual(callers(g, 'app.core/on-change').sections[1].rows, []);
    assert.deepEqual(callers(g, 'app.core/on-change', { includeReferences: true }).sections[1].rows.map((r) => `${r.label} ${r.kind}`), ['app.core registers_handler']);
    const blast = blastRadius(g, 'app.shapes/label');
    assert.ok(blast.notes.some((n) => /potential impact over known dependency relations/.test(n)));
    assert.ok(blast.sections.some((s) => s.rows.some((r) => r.label === 'app.shapes/describe')));
  });

  it('reads the rich comment as code that is not run: no calls, no definitions', async () => {
    const doc = await buildFixture('relations');
    const g = graphFromJson(JSON.stringify(doc));
    assert.deepEqual(callers(g, 'app.core/only-in-rich-comment', { includeReferences: true }).sections[1].rows, []);
    assert.deepEqual(blastRadius(g, 'app.core/only-in-rich-comment').sections.flatMap((s) => s.rows), []);
    assert.ok(!doc.nodes.some((n) => n.id === 'definition:app.core/scratch'));
    assert.ok(!doc.edges.some((e) => e.file === 'src/app/core.clj' && (e.line ?? 0) >= 42 && e.kind !== 'defines'));
  });

  it('knows binding and for by the var the name resolves to, and does not call a loop collection an alias', async () => {
    const doc = await buildFixture('relations');
    const from = (id: string) => doc.edges.filter((e) => e.from === `definition:app.local/${id}` && e.to.startsWith('definition:app.core/')).map((e) => `${e.kind} ${e.to} ${JSON.stringify(e.attrs?.via ?? null)}`).sort();
    assert.deepEqual(from('shadowed'), ['calls definition:app.core/audit null', 'references definition:app.core/log! null']);
    assert.deepEqual(from('real-rebind'), ['calls definition:app.core/audit null', 'rebinds definition:app.core/*sink* "binding"']);
    assert.deepEqual(from('iterates'), ['references definition:app.core/handlers null']);
  });

  it('does not count a protocol method parameter as a usage of an unknown name', async () => {
    const doc = await buildFixture('relations');
    assert.equal(doc.stats.usages.unknown, 0);
    assert.deepEqual(doc.stats.usages.topUnknown, []);
  });

  it('code inside a syntax-quote is a template: no call by the enclosing fn, an unquoted call stays one', async () => {
    const doc = await graphOf({ 'src/app/core.clj': [
      '(ns app.core)', '(defn target [a] a)', '(defn tpl [] `(target 12))', '(defn mixed [x] `(do ~(target x) (target 3)))', '(defn plain [] (target 1))',
      '(defmacro mac [] `(target 5))', '(defn nested [] `(a ~(b `(target 7))))', '(defn a [] 1)', '(defn b [x] x)',
    ].join('\n') });
    const into = (from: string) => doc.edges.filter((e) => e.from === `definition:app.core/${from}` && e.to === 'definition:app.core/target').map((e) => `${e.kind} ${e.band} ${e.attrs?.via ?? '-'}`).sort();
    assert.deepEqual(into('plain'), ['calls static_proven -']);
    assert.deepEqual(into('tpl'), ['references heuristic syntax-quote']);
    assert.deepEqual(into('mac'), ['references heuristic syntax-quote']);
    assert.deepEqual(into('mixed'), ['calls static_proven -', 'references heuristic syntax-quote']);
    assert.deepEqual(into('nested'), ['references heuristic syntax-quote']);
    const g = graphFromJson(JSON.stringify(doc));
    assert.deepEqual(callers(g, 'app.core/target').sections[1].rows.map((r) => r.label).sort(), ['app.core/mixed', 'app.core/plain']);
    assert.ok(callers(g, 'app.core/target', { includeReferences: true }).sections[1].rows.some((r) => r.label === 'app.core/tpl' && r.band === 'heuristic'));
  });
});

describe('invalid arguments are errors', () => {
  const g = graphFromJson(JSON.stringify({ format: 'code-graph', version: 2, source: { sha: 'a' }, capabilities: [{ name: 'definitions', status: 'available' }], nodes: [{ id: 'definition:a/b', kind: 'definition', name: 'a/b' }], edges: [] }));
  for (const [tool, args] of [['blast_radius', { var: 'a/b', depth: -5 }], ['blast_radius', { var: 'a/b', depth: 0 }], ['tests_for', { symbol: 'a/b', depth: -1 }]] as const) {
    it(`${tool} ${JSON.stringify(args)} is isError true`, () => {
      const r = callTool(g, tool, args);
      assert.equal(r.isError, true);
      assert.match(r.text, /is not valid: pass 1 or more/);
    });
  }
  it('a valid depth is not an error', () => assert.equal(callTool(g, 'blast_radius', { var: 'a/b', depth: 2 }).isError, false));
});
