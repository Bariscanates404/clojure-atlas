// Route data shared by the server and client route adapters: a route is a vector whose first element is a literal
// path, nested routes join their paths, and route data is a map of keyword keys.
import { flatChildren, textOf, unwrap, type Form } from '../reader.ts';

export const COMPOJURE = 'compojure.core';

export const keywordOf = (f: Form): string | undefined => (unwrap(f).t === 'keyword' ? textOf(unwrap(f)) : undefined);

export function entries(m: Form): [Form, Form][] {
  const xs = flatChildren(m);
  const out: [Form, Form][] = [];
  for (let k = 0; k + 1 < xs.length; k += 2) out.push([xs[k], xs[k + 1]]);
  return out;
}

export const entry = (m: Form, key: string): Form | undefined => entries(m).find(([k]) => keywordOf(k) === key)?.[1];

export const joinPath = (prefix: string, seg: string) => (prefix.endsWith('/') && seg.startsWith('/') ? prefix + seg.slice(1) : prefix + seg);

export const isRoute = (f: Form): boolean => f.t === 'vector' && f.children.length > 1 && unwrap(f.children[0]).t === 'string'
  && /^(\/|$)/.test(textOf(unwrap(f.children[0])) ?? 'x');

export const isRouteGroup = (f: Form): boolean => f.t === 'vector' && flatChildren(f).some((x) => isRoute(unwrap(x)));

// One spelling for path parameters (:id, {id}, *rest), so a path written either way matches.
export const canonicalPath = (p: string) => p.replace(/\{[^}]*\}|:[^/]+|\*[^/]*/g, '{p}');
