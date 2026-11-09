// Regressions from the review: sibling routes, the risk level of an attribute write, paging and JSON output.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { contextForChange, routeSiblings } from '../src/mcp/queries.ts';
import { render } from '../src/mcp/render.ts';
import type { QueryResult } from '../src/mcp/rows.ts';
import { GraphBuilder } from './helpers/code-graph-fixture.ts';

const CORE = 'components/core/src/core.clj';

describe('sibling routes are the same base and mount, never another copy of the same path', () => {
  it('a route served under two bases is not the odd one out because the other copy has a check', () => {
    const b = new GraphBuilder();
    const f = 'components/api/src/routes.clj';
    const app = b.route('GET', '/article', 'app', '/api');
    const admin = b.route('GET', '/article', 'admin', '/admin');
    const other = b.route('GET', '/logo', 'app', '/api');
    for (const id of [app, admin, other]) Object.assign(b.nodes.find((n) => n.id === id) ?? {}, { file: f, line: 5 });
    b.edge(admin, 'requires_permission', b.node('permission', ':edit-article'));
    const g = b.build();
    const node = g.byId.get(app);
    assert.ok(node);
    const sib = routeSiblings(g, node);
    assert.equal(sib?.odd, false);
  });
});

describe('the risk level comes from the row kind, not a word in its text', () => {
  it('a write to an attribute named like "runtime" is MEDIUM, not HIGH', () => {
    const b = new GraphBuilder();
    const f = b.def('core/f', 'components/core', { file: CORE, line: 10, end_line: 20 });
    const attr = b.node('data_attribute', ':app/runtime-vars', { file: 'components/core/resources/schema.edn', line: 1 });
    b.edge(f, 'writes', attr, { file: CORE, line: 12 });
    b.edge(b.def('r/reader', 'components/report', { file: 'components/report/src/r.clj', line: 3 }), 'reads', attr);
    const res = contextForChange(b.build(), [`${CORE}:12-12`]);
    assert.match(res.verdict, /risk MEDIUM$/);
  });
});

function keysResult(n: number): QueryResult {
  const rows = Array.from({ length: n }, (_, i) => ({ label: `ns/f${i}`, id: `d:${i}`, file: `components/c/src/f${i}.clj`, line: i + 1, band: 'static_proven' as const, detail: 'x'.repeat(100) }));
  return {
    name: 'context_for_change', query: 'q', title: 't', verdict: `${n} rows`, found: true, matches: [], notes: [], next: [],
    sections: [{ name: 'signatures and key siblings', short: 'keys', rows, ordered: true }, { name: 'tests to run', rows: [] }],
  };
}

describe('the paging hint names a section that section= accepts', () => {
  it('section="keys" (the short name in the hint) selects the section', () => {
    const first = render(keysResult(30));
    assert.match(first, /next page: offset=\d+ section="keys"/);
    const next = render(keysResult(30), { section: 'keys', offset: 5 });
    assert.doesNotMatch(next, /no section matches/);
    assert.match(next, /ns\/f5/);
  });
});

describe('response_format json honours limit, offset, section and max_tokens', () => {
  it('limit and offset page the rows and the totals say what was left out', () => {
    const out = JSON.parse(render(keysResult(300), { format: 'json', limit: 2, offset: 4, section: 'keys' })) as { sections: { rows: { label: string }[]; total?: number }[] };
    assert.equal(out.sections.length, 1);
    assert.deepEqual(out.sections[0].rows.map((r) => r.label), ['ns/f4', 'ns/f5']);
    assert.equal(out.sections[0].total, 300);
  });
  it('max_tokens bounds the output', () => {
    const out = render(keysResult(300), { format: 'json', maxTokens: 500 });
    assert.ok(out.length <= 500 * 4, `json is ${out.length} chars`);
    assert.match(out, /"truncated"/);
  });
});
