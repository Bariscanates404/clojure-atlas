// HTTP routes: compojure method macros (mount from `context`) and route data vectors (reitit, pedestal) whose
// first element is a literal path, followed into the functions that return route trees and under router :data.
// Edges: routes_to (handler), guarded_by (middleware, outermost first), and the authz .clojure-atlas.edn declares.
import type { GraphEdge, GraphNode } from '../../mcp/graph.ts';
import { isTestFile } from '../../shared/testfile.ts';
import type { VarUse } from '../analysis.ts';
import { contains, flatChildren, formAt, kids, textOf as text, unwrap, type Form } from '../reader.ts';
import { CORE_NS, defId, groupBy, UNKNOWN_NS, type Adapter, type Context, type Owner } from '../model.ts';
import { COMPOJURE, entries, entry, isRoute, isRouteGroup, joinPath, keywordOf } from './route-data.ts';
import { addChecks, NO_AUTHZ, routeDataAuthz, type Authz, type Check, type Permission } from './route-authz.ts';
import { wrappingOf, type Wrapper } from './ring-wrap.ts';

const COMPOJURE_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'ANY']);
const METHOD_KEYS = new Set([':get', ':post', ':put', ':delete', ':patch', ':head', ':options', ':any']);
const CHAIN_KEYS = new Set([':middleware', ':interceptors']);
const DATA_LIBS = /^(reitit\.|io\.pedestal\.)/;
const ROUTERS = /^reitit\.(ring|http|core|frontend)\/router$/;
const libraryOf = (ns: string) => (ns === COMPOJURE ? 'compojure' : ns.startsWith('reitit.') ? 'reitit' : 'pedestal');

interface Link {
  def: string;
  // the file the form is written in; absent: the route's own file
  file?: string;
  line: number;
  // absent: the form itself names the definition; heuristic: it is an argument or one branch of what the route returns
  band?: 'heuristic';
  // a project name the build saw used, never defined (a macro kondo cannot expand): def is its qualified name, no node stands for it
  unresolved?: boolean;
}

interface Guard extends Link {
  level: string;
  inheritedFrom?: string;
  // a library var: no project definition stands for it
  library?: boolean;
}

export interface Route {
  method: string;
  path: string;
  mount: string;
  base: string;
  file: string;
  line: number;
  library: string;
  handlers: Link[];
  guards: Guard[];
  authz: Authz;
  // the middleware around the route could not be read
  middlewareUnknown?: boolean;
}


export const routeId = (r: Pick<Route, 'method' | 'path' | 'base' | 'mount'>) => `route:${r.method} ${r.path} @${r.base}${r.mount}`;
const permissionId = (name: string) => `permission:${name}`;
const libraryMiddlewareId = (full: string) => `library_middleware:${full}`;
const exemptionId = (reason: string) => `authz_exemption:${reason}`;


function literalPath(f: Form | undefined): string | undefined {
  if (!f) return undefined;
  const u = unwrap(f);
  if (u.t === 'string') return u.text;
  if (u.t === 'vector' && u.children[0]?.t === 'string') return u.children[0].text;
  return undefined;
}

const chainForms = (m: Form): Form[] => entries(m).filter(([k]) => CHAIN_KEYS.has(keywordOf(k) ?? '')).map(([, v]) => v);

// ---------- links ----------

const demoted = (links: readonly Link[]): Link[] => links.map((l) => ({ ...l, band: 'heuristic' }));

