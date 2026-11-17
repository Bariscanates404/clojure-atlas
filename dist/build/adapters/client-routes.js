import { flatChildren, formAt, kids, textOf, unwrap } from "../reader.js";
import { isTestFile } from "../../shared/testfile.js";
import { groupBy } from "../model.js";
import { entry, isRoute, isRouteGroup, joinPath } from "./route-data.js";
import { canonicalPath } from "../../shared/route-path.js";
const CLIENT_KEYS = [':name', ':view'];
const usesReitit = (u) => /\.clj[cs]$/.test(u.file) && u.to.startsWith('reitit.');
const usesFrontendRouter = (u) => /\.clj[cs]$/.test(u.file) && u.to.startsWith('reitit.frontend') && !isTestFile(u.file);
// [path {:name ...}] with nothing else to tell it from other data: a literal route table
const isEntry = (f) => {
    const xs = flatChildren(f);
    const data = xs[1] && unwrap(xs[1]);
    return isRoute(f) && !!data && data.t === 'map' && !!entry(data, ':name');
};
// (when cond entry): an entry that only exists under a condition
const conditional = (f) => (f.t === 'list' && f.children.length === 3 && textOf(unwrap(f.children[0])) === 'when'
    ? unwrap(f.children[2]) : undefined);
const isTable = (f) => f.t === 'vector' && flatChildren(f).length > 0
    && flatChildren(f).every((x) => isEntry(unwrap(x)) || isEntry(conditional(unwrap(x)) ?? x));
const clientRouteId = (path) => `client_route:${canonicalPath(path)}`;
function reititRoutes(ctx, file, tablesOnly) {
    const out = [];
    const route = (v, prefix) => {
        const xs = flatChildren(v);
        const path = joinPath(prefix, textOf(unwrap(xs[0])) ?? '');
        const data = xs.slice(1).map(unwrap).find((x) => x.t === 'map');
        const named = data && CLIENT_KEYS.some((k) => entry(data, k));
        const name = data && entry(data, ':name');
        if (named)
            out.push({ path, file, line: v.row, ...(tablesOnly ? { table: true } : {}),
                ...(name && unwrap(name).t === 'keyword' ? { name: ctx.nameOf(file, unwrap(name)) } : {}) });
        for (const x of xs.slice(1))
            nested(unwrap(x), path);
    };
    const nested = (f, prefix) => {
        if (isRoute(f))
            route(f, prefix);
        else if (f.t === 'vector')
            for (const x of flatChildren(f))
                nested(unwrap(x), prefix);
        else if (conditional(f))
            nested(conditional(f), prefix);
    };
    const visit = (forms) => {
        for (const f of forms) {
            const u = unwrap(f);
            if (tablesOnly ? isTable(u) : isRoute(u) || isRouteGroup(u))
                nested(u, '');
            else
                visit(kids(u));
        }
    };
    visit(ctx.forms(file));
    return out;
}
// (defroute "/path" [...] ...) or (defroute name "/path" [...] ...)
function secretaryRoutes(ctx) {
    return ctx.analysis.varUses.filter((u) => u.to === 'secretary.core' && u.name === 'defroute').flatMap((u) => {
        const form = formAt(ctx.forms(u.file), u.row, u.col);
        const path = form ? kids(form).slice(1, 3).map(unwrap).find((x) => x.t === 'string') : undefined;
        return path ? [{ path: textOf(path) ?? '', file: u.file, line: u.row }] : [];
    });
}
export const clientRoutes = {
    name: 'client_routes',
    edgeKinds: [],
    detect: (ctx) => (ctx.analysis.nsUses.some((u) => usesReitit(u) || u.to === 'secretary.core') ? 'reitit in ClojureScript or secretary' : null),
    run: (ctx) => {
        const files = new Set(ctx.analysis.nsUses.filter(usesReitit).map((u) => u.file));
        // where reitit's frontend router is used, a route table in another namespace is the router's input
        const tableFiles = ctx.analysis.nsUses.some(usesFrontendRouter)
            ? [...new Set(ctx.analysis.nsDefs.map((d) => d.file))].filter((f) => /\.clj[cs]$/.test(f) && !files.has(f) && !isTestFile(f))
            : [];
        const found = [...[...files].flatMap((f) => reititRoutes(ctx, f, false)), ...tableFiles.flatMap((f) => reititRoutes(ctx, f, true)),
            ...secretaryRoutes(ctx)];
        // routes whose paths differ only in parameter names (/a/:id, /a/:slug) are one node that lists every spelling and name
        const nodes = [...groupBy(found, (r) => clientRouteId(r.path))].map(([id, routes]) => {
            const [first] = routes;
            const component = ctx.componentOf(first.file);
            const names = [...new Set(routes.flatMap((r) => (r.name ? [r.name] : [])))];
            const paths = [...new Set(routes.map((r) => r.path))];
            const several = paths.length > 1 || names.length > 1;
            const heuristic = routes.every((r) => r.table);
            return {
                id, kind: 'client_route', name: canonicalPath(first.path), file: first.file, line: first.line,
                ...(component ? { component } : {}),
                attrs: { path: first.path, ...(heuristic ? { band: 'heuristic' } : {}), ...(names.length === 1 ? { name: names[0] } : {}),
                    ...(several ? { paths, ...(names.length > 1 ? { names } : {}) } : {}) },
            };
        });
        return { nodes, edges: [] };
    },
};
