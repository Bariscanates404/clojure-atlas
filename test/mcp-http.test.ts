import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { request } from 'node:http';
import { gzipSync } from 'node:zlib';
import { GraphBuilder } from './helpers/code-graph-fixture.ts';
import { GraphAccessError, GraphStore } from '../src/mcp/graph-store.ts';
import { createAtlasHttpServer, HTTP_PROTOCOLS, listenAtlasHttp, MAX_HTTP_BODY } from '../src/mcp/http.ts';
import { handleGraphlessMessage } from '../src/mcp/server.ts';
import { defaultTokenFile, httpToken } from '../src/mcp/http-token.ts';
import { writeGraph } from '../src/build/index.ts';
import type { AtlasDocument } from '../src/build/assemble.ts';

const root = mkdtempSync(path.join(tmpdir(), 'atlas-http-'));
after(() => rmSync(root, { recursive: true, force: true }));
let serial = 0;
const dir = () => { const d = path.join(root, String(serial++)); mkdirSync(d); return d; };
const document = (sha = 'a'.repeat(40)) => { const b = new GraphBuilder(); b.sha = sha; b.def('demo/target'); return b.doc(); };
const put = (file: string, sha = 'a'.repeat(40)) => {
  const json = JSON.stringify(document(sha));
  writeFileSync(`${file}.next`, file.endsWith('.gz') ? gzipSync(json) : json);
  renameSync(`${file}.next`, file);
};
const fresh = () => { const repo = dir(); const file = path.join(repo, 'graph.json.gz'); put(file); return { repo, file }; };

describe('shared graph snapshots', () => {
  it('loads lazily, shares one snapshot, and reloads without mutating a snapshot already in use', () => {
    const target = fresh();
    const store = new GraphStore([target], 3);
    assert.equal((store.status()[0] as { loaded: boolean }).loaded, false);
    const old = store.get();
    assert.equal(store.get(target.repo), old);
    assert.equal(old.options.maxDistance, 3);
    assert.ok(old.options.snapshot!());
    put(target.file, 'b'.repeat(40));
    const next = store.get();
    assert.notEqual(next, old);
    assert.equal(next.graph.doc.source.sha, 'b'.repeat(40));
    assert.equal(old.graph.doc.source.sha, 'a'.repeat(40));
    assert.equal(store.get(), next);
    assert.equal((store.status()[0] as { generation: number }).generation, 2);
  });

  it('rejects a broken replacement or missing graph, retains the old snapshot and recovers on the next good build', () => {
    const { file } = fresh();
    const store = new GraphStore([{ file }]);
    const old = store.get();
    writeFileSync(file, '{partial');
    assert.throws(() => store.get(), /graph unavailable: .*not valid JSON/);
    assert.ok((store.status()[0] as { error: string }).error);
    assert.equal(old.graph.doc.source.sha, 'a'.repeat(40));
    rmSync(file);
    assert.throws(() => store.get(), /graph unavailable/);
    put(file, 'c'.repeat(40));
    assert.equal(store.get().graph.doc.source.sha, 'c'.repeat(40));
    assert.equal((store.status()[0] as { error: unknown }).error, null);
  });

  it('isolates repos, canonicalizes allowed aliases and refuses unregistered paths', () => {
    const a = fresh(), b = fresh(), other = fresh();
    put(b.file, 'b'.repeat(40));
    const store = new GraphStore([a, b]);
    assert.throws(() => store.get(), GraphAccessError);
    for (const repo of ['relative', '', other.repo, path.join(root, 'missing')]) assert.throws(() => store.get(repo), GraphAccessError);
    const alias = path.join(root, 'alias');
    symlinkSync(a.repo, alias, 'junction');
    assert.equal(store.get(alias), store.get(a.repo));
    assert.notEqual(store.get(a.repo), store.get(b.repo));
    assert.throws(() => new GraphStore([a, { file: a.file, repo: alias }]), /distinct/);
    assert.throws(() => new GraphStore([]), /between 1 and 32/);
    assert.throws(() => new GraphStore(Array(33).fill(a)), /between 1 and 32/);
    assert.throws(() => new GraphStore([{ file: a.file, repo: a.file }]), /not a directory/);
  });

  it('matches a repo spelled in another letter case only where the file system ignores case', () => {
    const repo = path.join(root, 'CaseRepo'); mkdirSync(repo);
    const file = path.join(repo, 'graph.json.gz'); put(file);
    const variant = path.join(root, 'caserepo');
    const store = new GraphStore([{ file, repo }]);
    if (existsSync(variant)) {
      assert.equal(store.get(variant), store.get(repo));
      assert.throws(() => new GraphStore([{ file, repo }, { file, repo: variant }]), /distinct/);
    } else {
      assert.throws(() => store.get(variant), GraphAccessError);
    }
  });
});

