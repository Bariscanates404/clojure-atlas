// key_flow, key_siblings and signature_impact answered by the MCP queries from a graph the builder made.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { graphFromJson } from '../src/mcp/graph.ts';
import { keyFlow, keySiblings, signatureImpact } from '../src/mcp/keyflow.ts';
import { buildFixture } from './helpers/atlas-fixture.ts';

describe('map keys and signatures end to end through the MCP queries', () => {
  it('answers from a built graph', async () => {
    const g = graphFromJson(JSON.stringify(await buildFixture('keys')));
    assert.match(keyFlow(g, ':total').verdict, /2 producer.*1 consumer/);
    assert.match(keyFlow(g, ':draft').verdict, /0 producer/);
    const siblings = keySiblings(g, 'src/cart/core.clj');
    assert.ok(siblings.sections.some((s) => s.rows.some((r) => /:price/.test(r.label) || /:price/.test(r.detail ?? ''))), JSON.stringify(siblings.sections));
    const sig = signatureImpact(g, 'cart.core/line-total');
    assert.ok(sig.sections.some((s) => s.rows.some((r) => r.finding === 'unread' && /:coupon/.test(r.label))), JSON.stringify(sig.sections));
    for (const cap of ['key_flow', 'key_tables', 'signatures']) assert.equal(g.doc.capabilities.find((c) => c.name === cap)?.status, 'available');
  });
});