// The project definitions a handler form names: a symbol, or a call, whose own head is the handler and whose
// arguments may be the handlers it wraps (HEURISTIC: an argument can as well be data). A symbol or head that is
// used but defined nowhere is kept as an unresolved link: its definition is probably made by a macro kondo cannot expand.
function handlerLinks(ctx: Context, file: string, f: Form | undefined, argument = false): Link[] {
  const u = f && unwrap(f);
  if (!u) return [];
  const def = (x: Form) => (x.t === 'symbol' ? ctx.defAt(file, x.row, x.col) : undefined);
  const unresolved = (x: Form): Link[] => {
    const use = !argument && x.t === 'symbol' ? ctx.useAt(file, x.row, x.col) : undefined;
    const ns = use && (use.to === UNKNOWN_NS ? use.from : ctx.projectNs.has(use.to) ? use.to : undefined);
    return use && ns ? [{ def: `${ns}/${use.name}`, line: x.row, unresolved: true }] : [];
  };
  if (u.t === 'symbol') {
    const d = def(u);
    return d ? [{ def: d, line: u.row }] : unresolved(u);
  }
  if (u.t !== 'list') return [];
  const head = u.children[0] && def(u.children[0]);
  return [...(head ? [{ def: head, line: u.row }] : u.children[0] ? unresolved(unwrap(u.children[0])) : []),
    ...demoted(u.children.slice(1).flatMap((x) => handlerLinks(ctx, file, x, true)))];
}

interface Chain {
  links: Link[];
  permissions: Check[];
}

// The elements of a middleware or interceptor vector.
const chainItems = (f: Form | undefined): Form[] => {
  const u = f && unwrap(f);
  return u && u.t === 'vector' ? flatChildren(u) : [];
};

// [mw [mw2 arg] (mw3 arg) ...]: each project definition in order; a permission middleware's argument is its permission.
// A call's head is a middleware factory, so it guards only as a guess.
function chainOf(ctx: Context, file: string, items: readonly Form[]): Chain {
  const out: Chain = { links: [], permissions: [] };
  for (const x of items) {
    const item = unwrap(x);
    const parts = item.t === 'vector' || item.t === 'list' ? flatChildren(item) : [item];
    const head = unwrap(parts[0] ?? item);
    const def = head.t === 'symbol' ? ctx.defAt(file, head.row, head.col) : undefined;
    if (!def) continue;
    out.links.push({ def, file, line: head.row, ...(item.t === 'list' ? { band: 'heuristic' as const } : {}) });
    if (ctx.config.permissionMiddleware.includes(def) && parts[1]) out.permissions.push({ form: parts[1], file });
  }
  return out;
}

// [interceptor ... handler]: the last element handles, the ones before it guard.
function interceptorChain(ctx: Context, file: string, items: readonly Form[]): { guards: Link[]; handlers: Link[] } {
  return { guards: chainOf(ctx, file, items.slice(0, -1)).links, handlers: handlerLinks(ctx, file, items[items.length - 1]) };
}

// The elements of an interceptor chain written as a vector, or as (conj interceptors ... handler), pedestal's idiom
// for adding a handler to shared interceptors; null for any other form.
function chainElements(ctx: Context, file: string, f: Form): Form[] | null {
  if (f.t === 'vector') return flatChildren(f);
  if (f.t !== 'list') return null;
  const head = f.children[0];
  const use = head && head.t === 'symbol' ? ctx.useAt(file, head.row, head.col) : undefined;
  return use && CORE_NS.test(use.to) && use.name === 'conj' ? f.children.slice(1) : null;
}

// ---------- middleware around the routing table ----------

// Wrappers read around a route var or a router: each is a guard, as a guess (what it wraps is read from the code around it).
const wrapperGuards = (wrappers: readonly Wrapper[]): Guard[] => wrappers.map((w): Guard => ({ def: w.def, file: w.file, line: w.line, band: 'heuristic',
  level: 'wrapper', ...(w.library ? { library: true } : {}) }));

// The permission arguments of the wrappers that are permission middleware: one more check each, as a guess.
const wrapperChecks = (wrappers: readonly Wrapper[]): Check[] => wrappers.flatMap((w) => (w.permission ? [{ ...w.permission, guessed: true }] : []));

// ---------- compojure ----------

