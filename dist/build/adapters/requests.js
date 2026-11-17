import { flatChildren, formAt, kids, textOf, unwrap, walk } from "../reader.js";
import { groupBy } from "../model.js";
import { entry, keywordOf } from "./route-data.js";
import { canonicalPath } from "../../shared/route-path.js";
import { routeId, serverRoutes } from "./routes.js";
const CLIENT_FILE = /\.clj[sc]$/;
const AJAX = /^ajax\.core\/(GET|POST|PUT|DELETE|PATCH|HEAD)$/;
const CLJS_HTTP = /^cljs-http\.client\/(get|post|put|delete|patch|head)$/;
const requestId = (r) => `request:${r.file}:${r.row}:${r.col}`;
// "/a" -> /a, literal; (str "/a/" id "/b") -> /a/{p}/b, built at runtime; a project URL helper is read through its
// body with its parameters bound to the call's arguments, so (user-url "5") over (str "/users/" id "/profile") is
// /users/5/profile. Anything else is not a path.
function uriOf(ctx, file, f, bound = new Map(), stack = []) {
    const u = f && unwrap(f);
    if (u?.t === 'string')
        return { path: u.text, literal: true };
    if (u?.t === 'symbol')
        return bound.get(u.text);
    if (u?.t !== 'list' || !u.children.length)
        return undefined;
    const part = (x) => uriOf(ctx, file, x, bound, stack) ?? { path: '{p}', literal: false };
    const join = (xs) => ({ path: xs.map((p) => p.path).join(''), literal: xs.every((p) => p.literal) });
    const head = unwrap(u.children[0]);
    if (textOf(head) === 'str') {
        const built = join(u.children.slice(1).map(part));
        return built.path.startsWith('/') ? built : undefined;
    }
    const def = head.t === 'symbol' ? ctx.defAt(file, head.row, head.col) : undefined;
    return def && !stack.includes(def) ? helperUri(ctx, def, u.children.slice(1).map(part), [...stack, def]) : undefined;
}
// What a URL helper returns for the given arguments: its body (defn f [a b] (str "/x/" a b)), or every argument
// after a literal for (defn f [& paths] (apply str "/api" paths)).
function helperUri(ctx, def, args, stack) {
    const d = ctx.defs.get(def);
    const form = d && /\/defn-?$/.test(d.definedBy ?? '') ? formAt(ctx.forms(d.file), d.row, d.col) : undefined;
    const xs = form ? kids(form).map(unwrap) : [];
    const body = xs[xs.length - 1];
    const params = xs.find((x, i) => i >= 2 && x.t === 'vector');
    if (body?.t !== 'list' || !params || params === body || !d)
        return undefined;
    const names = flatChildren(params).map((p) => textOf(unwrap(p)) ?? '');
    const parts = body.children.map(unwrap);
    if (textOf(parts[0]) === 'apply' && textOf(parts[1]) === 'str') {
        const [lit, rest] = [parts[2], parts[3]];
        const isRest = names.length === 2 && names[0] === '&' && textOf(rest) === names[1] && parts.length === 4;
        return isRest && lit?.t === 'string' && lit.text.startsWith('/')
            ? { path: lit.text + args.map((a) => a.path).join(''), literal: args.every((a) => a.literal) } : undefined;
    }
    if (names.some((n) => n === '&') || names.length !== args.length)
        return undefined;
    return uriOf(ctx, d.file, body, new Map(names.map((n, i) => [n, args[i]])), stack);
}
// js/fetch is interop clj-kondo does not report as a var usage, so it is read from the forms
function fetchCall(ctx, f, file, from) {
    if (f.t !== 'list' || textOf(f.children[0]) !== 'js/fetch')
        return undefined;
    const uri = uriOf(ctx, file, f.children[1]);
    if (!uri)
        return undefined;
    const raw = f.children[2] && unwrap(f.children[2]);
    // the options are a #js {...} literal or a map
    const opts = raw?.t === 'tagged' ? unwrap(raw.children[0]) : raw;
    const method = opts?.t === 'map' ? textOf(unwrap(entry(opts, ':method') ?? opts)) : undefined;
    return { method: (method ?? 'GET').replace(/^:/, '').toUpperCase(), ...uri, file, row: f.row, col: f.col, from };
}
function effectMaps(ctx, file, from) {
    const out = [];
    for (const f of walk(ctx.forms(file))) {
        const fetch = fetchCall(ctx, f, file, from);
        if (fetch)
            out.push(fetch);
        if (f.t !== 'map')
            continue;
        const method = entry(f, ':method');
        const at = entry(f, ':uri') ?? entry(f, ':url');
        const uri = uriOf(ctx, file, at);
        const m = method && keywordOf(method);
        if (!at || !uri || !m)
            continue;
        // cited where the URI is written
        out.push({ method: m.slice(1).toUpperCase(), ...uri, file, row: at.row, col: at.col, from });
    }
    return out;
}
function calls(ctx) {
    return ctx.analysis.varUses.flatMap((u) => {
        const full = `${u.to}/${u.name}`;
        if (!CLIENT_FILE.test(u.file) || !(AJAX.test(full) || CLJS_HTTP.test(full)))
            return [];
        const form = formAt(ctx.forms(u.file), u.row, u.col);
        const uri = uriOf(ctx, u.file, form ? kids(form)[1] : undefined);
        if (!form || !uri)
            return [];
        return [{ method: u.name.toUpperCase(), ...uri, file: u.file, row: u.row, col: u.col, from: u.from, ...(u.fromVar ? { fromVar: u.fromVar } : {}) }];
    });
}
// a query string or fragment is not part of the path a route serves
const routeKey = (method, path) => `${method} ${canonicalPath(path.replace(/[?#].*$/, '')).replace(/(.)\/$/, '$1')}`;
export const requests = {
    name: 'requests',
    edgeKinds: ['issues_request', 'requests_route'],
    detect: (ctx) => (ctx.analysis.nsDefs.some((d) => CLIENT_FILE.test(d.file)) ? 'ClojureScript sources' : null),
    run: (ctx, owner) => {
        const found = [
            ...ctx.analysis.nsDefs.filter((d) => CLIENT_FILE.test(d.file)).flatMap((d) => effectMaps(ctx, d.file, d.name)),
            ...calls(ctx),
        ];
        const byKey = groupBy(serverRoutes(ctx, owner), (r) => routeKey(r.method, `${r.mount}${r.path}`));
        const nodes = [];
        const edges = [];
        for (const q of found) {
            const id = requestId(q);
            const component = ctx.componentOf(q.file);
            nodes.push({
                id, kind: 'request', name: `${q.method} ${q.path}`, file: q.file, line: q.row, ...(component ? { component } : {}),
                attrs: { method: q.method.toLowerCase(), path: q.path, literal_uri: q.literal, dynamic: !q.literal },
            });
            edges.push({ from: owner(q), to: id, kind: 'issues_request', band: q.literal ? 'static_proven' : 'heuristic', file: q.file, line: q.row });
            const copies = [...(byKey.get(routeKey(q.method, q.path)) ?? []), ...(byKey.get(routeKey('ANY', q.path)) ?? [])];
            for (const r of copies) {
                edges.push({
                    from: id, to: routeId(r), kind: 'requests_route', band: q.literal && copies.length === 1 ? 'static_proven' : 'heuristic', file: q.file, line: q.row,
                    attrs: { copies: copies.length, reason: copies.length === 1 ? 'method and canonical path match one route'
                            : `method and canonical path match ${copies.length} served copies` },
                });
            }
        }
        return { nodes, edges };
    },
};
