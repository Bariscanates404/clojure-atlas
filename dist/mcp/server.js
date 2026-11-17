// The code-graph MCP server: its tool table over the shared stdio JSON-RPC core.
import { realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { invalidArguments, missingArguments, stdioServer } from "./stdio.js";
import { loadGraph } from "./graph.js";
import { attributeUsage, blastRadius, callers, contextForChange, eventFlow, permissionRoutes, routeAuthz, testsCovering, testsFor, } from "./queries.js";
import { keyFlow, keySiblings, signatureImpact } from "./keyflow.js";
import { PAGING_PROPS, render, renderOptionsOf, withSource } from "./render.js";
import { degradation, degradedLine } from "./degraded.js";
import { staleness } from "./staleness.js";
import { VERSION } from "../version.js";
const SERVER_NAME = 'clojure-atlas';
const common = {
    base: { type: 'string', description: 'sha of the commit you are looking at; a STALE header appears when the graph is far from it' },
    ...PAGING_PROPS,
    group_by: { type: 'string', enum: ['component', 'file', 'none'], description: 'row grouping (default component)' },
};
const str = (a, k) => (typeof a[k] === 'string' ? a[k] : '');
const strList = (a, k) => (typeof a[k] === 'string' ? [a[k]] : Array.isArray(a[k])
    ? a[k].filter((x) => typeof x === 'string') : []);
// A cached base graph is valid for the file stamp it was read at: a graph rewritten in place is read again. The cache
// keeps the few most recently used graphs, the oldest is dropped (a Map iterates in insertion order).
export const MAX_BASE_GRAPHS = 4;
const baseGraphs = new Map();
// A base graph is a code-graph file (.json or .json.gz) next to the served graph. The error names only the file
// name the caller passed and never quotes the file, so another file's content cannot reach the answer.
function baseGraph(file, opts) {
    const name = path.basename(file);
    if (!/\.json(\.gz)?$/.test(name))
        throw new Error(`base_graph ${name}: not a code-graph file (.json or .json.gz)`);
    let real;
    try {
        real = realpathSync(opts.baseDir === undefined ? file : path.resolve(opts.baseDir, file));
    }
    catch (err) {
        process.stderr.write(`clojure-atlas: base_graph not found: ${err.message}\n`);
        throw new Error(`base_graph ${name}: no such file`);
    }
    if (opts.graphDir !== undefined) {
        const rel = path.relative(realpathSync(opts.graphDir), real);
        if (rel === '' || rel.split(path.sep)[0] === '..' || path.isAbsolute(rel))
            throw new Error(`base_graph ${name}: outside the graph directory`);
    }
    const st = statSync(real);
    const stamp = `${st.mtimeMs}:${st.size}`;
    const hit = baseGraphs.get(real);
    if (hit?.stamp === stamp) {
        baseGraphs.delete(real);
        baseGraphs.set(real, hit);
        return hit.graph;
    }
    let graph;
    try {
        graph = loadGraph(real);
    }
    catch (err) {
        process.stderr.write(`clojure-atlas: base_graph ${real} not loaded: ${err.message}\n`);
        throw new Error(`base_graph ${name}: not a readable code-graph`);
    }
    baseGraphs.delete(real);
    baseGraphs.set(real, { stamp, graph });
    for (const old of [...baseGraphs.keys()].slice(0, Math.max(0, baseGraphs.size - MAX_BASE_GRAPHS)))
        baseGraphs.delete(old);
    return graph;
}
export const TOOLS = [
    {
        name: 'callers',
        description: 'Direct callers of a definition (ns/name or definition: id): sites that call it, each with file:line and band, counted per component.',
        required: ['var'],
        props: { var: { type: 'string' },
            include_references: { type: 'boolean',
                description: 'also list value uses, callbacks (partial, comp, map ...), registered handlers (re-frame reg-*, add-watch), macro expansions, dispatch ' +
                    'candidates and rebindings' } },
        run: (g, a) => callers(g, str(a, 'var'), { includeReferences: a.include_references === true }),
    },
    {
        name: 'blast_radius',
        description: 'Potential impact over known dependency relations: transitive callers and other dependents (value uses, callbacks, registered handlers, ' +
            'macro expansions, dispatch candidates, rebindings) of a definition, walked until no new one appears (or up to an explicit depth). Starts with the ' +
            'total, deepest depth, counts per depth and per component and the entry points reached; depth 1-2 rows are listed, deeper rows are paged with ' +
            'section="deeper".',
        required: ['var'],
        props: { var: { type: 'string' }, depth: { type: 'number', description: 'cap the walk at this depth (min 1); omit to walk to the end' } },
        run: (g, a) => blastRadius(g, str(a, 'var'), typeof a.depth === 'number' ? a.depth : undefined),
    },
    {
        name: 'route_authz',
        description: 'Authorization of a backend route (path such as /api/articles/:slug, "POST /api/articles", or a route: id): served copies with base and ' +
            'mount, handler, middleware chain in order, permissions (all/any structure) or the exempt reason.',
        required: ['route'],
        props: { route: { type: 'string' } },
        run: (g, a) => routeAuthz(g, str(a, 'route')),
    },
    {
        name: 'permission_routes',
        description: 'Every route copy that checks a permission (the keyword as declared, e.g. in .clojure-atlas.edn), saying whether it is required alone or ' +
            'one ' +
            'of alternatives.',
        required: ['permission'],
        props: { permission: { type: 'string' } },
        run: (g, a) => permissionRoutes(g, str(a, 'permission')),
    },
    {
        name: 'attribute_usage',
        description: 'Proven readers and writers of a persisted data attribute (:order/bid), plus references whose role is unproven as UNKNOWN rows ranked by ' +
            'how ' +
            'much they look like a write or a read.',
        required: ['attr'],
        props: { attr: { type: 'string' } },
        run: (g, a) => attributeUsage(g, str(a, 'attr')),
    },
    {
        name: 'event_flow',
        description: 'For an event: dispatchers, handler, what the handler dispatches and requests. For a subscription: handler, inputs, subscribers.',
        required: ['name'],
        props: { name: { type: 'string', description: 'event or subscription keyword, e.g. :add-todo' } },
        run: (g, a) => eventFlow(g, str(a, 'name')),
    },
    {
        name: 'tests_covering',
        description: 'Browser tests reaching a file, definition, selector (a CSS class or data-testid a page object uses) or route through selectors, page ' +
            'objects or requests.',
        required: ['target'],
        props: { target: { type: 'string', description: 'repo-relative file, ns/name, selector or route path' } },
        run: (g, a) => testsCovering(g, str(a, 'target')),
    },
    {
        name: 'tests_for',
        description: 'Unit tests (test definitions calling it directly or transitively, with depth and band) and browser tests (through rendered selectors and ' +
            'handled routes) for a definition, data attribute, event or subscription; limits stated.',
        required: ['symbol'],
        props: { symbol: { type: 'string' }, depth: { type: 'number', description: '1..3, default 3' } },
        run: (g, a) => testsFor(g, str(a, 'symbol'), typeof a.depth === 'number' ? a.depth : 3),
    },
    {
        name: 'signature_impact',
        description: 'Arities and parameters of a function (destructured map keys, & {:keys} keyword args) and, per caller grouped by component, the arity used ' +
            'and the keys passed; flags arities no definition has, destructured keys no caller passes, passed keys the function never reads; apply/partial uses as ' +
            'UNKNOWN. Diff mode: base_graph (a code-graph of the base commit) or added_keys / removed_keys / arities lists the callers the change affects.',
        required: ['fn'],
        props: {
            fn: { type: 'string', description: 'ns/name or definition: id' },
            base_graph: { type: 'string', description: 'path of the base commit\'s code-graph file: compare signatures and list affected callers' },
            added_keys: { type: 'array', items: { type: 'string' }, description: 'keys the change starts requiring (e.g. [":scope"])' },
            removed_keys: { type: 'array', items: { type: 'string' }, description: 'keys the change stops reading' },
            arities: { type: 'array', items: { type: 'number' }, description: 'argument counts the function accepts after the change' },
        },
        run: (g, a, opts) => signatureImpact(g, str(a, 'fn'), {
            ...(str(a, 'base_graph') ? { base: baseGraph(str(a, 'base_graph'), opts) } : {}),
            change: {
                addedKeys: strList(a, 'added_keys'),
                removedKeys: strList(a, 'removed_keys'),
                arities: Array.isArray(a.arities) ? a.arities.filter((x) => typeof x === 'number') : [],
            },
        }),
    },
    {
        name: 'key_flow',
        description: 'Producers (map literal keys, assoc/assoc-in/update, Datomic tx) and consumers (keyword as fn, get/get-in, destructuring, pull patterns, ' +
            'queries, select-keys) of one map key such as :scope or :user/email, grouped by component, tests apart; flags a key consumed but never produced (or ' +
            'the ' +
            'reverse) with similar keys; other uses as UNKNOWN.',
        required: ['key'],
        props: { key: { type: 'string', description: 'keyword, e.g. :articlesCount' } },
        run: (g, a) => keyFlow(g, str(a, 'key')),
    },
    {
        name: 'key_siblings',
        description: 'For literal tables of 3+ map rows (path tables, config vectors): rows lacking a key that most sibling rows or a path sibling have, minus ' +
            'absences shared by rows of the same kind; rows that are not map literals are UNKNOWN.',
        required: ['target'],
        props: { target: { type: 'string', description: 'repo-relative file, file:line inside a table, a key_table id, or the var holding the table' } },
        run: (g, a) => keySiblings(g, str(a, 'target')),
    },
    {
        name: 'context_for_change',
        description: 'One call per review: risk notes, changed symbols, callers outside the diff, route authz with siblings, attributes read or written, tests ' +
            'to ' +
            'run and tests to add, for changed files or hunks.',
        required: ['changes'],
        props: { changes: { type: 'array', items: { type: 'string' }, description: 'repo-relative "file", "file:12" or "file:10-20,30-41" entries' } },
        run: (g, a, opts) => contextForChange(g, strList(a, 'changes'), { ...(opts.repoDir !== undefined ? { repoDir: opts.repoDir } : {}) }),
    },
];
export function toolList() {
    return [
        ...TOOLS.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: { type: 'object', properties: { ...t.props, ...common }, required: t.required },
        })),
        {
            name: 'graph_info',
            description: 'Which commit the graph describes, its capabilities with band counts, and staleness against base.',
            inputSchema: { type: 'object', properties: { base: common.base } },
        },
    ];
}
export function graphInfo(g, base, opts) {
    const s = g.doc.source;
    const st = staleness(g, base, opts);
    const degraded = degradation(g.doc);
    const lines = [
        ...(st.header ? [st.header] : []),
        ...(degraded ? [degradedLine(degraded)] : []),
        `graph ${s.repo_name ?? '?'} @ ${s.ref ?? '?'} sha ${s.sha} built ${s.built_at ?? '?'}: ${g.doc.nodes.length} nodes, ${g.doc.edges.length} edges`,
        ...(s.snapshot ? [`snapshot ${s.snapshot}: ${s.dirty_files ?? 0} uncommitted file(s), analyzer ${s.analyzer ?? '?'}`] : []),
        ...(s.config_hash ? [`config ${s.config_hash.slice(0, 12)} from ${(s.config_sources ?? []).join(', ') || 'no project config files'}`] : []),
        ...g.doc.capabilities.map((c) => `  ${c.name}: ` +
            `${c.status}${c.edges !== undefined ? `, ${c.edges} edges` : ''}${c.bands ? ` ${JSON.stringify(c.bands)}` : ''}${c.note ? ` (${c.note})` : ''}`),
    ];
    return lines.join('\n');
}
const badArguments = (name, props, args) => {
    const invalid = invalidArguments(props, args);
    return invalid.length ? { text: `${name}: invalid argument(s): ${invalid.join('; ')}`, isError: true } : null;
};
export function callTool(g, name, args, opts = {}) {
    const base = typeof args.base === 'string' ? args.base : undefined;
    if (name === 'graph_info')
        return badArguments(name, { base: common.base }, args) ?? { text: graphInfo(g, base, opts), isError: false };
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool)
        return { text: `unknown tool ${name}`, isError: true };
    // a present value of the wrong type is a type error, whether or not the argument is required
    const invalid = badArguments(name, { ...tool.props, ...common }, args);
    if (invalid)
        return invalid;
    const missing = missingArguments(tool.required, args);
    if (missing.length)
        return { text: `${name}: missing required argument(s) ${missing.join(', ')}`, isError: true };
    const res = tool.run(g, args, opts);
    const isError = res.badArgument === true;
    const st = staleness(g, base, opts);
    const degraded = degradation(g.doc);
    const degradedText = degraded ? degradedLine(degraded) : undefined;
    const header = [st.header, degradedText].filter(Boolean).join('\n') || null;
    const groupBy = ['component', 'file', 'none'].includes(String(args.group_by)) ? args.group_by : undefined;
    const ro = renderOptionsOf(args);
    if (ro.format === 'json')
        return { text: withSource(render(res, { ...ro, groupBy }), { stale: st.stale, notice: st.header, ...(degradedText ? { degraded: degradedText } : {}) }), isError };
    return { text: render(res, { ...ro, groupBy, header }), isError };
}
// Sent once at initialize: when to reach for which tool and how to read an answer. A client hands it to the agent, so a
// project needs no prompt or hook of its own to get the tools used at the right moment.
export const INSTRUCTIONS = [
    'Structural answers about this Clojure codebase, read from a graph built by `clojure-atlas build`. Ask before you edit or claim:',
    '- changing a function: callers, then blast_radius; changing its parameters or a map key it reads: signature_impact, key_flow',
    '- a route or a permission: route_authz, permission_routes',
    '- a persisted attribute: attribute_usage; a re-frame event or subscription: event_flow',
    '- whether something is tested: tests_for, tests_covering',
    '- reviewing a change: context_for_change, once',
    'Every row cites file:line and a band: [S] proven, [H] heuristic (open the line before relying on it), [?] unknown.',
    'An empty answer is not proof of absence. STALE: the code moved since the build. DEGRADED: what the build could not read. graph_info: what this graph covers.',
].join('\n');
const server = stdioServer({
    name: SERVER_NAME,
    version: VERSION,
    instructions: INSTRUCTIONS,
    listTools: toolList,
    callTool: (ctx, name, args) => {
        if (!ctx.graph)
            throw new Error('no graph is loaded');
        return callTool(ctx.graph, name, args, ctx.opts);
    },
});
export const handleMessage = (g, msg, opts = {}) => server.handleMessage({ graph: g, opts }, msg);
// initialize, ping, tools/list and notifications never read the graph: the HTTP server answers them before a graph exists.
export const handleGraphlessMessage = (msg) => server.handleMessage({ opts: {} }, msg);
export const handleLine = (g, line, opts = {}) => server.handleLine({ graph: g, opts }, line);
export const serveStdio = (g, opts = {}) => server.serve({ graph: g, opts });
