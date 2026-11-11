import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PROTOCOL, invalidArguments, missingArguments, stdioServer, SUPPORTED_PROTOCOLS } from '../src/mcp/stdio.ts';

// found from this file, so the suite also runs from another working directory
const SERVE_FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'helpers', 'serve-fixture.ts');

const server = stdioServer<{ tag: string }>({
  name: 'fake',
  version: '9',
  listTools: () => ['plain', 'bad', 'async', 'sync-throw', 'async-throw'].map((name) => ({ name })),
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

describe('protocol edges', () => {
  const send = (msg: unknown) => server.handleMessage(ctx, msg) as { result?: Record<string, unknown>; error?: { code: number; message: string }; id: unknown };
  it('initialize answers with a version it supports: the requested one when known, else the newest', () => {
    const version = (v: unknown) => send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: v } }).result?.protocolVersion;
    for (const v of SUPPORTED_PROTOCOLS) assert.equal(version(v), v);
    for (const v of ['1999-01-01', 7, undefined]) assert.equal(version(v), DEFAULT_PROTOCOL);
    assert.equal(SUPPORTED_PROTOCOLS[0], DEFAULT_PROTOCOL);
  });
  it('an unknown tool is invalid params (-32602), not a tool result', () => {
    const r = send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'nope' } });
    assert.deepEqual(r.error, { code: -32602, message: 'unknown tool nope' });
  });
  it('a request with another jsonrpc version or an object id is invalid, a notification is still silent', () => {
    assert.equal(send({ jsonrpc: '1.0', id: 3, method: 'ping' }).error?.code, -32600);
    assert.equal(send({ id: 3, method: 'ping' }).error?.code, -32600);
    const objectId = send({ jsonrpc: '2.0', id: { a: 1 }, method: 'ping' });
    assert.deepEqual([objectId.error?.code, objectId.id], [-32600, null]);
    assert.equal(send({ jsonrpc: '1.0', method: 'ping' }), null);
  });
  it('a leading byte order mark does not make a line unparsable', () => {
    const r = server.handleLine(ctx, '\uFEFF{"jsonrpc":"2.0","id":4,"method":"ping"}') as { result: unknown };
    assert.deepEqual(r.result, {});
  });
  it('a client that closes our stdout ends the server quietly with exit 0', async () => {
    const child = spawn(process.execPath, [SERVE_FIXTURE], { stdio: ['pipe', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d: Buffer) => { err += d.toString(); });
    child.stdout.destroy();
    const exit = new Promise<number | null>((resolve) => child.on('exit', resolve));
    const timer = setTimeout(() => child.kill(), 5000);
    child.stdin.on('error', () => {});
    for (let i = 0; i < 20; i++) child.stdin.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
    assert.equal(await exit, 0);
    clearTimeout(timer);
    assert.equal(err, '');
  });
});

describe('invalidArguments', () => {
  const props = {
    n: { type: 'number' }, s: { type: 'string' }, b: { type: 'boolean' }, e: { type: 'string', enum: ['x', 'y'] },
    l: { type: 'array', items: { type: 'number' } }, t: { type: 'array', items: { type: 'string' } },
  };
  it('names every argument whose type or enum value is wrong, and accepts the right ones', () => {
    assert.deepEqual(invalidArguments(props, { n: 1, s: 'a', b: false, e: 'x', l: [1, 2], t: ['a'] }), []);
    assert.deepEqual(invalidArguments(props, { n: '1', s: 3, b: 'true', e: 'z', l: ['1'], t: 5 }), [
      'n must be a number, got string', 's must be a string, got number', 'b must be a boolean, got string',
      'e must be one of x, y, got "z"', 'l must be a list of number, got a list with a string', 't must be a list, got number',
    ]);
  });
  it('an absent or null argument and an argument the schema does not list are fine', () => {
    assert.deepEqual(invalidArguments(props, { n: null, extra: {} }), []);
  });
  it('a lone string is a list of one string, but not a list of numbers', () => {
    assert.deepEqual(invalidArguments(props, { t: 'a', l: '1' }), ['l must be a list, got string']);
  });
  it('a list is wrong where the schema says string', () => {
    assert.deepEqual(invalidArguments({ t: { type: 'string' } }, { t: ['a'] }), ['t must be a string, got array']);
  });
});
