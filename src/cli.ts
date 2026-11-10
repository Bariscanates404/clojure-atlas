#!/usr/bin/env node
// clojure-atlas build | mcp | coverage | init: the command line over the builder and the MCP server.
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AtlasDocument } from './build/assemble.ts';
import { degradation, degradedLine } from './mcp/degraded.ts';
import { buildGraph, DEFAULT_GRAPH, writeGraph } from './build/index.ts';
import { coverageRow, coverageTable, pct } from './coverage.ts';
import { GraphFormatError, loadGraph, type Graph } from './mcp/graph.ts';
import { serveStdio } from './mcp/server.ts';
import { analyzerFor, cachedSnapshot, SNAPSHOT_TTL_MS, snapshotOf } from './snapshot.ts';
import { VERSION } from './version.ts';
import { shortSha } from './shared/sha.ts';

const USAGE = `usage:
  clojure-atlas build [dir] [-o ${DEFAULT_GRAPH}]
  clojure-atlas mcp [--graph ${DEFAULT_GRAPH}] [--repo <clone>] [--max-distance N]
  clojure-atlas coverage [graph]
  clojure-atlas init [--yes]`;

export class UsageError extends Error {}

export type Command =
  | { cmd: 'help' }
  | { cmd: 'version' }
  | { cmd: 'build'; dir: string; out?: string }
  | { cmd: 'mcp'; graph: string; repo?: string; maxDistance?: number }
  | { cmd: 'coverage'; graph: string }
  | { cmd: 'init'; yes: boolean };

const VALUED: Record<string, readonly string[]> = { build: ['-o'], mcp: ['--graph', '--repo', '--max-distance'], coverage: [], init: [] };
const SWITCHES: Record<string, readonly string[]> = { build: [], mcp: [], coverage: [], init: ['--yes'] };
const MAX_POSITIONAL: Record<string, number> = { build: 1, mcp: 0, coverage: 1, init: 0 };

// The command line as data. `--help`, `-h` and `--version` win over everything else; an unknown command or flag, a
// flag without its value, a stray argument and a malformed number are usage errors, never guesses.
export function parseCommand(argv: string[]): Command {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) return { cmd: 'help' };
  if (argv.includes('--version')) return { cmd: 'version' };
  const [cmd, ...rest] = argv;
  if (!(cmd in VALUED)) throw new UsageError(`unknown command ${cmd}`);
  const values = new Map<string, string>();
  const switches = new Set<string>();
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (VALUED[cmd].includes(a)) {
      const v = rest[++i];
      if (v === undefined || v.startsWith('-')) throw new UsageError(`${a} needs a value`);
      values.set(a, v);
    } else if (SWITCHES[cmd].includes(a)) switches.add(a);
    else if (a.startsWith('-')) throw new UsageError(`unknown option ${a} for ${cmd}`);
    else positional.push(a);
  }
  if (positional.length > MAX_POSITIONAL[cmd]) throw new UsageError(`unexpected argument ${positional[MAX_POSITIONAL[cmd]]} for ${cmd}`);
  if (cmd === 'build') return { cmd, dir: positional[0] ?? '.', ...(values.has('-o') ? { out: values.get('-o') } : {}) };
  if (cmd === 'coverage') return { cmd, graph: positional[0] ?? DEFAULT_GRAPH };
  if (cmd === 'init') return { cmd, yes: switches.has('--yes') };
  const md = values.get('--max-distance');
  if (md !== undefined && !/^\d+$/.test(md)) throw new UsageError(`--max-distance must be a non-negative integer, got ${md}`);
  const repo = values.get('--repo');
  return { cmd: 'mcp', graph: values.get('--graph') ?? DEFAULT_GRAPH, ...(repo ? { repo } : {}), ...(md !== undefined ? { maxDistance: Number(md) } : {}) };
}

export const MCP_ENTRY = {
  command: 'npx',
  args: ['clojure-atlas', 'mcp', '--graph', DEFAULT_GRAPH, '--repo', '.'],
};

// The project .mcp.json with the clojure-atlas server added; other servers are kept as they are.
export function withMcpEntry(existing: string | undefined): string {
  let doc: { mcpServers?: unknown } = {};
  if (existing !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(existing);
    } catch (err) {
      throw new Error(`.mcp.json is not valid JSON (${(err as Error).message}); fix it or move it aside, then run init again`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('.mcp.json is not a JSON object; fix it or move it aside, then run init again');
    }
    doc = parsed;
  }
  const servers = doc.mcpServers;
  if (servers !== undefined && (!servers || typeof servers !== 'object' || Array.isArray(servers))) {
    throw new Error('.mcp.json: "mcpServers" is not an object; fix it, then run init again');
  }
  return `${JSON.stringify({ ...doc, mcpServers: { ...(servers ?? {}), 'clojure-atlas': MCP_ENTRY } }, null, 2)}\n`;
}