// The forms a branching or sequencing form may return its value from (the test of a conditional is never one).
function returnedForms(head: string, args: readonly Form[]): Form[] {
  const every = (from: number, step: number) => args.filter((_, i) => i >= from && (i - from) % step === 0);
  switch (head) {
    case 'if': case 'if-not': case 'if-let': case 'if-some': return args.slice(1);
    case 'cond': return every(1, 2);
    case 'case': return [...every(2, 2), ...(args.length % 2 === 0 ? [args[args.length - 1]] : [])];
    default: return args.slice(-1);
  }
}

// What a body returns: a var, a call of a project function (its head, and the calls it wraps as a guess), or what
// a let/do/if/cond/case returns, every branch of it (HEURISTIC: which branch runs is not decided here).
function returnedCall(ctx: Context, file: string, f: Form): Link[] {
  const u = unwrap(f);
  if (u.t === 'symbol') return handlerLinks(ctx, file, u);
  if (u.t !== 'list' || !u.children.length) return [];
  const head = unwrap(u.children[0]);
  if (head.t === 'symbol' && handlerLinks(ctx, file, head).length) return handlerLinks(ctx, file, u);
  return demoted(returnedForms(text(unwrap(u.children[0])) ?? '', u.children.slice(1)).flatMap((x) => returnedCall(ctx, file, x)));
}

// The path of a compojure context that is not a literal: the routes below it are served somewhere unknown.
const UNKNOWN_MOUNT = '{?}';

function compojureRoutes(ctx: Context): Route[] {
  const macro = (u: VarUse): string | undefined => {
    const full = ctx.config.routeMacros[`${u.to}/${u.name}`] ?? `${u.to}/${u.name}`;
    return full.startsWith(`${COMPOJURE}/`) ? full.slice(COMPOJURE.length + 1) : undefined;
  };
  const ownerOf = (u: VarUse) => (u.fromVar ? `${u.from}/${u.fromVar}` : u.from);
  const byFile = groupBy(ctx.analysis.varUses.filter((u) => macro(u)), (u) => u.file);
  const pathIn = (file: string, u: VarUse) => {
    const form = formAt(ctx.forms(file), u.row, u.col);
    return literalPath(form ? kids(form)[1] : undefined);
  };
  // the paths of the contexts around a position in a file, outermost first
  const contextsAt = (file: string, row: number, col: number): string =>
    (byFile.get(file) ?? [])
      .filter((c) => macro(c) === 'context' && contains(c, row, col))
      .sort((a, b) => a.row - b.row || a.col - b.col)
      .map((c) => pathIn(file, c) ?? UNKNOWN_MOUNT)
      .join('');
  const found: { u: VarUse; method: string; path: string }[] = [];
  for (const [file, uses] of byFile) {
    for (const u of uses) {
      const method = macro(u) ?? '';
      const path = COMPOJURE_METHODS.has(method) ? pathIn(file, u) : undefined;
      if (path !== undefined) found.push({ u, method, path });
    }
  }
  const bases = new Set(found.map(({ u }) => ownerOf(u)));
  // where a route var is mounted: each use of it outside tests, below the contexts around the use and the mounts of
  // the var that holds the use; a var nobody uses stands at the root
  const usesOf = groupBy(ctx.analysis.varUses.filter((u) => bases.has(`${u.to}/${u.name}`) && !isTestFile(u.file)), (u) => `${u.to}/${u.name}`);
  const mountsOf = (base: string, stack: readonly string[]): string[] => {
    const uses = (usesOf.get(base) ?? []).filter((u) => !stack.includes(ownerOf(u)) && ownerOf(u) !== base);
    if (!uses.length) return [''];
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
    return mountsOf(base, []).map((mount): Route => ({ method, path, mount: mount + local, base, file: u.file, line: u.row, library: 'compojure', handlers,
      guards: wrapperGuards(wrappers), authz: addChecks(ctx, NO_AUTHZ, wrapperChecks(wrappers)), ...(unknown ? { middlewareUnknown: true } : {}) }));
  });
}

