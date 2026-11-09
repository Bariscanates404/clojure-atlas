// HTTP routes: compojure method macros (mount from `context`) and route data vectors (reitit, pedestal) whose
// first element is a literal path, followed into the functions that return route trees and under router :data.
// Edges: routes_to (handler), guarded_by (middleware, outermost first), and the authz .clojure-atlas.edn declares.
import type { GraphEdge, GraphNode } from '../../mcp/graph.ts';
import { isTestFile } from '../../mcp/keyflow.ts';
import type { VarUse } from '../analysis.ts';
import { contains, flatChildren, formAt, kids, textOf as text, unwrap, type Form } from '../reader.ts';
import { CORE_NS, defId, groupBy, type Adapter, type Context, type Owner } from '../model.ts';
import { entries, entry, isRoute, isRouteGroup, joinPath, keywordOf } from './route-data.ts';

const COMPOJURE = 'compojure.core';
const COMPOJURE_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'ANY']);
const METHOD_KEYS = new Set([':get', ':post', ':put', ':delete', ':patch', ':head', ':options', ':any']);
const CHAIN_KEYS = new Set([':middleware', ':interceptors']);
const DATA_LIBS = /^(reitit\.|io\.pedestal\.)/;
const ROUTERS = /^reitit\.(ring|http|core|frontend)\/router$/;
const libraryOf = (ns: string) => (ns === COMPOJURE ? 'compojure' : ns.startsWith('reitit.') ? 'reitit' : 'pedestal');

interface Link {
  def: string;
  line: number;
}

interface Guard extends Link {
  level: string;
  inheritedFrom?: string;
}

interface Permission {
  // keyword, or the symbol text when the permission is decided at runtime
  name: string;
  dynamic: boolean;
  check: number;
  checks: number;
  alternative: number;
  alternatives: number;
  allOf: number;
  scope?: string;
  line: number;
}

interface Authz {
  permissions: Permission[];
  exempt?: { reason: string; line: number };
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
}

const NO_AUTHZ: Authz = { permissions: [] };

export const routeId = (r: Pick<Route, 'method' | 'path' | 'base' | 'mount'>) => `route:${r.method} ${r.path} @${r.base}${r.mount}`;
const permissionId = (name: string) => `permission:${name}`;
const exemptionId = (reason: string) => `authz_exemption:${reason}`;


function literalPath(f: Form | undefined): string | undefined {
  if (!f) return undefined;
  const u = unwrap(f);
  if (u.t === 'string') return u.text;
  if (u.t === 'vector' && u.children[0]?.t === 'string') return u.children[0].text;
  return undefined;
}

const chainForms = (m: Form): Form[] => entries(m).filter(([k]) => CHAIN_KEYS.has(keywordOf(k) ?? '')).map(([, v]) => v);

// ---------- authz as .clojure-atlas.edn declares it ----------

interface Located {
  form: Form;
  file: string;
}

// The value form of a project definition: (def x v), (defn f [params] body) gives its params and body.
function definitionForm(ctx: Context, full: string): { file: string; params?: Form; value: Form } | undefined {
  const d = ctx.defs.get(full);
  const form = d && formAt(ctx.forms(d.file), d.row, d.col);
  const xs = form ? kids(form) : [];
  const params = xs.find((x, i) => i >= 2 && unwrap(x).t === 'vector');
  const value = xs[xs.length - 1];
  return d && value && xs.length >= 3 ? { file: d.file, ...(params && params !== value ? { params: unwrap(params) } : {}), value: unwrap(value) } : undefined;
}

// A symbol naming a constant var, (def p :edit), stands for its value.
function constant(ctx: Context, at: Located): Located {
  const u = unwrap(at.form);
  const def = u.t === 'symbol' ? ctx.defAt(at.file, u.row, u.col) : undefined;
  const d = def ? definitionForm(ctx, def) : undefined;
  return d && !d.params && ['keyword', 'set', 'vector'].includes(d.value.t) ? { form: d.value, file: d.file } : at;
}

// A symbol naming a var whose value is a map literal stands for that map.
function constantMap(ctx: Context, at: Located): Located {
  const u = unwrap(at.form);
  const def = u.t === 'symbol' ? ctx.defAt(at.file, u.row, u.col) : undefined;
  const d = def ? definitionForm(ctx, def) : undefined;
  return d && !d.params && d.value.t === 'map' ? { form: d.value, file: d.file } : at;
}

