// The command line as a user runs it: one node process per command, against a fixture copied into a git checkout.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';
import { fixtureDir } from './helpers/atlas-fixture.ts';

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.ts');
const work = mkdtempSync(path.join(tmpdir(), 'atlas-cli-'));
after(() => rmSync(work, { recursive: true, force: true }));

const run = (args: string[], opts: { cwd?: string; input?: string; env?: Record<string, string> } = {}) => {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd: opts.cwd ?? work, input: opts.input ?? '', encoding: 'utf8', env: { ...process.env, ...opts.env } });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

const repo = path.join(work, 'repo');
cpSync(fixtureDir('core'), repo, { recursive: true });
const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' }).trim();
git('init', '-q');
git('add', '.');
git('commit', '-qm', 'one');
const graph = path.join(repo, '.clojure-atlas', 'graph.json.gz');

describe('clojure-atlas command line', () => {
  it('build writes the graph and prints the resolution rate with the raw counts', () => {
    const r = run(['build', repo]);
    assert.equal(r.code, 0, r.err);
    assert.ok(existsSync(graph));
    assert.match(r.err, /\d+ files, \d+ definitions, \d+ nodes, \d+ edges; resolution rate of var usages in recognized project namespaces \d+\.\d% \(\d+ of \d+\), \d+ usages in an unknown namespace; .* -> /);
  });

  it('build -o writes where it is told', () => {
    const out = path.join(work, 'elsewhere', 'g.json');
    assert.equal(run(['build', repo, '-o', out]).code, 0);
    assert.equal(JSON.parse(readFileSync(out, 'utf8')).format, 'code-graph');
  });

  it('coverage prints the table row and the most frequent misses', () => {
    const r = run(['coverage', graph]);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^\| repo \| files expected \| files analyzed \|/);
    assert.match(r.out, /\n\| repo \| \d+ \| \d+ \| 0 \|/);
    assert.match(r.out, /most frequent unknown: /);
  });

  it('init shows the .mcp.json first and writes it only with --yes', () => {
    const shown = run(['init'], { cwd: repo });
    assert.match(shown.out, /\.mcp\.json would become:\n\{\n {2}"mcpServers"/);
    assert.equal(existsSync(path.join(repo, '.mcp.json')), false);
    const written = run(['init', '--yes'], { cwd: repo });
    assert.match(written.out, /^wrote \.mcp\.json/);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(path.join(repo, '.mcp.json'), 'utf8')).mcpServers), ['clojure-atlas']);
  });

  it('mcp answers over stdio and reports the commit distance and the working tree against the graph', () => {
    git('add', '.');
    git('commit', '-qm', 'two');
    const head = git('rev-parse', 'HEAD');
    const input = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'graph_info', arguments: { base: head } } },
    ].map((m) => JSON.stringify(m)).join('\n');
    const r = run(['mcp', '--graph', graph, '--repo', repo], { input: `${input}\n` });
    assert.equal(r.code, 0, r.err);
    const answers = r.out.trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(answers.map((a) => a.id), [1, 2]);
    const text = answers[1].result.content[0].text as string;
    assert.match(text, /^STALE: the working tree is not the snapshot this graph describes \(commit /);
    assert.match(text, /\n.*1 commit/);
  });

  it('prints the usage: exit 0 when asked, 2 for a usage error, 1 with the reason on an error', () => {
    assert.deepEqual([run([]).code, run(['--help']).code], [0, 0]);
    assert.match(run(['--help']).out, /^usage:\n {2}clojure-atlas build/);
    const bad = run(['frobnicate']);
    assert.equal(bad.code, 2);
    assert.match(bad.err, /^clojure-atlas: unknown command frobnicate\nusage:\n {2}clojure-atlas build/);
    assert.equal(run(['build', '.', '-o']).code, 2);
    assert.equal(run(['mcp', '--max-distance', '5abc']).code, 2);
    const missing = run(['coverage', path.join(work, 'none.json')]);
    assert.equal(missing.code, 1);
    assert.match(missing.err, /^clojure-atlas: no graph at .*none\.json; run `clojure-atlas build` first/);
  });

  it('--version prints the package version, and build --help builds nothing', () => {
    const v = run(['--version']);
    assert.equal(v.code, 0);
    assert.equal(v.out.trim(), JSON.parse(readFileSync(path.join(path.dirname(cli), '..', 'package.json'), 'utf8')).version);
    const dir = path.join(work, 'helpless');
    mkdirSync(dir);
    assert.equal(run(['build', '--help'], { cwd: dir }).code, 0);
    assert.equal(existsSync(path.join(dir, '.clojure-atlas')), false);
  });

  it('says what is wrong for a missing graph, a garbage graph, a missing directory, a directory as output and a broken .mcp.json', () => {
    const mcp = run(['mcp', '--graph', path.join(work, 'none.gz')]);
    assert.equal(mcp.code, 1);
    assert.match(mcp.err, /no graph at .*none\.gz; run `clojure-atlas build` first/);
    const garbage = path.join(work, 'garbage.gz');
    writeFileSync(garbage, 'garbage');
    assert.match(run(['coverage', garbage]).err, /garbage\.gz is not a readable graph .*run `clojure-atlas build` again/);
    assert.match(run(['build', path.join(work, 'nope')]).err, /nope is not a directory/);
    assert.match(run(['build', repo, '-o', work]).err, /is a directory; name the graph file/);
    const dir = path.join(work, 'badmcp');
    mkdirSync(dir);
    writeFileSync(path.join(dir, '.mcp.json'), 'null');
    const init = run(['init', '--yes'], { cwd: dir });
    assert.equal(init.code, 1);
    assert.match(init.err, /^clojure-atlas: \.mcp\.json is not a JSON object/);
  });

  it('mcp --repo needs no clj-kondo: the analyzer comes from the graph', () => {
    const cache = path.join(work, 'empty-cache');
    mkdirSync(cache);
    const r = run(['mcp', '--graph', graph, '--repo', repo], {
      input: `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`,
      env: { XDG_CACHE_HOME: cache, LOCALAPPDATA: cache, PATH: path.dirname(process.execPath) },
    });
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(readdirSync(cache), []);
  });
});
