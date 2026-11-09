// HTTP routes: compojure method macros (mount from `context`) and route data vectors (reitit, pedestal terse and
// table routes) whose first element is a literal path. routes_to links a route to its handler definitions,
// guarded_by to its middleware or interceptors, outermost first. Paths built at runtime are not followed.
import type { GraphEdge, GraphNode } from '../../mcp/graph.ts';
import type { VarUse } from '../analysis.ts';
import { contains, flatChildren, formAt, kids, unwrap, type Form } from '../reader.ts';
import { defId, type Adapter, type Context, type Owner } from '../model.ts';

const COMPOJURE = 'compojure.core';
const COMPOJURE_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'ANY']);
const METHOD_KEYS = new Set([':get', ':post', ':put', ':delete', ':patch', ':head', ':options', ':any']);
const CHAIN_KEYS = new Set([':middleware', ':interceptors']);
const DATA_LIBS = /^(reitit\.|io\.pedestal\.)/;
const libraryOf = (ns: string) => (ns === COMPOJURE ? 'compojure' : ns.startsWith('reitit.') ? 'reitit' : 'pedestal');

interface Link {
  def: string;
  line: number;
}

interface Guard extends Link {
  level: string;
  inheritedFrom?: string;
}

interface Route {
  method: string;
  path: string;
  mount: string;
  base: string;
  file: string;
  line: number;
  library: string;
  handlers: Link[];
  guards: Guard[];
}

export const routeId = (r: Pick<Route, 'method' | 'path' | 'base' | 'mount'>) => `route:${r.method} ${r.path} @${r.base}${r.mount}`;

function literalPath(f: Form | undefined): string | undefined {
  if (!f) return undefined;
  const u = unwrap(f);
  if (u.t === 'string') return u.text;
  if (u.t === 'vector' && u.children[0]?.t === 'string') return u.children[0].text;
  return undefined;
}

const text = (f: Form | undefined): string | undefined => (f && 'text' in f ? f.text : undefined);
const keywordOf = (f: Form): string | undefined => (unwrap(f).t === 'keyword' ? text(unwrap(f)) : undefined);

function compojureRoutes(ctx: Context): Route[] {
  const byFile = new Map<string, VarUse[]>();
  for (const u of ctx.analysis.varUses) if (u.to === COMPOJURE) byFile.set(u.file, [...(byFile.get(u.file) ?? []), u]);
  const out: Route[] = [];
  for (const [file, uses] of byFile) {
    const forms = ctx.forms(file);
    const pathOf = (u: VarUse) => {
      const form = formAt(forms, u.row, u.col);
      return literalPath(form ? kids(form)[1] : undefined);
    };
    const contexts = uses.filter((u) => u.name === 'context');
    const fileUses = ctx.analysis.varUses.filter((v) => v.file === file && !v.defmethod);
    for (const u of uses.filter((x) => COMPOJURE_METHODS.has(x.name))) {
      const path = pathOf(u);
      if (path === undefined) continue;
      const mount = contexts
        .filter((c) => contains(c, u.row, u.col))
        .sort((a, b) => a.row - b.row || a.col - b.col)
        .map((c) => pathOf(c) ?? '')
        .join('');
      const handlers = fileUses
        .filter((v) => v !== u && contains(u, v.nameRow, v.nameCol) && ctx.defs.has(`${v.to}/${v.name}`))
        .map((v) => ({ def: `${v.to}/${v.name}`, line: v.nameRow }));
      out.push({ method: u.name, path, mount, base: u.fromVar ? `${u.from}/${u.fromVar}` : u.from, file, line: u.row, library: 'compojure', handlers, guards: [] });
    }
  }
  return out;
}

// [sym & args] or sym naming a project definition; registry keywords and inline fns are not followed.
function chainLinks(ctx: Context, file: string, f: Form | undefined): Link[] {
  const u = f && unwrap(f);
  if (!u || u.t !== 'vector') return [];
  return flatChildren(u).flatMap((x) => {
    const head = unwrap(x).t === 'vector' ? flatChildren(unwrap(x))[0] : unwrap(x);
    const def = head && head.t === 'symbol' ? ctx.defAt(file, head.row, head.col) : undefined;
    return def ? [{ def, line: head.row }] : [];
  });
}

function handlerLink(ctx: Context, file: string, f: Form | undefined): Link[] {
  const u = f && unwrap(f);
  const def = u && u.t === 'symbol' ? ctx.defAt(file, u.row, u.col) : undefined;
  return u && def ? [{ def, line: u.row }] : [];
}

function entries(m: Form): [Form, Form][] {
  const xs = flatChildren(m);
  const out: [Form, Form][] = [];
  for (let k = 0; k + 1 < xs.length; k += 2) out.push([xs[k], xs[k + 1]]);
  return out;
}

const joinPath = (prefix: string, seg: string) => (prefix.endsWith('/') && seg.startsWith('/') ? prefix + seg.slice(1) : prefix + seg);

// pedestal terse routes: ^:interceptors [...] beside the route data
const isInterceptorVector = (f: Form): boolean => f.t === 'meta' && keywordOf(f.children[0]) === ':interceptors' && unwrap(f).t === 'vector';