// ---------- route data ----------


// pedestal terse routes: ^:interceptors [...] beside the route data
const isInterceptorVector = (f: Form): boolean => f.t === 'meta' && keywordOf(f.children[0]) === ':interceptors' && unwrap(f).t === 'vector';

// (into ["/x" data] children) or (conj ["/x" data] child ...): one route with more children
function appendsToRoute(ctx: Context, file: string, f: Form): boolean {
  if (f.t !== 'list' || !f.children[1] || !isRoute(unwrap(f.children[1]))) return false;
  const head = f.children[0];
  const use = head && head.t === 'symbol' ? ctx.useAt(file, head.row, head.col) : undefined;
  return !!use && CORE_NS.test(use.to) && (use.name === 'into' || use.name === 'conj');
}

interface Scope {
  prefix: string;
  guards: Guard[];
  // authz declared in route data: a child's declaration replaces its parent's
  authz: Authz;
  // permissions of permission middleware: every one up the tree applies
  checks: Check[];
  base: string;
  library: string;
  // definitions being mounted, so a route function that includes itself stops
  stack: string[];
  // what wraps the tree could not be read
  unknown: boolean;
}

interface RouteFn {
  file: string;
  roots: Form[];
}

// Each definition whose body holds route vectors: a function or var returning a route tree. It may live in a file
// that never names the routing library and only returns data a router file mounts. A definition whose whole value
// is another route function, or a call of one (a Polylith interface), stands for it.
function routeFunctions(ctx: Context): Map<string, RouteFn> {
  const out = new Map<string, RouteFn>();
  const valueOf = new Map<string, { file: string; value: Form }>();
  for (const d of ctx.defs.values()) {
    const form = formAt(ctx.forms(d.file), d.row, d.col);
    if (!form) continue;
    const roots: Form[] = [];
    const visit = (f: Form): void => {
      const u = unwrap(f);
      if (isRoute(u) || isRouteGroup(u) || appendsToRoute(ctx, d.file, u)) roots.push(u);
      else kids(u).forEach(visit);
    };
    kids(form).forEach(visit);
    const full = `${d.ns}/${d.name}`;
    if (roots.length) out.set(full, { file: d.file, roots });
    const last = kids(form)[kids(form).length - 1];
    if (!roots.length && last && kids(form).length >= 3) valueOf.set(full, { file: d.file, value: unwrap(last) });
  }
  for (let grew = true; grew;) {
    grew = false;
    for (const [full, { file, value }] of valueOf) {
      const target = value.t === 'list' ? unwrap(value.children[0] ?? value) : value;
      const def = target.t === 'symbol' ? ctx.defAt(file, target.row, target.col) : undefined;
      if (out.has(full) || !def || !out.has(def)) continue;
      out.set(full, { file, roots: [target] });
      grew = true;
    }
  }
  return out;
}

// The route functions a route tree names, as `nested` mounts them: symbols inside vectors, calls and conditionals.
function mountsIn(ctx: Context, file: string, f: Form, fns: ReadonlyMap<string, RouteFn>): string[] {
  const u = unwrap(f);
  if (u.t === 'symbol') {
    const def = ctx.defAt(file, u.row, u.col);
    return def && fns.has(def) ? [def] : [];
  }
  return u.t === 'vector' || u.t === 'list' || u.t === 'cond' ? flatChildren(u).flatMap((x) => mountsIn(ctx, file, x, fns)) : [];
}

// The route trees a data-routing build walks, with the route functions mounted so far and the forms already visited.
interface Walker {
  routes: Route[];
  mounted: Set<string>;
  visited: Set<string>;
  nested: (f: Form, file: string, scope: Scope) => void;
}

