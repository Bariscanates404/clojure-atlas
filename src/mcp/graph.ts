// Loading and indexing one code-graph file (format "code-graph", version 1 or 2; the format is documented
// where the file is produced). Version 2 adds signatures, key flow and row tables; a version-1 file still
// loads and those capabilities read as absent. The file is read once; every query runs on the in-memory indexes built here.
import { readFileSync, statSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

export const FORMAT = 'code-graph';
export const VERSION = 2;
const SUPPORTED_VERSIONS: readonly number[] = [1, 2];

// Upper bounds for one graph file on disk and inflated: a bigger file is refused before it is read or gunzipped.
const MAX_GRAPH_BYTES = 256 * 1024 * 1024;
const MAX_INFLATED_BYTES = 480 * 1024 * 1024;

export const BANDS = ['static_proven', 'declared', 'heuristic', 'unknown'] as const;
export type Band = (typeof BANDS)[number];

export interface GraphNode {
  id: string;
  kind: string;
  name: string;
  file?: string;
  line?: number;
  end_line?: number;
  component?: string;
  roles?: string[];
  attrs?: Record<string, unknown>;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: string;
  band: Band;
  file: string;
  line?: number;
  attrs?: Record<string, unknown>;
}

export interface Capability {
  name: string;
  status: 'available' | 'absent';
  edge_kinds?: string[];
  edges?: number;
  bands?: Record<string, number>;
  note?: string;
}

export interface GraphSource {
  repo_name?: string;
  ref?: string | null;
  sha: string;
  built_at?: string;
}

export interface GraphDocument {
  format: string;
  version: number;
  source: GraphSource;
  capabilities: Capability[];
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface Graph {
  doc: GraphDocument;
  byId: Map<string, GraphNode>;
  out: Map<string, GraphEdge[]>;
  in: Map<string, GraphEdge[]>;
  byKind: Map<string, GraphNode[]>;
  byName: Map<string, GraphNode[]>;
}

export class GraphFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GraphFormatError';
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function check(cond: boolean, message: string): void {
  if (!cond) throw new GraphFormatError(message);
}

// Rejects anything that is not a version-1 or version-2 code-graph document, naming the first defect found.
export function parseDocument(raw: unknown, origin = 'graph'): GraphDocument {
  check(isObject(raw), `${origin}: not a JSON object`);
  const o = raw as Record<string, unknown>;
  check(o.format === FORMAT, `${origin}: format is ${JSON.stringify(o.format)}, expected "${FORMAT}"`);
  check(typeof o.version === 'number', `${origin}: no numeric version field`);
  check(SUPPORTED_VERSIONS.includes(o.version as number), `${origin}: version ${String(o.version)} is not supported (this reader knows versions ${SUPPORTED_VERSIONS.join(' and ')}); rebuild the graph with a matching exporter`);
  check(isObject(o.source) && typeof (o.source as Record<string, unknown>).sha === 'string', `${origin}: source.sha missing`);
  check(Array.isArray(o.nodes), `${origin}: nodes is not an array`);
  check(Array.isArray(o.edges), `${origin}: edges is not an array`);
  const caps = Array.isArray(o.capabilities) ? o.capabilities : [];
  const nodes = o.nodes as unknown[];
  const edges = o.edges as unknown[];
  const isLine = (v: unknown) => v === undefined || (Number.isInteger(v) && (v as number) >= 0);
  const ids = new Set<string>();
  nodes.forEach((n, i) => {
    check(isObject(n) && typeof n.id === 'string' && typeof n.kind === 'string' && typeof n.name === 'string',
      `${origin}: nodes[${i}] needs string id, kind and name`);
    const node = n as Record<string, unknown>;
    check(!ids.has(node.id as string), `${origin}: nodes[${i}] repeats id ${JSON.stringify(node.id)}`);
    ids.add(node.id as string);
    check(node.file === undefined || typeof node.file === 'string', `${origin}: nodes[${i}] has a non-string file`);
    check(isLine(node.line) && isLine(node.end_line), `${origin}: nodes[${i}] has a line or end_line that is not a whole number`);
  });
  edges.forEach((e, i) => {
    check(isObject(e) && typeof e.from === 'string' && typeof e.to === 'string' && typeof e.kind === 'string'
      && typeof e.file === 'string', `${origin}: edges[${i}] needs string from, to, kind and file`);
    check(isLine((e as Record<string, unknown>).line), `${origin}: edges[${i}] has a line that is not a whole number`);
    check((BANDS as readonly string[]).includes(String((e as Record<string, unknown>).band)),
      `${origin}: edges[${i}] has band ${JSON.stringify((e as Record<string, unknown>).band)}, expected one of ${BANDS.join(', ')}`);
  });
  return { ...(o as unknown as GraphDocument), capabilities: caps as Capability[] };
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const xs = m.get(k);
  if (xs) xs.push(v);
  else m.set(k, [v]);
}

export function indexGraph(doc: GraphDocument): Graph {
  const byId = new Map<string, GraphNode>();
  const byKind = new Map<string, GraphNode[]>();
  const byName = new Map<string, GraphNode[]>();
  for (const n of doc.nodes) {
    byId.set(n.id, n);
    push(byKind, n.kind, n);
    push(byName, n.name, n);
  }
  const out = new Map<string, GraphEdge[]>();
  const inn = new Map<string, GraphEdge[]>();
  for (const e of doc.edges) {
    push(out, e.from, e);
    push(inn, e.to, e);
  }
  return { doc, byId, out, in: inn, byKind, byName };
}

export function graphFromJson(text: string, origin = 'graph'): Graph {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    // the parser's message quotes the text around the error; only the position is kept, so no file content leaks
    const at = /position (\d+)/.exec((err as Error).message)?.[1];
    throw new GraphFormatError(`${origin}: not valid JSON${at !== undefined ? ` (at position ${at})` : ''}`);
  }
  return indexGraph(parseDocument(raw, origin));
}

// Reads a .json or .json.gz code-graph file once.
export function loadGraph(path: string, limits = { file: MAX_GRAPH_BYTES, inflated: MAX_INFLATED_BYTES }): Graph {
  const size = statSync(path).size;
  if (size > limits.file) throw new GraphFormatError(`${path}: ${size} bytes, over the ${limits.file}-byte limit for a graph file`);
  const bytes = readFileSync(path);
  const gz = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  let text: Buffer = bytes;
  if (gz) {
    try {
      text = gunzipSync(bytes, { maxOutputLength: limits.inflated });
    } catch (err) {
      throw new GraphFormatError(`${path}: gzip data not readable or over the ${limits.inflated}-byte limit (${(err as NodeJS.ErrnoException).code ?? 'error'})`);
    }
  }
  return graphFromJson(text.toString('utf8'), path);
}

export const outEdges = (g: Graph, id: string, kinds?: readonly string[]): GraphEdge[] =>
  (g.out.get(id) ?? []).filter((e) => !kinds || kinds.includes(e.kind));

export const inEdges = (g: Graph, id: string, kinds?: readonly string[]): GraphEdge[] =>
  (g.in.get(id) ?? []).filter((e) => !kinds || kinds.includes(e.kind));

export function capability(g: Graph, name: string): Capability | undefined {
  return g.doc.capabilities.find((c) => c.name === name);
}

// Code-unit order, the same on every machine (localeCompare follows the host's ICU locale data).
export const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// The weaker of two bands (unknown < heuristic < declared < static_proven).
export function weakest(a: Band, b: Band): Band {
  return BANDS.indexOf(a) >= BANDS.indexOf(b) ? a : b;
}