describe('atomic graph publication', () => {
  it('publishes JSON and gzip and leaves no partial files, including after a failed rename', () => {
    const repo = dir();
    const doc = document() as AtlasDocument;
    for (const name of ['graph.json', 'graph.json.gz']) {
      const file = path.join(repo, name);
      writeGraph(doc, file);
      if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o077, 0);
      const old = statSync(file).ino;
      writeGraph({ ...doc, source: { ...doc.source, sha: 'b'.repeat(40) } }, file);
      assert.notEqual(statSync(file).ino, old);
      if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o077, 0);
      assert.equal(new GraphStore([{ file }]).get().graph.doc.source.sha, 'b'.repeat(40));
    }
    const blocked = path.join(repo, 'directory');
    mkdirSync(blocked);
    assert.throws(() => writeGraph(doc, blocked));
    assert.ok(statSync(blocked).isDirectory());
    assert.equal(readdirSync(repo).some((n) => n.endsWith('.partial')), false);
  });
});

describe('HTTP token', () => {
  it('generates a private persistent token and refuses symlinks, loose permissions and malformed files', () => {
    const d = dir(), file = path.join(d, 'private', 'token');
    assert.ok(path.isAbsolute(defaultTokenFile()));
    const token = httpToken(file);
    assert.match(token, /^[a-f0-9]{64}$/);
    assert.equal(httpToken(file), token);
    assert.equal(readFileSync(file, 'utf8').trim(), token);
    if (process.platform !== 'win32') {
      assert.equal(statSync(file).mode & 0o077, 0);
      chmodSync(file, 0o644);
      assert.throws(() => httpToken(file), /chmod 600/);
      chmodSync(file, 0o600);
      const link = path.join(d, 'link'); symlinkSync(file, link);
      assert.throws(() => httpToken(link), /regular file/);
    }
    writeFileSync(file, 'x'.repeat(1025));
    assert.throws(() => httpToken(file), /too large/);
    writeFileSync(file, 'short');
    assert.throws(() => httpToken(file), /32–256/);
    assert.throws(() => httpToken(path.join(file, 'impossible')), /ENOTDIR|EEXIST/);
  });
});

const TOKEN = 't'.repeat(64);
const HEADERS = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } };
const info = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'graph_info' } };

async function start(targets = [fresh()]) {
  const store = new GraphStore(targets);
  const server = createAtlasHttpServer(store, TOKEN);
  const port = await listenAtlasHttp(server, 0);
  const send = async (payload: unknown = info, opts: { route?: string; method?: string; headers?: Record<string, string>; raw?: string } = {}) => {
    return await new Promise<{ status: number; headers: Headers; text: string; data: any }>((resolve, reject) => {
      // Node fetch normalizes Host; use a raw HTTP client so the DNS-rebinding checks are really exercised.
      const req = request({ hostname: '127.0.0.1', port, agent: false, path: opts.route ?? '/mcp', method: opts.method ?? 'POST',
        headers: { ...HEADERS, ...opts.headers } }, (res) => {
        let text = '';
        res.setEncoding('utf8'); res.on('data', (chunk) => { text += chunk; });
        res.on('end', () => {
          const headers = new Headers();
          for (const [key, value] of Object.entries(res.headers)) if (value !== undefined) headers.set(key, String(value));
          resolve({ status: res.statusCode!, headers, text, data: text ? JSON.parse(text) : null });
        });
      });
      req.on('error', reject);
      req.end(opts.method === 'GET' ? undefined : opts.raw ?? JSON.stringify(payload));
    });
  };
  const close = () => new Promise<void>((resolve, reject) => {
    server.close((err) => err ? reject(err) : resolve());
    server.closeAllConnections();
  });
  return { store, server, port, send, close, targets };
}

