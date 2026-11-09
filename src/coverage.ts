// Coverage of one built graph, from the statistics the builder records: how many var usages resolved to a
// project definition, what each adapter produced, size and time. Shared by `clojure-atlas coverage` and
// scripts/coverage.ts.
import type { AtlasDocument } from './build/assemble.ts';

export interface CoverageRow {
  repo: string;
  sha: string;
  files: number;
  syntaxErrorFiles: number;
  definitions: number;
  resolved: number;
  unresolved: number;
  unknown: number;
  resolvedPct: number;
  adapters: Record<string, number>;
  nodes: number;
  edges: number;
  unknownEdges: number;
  buildMs: number;
  graphBytes: number;
}

export function coverageRow(doc: AtlasDocument, graphBytes: number): CoverageRow {
  const u = doc.stats.usages;
  const counted = u.resolved + u.unresolved + u.unknown;
  return {
    repo: doc.source.repo_name ?? '?',
    sha: doc.source.sha,
    files: doc.stats.files.sources,
    syntaxErrorFiles: doc.stats.syntax_errors.files,
    definitions: doc.stats.definitions,
    resolved: u.resolved,
    unresolved: u.unresolved,
    unknown: u.unknown,
    resolvedPct: counted ? (100 * u.resolved) / counted : 100,
    // edges an adapter added; nodes for one that adds no edges (key tables)
    adapters: Object.fromEntries(Object.entries(doc.stats.adapters).map(([k, a]) => [k, doc.capabilities.find((c) => c.name === k)?.edge_kinds?.length ? a.edges : a.nodes])),
    nodes: doc.nodes.length,
    edges: doc.edges.length,
    unknownEdges: doc.edges.filter((e) => e.band === 'unknown').length,
    buildMs: doc.stats.build_ms ?? 0,
    graphBytes,
  };
}

const pct = (x: number) => `${x.toFixed(1)}%`;
const kb = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

export function coverageTable(rows: readonly CoverageRow[]): string {
  const adapters = [...new Set(rows.flatMap((r) => Object.keys(r.adapters)))];
  const head = ['repo', 'files', 'syntax-error files', 'definitions', 'resolved', 'unresolved', 'unknown', 'resolved %', ...adapters, 'unknown edges', 'build', 'graph'];
  const lines = [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`];
  for (const r of rows) {
    lines.push(`| ${[
      r.repo, r.files, r.syntaxErrorFiles, r.definitions, r.resolved, r.unresolved, r.unknown, pct(r.resolvedPct),
      ...adapters.map((a) => r.adapters[a] ?? 0), r.unknownEdges, `${(r.buildMs / 1000).toFixed(1)} s`, kb(r.graphBytes),
    ].join(' | ')} |`);
  }
  return lines.join('\n');
}