const isRoute = (f: Form): boolean => f.t === 'vector' && f.children.length > 1 && /^(\/|$)/.test(unwrap(f.children[0]).t === 'string' ? text(unwrap(f.children[0])) ?? 'x' : 'x');

interface Scope {
  prefix: string;
  guards: Guard[];
}

function dataRoutes(ctx: Context, file: string, library: string, owner: Owner, from: string): Route[] {
  const out: Route[] = [];
  const route = (v: Form, scope: Scope): void => {
    const xs = flatChildren(v);
    const path = joinPath(scope.prefix, text(unwrap(xs[0])) ?? '');
    const base = owner({ file, row: v.row, col: v.col, from }).replace(/^(definition|namespace):/, '');
    const emit = (method: string, handlers: Link[], guards: Guard[]) =>
      out.push({ method, path, mount: '', base, file, line: v.row, library, handlers, guards });
    const verb = xs[1] && keywordOf(xs[1]);
    if (verb && METHOD_KEYS.has(verb) && xs[2]) {
      // pedestal table route: [path :verb handler-or-interceptor-vector & options]
      const target = unwrap(xs[2]);
      const chain = target.t === 'vector' ? chainLinks(ctx, file, target) : handlerLink(ctx, file, target);
      emit(verb.slice(1).toUpperCase(), chain.slice(-1), [...scope.guards, ...chain.slice(0, -1).map((l) => ({ ...l, level: 'route' }))]);
      return;
    }
    const data = xs.slice(1).find((x) => unwrap(x).t === 'map');
    const own: Guard[] = xs.slice(1).filter(isInterceptorVector).flatMap((x) => chainLinks(ctx, file, x).map((l) => ({ ...l, level: 'route' })));
    const methods: [string, Form][] = [];
    let handler = data ? undefined : xs.slice(1).find((x) => unwrap(x).t === 'symbol');
    for (const [k, val] of data ? entries(unwrap(data)) : []) {
      const key = keywordOf(k) ?? '';
      if (CHAIN_KEYS.has(key)) own.push(...chainLinks(ctx, file, val).map((l) => ({ ...l, level: 'route' })));
      else if (METHOD_KEYS.has(key)) methods.push([key, val]);
      else if (key === ':handler') handler = val;
    }
    const guards = [...scope.guards, ...own];
    if (handler) emit('ANY', handlerLink(ctx, file, handler), guards);
    for (const [key, val] of methods) {
      const u = unwrap(val);
      const m = u.t === 'map' ? entries(u) : [];
      const h = u.t === 'map' ? m.find(([k]) => keywordOf(k) === ':handler')?.[1] : val;
      const chain = m.filter(([k]) => CHAIN_KEYS.has(keywordOf(k) ?? '')).flatMap(([, c]) => chainLinks(ctx, file, c));
      // pedestal: {:get [route-name interceptor ... handler]}
      const inline = u.t === 'vector' ? chainLinks(ctx, file, u) : [];
      const handlers = u.t === 'vector' ? inline.slice(-1) : handlerLink(ctx, file, h);
      emit(key.slice(1).toUpperCase(), handlers, [...guards, ...[...chain, ...inline.slice(0, -1)].map((l) => ({ ...l, level: 'method' }))]);
    }
    const inner = { prefix: path, guards: guards.map((g) => ({ ...g, inheritedFrom: g.inheritedFrom ?? path })) };
    for (const x of xs.slice(1)) nested(unwrap(x), inner);
  };
  const nested = (f: Form, scope: Scope): void => {
    if (isRoute(f)) route(f, scope);
    else if (f.t === 'vector') for (const x of flatChildren(f)) nested(unwrap(x), scope);
  };
  const visit = (forms: readonly Form[]): void => {
    for (const f of forms) {
      const u = unwrap(f);
      if (isRoute(u) || (u.t === 'vector' && flatChildren(u).some((x) => isRoute(unwrap(x))))) nested(u, { prefix: '', guards: [] });
      else visit(kids(u));
    }
  };
  visit(ctx.forms(file));
  return out;
}

export function routes(ctx: Context, owner: Owner): Route[] {
  const users = new Map<string, Set<string>>();
  for (const u of ctx.analysis.nsUses) if (DATA_LIBS.test(u.to)) users.set(u.file, (users.get(u.file) ?? new Set()).add(libraryOf(u.to)));
  const data = ctx.analysis.nsDefs.flatMap((d) => {
    const libs = users.get(d.file);
    return libs ? dataRoutes(ctx, d.file, [...libs].sort().join(', '), owner, d.name) : [];
  });
  return [...compojureRoutes(ctx), ...data];
}

export const httpRoutes: Adapter = {
  name: 'routes',
  edgeKinds: ['routes_to', 'guarded_by'],
  detect: (ctx) => {
    const libs = new Set(ctx.analysis.nsUses.map((u) => u.to).flatMap((n) => (n === COMPOJURE || DATA_LIBS.test(n) ? [libraryOf(n)] : [])));
    return libs.size ? [...libs].sort().join(', ') : null;
  },
  run: (ctx, owner) => {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    for (const r of routes(ctx, owner)) {
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
    }
    return { nodes, edges };
  },
};
