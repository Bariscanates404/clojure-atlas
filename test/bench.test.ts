// The benchmark compares the vars an answer names with the hand-verified set: missing and extra items both fail it.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { answerSet, score, type Question } from '../bench/scoring.ts';
import type { QueryResult, Row } from '../src/mcp/rows.ts';

const row = (id: string): Row => ({ label: id, id, file: null, line: null, band: 'static_proven' });
const result = (sections: [string, string[], string?][]): QueryResult => ({
  name: 'x', query: 'q', title: 't', verdict: 'v', found: true, matches: [], notes: [], next: [],
  sections: sections.map(([name, ids, short]) => ({ name, ...(short ? { short } : {}), rows: ids.map(row) })),
});
const q = (tool: string, expected: string[]): Question => ({ id: 'q', repo: 'r', question: '?', tool, args: {}, expected, evidence: {} });

describe('benchmark scoring', () => {
  it('reads only the sections that answer the tool, and only vars and namespaces', () => {
    const r = result([
      ['definition', ['definition:a/target']],
      [':e: dispatched by', ['definition:a/view', 'namespace:a.boot'], 'dispatched by'],
      [':e: handler', ['handler:event :e a.cljs:3'], 'handler'],
      [':e: handler dispatches', ['definition:a/other'], 'handler dispatches'],
    ]);
    assert.deepEqual(answerSet('event_flow', r), ['a.boot', 'a/view']);
    assert.throws(() => answerSet('graph_info', r), /no answer sections known for tool graph_info/);
  });

  it('passes an exact answer and fails one with a missing or an extra item', () => {
    const r = result([['callers', ['definition:a/f', 'definition:a/g']]]);
    assert.equal(score(q('callers', ['a/f', 'a/g']), r).pass, true);
    const missing = score(q('callers', ['a/f', 'a/g', 'a/h']), r);
    assert.deepEqual([missing.pass, missing.missing, missing.found], [false, ['a/h'], ['a/f', 'a/g']]);
    const extra = score(q('callers', ['a/f']), r);
    assert.deepEqual([extra.pass, extra.extra], [false, ['a/g']]);
  });
});