function routeWalker(ctx: Context, fns: ReadonlyMap<string, RouteFn>): Walker {
  const out: Route[] = [];
  const mounted = new Set<string>();
  const visited = new Set<string>();

  const route = (v: Form, file: string, scope: Scope, appended: readonly Form[] = []): void => {
    const xs = [...flatChildren(v), ...appended];
    const path = joinPath(scope.prefix, text(unwrap(xs[0])) ?? '');
    const emit = (method: string, handlers: Link[], guards: Guard[], authz: Authz) =>
      out.push({ method, path, mount: '', base: scope.base, file, line: v.row, library: scope.library, handlers, guards, authz,
        ...(scope.unknown ? { middlewareUnknown: true } : {}) });
    const verb = xs[1] && keywordOf(xs[1]);
    if (verb && METHOD_KEYS.has(verb) && xs[2]) {
      // pedestal table route: [path :verb handler-or-interceptor-vector & options]
      const target = unwrap(xs[2]);
      const items = chainElements(ctx, file, target);
      const chain = items ? interceptorChain(ctx, file, items) : { guards: [], handlers: handlerLinks(ctx, file, target) };
      emit(verb.slice(1).toUpperCase(), chain.handlers, [...scope.guards, ...chain.guards.map((l) => ({ ...l, level: 'route' }))],
        addChecks(ctx, scope.authz, scope.checks));
      return;
    }
    const dataForm = xs.slice(1).find((x) => unwrap(x).t === 'map');
    const data = dataForm && unwrap(dataForm);
    const own = xs.slice(1).filter(isInterceptorVector).map((x) => chainOf(ctx, file, chainItems(x)));
    const methods: [string, Form][] = [];
    // a symbol beside the path is the handler, unless it is a route function mounted here
    let handler = data ? undefined : xs.slice(1).find((x) => {
      const u = unwrap(x);
      const def = u.t === 'symbol' ? ctx.defAt(file, u.row, u.col) : undefined;
      return u.t === 'symbol' && !(def && fns.has(def));
    });
    for (const [k, val] of data ? entries(data) : []) {
      const key = keywordOf(k) ?? '';
      if (CHAIN_KEYS.has(key)) own.push(chainOf(ctx, file, chainItems(val)));
      else if (METHOD_KEYS.has(key)) methods.push([key, val]);
      else if (key === ':handler') handler = val;
    }
    const guards: Guard[] = [...scope.guards, ...own.flatMap((c) => c.links).map((l) => ({ ...l, level: 'route' }))];
    const authz = routeDataAuthz(ctx, file, data) ?? scope.authz;
    const checks = [...scope.checks, ...own.flatMap((c) => c.permissions)];
    if (handler) emit('ANY', handlerLinks(ctx, file, handler), guards, addChecks(ctx, authz, checks));
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
    const inner: Scope = { ...scope, prefix: path, authz, checks, guards: guards.map((g) => ({ ...g, inheritedFrom: g.inheritedFrom ?? path })) };
    for (const x of xs.slice(1)) nested(x, file, inner);
  };

  // a route, a group of routes, a call or conditional holding them, or a route function or var to mount here
  const nested = (f: Form, file: string, scope: Scope): void => {
    const u = unwrap(f);
    visited.add(`${file}:${u.row}:${u.col}`);
    if (u.t === 'symbol') {
      const def = ctx.defAt(file, u.row, u.col);
      const fn = def ? fns.get(def) : undefined;
      if (!def || !fn || scope.stack.includes(def)) return;
      mounted.add(def);
      for (const r of fn.roots) nested(r, fn.file, { ...scope, stack: [...scope.stack, def] });
    } else if (isRoute(u)) route(u, file, scope);
    else if (appendsToRoute(ctx, file, u)) {
      // (into ["/x" data] children) and (conj ["/x" data] child ...) build one route with more children
      route(unwrap(kids(u)[1]), file, scope, kids(u).slice(2));
    } else if (u.t === 'vector' || u.t === 'list' || u.t === 'cond') for (const x of flatChildren(u)) nested(x, file, scope);
  };

  return { routes: out, mounted, visited, nested };
}

