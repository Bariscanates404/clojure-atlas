// Client-side routes: reitit route data in ClojureScript (a route vector naming its route with :name or carrying a
// :view, no server handler) and secretary's defroute. One node per path, its parameters written {p} so a URL in a
// test or a request matches it whichever way the path spells them.
import type { GraphNode } from '../../mcp/graph.ts';
import { flatChildren, formAt, kids, textOf, unwrap, type Form } from '../reader.ts';
import type { Adapter, Context } from '../model.ts';
import { canonicalPath, entry, isRoute, isRouteGroup, joinPath } from './route-data.ts';

const CLIENT_KEYS = [':name', ':view'];

const usesReitit = (u: { file: string; to: string }) => u.file.endsWith('.cljs') && u.to.startsWith('reitit.');

const clientRouteId = (path: string) => `client_route:${canonicalPath(path)}`;

interface ClientRoute {
  path: string;
  name?: string;
  file: string;
  line: number;
}

function reititRoutes(ctx: Context, file: string): ClientRoute[] {
  const out: ClientRoute[] = [];
  const route = (v: Form, prefix: string): void => {
    const xs = flatChildren(v);
    const path = joinPath(prefix, textOf(unwrap(xs[0])) ?? '');
    const data = xs.slice(1).map(unwrap).find((x) => x.t === 'map');
    const named = data && CLIENT_KEYS.some((k) => entry(data, k));
    const name = data && entry(data, ':name');
    if (named) out.push({ path, file, line: v.row, ...(name && unwrap(name).t === 'keyword' ? { name: ctx.nameOf(file, unwrap(name)) } : {}) });
    for (const x of xs.slice(1)) nested(unwrap(x), path);
  };
  const nested = (f: Form, prefix: string): void => {
    if (isRoute(f)) route(f, prefix);
    else if (f.t === 'vector') for (const x of flatChildren(f)) nested(unwrap(x), prefix);
  };
  const visit = (forms: readonly Form[]): void => {
    for (const f of forms) {
      const u = unwrap(f);
      if (isRoute(u) || isRouteGroup(u)) nested(u, '');
      else visit(kids(u));
    }
  };
  visit(ctx.forms(file));
  return out;
}

// (defroute "/path" [...] ...) or (defroute name "/path" [...] ...)
function secretaryRoutes(ctx: Context): ClientRoute[] {
  return ctx.analysis.varUses.filter((u) => u.to === 'secretary.core' && u.name === 'defroute').flatMap((u) => {
    const form = formAt(ctx.forms(u.file), u.row, u.col);
    const path = form ? kids(form).slice(1, 3).map(unwrap).find((x) => x.t === 'string') : undefined;
    return path ? [{ path: textOf(path) ?? '', file: u.file, line: u.row }] : [];
  });
}

export const clientRoutes: Adapter = {
  name: 'client_routes',
  edgeKinds: [],
  detect: (ctx) => (ctx.analysis.nsUses.some((u) => usesReitit(u) || u.to === 'secretary.core') ? 'reitit in ClojureScript or secretary' : null),
  run: (ctx) => {
    const files = new Set(ctx.analysis.nsUses.filter(usesReitit).map((u) => u.file));
    const found = [...[...files].flatMap((f) => reititRoutes(ctx, f)), ...secretaryRoutes(ctx)];
    const nodes: GraphNode[] = found.map((r) => {
      const component = ctx.componentOf(r.file);
      return {
        id: clientRouteId(r.path), kind: 'client_route', name: canonicalPath(r.path), file: r.file, line: r.line,
        ...(component ? { component } : {}), attrs: { path: r.path, ...(r.name ? { name: r.name } : {}) },
      };
    });
    return { nodes, edges: [] };
  },
};
