// callers counts calls by default; include_references adds every other dependency relation; blast_radius walks them
// all and says it is potential impact.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { graphFromJson } from '../src/mcp/graph.ts';
import { blastRadius, callers } from '../src/mcp/queries.ts';
import { buildFixture } from './helpers/atlas-fixture.ts';

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
});
