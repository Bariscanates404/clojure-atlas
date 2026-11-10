// Coverage of one built graph, from the statistics the builder records: how many var usages resolved to a
// project definition, what each adapter produced, size and time. Shared by `clojure-atlas coverage` and
// scripts/coverage.ts.
import type { AtlasDocument } from './build/assemble.ts';

export interface CoverageRow {
  repo: string;
  sha: string;
  filesExpected: number;
  files: number;
  syntaxErrorFiles: number;
  definitions: number;
  resolved: number;
  unresolved: number;
  unknown: number;
  // resolution rate of var usages in recognized project namespaces: resolved / (resolved + unresolved); null when
  // there were none, which is not 100%
  resolutionRate: number | null;
  adapters: Record<string, number>;
  nodes: number;
  edges: number;
  unknownEdges: number;
  droppedEdges: number;
  buildMs: number;
  graphBytes: number;
}

export function coverageRow(doc: AtlasDocument, graphBytes: number): CoverageRow {
  const u = doc.stats.usages;
  const inProject = u.resolved + u.unresolved;
  return {
    repo: doc.source.repo_name ?? '?',
    sha: doc.source.sha,
    filesExpected: doc.stats.files.expected,
    files: doc.stats.files.sources,
    syntaxErrorFiles: doc.stats.syntax_errors.files,
    definitions: doc.stats.definitions,
    resolved: u.resolved,
    unresolved: u.unresolved,
    unknown: u.unknown,
    resolutionRate: inProject ? (100 * u.resolved) / inProject : null,
    // edges an adapter added; nodes for one that adds no edges (key tables)
    adapters: Object.fromEntries(Object.entries(doc.stats.adapters).map(([k, a]) => [k, doc.capabilities.find((c) => c.name === k)?.edge_kinds?.length ? a.edges : a.nodes])),
    nodes: doc.nodes.length,
    edges: doc.edges.length,
    unknownEdges: doc.edges.filter((e) => e.band === 'unknown').length,
    droppedEdges: doc.stats.dropped_edges ?? 0,
    buildMs: doc.stats.build_ms ?? 0,
    graphBytes,
  };
}

export const pct = (x: number | null) => (x === null ? 'n/a' : `${x.toFixed(1)}%`);
const kb = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

export function coverageTable(rows: readonly CoverageRow[]): string {
  const adapters = [...new Set(rows.flatMap((r) => Object.keys(r.adapters)))];
  const head = ['repo', 'files expected', 'files analyzed', 'syntax-error files', 'definitions', 'resolved', 'unresolved', 'resolution rate', 'unknown namespace', ...adapters, 'unknown edges', 'dropped edges', 'build', 'graph'];
  const lines = [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`];
  for (const r of rows) {
    lines.push(`| ${[
      r.repo, r.filesExpected, r.files, r.syntaxErrorFiles, r.definitions, r.resolved, r.unresolved, pct(r.resolutionRate), r.unknown,
      ...adapters.map((a) => r.adapters[a] ?? 0), r.unknownEdges, r.droppedEdges, `${(r.buildMs / 1000).toFixed(1)} s`, kb(r.graphBytes),
    ].join(' | ')} |`);
  }
  return lines.join('\n');
}
