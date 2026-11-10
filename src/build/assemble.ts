// Turns a build context into one code-graph document: core rows, then every detected adapter, merged (first node
// per id wins, one edge per site), edges whose ends are not nodes dropped and counted, capabilities with their band
// counts, and the coverage statistics `clojure-atlas coverage` prints.
import { BANDS, FORMAT, VERSION, compareText, type Capability, type GraphDocument, type GraphEdge, type GraphNode, type GraphSource } from '../mcp/graph.ts';
import { declaresAuthz } from './config.ts';
import { NOT_USED } from '../shared/capability.ts';
import { core, type UsageStats } from './core.ts';
import { makeOwner, type Adapter, type Context, type Rows } from './model.ts';

// the unparsed files named in the graph; the count beside them stays exact
const MAX_NAMED_FILES = 500;

export interface AdapterStats {
  detected: string | null;
  nodes: number;
  edges: number;
}

export interface BuildStats {
  // expected: Clojure files the repo tracks (build output and dependencies included); sources: the ones analyzed
  files: {
    expected: number; sources: number; edn: number; skipped_large: number; skipped_large_names: string[];
    // tracked Clojure files the file walk left out (hidden or root build folders), and files whose clj-kondo run was killed
    unread: number; unread_names: string[]; timed_out: number; timed_out_names: string[];
  };
  // namespaces defined in more than one file: one graph node stands for them all, and usages of them are heuristic
  duplicate_namespaces: { ns: string; files: string[] }[];
  // names: every file kondo reported a syntax error in; recovered_names: those it still analyzed (their namespace or a definition is in the graph)
  syntax_errors: { files: number; errors: number; names: string[]; recovered: number; recovered_names: string[] };
  definitions: number;
  usages: UsageStats;
  adapters: Record<string, AdapterStats>;
  dropped_edges: number;
  build_ms?: number;
}

export type AtlasDocument = GraphDocument & { stats: BuildStats };

function bandCounts(edges: readonly GraphEdge[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of BANDS) {
    const k = edges.filter((e) => e.band === b).length;
    if (k) out[b] = k;
  }
  return out;
}

const AUTHZ_KINDS = ['requires_permission', 'exempted_by'];

// Route authorization is project-specific: it is extracted only where .clojure-atlas.edn says how it is declared,
// so elsewhere a route without a check reads as unknown, never as unguarded.
function routeAuthz(ctx: Context, edges: readonly GraphEdge[]): Capability {
  if (!declaresAuthz(ctx.config)) {
    return { name: 'route_authz', status: 'absent', note: 'not declared: .clojure-atlas.edn names no route authz key, permission middleware or permission fn' };
  }
  const mine = edges.filter((e) => AUTHZ_KINDS.includes(e.kind));
  return {
    name: 'route_authz', status: 'available', edge_kinds: AUTHZ_KINDS, edges: mine.length, bands: bandCounts(mine), note: 'as declared in .clojure-atlas.edn',
  };
}

// Arities and parameters ride on definitions, the arity and passed keys on calls edges.
function signaturesOf(edges: readonly GraphEdge[]): Capability {
  const mine = edges.filter((e) => e.kind === 'calls' && typeof e.attrs?.arity === 'number');
  return { name: 'signatures', status: 'available', edge_kinds: ['calls'], edges: mine.length, bands: bandCounts(mine) };
}

// An edge has a line, not a column: two call sites on one line are told apart by what they carry (arity, arguments).
const edgeKey = (e: GraphEdge) => `${e.from}\0${e.kind}\0${e.to}\0${e.file}\0${e.line ?? 0}\0${JSON.stringify(e.attrs ?? {})}`;

export function assemble(ctx: Context, adapters: readonly Adapter[], source: GraphSource, files: BuildStats['files']): AtlasDocument {
  const detected = new Map(adapters.map((a) => [a.name, a.detect(ctx)]));
  const active = adapters.filter((a) => detected.get(a.name) !== null);
  const owner = makeOwner(ctx, active.flatMap((a) => a.containers?.(ctx) ?? []));
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
    ...[
      ['definitions', ['defines', 'requires', 'calls', 'references', 'passes_callback', 'registers_handler', 'expands_via', 'rebinds', 'tests']] as const,
      ...adapters.map((a) => [a.name, a.edgeKinds] as const),
    ].map(([name, kinds]): Capability => {
      const rows = kept.get(name);
      const why = detected.get(name);
      const missing = why ? null : adapters.find((a) => a.name === name)?.unavailable?.(ctx);
      if (missing) return { name, status: 'absent', edge_kinds: [...kinds], note: missing };
      return {
        name, status: 'available', edge_kinds: [...kinds], edges: rows?.edges.length ?? 0, bands: bandCounts(rows?.edges ?? []),
        ...(name === 'definitions' ? {} : { note: why ? `switched on by ${why}` : NOT_USED }),
      };
    }),
    routeAuthz(ctx, [...edges.values()]),
    signaturesOf([...edges.values()]),
  ];

  const adapterStats: Record<string, AdapterStats> = {};
  for (const a of adapters) {
    const rows = kept.get(a.name);
    adapterStats[a.name] = { detected: detected.get(a.name) ?? null, nodes: rows?.nodes.length ?? 0, edges: rows?.edges.length ?? 0 };
  }
  const syntaxFiles = new Set(ctx.analysis.syntaxErrors.map((e) => e.file));
  const analyzed = new Set([...ctx.analysis.nsDefs, ...ctx.analysis.varDefs].map((d) => d.file));
  const recovered = [...syntaxFiles].filter((f) => analyzed.has(f)).sort(compareText);
  return {
    format: FORMAT,
    version: VERSION,
    source,
    capabilities,
    nodes: [...nodes.values()].sort((a, b) => compareText(a.id, b.id)),
    edges: [...edges.values()].sort((a, b) => compareText(edgeKey(a), edgeKey(b))),
    stats: {
      files: {
        ...files, skipped_large_names: files.skipped_large_names.slice(0, MAX_NAMED_FILES),
        unread_names: files.unread_names.slice(0, MAX_NAMED_FILES), timed_out_names: files.timed_out_names.slice(0, MAX_NAMED_FILES),
      },
      syntax_errors: {
        files: syntaxFiles.size, errors: ctx.analysis.syntaxErrors.length, names: [...syntaxFiles].sort(compareText).slice(0, MAX_NAMED_FILES),
        recovered: recovered.length, recovered_names: recovered.slice(0, MAX_NAMED_FILES),
      },
      duplicate_namespaces: [...ctx.duplicateNs].map(([ns, files]) => ({ ns, files })).sort((a, b) => compareText(a.ns, b.ns)),
      definitions: ctx.defs.size,
      usages: base.stats,
      adapters: adapterStats,
      dropped_edges: dropped,
    },
  };
}
