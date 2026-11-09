// Build-time coverage losses, read back from the graph's `stats`: files clj-kondo could not parse (their namespaces
// are missing from the graph) and edges dropped because an end was not a node. Both mean "not extracted", never "none",
// so every answer that could be affected says so.
import type { GraphDocument } from './graph.ts';

export interface Degradation {
  files: number;
  // repo-relative paths of the files that could not be parsed (capped at build time; `files` is the true count)
  names: string[];
  edges: number;
}

const SHOWN = 3;

export function degradation(doc: GraphDocument): Degradation | null {
  const stats = (doc as { stats?: { syntax_errors?: { files?: unknown; names?: unknown }; dropped_edges?: unknown } }).stats;
  const files = typeof stats?.syntax_errors?.files === 'number' ? stats.syntax_errors.files : 0;
  const names = Array.isArray(stats?.syntax_errors?.names) ? stats.syntax_errors.names.filter((x): x is string => typeof x === 'string') : [];
  const edges = typeof stats?.dropped_edges === 'number' ? stats.dropped_edges : 0;
  return files > 0 || edges > 0 ? { files, names, edges } : null;
}

// One line, same words in the build log, graph_info and every answer.
export function degradedLine(d: Degradation): string {
  const parts: string[] = [];
  if (d.files) {
    const shown = d.names.slice(0, SHOWN).join(', ');
    parts.push(`${d.files} file(s) could not be parsed${shown ? ` (${shown}${d.files > SHOWN ? ', ...' : ''})` : ''}, so their definitions and calls are missing`);
  }
  if (d.edges) parts.push(`${d.edges} edge(s) dropped because an end was not a node`);
  return `DEGRADED: ${parts.join('; ')}; an empty or missing answer may be a gap in the graph, not absence`;
}

// The unparsed files a name could live in: "demo.broken/oops" or "demo.broken" matches src/demo/broken.clj (also
// with underscores for dashes), a repo path matches itself.
export function unparsedFor(d: Degradation | null, query: string): string[] {
  if (!d?.names.length) return [];
  const q = query.trim().replace(/^definition:/, '');
  const ns = q.split('/')[0];
  const rel = ns.replace(/\./g, '/').replace(/-/g, '_');
  return d.names.filter((n) => n === q || (rel !== '' && new RegExp(`(^|/)${rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.clj[sc]?$`).test(n)));
}