// :p one permission; #{:a :b} any of them; [:a :b] all of them; anything else is decided at runtime.
function permissionsOf(ctx: Context, at: Located, check: number, scope: string | undefined): Permission[] {
  const u = unwrap(constant(ctx, at).form);
  const one = (x: Form, alternative: number, alternatives: number, allOf: number): Permission => {
    const v = unwrap(x);
    return { name: text(v) ?? `(runtime ${v.t})`, dynamic: v.t !== 'keyword', check, checks: check, alternative, alternatives, allOf, ...(scope ? { scope } : {}), line: x.row };
  };
  if (u.t === 'set') return flatChildren(u).map((x, i, all) => one(x, i + 1, all.length, 1));
  if (u.t === 'vector') return flatChildren(u).map((x, _i, all) => one(x, 1, 1, all.length));
  return [one(u, 1, 1, 1)];
}

// An authz map, or (helper args) whose body is one: its parameters are bound to the call's arguments.
function authzMap(ctx: Context, at: Located): { map: Form; bind: (f: Located) => Located } | undefined {
  const c = constantMap(ctx, at);
  const u = unwrap(c.form);
  if (u.t === 'map') return { map: u, bind: (f) => ({ form: f.form, file: c.file }) };
  const head = u.t === 'list' ? unwrap(u.children[0] ?? u) : undefined;
  const def = head && head.t === 'symbol' ? ctx.defAt(at.file, head.row, head.col) : undefined;
  const d = def ? definitionForm(ctx, def) : undefined;
  if (!d || !d.params || d.value.t !== 'map' || u.t !== 'list') return undefined;
  const args = new Map(flatChildren(d.params).map((p, i) => [text(unwrap(p)) ?? '', u.children[i + 1]]));
  return {
    map: d.value,
    bind: (f) => {
      const v = unwrap(f.form);
      const arg = v.t === 'symbol' ? args.get(v.text) : undefined;
      return arg ? { form: arg, file: at.file } : { form: f.form, file: d.file };
    },
  };
}

function routeDataAuthz(ctx: Context, file: string, data: Form | undefined): Authz | undefined {
  const cfg = ctx.config.routeAuthz;
  const value = cfg && data && entry(data, cfg.key);
  if (!cfg || !value) return undefined;
  // a vector of authz maps is a list of checks, all of which must pass
  const items = unwrap(value).t === 'vector' ? flatChildren(unwrap(value)) : [value];
  const permissions: Permission[] = [];
  let exempt: Authz['exempt'];
  for (const item of items) {
    const m = authzMap(ctx, { form: item, file });
    if (!m) continue;
    // an exemption beside checks is kept with them: the MCP shows the checks and lists the exemption
    const reason = cfg.exempt ? entry(m.map, cfg.exempt) : undefined;
    if (reason) exempt = { reason: text(unwrap(reason)) ?? '?', line: value.row };
    // the check itself, then the alternative map that also satisfies it
    const check = permissions.reduce((n, p) => Math.max(n, p.check), 0) + 1;
    const alt = cfg.alternative ? entry(m.map, cfg.alternative) : undefined;
    const options = [m.map, ...(alt && unwrap(alt).t === 'map' ? [unwrap(alt)] : [])];
    const found = options.map((o) => {
      const perm = cfg.permission ? entry(o, cfg.permission) : undefined;
      const scopeForm = cfg.scope ? entry(o, cfg.scope) : undefined;
      const scope = scopeForm && m.bind({ form: scopeForm, file }).form;
      return perm ? permissionsOf(ctx, m.bind({ form: perm, file }), check, scope && formText(scope)) : [];
    }).filter((ps) => ps.length);
    const single = found.length > 1 && found.every((ps) => ps.length === 1);
    permissions.push(...(single ? found.map(([p], k) => ({ ...p, alternative: k + 1, alternatives: found.length })) : found.flat()));
  }
  // cited at the route's own authz entry: a constant or helper may live in another file
  const checks = permissions.reduce((n, p) => Math.max(n, p.check), 0);
  if (!permissions.length && !exempt) return undefined;
  return { permissions: permissions.map((p) => ({ ...p, checks, line: value.row })), ...(exempt ? { exempt } : {}) };
}

// Short source-like text of a scope form, for the edge attribute.
function formText(f: Form): string {
  const u = unwrap(f);
  if ('text' in u) return u.text;
  return u.t === 'list' ? `(${u.children.map(formText).join(' ')})` : u.t;
}

