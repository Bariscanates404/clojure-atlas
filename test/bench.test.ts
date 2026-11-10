// The benchmark compares the vars an answer names with the hand-verified set: missing and extra items both fail it.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { answerSet, score, scoreNodes, staleGraph, type Question } from '../bench/scoring.ts';
import type { Graph, GraphNode } from '../src/mcp/graph.ts';
import type { QueryResult, Row } from '../src/mcp/rows.ts';
import { VERSION } from '../src/version.ts';

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

  it('reads the sections a question names, and counts library middleware as an answer item', () => {
    const r = result([
      ['r: handler', ['definition:a/h'], 'handler'],
      ['r: middleware (outermost first)', ['definition:a/wrap-auth', 'library_middleware:ring.middleware.params/wrap-params'], 'middleware'],
    ]);
    assert.deepEqual(answerSet('route_authz', r), ['a/h']);
    assert.deepEqual(answerSet('route_authz', r, ['middleware']), ['a/wrap-auth', 'ring.middleware.params/wrap-params']);
    assert.equal(score({ ...q('route_authz', ['a/wrap-auth', 'ring.middleware.params/wrap-params']), sections: ['middleware'] }, r).pass, true);
  });

  it('scores a question about a kind of node no tool lists against the graph itself', () => {
    const node = (name: string, attrs: Record<string, unknown>): GraphNode => ({ id: `client_route:${name}`, kind: 'client_route', name, attrs });
    const g = { byKind: new Map([['client_route', [node('/a', { name: ':a' }), node('/b', { name: ':b' }), node('/c', {})]]]) } as unknown as Graph;
    const ask = (expected: string[], attrs: Record<string, unknown>): Question => ({ ...q('graph_nodes', expected), args: { kind: 'client_route', attrs } });
    assert.equal(scoreNodes(ask(['/a'], { name: ':a' }), g).pass, true);
    assert.deepEqual(scoreNodes(ask(['/a'], {}), g).extra, ['/b', '/c']);
    assert.deepEqual(scoreNodes(ask(['/z'], { name: ':z' }), g).missing, ['/z']);
    assert.deepEqual(scoreNodes({ ...q('graph_nodes', []), args: { kind: 'none' } }, g).answered, []);
  });

  it('passes an exact answer and fails one with a missing or an extra item', () => {
    const r = result([['callers', ['definition:a/f', 'definition:a/g']]]);
    assert.equal(score(q('callers', ['a/f', 'a/g']), r).pass, true);
    const missing = score(q('callers', ['a/f', 'a/g', 'a/h']), r);
    assert.deepEqual([missing.pass, missing.missing, missing.found], [false, ['a/h'], ['a/f', 'a/g']]);
    const extra = score(q('callers', ['a/f']), r);
    assert.deepEqual([extra.pass, extra.extra], [false, ['a/g']]);
  });

  const absent = (absence: Question['absence'], capability?: string): Question => ({ ...q('callers', []), absence, ...(capability ? { capability } : {}) });
  const said = (verdict: string, found: boolean, notes: string[] = [], sections: [string, string[]][] = [['callers', []]]): QueryResult => ({ ...result(sections), verdict, found, notes });

  it('passes an absence question only when the answer states that absence and names nothing', () => {
    assert.equal(score(absent('none'), said('0 direct caller(s) in 0 component(s)', true)).pass, true);
    assert.equal(score(absent('none'), said('1 direct caller(s) in 1 component(s)', true, [], [['callers', ['definition:a/f']]])).pass, false);
    assert.equal(score(absent('none'), said('no definition matches "a/f"', false)).pass, false, 'not found is not "none"');
    assert.equal(score(absent('not-found'), said('no definition matches "a/f"', false, [], [])).pass, true);
    assert.equal(score(absent('not-found'), said('0 direct caller(s)', true)).pass, false, 'a found definition is not a missing one');
  });

  it('passes a capability-off question only when the capability is named as not available', () => {
    const off = absent('capability-off', 'events');
    assert.equal(score(off, said('no event or subscription matches ":e"', false, [], [])).pass, false, 'a bare no-match reads as plain absence');
    assert.equal(score(off, said('no event or subscription matches ":e"', false, ['events: not used: nothing in this codebase switches it on'], [])).pass, true);
    assert.equal(score(off, said('no event matches ":e"', false, ['capability route_authz is absent: an empty answer is not proof of absence'], [])).pass, false, 'another capability does not count');
    assert.equal(score(off, said('1 handler', true, ['events: not used: x'], [['callers', ['definition:a/f']]])).pass, false, 'naming something fails it');
  });

  it('counts a route as named even though it is not a var', () => {
    const r = said('1 route', true, ['route_authz is absent'], [['routes', ['route:GET /x']]]);
    assert.equal(score({ ...absent('capability-off', 'route_authz'), tool: 'permission_routes' }, r).pass, false);
  });

  it('refuses a graph built by another clojure-atlas version', () => {
    assert.equal(staleGraph(`clojure-atlas ${VERSION}, clj-kondo v2025.10.23`), undefined);
    assert.match(staleGraph('clojure-atlas 0.0.0, clj-kondo v2025.10.23') ?? '', /rebuild it with scripts\/coverage.ts/);
    assert.match(staleGraph(undefined) ?? '', /no analyzer recorded/);
  });
});
