import { isTestFile } from "../../shared/testfile.js";
import { contains, flatChildren, formAt, headName, kids, textOf as text, unwrap } from "../reader.js";
import { CORE_NS, defId, groupBy, UNKNOWN_NS } from "../model.js";
import { COMPOJURE, entries, entry, isRoute, joinPath, keywordOf } from "./route-data.js";
import { addChecks, definitionForm, NO_AUTHZ, routeDataAuthz } from "./route-authz.js";
import { wrappingOf } from "./ring-wrap.js";
const COMPOJURE_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'ANY']);
const METHOD_KEYS = new Set([':get', ':post', ':put', ':delete', ':patch', ':head', ':options', ':any']);
const CHAIN_KEYS = new Set([':middleware', ':interceptors']);
const DATA_LIBS = /^(reitit\.|io\.pedestal\.)/;
const ROUTERS = /^reitit\.(ring|http|core|frontend)\/router$/;
const libraryOf = (ns) => (ns === COMPOJURE ? 'compojure' : ns.startsWith('reitit.') ? 'reitit' : 'pedestal');
export const routeId = (r) => `route:${r.method} ${r.path} @${r.base}${r.mount}`;
const permissionId = (name) => `permission:${name}`;
const libraryMiddlewareId = (full) => `library_middleware:${full}`;
const exemptionId = (reason) => `authz_exemption:${reason}`;
function literalPath(f) {
    if (!f)
        return undefined;
    const u = unwrap(f);
    if (u.t === 'string')
        return u.text;
    if (u.t === 'vector' && u.children[0]?.t === 'string')
        return u.children[0].text;
    return undefined;
}
const chainForms = (m) => entries(m).filter(([k]) => CHAIN_KEYS.has(keywordOf(k) ?? '')).map(([, v]) => v);
// ---------- links ----------
const demoted = (links) => links.map((l) => ({ ...l, band: 'heuristic' }));
// The project definitions a handler form names: a symbol, or a call, whose own head is the handler and whose
// arguments may be the handlers it wraps (HEURISTIC: an argument can as well be data). A symbol or head that is
// used but defined nowhere is kept as an unresolved link: its definition is probably made by a macro kondo cannot expand.
function handlerLinks(ctx, file, f, argument = false) {
    const u = f && unwrap(f);
    if (!u)
        return [];
    const def = (x) => (x.t === 'symbol' ? ctx.defAt(file, x.row, x.col) : undefined);
    const unresolved = (x) => {
        const use = !argument && x.t === 'symbol' ? ctx.useAt(file, x.row, x.col) : undefined;
        const ns = use && (use.to === UNKNOWN_NS ? use.from : ctx.projectNs.has(use.to) ? use.to : undefined);
        return use && ns ? [{ def: `${ns}/${use.name}`, line: x.row, unresolved: true }] : [];
    };
    if (u.t === 'symbol') {
        const d = def(u);
        return d ? [{ def: d, line: u.row }] : unresolved(u);
    }
    if (u.t !== 'list')
        return [];
    const head = u.children[0] && def(u.children[0]);
    return [...(head ? [{ def: head, line: u.row }] : u.children[0] ? unresolved(unwrap(u.children[0])) : []),
        ...demoted(u.children.slice(1).flatMap((x) => handlerLinks(ctx, file, x, true)))];
}
// The elements of a middleware or interceptor vector.
const chainItems = (f) => {
    const u = f && unwrap(f);
    return u && u.t === 'vector' ? flatChildren(u) : [];
};
// [mw [mw2 arg] (mw3 arg) ...]: each project definition in order; a permission middleware's argument is its permission.
// A call's head is a middleware factory, so it guards only as a guess.
function chainOf(ctx, file, items) {
    const out = { links: [], permissions: [] };
    for (const x of items) {
        const item = unwrap(x);
        const parts = item.t === 'vector' || item.t === 'list' ? flatChildren(item) : [item];
        const head = unwrap(parts[0] ?? item);
        const def = head.t === 'symbol' ? ctx.defAt(file, head.row, head.col) : undefined;
        if (!def)
            continue;
        out.links.push({ def, file, line: head.row, ...(item.t === 'list' ? { band: 'heuristic' } : {}) });
        if (ctx.config.permissionMiddleware.includes(def) && parts[1])
            out.permissions.push({ form: parts[1], file });
    }
    return out;
}
// [interceptor ... handler]: the last element handles, the ones before it guard.
function interceptorChain(ctx, file, items) {
    return { guards: chainOf(ctx, file, items.slice(0, -1)).links, handlers: handlerLinks(ctx, file, items[items.length - 1]) };
}
// The clojure.core name a call's head resolves to.
function coreHead(ctx, file, f) {
    const head = f.t === 'list' ? f.children[0] : undefined;
    const use = head && head.t === 'symbol' ? ctx.useAt(file, head.row, head.col) : undefined;
    return use && CORE_NS.test(use.to) ? use.name : undefined;
}
// The elements of an interceptor chain written as a vector, or as (conj interceptors ... handler), pedestal's idiom
// for adding a handler to shared interceptors; null for any other form.
function chainElements(ctx, file, f) {
    if (f.t === 'vector')
        return flatChildren(f);
    return coreHead(ctx, file, f) === 'conj' ? kids(f).slice(1) : null;
}
// ---------- middleware around the routing table ----------
// Wrappers read around a route var or a router: each is a guard, as a guess (what it wraps is read from the code around it).
const wrapperGuards = (wrappers) => wrappers.map((w) => ({ def: w.def, file: w.file, line: w.line, band: 'heuristic',
    level: 'wrapper', ...(w.library ? { library: true } : {}) }));
