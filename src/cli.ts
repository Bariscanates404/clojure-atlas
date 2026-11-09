#!/usr/bin/env node
// clojure-atlas build | mcp | coverage | init: the command line over the builder and the MCP server.
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import type { AtlasDocument } from './build/assemble.ts';
import { buildGraph, DEFAULT_GRAPH, writeGraph } from './build/index.ts';
import { coverageRow, coverageTable } from './coverage.ts';
import { loadGraph } from './mcp/graph.ts';
import { serveStdio } from './mcp/server.ts';
import { kondo } from './build/kondo-binary.ts';
import { analyzerVersion, snapshotOf } from './snapshot.ts';

const USAGE = `usage:
  clojure-atlas build [dir] [-o ${DEFAULT_GRAPH}]
  clojure-atlas mcp [--graph ${DEFAULT_GRAPH}] [--repo <clone>] [--max-distance N]
  clojure-atlas coverage [graph]
  clojure-atlas init [--yes]`;

const flag = (argv: string[], name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const positional = (argv: string[], valued: readonly string[]): string[] =>
  argv.filter((a, i) => !a.startsWith('-') && !valued.includes(argv[i - 1] ?? ''));

export function parseMcpArgs(argv: string[]): { graph: string; repo?: string; maxDistance?: number } {
  const graph = flag(argv, '--graph') ?? DEFAULT_GRAPH;
  const repo = flag(argv, '--repo');
  const md = flag(argv, '--max-distance');
  const maxDistance = md === undefined ? undefined : Number.parseInt(md, 10);
  if (maxDistance !== undefined && !(maxDistance >= 0)) throw new Error(`--max-distance must be a non-negative integer, got ${md}`);
  return { graph, ...(repo ? { repo } : {}), ...(maxDistance !== undefined ? { maxDistance } : {}) };
}

export const MCP_ENTRY = {
  command: 'npx',
  args: ['clojure-atlas', 'mcp', '--graph', DEFAULT_GRAPH, '--repo', '.'],
};

// The project .mcp.json with the clojure-atlas server added; other servers are kept as they are.
export function withMcpEntry(existing: string | undefined): string {
  const doc = existing ? (JSON.parse(existing) as { mcpServers?: Record<string, unknown> }) : {};
  return `${JSON.stringify({ ...doc, mcpServers: { ...(doc.mcpServers ?? {}), 'clojure-atlas': MCP_ENTRY } }, null, 2)}\n`;
}

function readDocument(file: string): AtlasDocument {
  const bytes = readFileSync(file);
  const text = (file.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8');
  return JSON.parse(text) as AtlasDocument;
}

async function main(argv: string[]): Promise<void> {
  const [cmd, ...rest] = argv;
  if (cmd === 'build') {
    const dir = positional(rest, ['-o'])[0] ?? '.';
    const out = flag(rest, '-o') ?? path.join(dir, DEFAULT_GRAPH);
    const doc = await buildGraph(dir);
    writeGraph(doc, out);
    const row = coverageRow(doc, statSync(out).size);
    process.stderr.write(`clojure-atlas: ${row.files} files, ${row.definitions} definitions, ${row.nodes} nodes, ${row.edges} edges; `
      + `${row.resolvedPct.toFixed(1)}% of project var usages resolved; ${(row.buildMs / 1000).toFixed(1)} s -> ${out}\n`);
    return;
  }
  if (cmd === 'mcp') {
    const a = parseMcpArgs(rest);
    const g = loadGraph(a.graph);
    process.stderr.write(`clojure-atlas: ${g.doc.nodes.length} nodes, ${g.doc.edges.length} edges at ${g.doc.source.sha.slice(0, 10)}\n`);
    const repo = a.repo;
    const analyzer = repo ? analyzerVersion((await kondo()).version) : '';
    serveStdio(g, {
      repoDir: repo, maxDistance: a.maxDistance, graphDir: path.dirname(a.graph),
      ...(repo ? { snapshot: () => snapshotOf(repo, analyzer) } : {}),
    });
    return;
  }
  if (cmd === 'coverage') {
    const file = positional(rest, [])[0] ?? DEFAULT_GRAPH;
    const doc = readDocument(file);
    process.stdout.write(`${coverageTable([coverageRow(doc, statSync(file).size)])}\n`);
    const u = doc.stats.usages;
    if (u.topUnresolved.length) process.stdout.write(`\nmost frequent unresolved: ${u.topUnresolved.map(([n, k]) => `${n} (${k})`).join(', ')}\n`);
    if (u.topUnknown.length) process.stdout.write(`most frequent unknown: ${u.topUnknown.map(([n, k]) => `${n} (${k})`).join(', ')}\n`);
    return;
  }
  if (cmd === 'init') {
    const file = '.mcp.json';
    const next = withMcpEntry(existsSync(file) ? readFileSync(file, 'utf8') : undefined);
    if (!rest.includes('--yes')) {
      process.stdout.write(`${file} would become:\n${next}\nrun \`clojure-atlas init --yes\` to write it, then \`clojure-atlas build\`\n`);
      return;
    }
    writeFileSync(file, next);
    process.stdout.write(`wrote ${file}; run \`clojure-atlas build\` to create ${DEFAULT_GRAPH}\n`);
    return;
  }
  process.stderr.write(`${USAGE}\n`);
  process.exitCode = cmd === undefined || cmd === '--help' || cmd === '-h' ? 0 : 2;
}

const invokedDirectly = !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    process.stderr.write(`clojure-atlas: ${(err as Error).message}\n`);
    process.exit(1);
  });
}
