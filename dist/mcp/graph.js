// Loading and indexing one code-graph file (format "code-graph", version 1 or 2; the format is documented
// where the file is produced). Version 2 adds signatures, key flow and row tables; a version-1 file still
// loads and those capabilities read as absent. The file is read once; every query runs on the in-memory indexes built here.
import { readFileSync, statSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
export const FORMAT = 'code-graph';
export const VERSION = 2;
const SUPPORTED_VERSIONS = [1, 2];
// Upper bounds for one graph file on disk and inflated: a bigger file is refused before it is read or gunzipped.
const MAX_GRAPH_BYTES = 256 * 1024 * 1024;
const MAX_INFLATED_BYTES = 480 * 1024 * 1024;
export const BANDS = ['static_proven', 'heuristic', 'unknown'];
export class GraphFormatError extends Error {
    constructor(message) {
        super(message);
        this.name = 'GraphFormatError';
    }
}
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
function check(cond, message) {
    if (!cond)
        throw new GraphFormatError(message);
}
// Rejects anything that is not a version-1 or version-2 code-graph document, naming the first defect found.
export function parseDocument(raw, origin = 'graph') {
    check(isObject(raw), `${origin}: not a JSON object`);
    const o = raw;
    check(o.format === FORMAT, `${origin}: format is ${JSON.stringify(o.format)}, expected "${FORMAT}"`);
    check(typeof o.version === 'number', `${origin}: no numeric version field`);
    check(SUPPORTED_VERSIONS.includes(o.version), `${origin}: version ${String(o.version)} is not supported (this reader knows versions ${SUPPORTED_VERSIONS.join(' and ')}); rebuild the graph with a ` +
        `matching exporter`);
    check(isObject(o.source) && typeof o.source.sha === 'string', `${origin}: source.sha missing`);
    check(Array.isArray(o.nodes), `${origin}: nodes is not an array`);
    check(Array.isArray(o.edges), `${origin}: edges is not an array`);
    const caps = Array.isArray(o.capabilities) ? o.capabilities : [];
    const nodes = o.nodes;
    const edges = o.edges;
    const isLine = (v) => v === undefined || (Number.isInteger(v) && v >= 0);
    const ids = new Set();
    nodes.forEach((n, i) => {
        check(isObject(n) && typeof n.id === 'string' && typeof n.kind === 'string' && typeof n.name === 'string', `${origin}: nodes[${i}] needs string id, kind and name`);
        const node = n;
        check(!ids.has(node.id), `${origin}: nodes[${i}] repeats id ${JSON.stringify(node.id)}`);
        ids.add(node.id);
        check(node.file === undefined || typeof node.file === 'string', `${origin}: nodes[${i}] has a non-string file`);
        check(node.roles === undefined || (Array.isArray(node.roles) && node.roles.every((r) => typeof r === 'string')), `${origin}: nodes[${i}] has roles that are not a list of strings`);
        check(node.attrs === undefined || isObject(node.attrs), `${origin}: nodes[${i}] has attrs that are not an object`);
        check(isLine(node.line) && isLine(node.end_line), `${origin}: nodes[${i}] has a line or end_line that is not a whole number`);
    });
    edges.forEach((e, i) => {
        check(isObject(e) && typeof e.from === 'string' && typeof e.to === 'string' && typeof e.kind === 'string'
            && typeof e.file === 'string', `${origin}: edges[${i}] needs string from, to, kind and file`);
        check(isLine(e.line), `${origin}: edges[${i}] has a line that is not a whole number`);
        const attrs = e.attrs;
        check(attrs === undefined || isObject(attrs), `${origin}: edges[${i}] has attrs that are not an object`);
        check(BANDS.includes(String(e.band)), `${origin}: edges[${i}] has band ${JSON.stringify(e.band)}, expected one of ${BANDS.join(', ')}`);
    });
    return { ...o, capabilities: caps };
}
function push(m, k, v) {
    const xs = m.get(k);
    if (xs)
        xs.push(v);
    else
        m.set(k, [v]);
}
export function indexGraph(doc) {
    const byId = new Map();
    const byKind = new Map();
    const byName = new Map();
    for (const n of doc.nodes) {
        byId.set(n.id, n);
        push(byKind, n.kind, n);
        push(byName, n.name, n);
    }
    const out = new Map();
    const inn = new Map();
    for (const e of doc.edges) {
        push(out, e.from, e);
        push(inn, e.to, e);
    }
    return { doc, byId, out, in: inn, byKind, byName };
}
export function graphFromJson(text, origin = 'graph') {
    let raw;
    try {
        raw = JSON.parse(text);
    }
    catch (err) {
        // the parser's message quotes the text around the error; only the position is kept, so no file content leaks
        const at = /position (\d+)/.exec(err.message)?.[1];
        throw new GraphFormatError(`${origin}: not valid JSON${at !== undefined ? ` (at position ${at})` : ''}`);
    }
    return indexGraph(parseDocument(raw, origin));
}
// Reads a .json or .json.gz code-graph file once.
export function loadGraph(path, limits = { file: MAX_GRAPH_BYTES, inflated: MAX_INFLATED_BYTES }) {
    const size = statSync(path).size;
    if (size > limits.file)
        throw new GraphFormatError(`${path}: ${size} bytes, over the ${limits.file}-byte limit for a graph file`);
    const bytes = readFileSync(path);
    const gz = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
    let text = bytes;
    if (gz) {
        try {
            text = gunzipSync(bytes, { maxOutputLength: limits.inflated });
        }
        catch (err) {
            throw new GraphFormatError(`${path}: gzip data not readable or over the ${limits.inflated}-byte limit ` +
                `(${err.code ?? 'error'})`);
        }
    }
    return graphFromJson(text.toString('utf8'), path);
}
export const outEdges = (g, id, kinds) => (g.out.get(id) ?? []).filter((e) => !kinds || kinds.includes(e.kind));
export const inEdges = (g, id, kinds) => (g.in.get(id) ?? []).filter((e) => !kinds || kinds.includes(e.kind));
export function capability(g, name) {
    return g.doc.capabilities.find((c) => c.name === name);
}
// Code-unit order, the same on every machine (localeCompare follows the host's ICU locale data).
export const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
// The weaker of two bands (unknown < heuristic < declared < static_proven).
export function weakest(a, b) {
    return BANDS.indexOf(a) >= BANDS.indexOf(b) ? a : b;
}