// The permission arguments of the wrappers that are permission middleware: one more check each, as a guess.
const wrapperChecks = (wrappers) => wrappers.flatMap((w) => (w.permission ? [{ ...w.permission, guessed: true }] : []));
// ---------- compojure ----------
// The forms a branching or sequencing form may return its value from (the test of a conditional is never one).
function returnedForms(head, args) {
    const every = (from, step) => args.filter((_, i) => i >= from && (i - from) % step === 0);
    switch (head) {
        case 'if':
        case 'if-not':
        case 'if-let':
        case 'if-some': return args.slice(1);
        case 'cond': return every(1, 2);
        case 'case': return [...every(2, 2), ...(args.length % 2 === 0 ? [args[args.length - 1]] : [])];
        default: return args.slice(-1);
    }
}
// What a body returns: a var, a call of a project function (its head, and the calls it wraps as a guess), or what
// a let/do/if/cond/case returns, every branch of it (HEURISTIC: which branch runs is not decided here).
function returnedCall(ctx, file, f) {
    const u = unwrap(f);
    if (u.t === 'symbol')
        return handlerLinks(ctx, file, u);
    if (u.t !== 'list' || !u.children.length)
        return [];
    const head = unwrap(u.children[0]);
    if (head.t === 'symbol' && handlerLinks(ctx, file, head).length)
        return handlerLinks(ctx, file, u);
    return demoted(returnedForms(text(unwrap(u.children[0])) ?? '', u.children.slice(1)).flatMap((x) => returnedCall(ctx, file, x)));
}
// The path of a compojure context that is not a literal: the routes below it are served somewhere unknown.
const UNKNOWN_MOUNT = '{?}';
function compojureRoutes(ctx) {
    const macro = (u) => {
        const full = ctx.config.routeMacros[`${u.to}/${u.name}`] ?? `${u.to}/${u.name}`;
        return full.startsWith(`${COMPOJURE}/`) ? full.slice(COMPOJURE.length + 1) : undefined;
    };
    const ownerOf = (u) => (u.fromVar ? `${u.from}/${u.fromVar}` : u.from);
    const byFile = groupBy(ctx.analysis.varUses.filter((u) => macro(u)), (u) => u.file);
    const pathIn = (file, u) => {
        const form = formAt(ctx.forms(file), u.row, u.col);
        return literalPath(form ? kids(form)[1] : undefined);
    };
    // the paths of the contexts around a position in a file, outermost first
    const contextsAt = (file, row, col) => (byFile.get(file) ?? [])
        .filter((c) => macro(c) === 'context' && contains(c, row, col))
        .sort((a, b) => a.row - b.row || a.col - b.col)
        .map((c) => pathIn(file, c) ?? UNKNOWN_MOUNT)
        .join('');
    const found = [];
    for (const [file, uses] of byFile) {
        for (const u of uses) {
            const method = macro(u) ?? '';
            const path = COMPOJURE_METHODS.has(method) ? pathIn(file, u) : undefined;
            if (path !== undefined)
                found.push({ u, method, path });
        }
    }
    const bases = new Set(found.map(({ u }) => ownerOf(u)));
    // where a route var is mounted: each use of it outside tests, below the contexts around the use and the mounts of
    // the var that holds the use; a var nobody uses stands at the root
    const usesOf = groupBy(ctx.analysis.varUses.filter((u) => bases.has(`${u.to}/${u.name}`) && !isTestFile(u.file)), (u) => `${u.to}/${u.name}`);
    const mountsOf = (base, stack) => {
        const uses = (usesOf.get(base) ?? []).filter((u) => !stack.includes(ownerOf(u)) && ownerOf(u) !== base);
        if (!uses.length)
            return [''];
        const mounts = uses.flatMap((u) => mountsOf(ownerOf(u), [...stack, base]).map((m) => m + contextsAt(u.file, u.row, u.col)));
        return [...new Set(mounts)];
    };
    const wrapping = wrappingOf(ctx);
    return found.flatMap(({ u, method, path }) => {
        const form = formAt(ctx.forms(u.file), u.row, u.col);
        const handlers = form && kids(form).length > 3 ? returnedCall(ctx, u.file, kids(form)[kids(form).length - 1]) : [];
        const base = ownerOf(u);
        const local = contextsAt(u.file, u.row, u.col);
        const { wrappers, unknown } = form ? wrapping(u.file, form) : { wrappers: [], unknown: true };
        return mountsOf(base, []).map((mount) => ({ method, path, mount: mount + local, base, file: u.file, line: u.row, library: 'compojure', handlers,
            guards: wrapperGuards(wrappers), authz: addChecks(ctx, NO_AUTHZ, wrapperChecks(wrappers)), ...(unknown ? { middlewareUnknown: true } : {}) }));
    });
}
// ---------- route data ----------
// pedestal terse routes: ^:interceptors [...] beside the route data
const isInterceptorVector = (f) => f.t === 'meta' && keywordOf(f.children[0]) === ':interceptors' && unwrap(f).t === 'vector';
// A route's path: a literal, or a symbol naming a var whose value is one, also through vars that name other vars.
function pathOf(ctx, file, f, seen = new Set()) {
    const u = unwrap(f);
    if (u.t === 'string')
        return u.text;
    const def = u.t === 'symbol' ? ctx.defAt(file, u.row, u.col) : undefined;
    const d = def && !seen.has(def) ? definitionForm(ctx, def) : undefined;
    return def && d && !d.params ? pathOf(ctx, d.file, d.value, new Set([...seen, def])) : undefined;
}
const isRouteIn = (ctx, file, f) => isRoute(f)
    || (f.t === 'vector' && f.children.length > 1 && unwrap(f.children[0]).t === 'symbol' && /^(\/|$)/.test(pathOf(ctx, file, f.children[0]) ?? 'x'));