// (router routes {:data {:middleware [...]}}): router data applies to every route below it; a router built in test code serves nothing
function routerCalls(ctx: Context, files: ReadonlyMap<string, string>, walker: Walker, owner: Owner, scopeAt: ScopeAt): void {
  const wrapping = wrappingOf(ctx);
  for (const call of ctx.analysis.varUses.filter((u) => ROUTERS.test(`${u.to}/${u.name}`) && files.has(u.file) && !isTestFile(u.file))) {
    const form = formAt(ctx.forms(call.file), call.row, call.col);
    const [routesArg, opts] = form ? kids(form).slice(1) : [];
    if (!form || !routesArg) continue;
    const data = opts && unwrap(opts).t === 'map' ? entry(unwrap(opts), ':data') : undefined;
    const chains = (data && unwrap(data).t === 'map' ? chainForms(unwrap(data)) : []).map((c) => chainOf(ctx, call.file, chainItems(c)));
    const around = wrapping(call.file, form);
    const guards = [...wrapperGuards(around.wrappers).map((g) => ({ ...g, inheritedFrom: 'around the router' })),
      ...chains.flatMap((c) => c.links).map((l): Guard => ({ ...l, level: 'router-data', inheritedFrom: 'router :data' }))];
    const base = owner({ ...call, row: call.nameRow, col: call.nameCol }).replace(/^(definition|namespace):/, '');
    walker.nested(routesArg, call.file,
      scopeAt(call.file, base, guards, [...wrapperChecks(around.wrappers), ...chains.flatMap((c) => c.permissions)], around.unknown));
  }
}

// Route trees no router call reaches stand where they are written, in files that use a routing library.
// The ones another route function mounts come last: mounting them there marks them, so they stand alone only when nobody does.
function standingTrees(ctx: Context, files: ReadonlyMap<string, string>, fns: ReadonlyMap<string, RouteFn>, walker: Walker, scopeAt: ScopeAt): void {
  const mountedByAnother = new Set([...fns].flatMap(([def, fn]) => fn.roots.flatMap((r) => mountsIn(ctx, fn.file, r, fns)).filter((m) => m !== def)));
  for (const [def, fn] of [...fns].sort(([a], [b]) => Number(mountedByAnother.has(a)) - Number(mountedByAnother.has(b)))) {
    if (walker.mounted.has(def) || !files.has(fn.file) || isTestFile(fn.file)) continue;
    for (const r of fn.roots) if (!walker.visited.has(`${fn.file}:${r.row}:${r.col}`)) walker.nested(r, fn.file, scopeAt(fn.file, def, [], [], true));
  }
}

type ScopeAt = (file: string, base: string, guards: Guard[], checks: Check[], unknown: boolean) => Scope;

function dataRoutes(ctx: Context, owner: Owner): Route[] {
  const libs = new Map<string, Set<string>>();
  for (const u of ctx.analysis.nsUses) if (DATA_LIBS.test(u.to)) libs.set(u.file, (libs.get(u.file) ?? new Set()).add(libraryOf(u.to)));
  const files = new Map([...libs].map(([f, s]) => [f, [...s].sort().join(', ')]));
  const fns = routeFunctions(ctx);
  const walker = routeWalker(ctx, fns);
  const scopeAt: ScopeAt = (file, base, guards, checks, unknown) =>
    ({ prefix: '', guards, authz: NO_AUTHZ, checks, base, library: files.get(file) ?? '', stack: [], unknown });
  routerCalls(ctx, files, walker, owner, scopeAt);
  standingTrees(ctx, files, fns, walker, scopeAt);
  return walker.routes;
}