// Each permission middleware in a chain is one more check that every request must pass.
function addChecks(ctx: Context, file: string, authz: Authz, forms: readonly Form[]): Authz {
  if (!forms.length) return authz;
  const before = authz.permissions.reduce((m, p) => Math.max(m, p.check), 0);
  const all = [...authz.permissions, ...forms.flatMap((f, i) => permissionsOf(ctx, { form: f, file }, before + i + 1, undefined))];
  const checks = before + forms.length;
  return { ...authz, permissions: all.map((p) => ({ ...p, checks })) };
}

// ---------- links ----------

// The project definitions a handler form names: a symbol, or the arguments of a wrapper call (wrap f).
function handlerLinks(ctx: Context, file: string, f: Form | undefined): Link[] {
  const u = f && unwrap(f);
  if (!u) return [];
  const def = (x: Form) => (x.t === 'symbol' ? ctx.defAt(file, x.row, x.col) : undefined);
  if (u.t === 'symbol') {
    const d = def(u);
    return d ? [{ def: d, line: u.row }] : [];
  }
  if (u.t !== 'list') return [];
  const args = u.children.slice(1).flatMap((x) => handlerLinks(ctx, file, x));
  if (args.length) return args;
  const head = u.children[0] && def(u.children[0]);
  return head ? [{ def: head, line: u.row }] : [];
}

interface Chain {
  links: Link[];
  permissions: Form[];
}

// [mw [mw2 arg] ...]: each project definition in order; a permission middleware's argument is its permission.
function chainOf(ctx: Context, file: string, f: Form | undefined): Chain {
  const u = f && unwrap(f);
  const out: Chain = { links: [], permissions: [] };
  if (!u || u.t !== 'vector') return out;
  for (const x of flatChildren(u)) {
    const item = unwrap(x);
    const parts = item.t === 'vector' ? flatChildren(item) : [item];
    const head = unwrap(parts[0] ?? item);
    const def = head.t === 'symbol' ? ctx.defAt(file, head.row, head.col) : undefined;
    if (!def) continue;
    out.links.push({ def, line: head.row });
    if (ctx.config.permissionMiddleware.includes(def) && parts[1]) out.permissions.push(parts[1]);
  }
  return out;
}

// ---------- compojure ----------

// What a body returns: a var, the project function its last call calls, or that of the last form of a let/do.
function returnedCall(ctx: Context, file: string, f: Form): Link[] {
  const u = unwrap(f);
  const def = (x: Form | undefined) => (x && x.t === 'symbol' ? ctx.defAt(file, x.row, x.col) : undefined);
  if (u.t === 'symbol') {
    const d = def(u);
    return d ? [{ def: d, line: u.row }] : [];
  }
  if (u.t !== 'list' || !u.children.length) return [];
  const head = def(u.children[0]);
  return head ? [{ def: head, line: u.row }] : returnedCall(ctx, file, u.children[u.children.length - 1]);
}

