// Turns a build context into one code-graph document: core rows, then every detected adapter, merged (first node
// per id wins, one edge per site), edges whose ends are not nodes dropped and counted, capabilities with their band
// counts, and the coverage statistics `clojure-atlas coverage` prints.
import { BANDS, FORMAT, VERSION, compareText, type Capability, type GraphDocument, type GraphEdge, type GraphNode, type GraphSource } from '../mcp/graph.ts';
import { core, implementationContainers, type UsageStats } from './core.ts';
import { makeOwner, type Adapter, type Context, type Rows } from './model.ts';

export interface AdapterStats {
  detected: string | null;
  nodes: number;
  edges: number;
}

export interface BuildStats {
  files: { sources: number; edn: number; skipped_large: number };
  syntax_errors: { files: number; errors: number };
  definitions: number;
  usages: UsageStats;
  adapters: Record<string, AdapterStats>;
  dropped_edges: number;
  build_ms?: number;
}

export type AtlasDocument = GraphDocument & { stats: BuildStats };

// Capabilities the MCP tools ask for that a Clojure source analysis does not produce.
const NOT_EXTRACTED = ['route_authz', 'signatures', 'key_flow', 'key_tables', 'selectors', 'browser_tests', 'requests'];

function bandCounts(edges: readonly GraphEdge[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of BANDS) {
    const k = edges.filter((e) => e.band === b).length;
    if (k) out[b] = k;
  }
  return out;
}

const edgeKey = (e: GraphEdge) => `${e.from}\0${e.kind}\0${e.to}\0${e.file}\0${e.line ?? 0}`;

export function assemble(ctx: Context, adapters: readonly Adapter[], source: GraphSource, files: BuildStats['files']): AtlasDocument {
  const detected = new Map(adapters.map((a) => [a.name, a.detect(ctx)]));
  const active = adapters.filter((a) => detected.get(a.name) !== null);
  const owner = makeOwner(ctx, [...implementationContainers(ctx), ...active.flatMap((a) => a.containers?.(ctx) ?? [])]);
  const base = core(ctx, owner);
  const produced: [string, Rows][] = [['definitions', base], ...active.map((a): [string, Rows] => [a.name, a.run(ctx, owner)])];

  const nodes = new Map<string, GraphNode>();
  for (const [, rows] of produced) for (const n of rows.nodes) if (!nodes.has(n.id)) nodes.set(n.id, n);
  const kept = new Map<string, Rows>();
  const edges = new Map<string, GraphEdge>();
  let dropped = 0;
  for (const [name, rows] of produced) {
    const mine: GraphEdge[] = [];
    for (const e of rows.edges) {
      if (!nodes.has(e.from) || !nodes.has(e.to)) {
        dropped++;
        continue;
      }
      const k = edgeKey(e);
      if (edges.has(k)) continue;
      edges.set(k, e);
      mine.push(e);
    }
    kept.set(name, { nodes: rows.nodes, edges: mine });
  }

  const capabilities: Capability[] = [
    ...[['definitions', ['defines', 'requires', 'calls', 'references', 'tests']] as const, ...adapters.map((a) => [a.name, a.edgeKinds] as const)].map(([name, kinds]): Capability => {
      const rows = kept.get(name);
      const why = detected.get(name);
      return {
        name, status: 'available', edge_kinds: [...kinds], edges: rows?.edges.length ?? 0, bands: bandCounts(rows?.edges ?? []),
        ...(name === 'definitions' ? {} : { note: why ? `switched on by ${why}` : 'not used: nothing in this codebase switches it on' }),
      };
    }),
    ...NOT_EXTRACTED.map((name): Capability => ({ name, status: 'absent', note: 'not extracted from Clojure sources by clojure-atlas' })),
  ];

  const adapterStats: Record<string, AdapterStats> = {};
  for (const a of adapters) {
    const rows = kept.get(a.name);
    adapterStats[a.name] = { detected: detected.get(a.name) ?? null, nodes: rows?.nodes.length ?? 0, edges: rows?.edges.length ?? 0 };
  }
  const syntaxFiles = new Set(ctx.analysis.syntaxErrors.map((e) => e.file));
  return {
    format: FORMAT,
    version: VERSION,
    source,
    capabilities,
    nodes: [...nodes.values()].sort((a, b) => compareText(a.id, b.id)),
    edges: [...edges.values()].sort((a, b) => compareText(edgeKey(a), edgeKey(b))),
    stats: {
      files,
      syntax_errors: { files: syntaxFiles.size, errors: ctx.analysis.syntaxErrors.length },
      definitions: ctx.defs.size,
      usages: base.stats,
      adapters: adapterStats,
      dropped_edges: dropped,
    },
  };
}