// A handler that calls a declared permission fn with a keyword checks that permission (HEURISTIC, one level deep).
function handlerPermissions(ctx: Context): (handlers: readonly Link[], check: number) => Permission[] {
  const calls = groupBy(ctx.analysis.varUses.filter((u) => u.fromVar && ctx.config.permissionFns.includes(`${u.to}/${u.name}`)),
    (u) => `${u.from}/${u.fromVar}`);
  return (handlers, check) => handlers.flatMap((h) => (calls.get(h.def) ?? []).flatMap((u) => {
    const call = formAt(ctx.forms(u.file), u.row, u.col);
    return (call ? kids(call).slice(1).map(unwrap) : [])
      .filter((k) => k.t === 'keyword')
      .map((k) => ({ name: text(k) ?? '?', dynamic: false, check, checks: check, alternative: 1, alternatives: 1, allOf: 1, file: u.file, line: k.row }));
  }));
}

export const serverRoutes = (ctx: Context, owner: Owner): Route[] => [...compojureRoutes(ctx), ...dataRoutes(ctx, owner)];

export const httpRoutes: Adapter = {
  name: 'routes',
  edgeKinds: ['routes_to', 'guarded_by', 'requires_permission', 'exempted_by'],
  detect: (ctx) => {
    const libs = new Set(ctx.analysis.nsUses.map((u) => u.to).flatMap((n) => (n === COMPOJURE || DATA_LIBS.test(n) ? [libraryOf(n)] : [])));
    return libs.size ? [...libs].sort().join(', ') : null;
  },
  run: (ctx, owner) => {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const inHandlers = handlerPermissions(ctx);
    const routes = serverRoutes(ctx, owner);
    const sites = groupBy(routes, routeId);
    for (const r of routes) {
      const id = routeId(r);
      // several definitions behind one id (the same method and path twice in a router): which one serves is not decided
      const competing = new Set((sites.get(id) ?? []).map((x) => `${x.file}:${x.line}`)).size;
      const bandOf = (own: 'heuristic' | undefined) => (competing > 1 ? 'heuristic' : own ?? 'static_proven');
      const component = ctx.componentOf(r.file);
      const unresolved = r.handlers.filter((h) => h.unresolved).map((h) => h.def);
      nodes.push({
        id, kind: 'route', name: `${r.method} ${r.mount}${r.path} @${r.base}`, file: r.file, line: r.line, ...(component ? { component } : {}),
        attrs: { method: r.method.toLowerCase(), path: r.path, full_path: `${r.mount}${r.path}`, base: r.base, mount: r.mount, library: r.library,
          ...(competing > 1 ? { conflict: competing } : {}), ...(r.middlewareUnknown ? { middleware: 'unknown' } : {}),
          ...(unresolved.length ? { unresolved_handler: unresolved.join(', ') } : {}) },
      });
      for (const h of r.handlers.filter((x) => !x.unresolved)) edges.push({ from: id, to: defId(h.def), kind: 'routes_to', band: bandOf(h.band), file: r.file,
        line: h.line });
      for (const g of r.guards.filter((x) => x.library)) nodes.push({ id: libraryMiddlewareId(g.def), kind: 'library_middleware', name: g.def,
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
          band: p.dynamic ? 'unknown' : found.includes(p) || p.guessed ? 'heuristic' : 'static_proven', file: p.file, line: p.line,
          attrs: { check: p.check, checks, alternative: p.alternative, alternatives: p.alternatives, all_of: p.allOf, ...(p.scope ? { tenant: p.scope } : {}) },
        });
      }
      if (r.authz.exempt) {
        nodes.push({ id: exemptionId(r.authz.exempt.reason), kind: 'authz_exemption', name: r.authz.exempt.reason, file: r.authz.exempt.file,
          line: r.authz.exempt.line });
        edges.push({ from: id, to: exemptionId(r.authz.exempt.reason), kind: 'exempted_by', band: 'static_proven', file: r.authz.exempt.file,
          line: r.authz.exempt.line,
          attrs: { label: r.authz.exempt.reason } });
      }
    }
    return { nodes, edges };
  },
};