describe('Streamable HTTP', () => {
  it('initializes, lists all tools and accepts notifications without creating protocol sessions', async (t) => {
    const s = await start(); t.after(s.close);
    for (const protocolVersion of [...HTTP_PROTOCOLS, '2024-11-05', 'future']) {
      const r = await s.send({ ...init, params: { protocolVersion } });
      assert.equal(r.status, 200);
      assert.equal(r.data.result.protocolVersion, HTTP_PROTOCOLS.includes(protocolVersion) ? protocolVersion : '2025-06-18');
      assert.equal(r.headers.has('Mcp-Session-Id'), false);
    }
    const listed = await s.send({ ...init, method: 'tools/list' });
    assert.equal(listed.data.result.tools.length, 13);
    const notice = await s.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    assert.equal(notice.status, 202);
    assert.equal(notice.text, '');
    const missing = await s.send({ ...init, method: 'not-a-method' });
    assert.equal(missing.data.error.code, -32601);
    assert.equal((await s.send({ ...info, params: { name: 'missing' } })).data.error.code, -32602);
  });

  it('routes concurrent clients (even identical request ids) to their own repo and reloads only the changed graph', async (t) => {
    const a = fresh(), b = fresh(); put(b.file, 'b'.repeat(40));
    const s = await start([a, b]); t.after(s.close);
    const before = await s.send(null, { route: '/status', method: 'GET' });
    assert.ok(before.data.graphs.every((g: { loaded: boolean }) => !g.loaded));
    const answers = await Promise.all(Array.from({ length: 20 }, (_, i) => s.send(info, { route: `/mcp?repo=${encodeURIComponent(i % 2 ? b.repo : a.repo)}` })));
    answers.forEach((r, i) => {
      assert.equal(r.status, 200); assert.equal(r.data.id, 1);
      assert.ok(r.data.result.content[0].text.includes((i % 2 ? 'b' : 'a').repeat(40)));
    });
    put(a.file, 'c'.repeat(40));
    const changed = await s.send(info, { route: `/mcp?repo=${encodeURIComponent(a.repo)}` });
    assert.ok(changed.data.result.content[0].text.includes('c'.repeat(40)));
    const status = await s.send(null, { route: '/status', method: 'GET' });
    assert.deepEqual(status.data.graphs.map((g: { generation: number }) => g.generation), [2, 1]);
    assert.equal((await s.send()).status, 403);
    assert.equal((await s.send(info, { route: `/mcp?repo=${encodeURIComponent(root)}` })).status, 403);
  });

  it('initializes before the first build, fails tool calls with 503 until a graph is published, and still refuses unknown repos', async (t) => {
    const target = fresh(); rmSync(target.file);
    const s = await start([target]); t.after(s.close);
    assert.equal((await s.send(init)).data.result.protocolVersion, '2025-06-18');
    assert.equal((await s.send({ jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
    assert.equal((await s.send({ ...init, method: 'tools/list' })).data.result.tools.length, 13);
    assert.equal((await s.send({ ...init, method: 'ping' })).status, 200);
    const missing = await s.send();
    assert.equal(missing.status, 503);
    assert.match(missing.data.error.message, /graph unavailable/);
    assert.equal((await s.send(init, { route: `/mcp?repo=${encodeURIComponent(root)}` })).status, 403);
    put(target.file, 'e'.repeat(40));
    assert.ok((await s.send()).data.result.content[0].text.includes('e'.repeat(40)));
    const graphless = handleGraphlessMessage(info) as { result: { isError: boolean; content: { text: string }[] } };
    assert.equal(graphless.result.isError, true);
    assert.match(graphless.result.content[0].text, /no graph is loaded/);
  });

  it('resolves a relative base_graph in the selected repo, not the server directory', async (t) => {
    const a = fresh(), b = fresh();
    for (const { repo } of [a, b]) put(path.join(repo, 'base.json.gz'));
    const s = await start([a, b]); t.after(s.close);
    const impact = { ...info, params: { name: 'signature_impact', arguments: { fn: 'demo/target', base_graph: 'base.json.gz' } } };
    for (const { repo } of [a, b]) {
      const text = (await s.send(impact, { route: `/mcp?repo=${encodeURIComponent(repo)}` })).data.result.content[0].text;
      assert.doesNotMatch(text, /no such file|outside the graph directory/);
      assert.match(text, /^SIGNATURE_IMPACT demo\/target/);
    }
    assert.equal(s.store.get(b.repo).options.baseDir, realpathSync.native(b.repo));
  });

  it('fails new queries on invalid graph replacement and recovers without reconnecting', async (t) => {
    const s = await start(); t.after(s.close);
    assert.equal((await s.send()).status, 200);
    writeFileSync(s.targets[0].file, 'partial gzip');
    const failed = await s.send();
    assert.equal(failed.status, 503);
    assert.match(failed.data.error.message, /graph unavailable/);
    put(s.targets[0].file, 'd'.repeat(40));
    assert.ok((await s.send()).data.result.content[0].text.includes('d'.repeat(40)));
  });

  it('protects both endpoints with token, exact Host and same-server Origin checks', async (t) => {
    const s = await start(); t.after(s.close);
    for (const route of ['/mcp', '/status']) {
      const opts = { route, ...(route === '/status' ? { method: 'GET' } : {}) };
      for (const Authorization of ['', 'Bearer wrong', `Bearer ${'x'.repeat(64)}`]) {
        const r = await s.send(info, { ...opts, headers: { Authorization } });
        assert.equal(r.status, 401); assert.ok(r.headers.get('www-authenticate'));
      }
      const rejectedHeaders: Record<string, string>[] = [{ Host: `evil.example:${s.port}` }, { Origin: 'https://evil.example' }, { Origin: 'null' },
        { Origin: 'http://localhost:1' }, { Host: 'localhost' }];
      for (const headers of rejectedHeaders) {
        assert.equal((await s.send(info, { ...opts, headers })).status, 403);
      }
    }
    assert.equal((await s.send(info, { headers: { Host: `localhost:${s.port}`, Origin: `http://localhost:${s.port}` } })).status, 200);
    assert.throws(() => createAtlasHttpServer(s.store, 'short'), /bearer token/);
    const other = createAtlasHttpServer(s.store, TOKEN);
    await assert.rejects(listenAtlasHttp(other, s.port), /EADDRINUSE/);
  });

  it('handles malformed requests, unsupported versions/methods and oversized bodies', async (t) => {
    const s = await start(); t.after(s.close);
    const cases: [Parameters<typeof s.send>[1], number][] = [
      [{ route: '/missing' }, 404], [{ method: 'GET' }, 405], [{ method: 'DELETE' }, 405],
      [{ route: '/mcp?repo=a&repo=b' }, 400], [{ route: '/mcp?graph=/etc/passwd' }, 400],
      [{ headers: { 'Content-Type': 'text/plain' } }, 415], [{ headers: { Accept: 'application/json' } }, 406],
      [{ headers: { 'MCP-Protocol-Version': '2026-07-28' } }, 400], [{ raw: '{' }, 400],
      [{ raw: 'null' }, 400], [{ raw: '[1,2]' }, 400], [{ raw: '42' }, 400],
      [{ raw: '{}', headers: { 'Content-Length': String(MAX_HTTP_BODY + 1) } }, 413],
    ];
    for (const [opts, status] of cases) assert.equal((await s.send(info, opts)).status, status, JSON.stringify(opts).slice(0, 150));
    for (const payload of [{ ...init, id: {} }, { ...init, id: null }, { ...init, jsonrpc: '1.0' },
      { ...init, method: 4 }, { ...init, params: null }, { ...init, params: [] }, { ...init, params: 5 }]) {
      assert.equal((await s.send(payload)).status, 400);
    }
    const chunked = await new Promise<number | undefined>((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port: s.port, agent: false, path: '/mcp', method: 'POST', headers: HEADERS }, (res) => {
        res.resume(); res.on('end', () => resolve(res.statusCode));
      });
      req.on('error', reject);
      req.write('x'.repeat(MAX_HTTP_BODY)); req.end('x');
    });
    assert.equal(chunked, 413);
    assert.equal((await s.send()).status, 200, 'bad requests leave the server usable');
  });
});