const isRouteGroupIn = (ctx, file, f) => f.t === 'vector' && flatChildren(f).some((x) => isRouteIn(ctx, file, unwrap(x)));
// (into ["/x" data] children) or (conj ["/x" data] child ...): one route with more children
function appendsToRoute(ctx, file, f) {
    const name = f.t === 'list' && f.children[1] && isRouteIn(ctx, file, unwrap(f.children[1])) ? coreHead(ctx, file, f) : undefined;
    return name === 'into' || name === 'conj';
}
// (f args) or (apply f args) where f is a route function.
function routeCall(ctx, file, f, fns) {
    const spread = coreHead(ctx, file, f) === 'apply';
    const [head, ...args] = kids(f).slice(spread ? 1 : 0);
    const u = f.t === 'list' && head ? unwrap(head) : undefined;
    const def = u && u.t === 'symbol' ? ctx.defAt(file, u.row, u.col) : undefined;
    return def && fns.has(def) ? { def, args, spread } : undefined;
}
// The forms a definition returns: its last form, or the last form of each arity of a multi-arity defn.
function returnedValues(form) {
    const xs = kids(form).slice(2).map(unwrap);
    const arities = xs.filter((x) => x.t === 'list' && x.children[0] && unwrap(x.children[0]).t === 'vector');
    return arities.length && !xs.some((x) => x.t === 'vector') ? arities.map((a) => unwrap(kids(a)[kids(a).length - 1])) : xs.slice(-1);
}
// Each definition whose body holds route vectors: a function or var returning a route tree. It may live in a file
// that never names the routing library and only returns data a router file mounts. A definition whose whole value
// is another route function, or a call of one (a Polylith interface, in any of its arities), stands for it.
function routeFunctions(ctx) {
    const out = new Map();
    const valuesOf = new Map();
    for (const d of ctx.defs.values()) {
        const form = formAt(ctx.forms(d.file), d.row, d.col);
        if (!form)
            continue;
        const roots = [];
        const visit = (f) => {
            const u = unwrap(f);
            if (isRouteIn(ctx, d.file, u) || isRouteGroupIn(ctx, d.file, u) || appendsToRoute(ctx, d.file, u))
                roots.push(u);
            else
                kids(u).forEach(visit);
        };
        kids(form).forEach(visit);
        const full = `${d.ns}/${d.name}`;
        if (roots.length)
            out.set(full, { file: d.file, roots });
        else if (kids(form).length >= 3)
            valuesOf.set(full, { file: d.file, values: returnedValues(form) });
    }
    const standsFor = (file, v) => {
        const def = v.t === 'symbol' ? ctx.defAt(file, v.row, v.col) : undefined;
        return def ? out.has(def) : !!routeCall(ctx, file, v, out);
    };
    for (let grew = true; grew;) {
        grew = false;
        for (const [full, { file, values }] of valuesOf) {
            const roots = values.filter((v) => standsFor(file, v));
            if (out.has(full) || !roots.length)
                continue;
            out.set(full, { file, roots });
            grew = true;
        }
    }
    return out;
}
// The route functions a route tree names, as `nested` mounts them: symbols inside vectors, calls and conditionals.
function mountsIn(ctx, file, f, fns) {
    const u = unwrap(f);
    if (u.t === 'symbol') {
        const def = ctx.defAt(file, u.row, u.col);
        return def && fns.has(def) ? [def] : [];
    }
    return u.t === 'vector' || u.t === 'list' || u.t === 'cond' ? flatChildren(u).flatMap((x) => mountsIn(ctx, file, x, fns)) : [];
}
const REBINDERS = /^(let|loop|for|doseq|binding|with-open|(when|if)-(let|some|first)|fn\*?)$/;
// A name the function binds again, (let [child ...] ...) or (fn [child] ...), no longer stands for its argument.
function rebinds(f, name) {
    const u = unwrap(f);
    const fnLike = /^fn/.test(headName(u) ?? '');
    const vec = REBINDERS.test(headName(u) ?? '') ? kids(u).slice(1, 3).map(unwrap).find((x) => x.t === 'vector') : undefined;
    const here = !!vec && flatChildren(vec).some((x, i) => (fnLike || i % 2 === 0) && unwrap(x).t === 'symbol' && text(unwrap(x)) === name);
    return here || kids(u).some((x) => rebinds(x, name));
}
// A call's arguments bound to the plain-symbol parameters of the one arity of the function it calls. With apply the
// last argument is a collection of further arguments, so only a rest parameter after every given one can take it.
function bind(params, body, call, file, env) {
    const out = new Map();
    const ps = params ? flatChildren(params).map(unwrap) : [];
    const amp = ps.findIndex((p) => p.t === 'symbol' && p.text === '&');
    const fixed = amp < 0 ? ps : ps.slice(0, amp);
    const given = call.spread ? call.args.slice(0, -1) : call.args;
    const set = (p, forms) => {
        if (p?.t === 'symbol' && forms.length && !(body && rebinds(body, p.text)))
            out.set(p.text, { forms, file, env, reached: false });
    };
    fixed.forEach((p, i) => set(p, given.slice(i, i + 1)));
    if (amp >= 0 && given.length >= fixed.length)
        set(ps[amp + 1], call.args.slice(fixed.length));
    return out;
}
function routeWalker(ctx, fns) {
    const out = [];
    const mounted = new Set();
    const visited = new Set();
    const route = (v, file, scope, appended = []) => {
        const xs = [...flatChildren(v), ...appended];
        const path = joinPath(scope.prefix, pathOf(ctx, file, xs[0]) ?? '');
        const emit = (method, handlers, guards, authz) => out.push({ method, path, mount: '', base: scope.base, file, line: v.row, library: scope.library, handlers, guards, authz,
            ...(scope.unknown ? { middlewareUnknown: true } : {}) });
        const verb = xs[1] && keywordOf(xs[1]);
        if (verb && METHOD_KEYS.has(verb) && xs[2]) {
            // pedestal table route: [path :verb handler-or-interceptor-vector & options]
            const target = unwrap(xs[2]);
            const items = chainElements(ctx, file, target);
            const chain = items ? interceptorChain(ctx, file, items) : { guards: [], handlers: handlerLinks(ctx, file, target) };
            emit(verb.slice(1).toUpperCase(), chain.handlers, [...scope.guards, ...chain.guards.map((l) => ({ ...l, level: 'route' }))], addChecks(ctx, scope.authz, scope.checks));
            return;
        }
        const dataForm = xs.slice(1).find((x) => unwrap(x).t === 'map');
        const data = dataForm && unwrap(dataForm);
        const own = xs.slice(1).filter(isInterceptorVector).map((x) => chainOf(ctx, file, chainItems(x)));
        const methods = [];
        // a symbol beside the path is the handler, unless it is a route function mounted here
        let handler = data ? undefined : xs.slice(1).find((x) => {
            const u = unwrap(x);
            const def = u.t === 'symbol' ? ctx.defAt(file, u.row, u.col) : undefined;
            return u.t === 'symbol' && !(def && fns.has(def));
        });
        for (const [k, val] of data ? entries(data) : []) {
            const key = keywordOf(k) ?? '';
            if (CHAIN_KEYS.has(key))
                own.push(chainOf(ctx, file, chainItems(val)));
            else if (METHOD_KEYS.has(key))
                methods.push([key, val]);
            else if (key === ':handler')
                handler = val;
        }
        const guards = [...scope.guards, ...own.flatMap((c) => c.links).map((l) => ({ ...l, level: 'route' }))];
        const authz = routeDataAuthz(ctx, file, data) ?? scope.authz;
        const checks = [...scope.checks, ...own.flatMap((c) => c.permissions)];
        if (handler)
            emit('ANY', handlerLinks(ctx, file, handler), guards, addChecks(ctx, authz, checks));
        for (const [key, val] of methods) {
            const u = unwrap(val);
            const m = u.t === 'map' ? u : undefined;
            const chains = m ? chainForms(m).map((c) => chainOf(ctx, file, chainItems(c))) : [];
            // pedestal: {:get [route-name interceptor ... handler]}
            const inline = u.t === 'vector' ? interceptorChain(ctx, file, flatChildren(u)) : { guards: [],
                handlers: handlerLinks(ctx, file, m ? entry(m, ':handler') : val) };
            const methodGuards = [...chains.flatMap((c) => c.links), ...inline.guards].map((l) => ({ ...l, level: 'method' }));
            const methodAuthz = addChecks(ctx, routeDataAuthz(ctx, file, m) ?? authz, [...checks, ...chains.flatMap((c) => c.permissions)]);
            emit(key.slice(1).toUpperCase(), inline.handlers, [...guards, ...methodGuards], methodAuthz);
        }
        const inner = { ...scope, prefix: path, authz, checks, guards: guards.map((g) => ({ ...g, inheritedFrom: g.inheritedFrom ?? path })) };
        for (const x of xs.slice(1))
            nested(x, file, inner);
    };
    const mount = (def, scope, env) => {
        const fn = fns.get(def);
        if (!fn || scope.stack.includes(def))
            return;
        mounted.add(def);
        for (const r of fn.roots)
            nested(r, fn.file, { ...scope, stack: [...scope.stack, def], env });
    };
    // An argument no parameter carried into the tree is served below this call at a path not known here.
    const mountCall = (call, file, scope) => {
        const d = definitionForm(ctx, call.def);
        const env = bind(d?.params, d?.value, call, file, scope.env);
        mount(call.def, scope, env);
        const carried = new Set([...env.values()].filter((b) => b.reached).flatMap((b) => b.forms));
        const unknown = { ...scope, prefix: joinPath(scope.prefix, UNKNOWN_MOUNT) };
        for (const a of call.args.filter((x) => !carried.has(x)))
            nested(a, file, unknown);
    };
    // a route, a group of routes, a call or conditional holding them, a route function or var to mount here, or a
    // parameter of the route function being mounted, which stands for the arguments it was called with
    const nested = (f, file, scope) => {
        const u = unwrap(f);
        visited.add(`${file}:${u.row}:${u.col}`);
        const call = routeCall(ctx, file, u, fns);
        if (u.t === 'symbol') {
            const def = ctx.defAt(file, u.row, u.col);
            const bound = ctx.useAt(file, u.row, u.col) ? undefined : scope.env.get(u.text);
            if (def)
                mount(def, scope, new Map());
            else if (bound) {
                bound.reached = true;
                for (const x of bound.forms)
                    nested(x, bound.file, { ...scope, env: bound.env });
            }
        }
        else if (call)
            mountCall(call, file, scope);
        else if (isRouteIn(ctx, file, u))
            route(u, file, scope);
        else if (appendsToRoute(ctx, file, u)) {
            // (into ["/x" data] children) and (conj ["/x" data] child ...) build one route with more children
            route(unwrap(kids(u)[1]), file, scope, kids(u).slice(2));
        }
        else if (u.t === 'vector' || u.t === 'list' || u.t === 'cond')
            for (const x of flatChildren(u))
                nested(x, file, scope);
    };
    return { routes: out, mounted, visited, nested };
}
// (router routes {:data {:middleware [...]}}): router data applies to every route below it; a router built in test code serves nothing
function routerCalls(ctx, files, walker, owner, scopeAt) {
    const wrapping = wrappingOf(ctx);
    for (const call of ctx.analysis.varUses.filter((u) => ROUTERS.test(`${u.to}/${u.name}`) && files.has(u.file) && !isTestFile(u.file))) {
        const form = formAt(ctx.forms(call.file), call.row, call.col);
        const [routesArg, opts] = form ? kids(form).slice(1) : [];
        if (!form || !routesArg)
            continue;
        const data = opts && unwrap(opts).t === 'map' ? entry(unwrap(opts), ':data') : undefined;
        const chains = (data && unwrap(data).t === 'map' ? chainForms(unwrap(data)) : []).map((c) => chainOf(ctx, call.file, chainItems(c)));
        const around = wrapping(call.file, form);
        const guards = [...wrapperGuards(around.wrappers).map((g) => ({ ...g, inheritedFrom: 'around the router' })),
            ...chains.flatMap((c) => c.links).map((l) => ({ ...l, level: 'router-data', inheritedFrom: 'router :data' }))];
        const base = owner({ ...call, row: call.nameRow, col: call.nameCol }).replace(/^(definition|namespace):/, '');
        walker.nested(routesArg, call.file, scopeAt(call.file, base, guards, [...wrapperChecks(around.wrappers), ...chains.flatMap((c) => c.permissions)], around.unknown));
    }
}
// Route trees no router call reaches stand where they are written, in files that use a routing library.
// The ones another route function mounts come last: mounting them there marks them, so they stand alone only when nobody does.
// A root that names a route function whose trees were all walked already (a var holding the router) is that tree again.
function standingTrees(ctx, files, fns, walker, scopeAt) {
    const mountedByAnother = new Set([...fns].flatMap(([def, fn]) => fn.roots.flatMap((r) => mountsIn(ctx, fn.file, r, fns)).filter((m) => m !== def)));
    const walked = (file, r, seen) => {
        const def = r.t === 'symbol' ? ctx.defAt(file, r.row, r.col) : routeCall(ctx, file, r, fns)?.def;
        const fn = def && !seen.includes(def) ? fns.get(def) : undefined;
        return walker.visited.has(`${file}:${r.row}:${r.col}`) || (!!def && !!fn && fn.roots.every((x) => walked(fn.file, x, [...seen, def])));
    };
    for (const [def, fn] of [...fns].sort(([a], [b]) => Number(mountedByAnother.has(a)) - Number(mountedByAnother.has(b)))) {
        if (walker.mounted.has(def) || !files.has(fn.file) || isTestFile(fn.file))
            continue;
        for (const r of fn.roots)
            if (!walked(fn.file, r, [def]))
                walker.nested(r, fn.file, scopeAt(fn.file, def, [], [], true));
    }
}
function dataRoutes(ctx, owner) {
    const libs = new Map();
    for (const u of ctx.analysis.nsUses)
        if (DATA_LIBS.test(u.to))
            libs.set(u.file, (libs.get(u.file) ?? new Set()).add(libraryOf(u.to)));
    const files = new Map([...libs].map(([f, s]) => [f, [...s].sort().join(', ')]));
    const fns = routeFunctions(ctx);
    const walker = routeWalker(ctx, fns);
    const scopeAt = (file, base, guards, checks, unknown) => ({ prefix: '', guards, authz: NO_AUTHZ, checks, base, library: files.get(file) ?? '', stack: [], unknown, env: new Map() });
    routerCalls(ctx, files, walker, owner, scopeAt);
    standingTrees(ctx, files, fns, walker, scopeAt);
    return walker.routes;
}
// A handler that calls a declared permission fn with a keyword checks that permission (HEURISTIC, one level deep).
function handlerPermissions(ctx) {
    const calls = groupBy(ctx.analysis.varUses.filter((u) => u.fromVar && ctx.config.permissionFns.includes(`${u.to}/${u.name}`)), (u) => `${u.from}/${u.fromVar}`);
    return (handlers, check) => handlers.flatMap((h) => (calls.get(h.def) ?? []).flatMap((u) => {
        const call = formAt(ctx.forms(u.file), u.row, u.col);
        return (call ? kids(call).slice(1).map(unwrap) : [])
            .filter((k) => k.t === 'keyword')
            .map((k) => ({ name: text(k) ?? '?', dynamic: false, check, checks: check, alternative: 1, alternatives: 1, allOf: 1, file: u.file, line: k.row }));
    }));
}
export const serverRoutes = (ctx, owner) => [...compojureRoutes(ctx), ...dataRoutes(ctx, owner)];
export const httpRoutes = {
    name: 'routes',
    edgeKinds: ['routes_to', 'guarded_by', 'requires_permission', 'exempted_by'],
    detect: (ctx) => {
        const libs = new Set(ctx.analysis.nsUses.map((u) => u.to).flatMap((n) => (n === COMPOJURE || DATA_LIBS.test(n) ? [libraryOf(n)] : [])));
        return libs.size ? [...libs].sort().join(', ') : null;
    },
    run: (ctx, owner) => {
        const nodes = [];
        const edges = [];
        const inHandlers = handlerPermissions(ctx);
        const routes = serverRoutes(ctx, owner);
        const sites = groupBy(routes, routeId);
        for (const r of routes) {
            const id = routeId(r);
            // several definitions behind one id (the same method and path twice in a router): which one serves is not decided
            const competing = new Set((sites.get(id) ?? []).map((x) => `${x.file}:${x.line}`)).size;
            const bandOf = (own) => (competing > 1 ? 'heuristic' : own ?? 'static_proven');
            const component = ctx.componentOf(r.file);
            const unresolved = r.handlers.filter((h) => h.unresolved).map((h) => h.def);
            nodes.push({
                id, kind: 'route', name: `${r.method} ${r.mount}${r.path} @${r.base}`, file: r.file, line: r.line, ...(component ? { component } : {}),
                attrs: { method: r.method.toLowerCase(), path: r.path, full_path: `${r.mount}${r.path}`, base: r.base, mount: r.mount, library: r.library,
                    ...(competing > 1 ? { conflict: competing } : {}), ...(r.middlewareUnknown ? { middleware: 'unknown' } : {}),
                    ...(unresolved.length ? { unresolved_handler: unresolved.join(', ') } : {}) },
            });
            for (const h of r.handlers.filter((x) => !x.unresolved))
                edges.push({ from: id, to: defId(h.def), kind: 'routes_to', band: bandOf(h.band), file: r.file,
                    line: h.line });
            for (const g of r.guards.filter((x) => x.library))
                nodes.push({ id: libraryMiddlewareId(g.def), kind: 'library_middleware', name: g.def,
                    file: g.file ?? r.file, line: g.line });
            r.guards.forEach((g, order) => edges.push({
                from: id, to: g.library ? libraryMiddlewareId(g.def) : defId(g.def), kind: 'guarded_by', band: bandOf(g.band), file: g.file ?? r.file, line: g.line,
                attrs: { order, level: g.level, ...(g.inheritedFrom ? { inherited_from: g.inheritedFrom } : {}) },
            }));
            const declared = r.authz.permissions;
            const found = inHandlers(r.handlers, declared.reduce((m, p) => Math.max(m, p.check), 0) + 1);
            const checks = Math.max(0, ...[...declared, ...found].map((x) => x.check), ...declared.map((x) => x.checks));
            for (const p of [...declared, ...found]) {
                nodes.push({ id: permissionId(p.name), kind: 'permission', name: p.name, file: p.file, line: p.line,
                    ...(p.dynamic ? { attrs: { dynamic: true } } : {}) });
                edges.push({
                    from: id, to: permissionId(p.name), kind: 'requires_permission',
                    band: p.dynamic ? 'unknown' : bandOf(found.includes(p) || p.guessed ? 'heuristic' : undefined), file: p.file, line: p.line,
                    attrs: { check: p.check, checks, alternative: p.alternative, alternatives: p.alternatives, all_of: p.allOf, ...(p.scope ? { tenant: p.scope } : {}) },
                });
            }
            if (r.authz.exempt) {
                nodes.push({ id: exemptionId(r.authz.exempt.reason), kind: 'authz_exemption', name: r.authz.exempt.reason, file: r.authz.exempt.file,
                    line: r.authz.exempt.line });
                edges.push({ from: id, to: exemptionId(r.authz.exempt.reason), kind: 'exempted_by', band: bandOf(undefined), file: r.authz.exempt.file,
                    line: r.authz.exempt.line,
                    attrs: { label: r.authz.exempt.reason } });
            }
        }
        return { nodes, edges };
    },
};
