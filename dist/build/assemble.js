// Turns a build context into one code-graph document: core rows, then every detected adapter, merged (first node
// per id wins, one edge per site), edges whose ends are not nodes dropped and counted, capabilities with their band
// counts, and the coverage statistics `clojure-atlas coverage` prints.
import { BANDS, FORMAT, VERSION, compareText } from "../mcp/graph.js";
import { declaresAuthz } from "./config.js";
import { NOT_USED } from "../shared/capability.js";
import { core } from "./core.js";
import { makeOwner } from "./model.js";
// the unparsed files named in the graph; the count beside them stays exact
const MAX_NAMED_FILES = 500;
const EDN_FILE = /\.edn$/;
function bandCounts(edges) {
    const out = {};
    for (const b of BANDS) {
        const k = edges.filter((e) => e.band === b).length;
        if (k)
            out[b] = k;
    }
    return out;
}
const AUTHZ_KINDS = ['requires_permission', 'exempted_by'];
// Route authorization is project-specific: it is extracted only where .clojure-atlas.edn says how it is declared,
// so elsewhere a route without a check reads as unknown, never as unguarded.
function routeAuthz(ctx, edges) {
    if (!declaresAuthz(ctx.config)) {
        return { name: 'route_authz', status: 'absent', note: 'not declared: .clojure-atlas.edn names no route authz key, permission middleware or permission fn; '
                + 'add :route-authz, :permission-middleware or :permission-fns there and rebuild' };
    }
    const mine = edges.filter((e) => AUTHZ_KINDS.includes(e.kind));
    return {
        name: 'route_authz', status: 'available', edge_kinds: AUTHZ_KINDS, edges: mine.length, bands: bandCounts(mine), note: 'as declared in .clojure-atlas.edn',
    };
}
// Arities and parameters ride on definitions, the arity and passed keys on calls edges.
function signaturesOf(edges) {
    const mine = edges.filter((e) => e.kind === 'calls' && typeof e.attrs?.arity === 'number');
    return { name: 'signatures', status: 'available', edge_kinds: ['calls'], edges: mine.length, bands: bandCounts(mine) };
}
// An edge has a line, not a column: two call sites on one line are told apart by what they carry (arity, arguments).
const edgeKey = (e) => `${e.from}\0${e.kind}\0${e.to}\0${e.file}\0${e.line ?? 0}\0${JSON.stringify(e.attrs ?? {})}`;
export function assemble(ctx, adapters, source, files) {
    const detected = new Map(adapters.map((a) => [a.name, a.detect(ctx)]));
    const active = adapters.filter((a) => detected.get(a.name) !== null);
    const owner = makeOwner(ctx, active.flatMap((a) => a.containers?.(ctx) ?? []));
    const base = core(ctx, owner);
    const produced = [['definitions', base], ...active.map((a) => [a.name, a.run(ctx, owner)])];
    const nodes = new Map();
    for (const [, rows] of produced)
        for (const n of rows.nodes)
            if (!nodes.has(n.id))
                nodes.set(n.id, n);
    const kept = new Map();
    const edges = new Map();
    let dropped = 0;
    for (const [name, rows] of produced) {
        const mine = [];
        for (const e of rows.edges) {
            if (!nodes.has(e.from) || !nodes.has(e.to)) {
                dropped++;
                continue;
            }
            const k = edgeKey(e);
            if (edges.has(k))
                continue;
            edges.set(k, e);
            mine.push(e);
        }
        kept.set(name, { nodes: rows.nodes, edges: mine });
    }
    const capabilities = [
        ...[
            ['definitions', ['defines', 'requires', 'calls', 'references', 'passes_callback', 'registers_handler', 'expands_via', 'rebinds', 'tests']],
            ...adapters.map((a) => [a.name, a.edgeKinds]),
        ].map(([name, kinds]) => {
            const rows = kept.get(name);
            const why = detected.get(name);
            const missing = why ? null : adapters.find((a) => a.name === name)?.unavailable?.(ctx);
            if (missing)
                return { name, status: 'absent', edge_kinds: [...kinds], note: missing };
            return {
                name, status: 'available', edge_kinds: [...kinds], edges: rows?.edges.length ?? 0, bands: bandCounts(rows?.edges ?? []),
                ...(name === 'definitions' ? {} : { note: why ? `switched on by ${why}` : NOT_USED }),
            };
        }),
        routeAuthz(ctx, [...edges.values()]),
        signaturesOf([...edges.values()]),
    ];
    const adapterStats = {};
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
                ...files, skipped_large_edn: files.skipped_large_names.filter((f) => EDN_FILE.test(f)).length,
                skipped_large_names: files.skipped_large_names.slice(0, MAX_NAMED_FILES),
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
