import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { componentOf, listFiles } from '../src/build/files.ts';
import { MCP_ENTRY, withMcpEntry } from '../src/cli.ts';
import { coverageTable, type CoverageRow } from '../src/coverage.ts';

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
      'node_modules/x/y.clj', 'target/t.clj', 'out/o.cljs', '.cpcache/c.clj', 'src/.hidden.edn']) put(f);
    put('src/huge.clj', 'x'.repeat(2 * 1024 * 1024 + 1));
    try {
      assert.deepEqual(listFiles(root), {
        sources: ['src/a.clj', 'src/b.cljs', 'src/c.cljc'], edn: ['mod/deps.edn', 'resources/system.edn'],
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
      repo: 'demo', sha: 'a', files: 3, syntaxErrorFiles: 0, definitions: 9, resolved: 19, unresolved: 1, unknown: 0, resolvedPct: 95,
      adapters: { events: 2 }, nodes: 10, edges: 20, unknownEdges: 1, buildMs: 1500, graphBytes: 2048,
    };
    const lines = coverageTable([row]).split('\n');
    assert.equal(lines.length, 3);
    assert.equal(lines[2], '| demo | 3 | 0 | 9 | 19 | 1 | 0 | 95.0% | 2 | 1 | 1.5 s | 2 KB |');
  });
});
