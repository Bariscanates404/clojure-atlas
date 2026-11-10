// Build-time coverage losses, read back from the graph's `stats`: files clj-kondo could not parse and files over the
// size limit (their namespaces are missing from the graph), edges dropped because an end was not a node, and
// namespaces defined in more than one file (merged into one node). All mean "not extracted" or "not told apart",
// never "none", so every answer that could be affected says so.
import type { GraphDocument } from './graph.ts';

export interface Degradation {
  // files kondo produced nothing for (no namespace, no definition): their definitions and calls are missing
  files: number;
  // repo-relative paths of those files (capped at build time; `files` is the true count)
  names: string[];
  // files with syntax errors that kondo still analyzed: some forms in them may be missing, the rest is in the graph
  recovered: { files: number; names: string[] };
  edges: number;
  // files over the size limit, never read: the true count and the first names (capped at build time)
  large: { files: number; names: string[] };
  // namespaces defined in more than one file
  duplicates: string[];
  // files whose clj-kondo run was killed for taking too long, and tracked Clojure files the build never looked at
  timedOut: { files: number; names: string[] };
  unread: { files: number; names: string[] };
}

const SHOWN = 3;

export const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

interface Stats {
  syntax_errors?: { files?: unknown; names?: unknown; recovered?: unknown; recovered_names?: unknown };
  dropped_edges?: unknown;
  files?: { skipped_large?: unknown; skipped_large_names?: unknown; timed_out?: unknown; timed_out_names?: unknown; unread?: unknown; unread_names?: unknown };
  duplicate_namespaces?: unknown;
}

export function degradation(doc: GraphDocument): Degradation | null {
  const stats = (doc as { stats?: Stats }).stats;
  const withErrors = typeof stats?.syntax_errors?.files === 'number' ? stats.syntax_errors.files : 0;
  const recoveredFiles = typeof stats?.syntax_errors?.recovered === 'number' ? stats.syntax_errors.recovered : 0;
  const recoveredNames = strings(stats?.syntax_errors?.recovered_names);
  const files = Math.max(0, withErrors - recoveredFiles);
  const names = strings(stats?.syntax_errors?.names).filter((n) => !recoveredNames.includes(n));
  const recovered = { files: recoveredFiles, names: recoveredNames };
  const edges = typeof stats?.dropped_edges === 'number' ? stats.dropped_edges : 0;
  const largeNames = strings(stats?.files?.skipped_large_names);
  const large = { files: typeof stats?.files?.skipped_large === 'number' ? stats.files.skipped_large : 0, names: largeNames };
  const counted = (n: unknown, names: unknown) => ({ files: typeof n === 'number' ? n : 0, names: strings(names) });
  const timedOut = counted(stats?.files?.timed_out, stats?.files?.timed_out_names);
  const unread = counted(stats?.files?.unread, stats?.files?.unread_names);
  const duplicates = Array.isArray(stats?.duplicate_namespaces)
    ? stats.duplicate_namespaces.flatMap((d: unknown) => (typeof (d as { ns?: unknown })?.ns === 'string' ? [(d as { ns: string }).ns] : []))
    : [];
  return files > 0 || recovered.files > 0 || edges > 0 || large.files > 0 || duplicates.length > 0 || timedOut.files > 0 || unread.files > 0
    ? { files, names, recovered, edges, large, duplicates, timedOut, unread } : null;
}

const listed = (names: readonly string[], total: number) => `${names.slice(0, SHOWN).join(', ')}${total > SHOWN ? ', ...' : ''}`;

// One line, same words in the build log, graph_info and every answer.
export function degradedLine(d: Degradation): string {
  const parts: string[] = [];
  if (d.files) {
    parts.push(`${d.files} file(s) could not be parsed${d.names.length ? ` (${listed(d.names, d.files)})` : ''}, so their definitions and calls are missing`);
  }
  if (d.recovered.files) {
    parts.push(`${d.recovered.files} file(s) have syntax errors but were analyzed${d.recovered.names.length ? ` (${listed(d.recovered.names, d.recovered.files)})` : ''}; some forms in them may be missing`);
  }
  if (d.large.files) {
    const shown = d.large.names.length ? ` (${listed(d.large.names, d.large.files)})` : '';
    parts.push(`${d.large.files} file(s) over 2 MB were skipped${shown}, so their definitions and calls are missing`);
  }
  if (d.timedOut.files) {
    parts.push(`${d.timedOut.files} file(s) were not analyzed because clj-kondo did not finish on them (${listed(d.timedOut.names, d.timedOut.files)}), so their definitions and calls are missing`);
  }
  if (d.unread.files) {
    parts.push(`${d.unread.files} tracked Clojure file(s) were not analyzed, as they sit in a hidden or root build folder (${listed(d.unread.names, d.unread.files)}), so their definitions and calls are missing`);
  }
  if (d.duplicates.length) {
    const shown = listed(d.duplicates, d.duplicates.length);
    parts.push(`${d.duplicates.length} namespace(s) defined in more than one file (${shown}) share one node each, so calls into them are heuristic`);
  }
  if (d.edges) parts.push(`${d.edges} edge(s) dropped because an end was not a node`);
  return `DEGRADED: ${parts.join('; ')}; an empty or missing answer may be a gap in the graph, not absence`;
}

const matching = (names: readonly string[], query: string): string[] => {
  if (!names.length) return [];
  const q = query.trim().replace(/^definition:/, '');
  const ns = q.split('/')[0];
  const rel = ns.replace(/\./g, '/').replace(/-/g, '_');
  return names.filter((n) => n === q || (rel !== '' && new RegExp(`(^|/)${rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.clj[sc]?$`).test(n)));
};

// The unparsed files a name could live in: "demo.broken/oops" or "demo.broken" matches src/demo/broken.clj (also
// with underscores for dashes), a repo path matches itself.
export const unparsedFor = (d: Degradation | null, query: string): string[] => matching(d?.names ?? [], query);

// The files with syntax errors that were still analyzed, a name could live in: a form kondo could not read may be the one missing.
export const recoveredFor = (d: Degradation | null, query: string): string[] => matching(d?.recovered.names ?? [], query);

// The files a name could live in that were never analyzed: killed by the timeout, or tracked but outside the file walk.
export const unanalyzedFor = (d: Degradation | null, query: string): { timedOut: string[]; unread: string[] } =>
  ({ timedOut: matching(d?.timedOut.names ?? [], query), unread: matching(d?.unread.names ?? [], query) });

// The same for the files skipped as too large.
export const skippedFor = (d: Degradation | null, query: string): string[] => matching(d?.large.names ?? [], query);