function compojureRoutes(ctx: Context): Route[] {
  const macro = (u: VarUse): string | undefined => {
    const full = ctx.config.routeMacros[`${u.to}/${u.name}`] ?? `${u.to}/${u.name}`;
    return full.startsWith(`${COMPOJURE}/`) ? full.slice(COMPOJURE.length + 1) : undefined;
  };
  const byFile = groupBy(ctx.analysis.varUses.filter((u) => macro(u)), (u) => u.file);
  const out: Route[] = [];
  for (const [file, uses] of byFile) {
    const forms = ctx.forms(file);
    const pathOf = (u: VarUse) => {
      const form = formAt(forms, u.row, u.col);
      return literalPath(form ? kids(form)[1] : undefined);
    };
    const contexts = uses.filter((u) => macro(u) === 'context');
    for (const u of uses) {
      const method = macro(u) ?? '';
      const path = COMPOJURE_METHODS.has(method) ? pathOf(u) : undefined;
      if (path === undefined) continue;
      const mount = contexts
        .filter((c) => contains(c, u.row, u.col))
        .sort((a, b) => a.row - b.row || a.col - b.col)
        .map((c) => pathOf(c) ?? '')
        .join('');
      const form = formAt(forms, u.row, u.col);
      const handlers = form && kids(form).length > 3 ? returnedCall(ctx, file, kids(form)[kids(form).length - 1]) : [];
      out.push({ method, path, mount, base: u.fromVar ? `${u.from}/${u.fromVar}` : u.from, file, line: u.row, library: 'compojure', handlers, guards: [], authz: NO_AUTHZ });
    }
  }
  return out;
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
  checks: Form[];
  base: string;
  library: string;
  // definitions being mounted, so a route function that includes itself stops
  stack: string[];
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

function dataRoutes(ctx: Context, owner: Owner): Route[] {
  const libs = new Map<string, Set<string>>();
  for (const u of ctx.analysis.nsUses) if (DATA_LIBS.test(u.to)) libs.set(u.file, (libs.get(u.file) ?? new Set()).add(libraryOf(u.to)));
  const files = new Map([...libs].map(([f, s]) => [f, [...s].sort().join(', ')]));
  const fns = routeFunctions(ctx);
  const out: Route[] = [];
  const mounted = new Set<string>();
  const visited = new Set<string>();

  const route = (v: Form, file: string, scope: Scope, appended: readonly Form[] = []): void => {
    const xs = [...flatChildren(v), ...appended];
    const path = joinPath(scope.prefix, text(unwrap(xs[0])) ?? '');
    const emit = (method: string, handlers: Link[], guards: Guard[], authz: Authz) =>
      out.push({ method, path, mount: '', base: scope.base, file, line: v.row, library: scope.library, handlers, guards, authz });
    const verb = xs[1] && keywordOf(xs[1]);
    if (verb && METHOD_KEYS.has(verb) && xs[2]) {
      // pedestal table route: [path :verb handler-or-interceptor-vector & options]
      const target = unwrap(xs[2]);
      const chain = target.t === 'vector' ? chainOf(ctx, file, target).links : handlerLinks(ctx, file, target);
      emit(verb.slice(1).toUpperCase(), chain.slice(-1), [...scope.guards, ...chain.slice(0, -1).map((l) => ({ ...l, level: 'route' }))], addChecks(ctx, file, scope.authz, scope.checks));
      return;
    }
    const dataForm = xs.slice(1).find((x) => unwrap(x).t === 'map');
    const data = dataForm && unwrap(dataForm);
    const own = xs.slice(1).filter(isInterceptorVector).map((x) => chainOf(ctx, file, x));
    const methods: [string, Form][] = [];
    let handler = data ? undefined : xs.slice(1).find((x) => unwrap(x).t === 'symbol');
    for (const [k, val] of data ? entries(data) : []) {
      const key = keywordOf(k) ?? '';
      if (CHAIN_KEYS.has(key)) own.push(chainOf(ctx, file, val));
      else if (METHOD_KEYS.has(key)) methods.push([key, val]);
      else if (key === ':handler') handler = val;
    }
    const guards: Guard[] = [...scope.guards, ...own.flatMap((c) => c.links).map((l) => ({ ...l, level: 'route' }))];
    const authz = routeDataAuthz(ctx, file, data) ?? scope.authz;
    const checks = [...scope.checks, ...own.flatMap((c) => c.permissions)];
    if (handler) emit('ANY', handlerLinks(ctx, file, handler), guards, addChecks(ctx, file, authz, checks));
    for (const [key, val] of methods) {
      const u = unwrap(val);
      const m = u.t === 'map' ? u : undefined;
      const chains = m ? chainForms(m).map((c) => chainOf(ctx, file, c)) : [];
      // pedestal: {:get [route-name interceptor ... handler]}
      const inline = u.t === 'vector' ? chainOf(ctx, file, u).links : [];
      const handlers = u.t === 'vector' ? inline.slice(-1) : handlerLinks(ctx, file, m ? entry(m, ':handler') : val);
      const methodGuards = [...chains.flatMap((c) => c.links), ...inline.slice(0, -1)].map((l) => ({ ...l, level: 'method' }));
      const methodAuthz = addChecks(ctx, file, routeDataAuthz(ctx, file, m) ?? authz, [...checks, ...chains.flatMap((c) => c.permissions)]);
      emit(key.slice(1).toUpperCase(), handlers, [...guards, ...methodGuards], methodAuthz);
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

  const scopeAt = (file: string, base: string, guards: Guard[]): Scope => ({ prefix: '', guards, authz: NO_AUTHZ, checks: [], base, library: files.get(file) ?? '', stack: [] });

  // (router routes {:data {:middleware [...]}}): router data applies to every route below it
  // a router built in test code serves nothing
  for (const call of ctx.analysis.varUses.filter((u) => ROUTERS.test(`${u.to}/${u.name}`) && files.has(u.file) && !isTestFile(u.file))) {
    const form = formAt(ctx.forms(call.file), call.row, call.col);
    const [routesArg, opts] = form ? kids(form).slice(1) : [];
    if (!routesArg) continue;
    const data = opts && unwrap(opts).t === 'map' ? entry(unwrap(opts), ':data') : undefined;
    const mw = data && unwrap(data).t === 'map' ? entry(unwrap(data), ':middleware') : undefined;
    const guards = chainOf(ctx, call.file, mw).links.map((l) => ({ ...l, level: 'router-data', inheritedFrom: 'router :data' }));
    const base = owner({ ...call, row: call.nameRow, col: call.nameCol }).replace(/^(definition|namespace):/, '');
    nested(routesArg, call.file, scopeAt(call.file, base, guards));
  }
  // route trees no router call reaches stand where they are written, in files that use a routing library
  for (const [def, fn] of fns) {
    if (mounted.has(def) || !files.has(fn.file) || isTestFile(fn.file)) continue;
    for (const r of fn.roots) if (!visited.has(`${fn.file}:${r.row}:${r.col}`)) nested(r, fn.file, scopeAt(fn.file, def, []));
  }
  return out;
}

// A handler that calls a declared permission fn with a keyword checks that permission (HEURISTIC, one level deep).
function handlerPermissions(ctx: Context): (handlers: readonly Link[], check: number) => Permission[] {
  const calls = groupBy(ctx.analysis.varUses.filter((u) => u.fromVar && ctx.config.permissionFns.includes(`${u.to}/${u.name}`)), (u) => `${u.from}/${u.fromVar}`);
  return (handlers, check) => handlers.flatMap((h) => (calls.get(h.def) ?? []).flatMap((u) => {
    const call = formAt(ctx.forms(u.file), u.row, u.col);
    return (call ? kids(call).slice(1).map(unwrap) : [])
      .filter((k) => k.t === 'keyword')
      .map((k) => ({ name: text(k) ?? '?', dynamic: false, check, checks: check, alternative: 1, alternatives: 1, allOf: 1, line: k.row }));
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
    for (const r of serverRoutes(ctx, owner)) {
      const id = routeId(r);
      const component = ctx.componentOf(r.file);
      nodes.push({
        id, kind: 'route', name: `${r.method} ${r.mount}${r.path} @${r.base}`, file: r.file, line: r.line, ...(component ? { component } : {}),
        attrs: { method: r.method.toLowerCase(), path: r.path, full_path: `${r.mount}${r.path}`, base: r.base, mount: r.mount, library: r.library },
      });
      for (const h of r.handlers) edges.push({ from: id, to: defId(h.def), kind: 'routes_to', band: 'static_proven', file: r.file, line: h.line });
      r.guards.forEach((g, order) => edges.push({
        from: id, to: defId(g.def), kind: 'guarded_by', band: 'static_proven', file: r.file, line: g.line,
        attrs: { order, level: g.level, ...(g.inheritedFrom ? { inherited_from: g.inheritedFrom } : {}) },
      }));
      const declared = r.authz.permissions;
      const found = inHandlers(r.handlers, declared.reduce((m, p) => Math.max(m, p.check), 0) + 1);
      const checks = Math.max(0, ...[...declared, ...found].map((x) => x.check), ...declared.map((x) => x.checks));
      for (const p of [...declared, ...found]) {
        nodes.push({ id: permissionId(p.name), kind: 'permission', name: p.name, file: r.file, line: p.line, ...(p.dynamic ? { attrs: { dynamic: true } } : {}) });
        edges.push({
          from: id, to: permissionId(p.name), kind: 'requires_permission',
          band: p.dynamic ? 'unknown' : found.includes(p) ? 'heuristic' : 'static_proven', file: r.file, line: p.line,
          attrs: { check: p.check, checks, alternative: p.alternative, alternatives: p.alternatives, all_of: p.allOf, ...(p.scope ? { tenant: p.scope } : {}) },
        });
      }
      if (r.authz.exempt) {
        nodes.push({ id: exemptionId(r.authz.exempt.reason), kind: 'authz_exemption', name: r.authz.exempt.reason, file: r.file, line: r.authz.exempt.line });
        edges.push({ from: id, to: exemptionId(r.authz.exempt.reason), kind: 'exempted_by', band: 'static_proven', file: r.file, line: r.authz.exempt.line, attrs: { label: r.authz.exempt.reason } });
      }
    }
    return { nodes, edges };
  },
};
