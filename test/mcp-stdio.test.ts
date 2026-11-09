import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_PROTOCOL, missingArguments, stdioServer } from '../src/mcp/stdio.ts';

const server = stdioServer<{ tag: string }>({
  name: 'fake',
  version: '9',
  listTools: () => [{ name: 'echo' }],
  callTool: (ctx, name, args) => {
    if (name === 'sync-throw') throw new Error('boom');
    if (name === 'async-throw') return Promise.reject(new Error('later'));
    if (name === 'async') return Promise.resolve({ text: `${ctx.tag}:${String(args.v)}`, isError: false });
    return { text: `${ctx.tag}:${name}`, isError: name === 'bad' };
  },
});
const ctx = { tag: 'c' };
const call = (name: string, args: Record<string, unknown> = {}) => server.handleMessage(ctx, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
const text = (r: unknown) => (r as { result: { content: { text: string }[]; isError: boolean } }).result;

describe('the stdio core', () => {
  it('a synchronous tool is answered synchronously, with the context it was given', () => {
    const r = text(call('plain'));
    assert.deepEqual([r.content[0].text, r.isError], ['c:plain', false]);
    assert.equal(text(call('bad')).isError, true);
  });
  it('an async tool is answered with a promise', async () => {
    const r = call('async', { v: 4 });
    assert.ok(r instanceof Promise);
    assert.equal(text(await r).content[0].text, 'c:4');
  });
  it('a throwing tool, sync or async, comes back as an error result and never rejects', async () => {
    assert.deepEqual([text(call('sync-throw')).isError, text(call('sync-throw')).content[0].text], [true, 'sync-throw failed: boom']);
    const r = text(await call('async-throw'));
    assert.deepEqual([r.isError, r.content[0].text], [true, 'async-throw failed: later']);
  });
  it('initialize names the server, defaults the protocol and adds instructions only when given', () => {
    const init = (s: typeof server, params?: Record<string, unknown>) => (s.handleMessage(ctx, { jsonrpc: '2.0', id: 1, method: 'initialize', params }) as { result: Record<string, unknown> }).result;
    assert.deepEqual(init(server), { protocolVersion: DEFAULT_PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '9' } });
    const withHelp = stdioServer<object>({ name: 'h', version: '1', instructions: 'read me', listTools: () => [], callTool: () => ({ text: '', isError: false }) });
    assert.equal((withHelp.handleMessage({}, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 'x' } }) as { result: { instructions: string; protocolVersion: string } }).result.instructions, 'read me');
  });
});

describe('missingArguments', () => {
  it('a blank string, a list without a string and an absent argument are missing', () => {
    assert.deepEqual(missingArguments(['a', 'b', 'c', 'd', 'e'], { a: '  ', b: [], c: [3], d: 'x', e: ['y'] }), ['a', 'b', 'c']);
    assert.deepEqual(missingArguments(['q'], {}), ['q']);
    assert.deepEqual(missingArguments([], {}), []);
  });
});