function requireGraph(file: string): string {
  if (!existsSync(file)) {
    throw new Error(`no graph at ${file}; run \`clojure-atlas build\` first, or name one with ${file === DEFAULT_GRAPH ? '--graph' : 'the graph argument'}`);
  }
  return file;
}

// The one way the command line loads a graph, for the server and for coverage alike: loadGraph checks the
// format, version and shape, and its complaint gets the way out appended.
function readGraph(file: string): Graph {
  try {
    return loadGraph(requireGraph(file));
  } catch (err) {
    if (err instanceof GraphFormatError) throw new Error(`${err.message}; run \`clojure-atlas build\` again`);
    throw err;
  }
}

function readDocument(file: string): AtlasDocument {
  const doc = readGraph(file).doc as unknown as Partial<AtlasDocument>;
  if (!doc.stats?.usages) throw new Error(`${file} carries no build statistics, so there is no coverage to show; run \`clojure-atlas build\` again`);
  return doc as AtlasDocument;
}

async function build(dir: string, outArg: string | undefined): Promise<void> {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`${dir} is not a directory`);
  const out = outArg ?? path.join(dir, DEFAULT_GRAPH);
  if (statSync(out, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`-o ${out} is a directory; name the graph file`);
  const doc = await buildGraph(dir);
  writeGraph(doc, out);
  const row = coverageRow(doc, statSync(out).size);
  process.stderr.write(`clojure-atlas: ${row.files} files, ${row.definitions} definitions, ${row.nodes} nodes, ${row.edges} edges; `
    + `resolution rate of var usages in recognized project namespaces ${pct(row.resolutionRate)} (${row.resolved} of ${row.resolved + row.unresolved}), `
    + `${row.unknown} usages in an unknown namespace; ${(row.buildMs / 1000).toFixed(1)} s -> ${out}\n`);
  const degraded = degradation(doc);
  if (degraded) process.stderr.write(`clojure-atlas: ${degradedLine(degraded)}\n`);
}

async function main(argv: string[]): Promise<void> {
  const c = parseCommand(argv);
  if (c.cmd === 'help') {
    process.stdout.write(`${USAGE}\n`);
  } else if (c.cmd === 'version') {
    process.stdout.write(`${VERSION}\n`);
  } else if (c.cmd === 'build') {
    await build(c.dir, c.out);
  } else if (c.cmd === 'mcp') {
    const g = readGraph(c.graph);
    process.stderr.write(`clojure-atlas: ${g.doc.nodes.length} nodes, ${g.doc.edges.length} edges at ${shortSha(g.doc.source.sha)}\n`);
    const loaded = degradation(g.doc);
    if (loaded) process.stderr.write(`clojure-atlas: ${degradedLine(loaded)}\n`);
    const repo = c.repo;
    const analyzer = analyzerFor(g.doc.source.analyzer);
    serveStdio(g, {
      repoDir: repo, maxDistance: c.maxDistance, graphDir: path.dirname(c.graph),
      ...(repo ? { snapshot: cachedSnapshot(() => snapshotOf(repo, analyzer), SNAPSHOT_TTL_MS) } : {}),
    });
  } else if (c.cmd === 'coverage') {
    const doc = readDocument(c.graph);
    process.stdout.write(`${coverageTable([coverageRow(doc, statSync(c.graph).size)])}\n`);
    const u = doc.stats.usages;
    if (u.topUnresolved.length) process.stdout.write(`\nmost frequent unresolved: ${u.topUnresolved.map(([n, k]) => `${n} (${k})`).join(', ')}\n`);
    if (u.topUnknown.length) process.stdout.write(`most frequent unknown: ${u.topUnknown.map(([n, k]) => `${n} (${k})`).join(', ')}\n`);
  } else {
    const file = '.mcp.json';
    const next = withMcpEntry(existsSync(file) ? readFileSync(file, 'utf8') : undefined);
    if (!c.yes) {
      process.stdout.write(`${file} would become:\n${next}\nrun \`clojure-atlas init --yes\` to write it, then \`clojure-atlas build\`\n`);
      return;
    }
    writeFileSync(file, next);
    process.stdout.write(`wrote ${file}; run \`clojure-atlas build\` to create ${DEFAULT_GRAPH}\n`);
  }
}

const invokedDirectly = !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    const usage = err instanceof UsageError;
    process.stderr.write(`clojure-atlas: ${(err as Error).message}\n${usage ? `${USAGE}\n` : ''}`);
    process.exit(usage ? 2 : 1);
  });
}
