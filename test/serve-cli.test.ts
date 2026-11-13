import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, it, type TestContext } from 'node:test';
import { GraphBuilder } from './helpers/code-graph-fixture.ts';

const root = mkdtempSync(path.join(tmpdir(), 'atlas-serve-cli-'));
after(() => rmSync(root, { recursive: true, force: true }));
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const graph = path.join(root, 'graph.json');
writeFileSync(graph, JSON.stringify(new GraphBuilder().doc()));

async function launch(t: TestContext, args: string[]) {
  const cache = path.join(root, 'cache');
  const child = spawn(process.execPath, [cli, 'serve', '--port', '0', ...args], {
    cwd: root, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, XDG_CACHE_HOME: cache, LOCALAPPDATA: cache },
  });
  const exited = new Promise<number | null>((resolve) => child.once('exit', resolve));
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill(); await exited; });
  let output = '';
  const ready = await new Promise<{ port: number; tokenFile: string }>((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error(`serve startup timed out: ${output}`)); }, 10_000);
    child.once('error', (err) => { clearTimeout(timeout); reject(err); });
    child.once('exit', () => { clearTimeout(timeout); reject(new Error(`serve exited before startup: ${output}`)); });
    child.stderr.on('data', (b: Buffer) => {
      output += b.toString();
      const port = /serving http:\/\/127\.0\.0\.1:(\d+)\/mcp/.exec(output)?.[1];
      const tokenFile = /Bearer token file: (.+) \(keep private/.exec(output)?.[1];
      if (port && tokenFile) { clearTimeout(timeout); resolve({ port: Number(port), tokenFile }); }
    });
  });
  return { child, exited, output: () => output, ...ready };
}

it('serve works from a packed-style CLI invocation, keeps its token private, and shuts down cleanly', { timeout: 20_000 }, async (t) => {
  const s = await launch(t, ['--graph', graph]);
  const token = readFileSync(s.tokenFile, 'utf8').trim();
  assert.ok(!s.output().includes(token), 'the token itself must never be logged');
  const r = await fetch(`http://127.0.0.1:${s.port}/mcp`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/list' }),
  });
  assert.equal(r.status, 200);
  assert.equal((await r.json() as { result: { tools: unknown[] } }).result.tools.length, 13);
  s.child.kill('SIGTERM');
  assert.equal(await s.exited, 0);
});

it('serve registers default or multiple repo paths without requiring their graphs to exist yet', { timeout: 20_000 }, async (t) => {
  const a = path.join(root, 'a'), b = path.join(root, 'b'); mkdirSync(a); mkdirSync(b);
  for (const args of [[], ['--repo', a, '--repo', b, '--token-file', path.join(root, 'another-token')], ['--repo', a, '--graph', graph]]) {
    const s = await launch(t, args);
    const token = readFileSync(s.tokenFile, 'utf8').trim();
    const r = await fetch(`http://127.0.0.1:${s.port}/status`, { headers: { Authorization: `Bearer ${token}` } });
    const status = await r.json() as { graphs: { repo: string; loaded: boolean }[] };
    assert.equal(status.graphs.length, args.includes(b) ? 2 : 1);
    assert.ok(status.graphs.every((g) => !g.loaded && path.isAbsolute(g.repo)));
    s.child.kill('SIGINT'); assert.equal(await s.exited, 0);
  }
});
