import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { componentOf, listFiles } from '../src/build/files.ts';
import { coverageRow, coverageTable, type CoverageRow } from '../src/coverage.ts';
import { MCP_ENTRY, parseCommand, UsageError, withMcpEntry } from '../src/cli.ts';
import { readFileSync } from 'node:fs';
import { VERSION } from '../src/version.ts';

describe('init', () => {
  it('adds the server to a new .mcp.json', () => {
    assert.deepEqual(JSON.parse(withMcpEntry(undefined)), { mcpServers: { 'clojure-atlas': MCP_ENTRY } });
  });
  it('keeps the servers and fields already there', () => {
    const before = JSON.stringify({ mcpServers: { other: { command: 'x' } }, extra: 1 });
    assert.deepEqual(JSON.parse(withMcpEntry(before)), { mcpServers: { other: { command: 'x' }, 'clojure-atlas': MCP_ENTRY }, extra: 1 });
  });
});

describe('mcp entry', () => {
  it('serves the default graph with staleness checked against the project repo', () => {
    assert.deepEqual(MCP_ENTRY, { command: 'npx', args: ['clojure-atlas', 'mcp', '--graph', '.clojure-atlas/graph.json.gz', '--repo', '.'] });
  });
});

describe('files', () => {
  it('lists sources and edn, skips build output, dependencies, hidden dirs, project.clj and large files', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'atlas-files-'));
    const put = (rel: string, body = '(ns x)') => {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      writeFileSync(path.join(root, rel), body);
    };
    for (const f of ['src/a.clj', 'src/b.cljs', 'src/c.cljc', 'resources/system.edn', 'mod/deps.edn', 'project.clj',
      'node_modules/x/y.clj', 'target/t.clj', 'out/o.cljs', '.cpcache/c.clj', 'src/.hidden.edn', 'e2e/login.ts', 'e2e/types.d.ts', 'e2e/package.json']) put(f);
    put('src/huge.clj', 'x'.repeat(2 * 1024 * 1024 + 1));
    try {
      assert.deepEqual(listFiles(root), {
        sources: ['src/a.clj', 'src/b.cljs', 'src/c.cljc'], edn: ['mod/deps.edn', 'resources/system.edn'], typescript: ['e2e/login.ts'], packageJsons: ['e2e/package.json'],
        moduleRoots: ['', 'mod'], skippedLarge: ['src/huge.clj'],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('components', () => {
  it('names a file by its innermost module root; the repo root names none', () => {
    const roots = ['', 'components/user', 'components/user/sub'];
    assert.equal(componentOf(roots, 'components/user/src/u.clj'), 'components/user');
    assert.equal(componentOf(roots, 'components/user/sub/src/s.clj'), 'components/user/sub');
    assert.equal(componentOf(roots, 'src/main.clj'), undefined);
  });
});

describe('coverage table', () => {
  it('prints one row per repo with every adapter column', () => {
    const row: CoverageRow = {
      repo: 'demo', sha: 'a', filesExpected: 4, files: 3, syntaxErrorFiles: 0, definitions: 9, resolved: 19, unresolved: 1, unknown: 2, resolutionRate: 95,
      adapters: { events: 2 }, nodes: 10, edges: 20, unknownEdges: 1, droppedEdges: 0, buildMs: 1500, graphBytes: 2048,
    };
    const lines = coverageTable([row]).split('\n');
    assert.equal(lines.length, 3);
    assert.equal(lines[2], '| demo | 4 | 3 | 0 | 9 | 19 | 1 | 95.0% | 2 | 2 | 1 | 0 | 1.5 s | 2 KB |');
  });

  it('shows n/a, not 100%, for a repo whose usages never reached a project namespace', () => {
    const doc = { source: { repo_name: 'bare', sha: 'a' }, stats: { files: { expected: 1, sources: 1 }, syntax_errors: { files: 0 }, definitions: 1, usages: { resolved: 0, unresolved: 0, unknown: 0 }, adapters: {} }, capabilities: [], nodes: [], edges: [] };
    const row = coverageRow(doc as unknown as Parameters<typeof coverageRow>[0], 10);
    assert.equal(row.resolutionRate, null);
    assert.match(coverageTable([row]), /\| 0 \| 0 \| n\/a \| 0 \|/);
  });
});

describe('version', () => {
  it('is the package.json version', () => {
    assert.equal(VERSION, JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
  });
});

describe('command line parsing', () => {
  it('reads each command with its defaults', () => {
    assert.deepEqual(parseCommand(['build']), { cmd: 'build', dir: '.' });
    assert.deepEqual(parseCommand(['build', 'x', '-o', 'g.gz']), { cmd: 'build', dir: 'x', out: 'g.gz' });
    assert.deepEqual(parseCommand(['coverage']), { cmd: 'coverage', graph: '.clojure-atlas/graph.json.gz' });
    assert.deepEqual(parseCommand(['init', '--yes']), { cmd: 'init', yes: true });
    assert.deepEqual(parseCommand(['init']), { cmd: 'init', yes: false });
  });

  it('answers help and version before anything else is looked at', () => {
    for (const argv of [[], ['--help'], ['-h'], ['build', '--help'], ['build', '-h'], ['mcp', '--bogus', '-h'], ['frobnicate', '--help']]) assert.deepEqual(parseCommand(argv), { cmd: 'help' });
    assert.deepEqual(parseCommand(['--version']), { cmd: 'version' });
    assert.deepEqual(parseCommand(['build', '--version']), { cmd: 'version' });
  });

  it('rejects unknown commands and options, missing values, stray arguments and bad numbers', () => {
    const bad: [string[], RegExp][] = [
      [['frobnicate'], /unknown command frobnicate/],
      [['build', '.', '-o'], /-o needs a value/],
      [['build', '-o', '--x'], /-o needs a value/],
      [['mcp', '--repo', '--graph', 'x'], /--repo needs a value/],
      [['mcp', '--graph'], /--graph needs a value/],
      [['mcp', '--outt', 'x'], /unknown option --outt/],
      [['build', '--outt', 'x'], /unknown option --outt/],
      [['build', 'a', 'b'], /unexpected argument b/],
      [['mcp', 'stray'], /unexpected argument stray/],
      [['coverage', 'a', 'b'], /unexpected argument b/],
      [['init', '--yes', 'x'], /unexpected argument x/],
      [['mcp', '--max-distance', '5abc'], /non-negative integer, got 5abc/],
      [['mcp', '--max-distance', '1.9'], /non-negative integer, got 1\.9/],
      [['mcp', '--max-distance', '-1'], /--max-distance needs a value/],
    ];
    for (const [argv, why] of bad) assert.throws(() => parseCommand(argv), (e) => e instanceof UsageError && why.test(e.message), argv.join(' '));
  });

  it('refuses a .mcp.json it cannot extend, naming the file', () => {
    for (const bad of ['null', '[]', '3', '{bad', '{"mcpServers":[]}', '{"mcpServers":null}']) assert.throws(() => withMcpEntry(bad), /^Error: \.mcp\.json/, bad);
  });
});
