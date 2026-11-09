// Entry point: node graph-mcp/src/main.ts --graph <code-graph.json[.gz]> [--repo <clone>] [--max-distance N]
// Loads the graph once, then serves MCP over stdio. Nothing but the graph file (and, for staleness, a
// read-only `git rev-list` in --repo) is ever read.
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGraph } from './graph.ts';
import { serveStdio } from './server.ts';

export function parseArgs(argv: string[]): { graph: string; repo?: string; maxDistance?: number } {
  const get = (flag: string, env: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : process.env[env];
  };
  const graph = get('--graph', 'CODE_GRAPH');
  if (!graph) throw new Error('usage: main.ts --graph <code-graph.json[.gz]> [--repo <clone>] [--max-distance N] (or CODE_GRAPH=...)');
  const repo = get('--repo', 'CODE_GRAPH_REPO');
  const md = get('--max-distance', 'CODE_GRAPH_MAX_DISTANCE');
  const maxDistance = md === undefined ? undefined : Number.parseInt(md, 10);
  if (maxDistance !== undefined && !(maxDistance >= 0)) throw new Error(`--max-distance must be a non-negative integer, got ${md}`);
  return { graph, ...(repo ? { repo } : {}), ...(maxDistance !== undefined ? { maxDistance } : {}) };
}

const invokedDirectly = !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  try {
    const a = parseArgs(process.argv.slice(2));
    const g = loadGraph(a.graph);
    process.stderr.write(`code-graph: ${g.doc.nodes.length} nodes, ${g.doc.edges.length} edges at ${g.doc.source.sha.slice(0, 10)}\n`);
    serveStdio(g, { repoDir: a.repo, maxDistance: a.maxDistance, graphDir: path.dirname(a.graph) });
  } catch (err) {
    process.stderr.write(`code-graph: ${(err as Error).message}\n`);
    process.exit(1);
  }
}
