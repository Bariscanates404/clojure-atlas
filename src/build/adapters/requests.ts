// HTTP requests the ClojureScript side issues: an effect map with :method and :uri (re-frame http-fx or a project's
// own request effect), cljs-ajax GET/POST/..., cljs-http get/post/... and js/fetch. A literal URI is the path; one
// built with str gets {p} for each runtime part. Each request is joined to the server routes by method and path.
import type { GraphEdge, GraphNode } from '../../mcp/graph.ts';
import { formAt, kids, textOf, unwrap, walk, type Form } from '../reader.ts';
import { groupBy, type Adapter, type Context, type Owner } from '../model.ts';
import { canonicalPath, entry, keywordOf } from './route-data.ts';
import { routeId, serverRoutes } from './routes.ts';

const CLIENT_FILE = /\.clj[sc]$/;
const AJAX = /^ajax\.core\/(GET|POST|PUT|DELETE|PATCH|HEAD)$/;
const CLJS_HTTP = /^cljs-http\.client\/(get|post|put|delete|patch|head)$/;

interface Request {
  method: string;
  path: string;
  literal: boolean;
  file: string;
  row: number;
  col: number;
  fromVar?: string;
  from: string;
}

const requestId = (r: Pick<Request, 'file' | 'row' | 'col'>) => `request:${r.file}:${r.row}:${r.col}`;

// "/a" -> /a, literal; (str "/a/" id "/b") -> /a/{p}/b, built at runtime; a project URL helper whose body is
// (str "/api" ...) or (apply str "/api" args) prefixes what it is given. Anything else is not a path.
function uriOf(ctx: Context, file: string, f: Form | undefined): { path: string; literal: boolean } | undefined {
  const u = f && unwrap(f);
  if (u?.t === 'string') return { path: u.text, literal: true };
  if (u?.t !== 'list' || !u.children.length) return undefined;
  const part = (x: Form) => uriOf(ctx, file, x) ?? { path: '{p}', literal: false };
  const join = (prefix: string, xs: readonly Form[]) => {
    const parts = xs.map(part);
    return { path: prefix + parts.map((p) => p.path).join(''), literal: parts.every((p) => p.literal) };
  };
  const head = unwrap(u.children[0]);
  if (textOf(head) === 'str') {
    const built = join('', u.children.slice(1));
    return built.path.startsWith('/') ? built : undefined;
  }
  const def = head.t === 'symbol' ? ctx.defAt(file, head.row, head.col) : undefined;
  const prefix = def ? helperPrefix(ctx, def) : undefined;
  return prefix === undefined ? undefined : join(prefix, u.children.slice(1));
}

// The literal a URL helper puts first: (defn f [& paths] (apply str "/api" paths)) or (defn f [p] (str "/api" p)).
function helperPrefix(ctx: Context, def: string): string | undefined {
  const d = ctx.defs.get(def);
  const form = d && /\/defn-?$/.test(d.definedBy ?? '') ? formAt(ctx.forms(d.file), d.row, d.col) : undefined;
  const body = form ? unwrap(kids(form)[kids(form).length - 1]) : undefined;
  if (body?.t !== 'list') return undefined;
  const xs = body.children.map(unwrap);
  const lit = textOf(xs[0]) === 'str' ? xs[1] : textOf(xs[0]) === 'apply' && textOf(xs[1]) === 'str' ? xs[2] : undefined;
  return lit?.t === 'string' && lit.text.startsWith('/') ? lit.text : undefined;
}

// js/fetch is interop clj-kondo does not report as a var usage, so it is read from the forms
function fetchCall(ctx: Context, f: Form, file: string, from: string): Request | undefined {
  if (f.t !== 'list' || textOf(f.children[0]) !== 'js/fetch') return undefined;
  const uri = uriOf(ctx, file, f.children[1]);
  if (!uri) return undefined;
  const raw = f.children[2] && unwrap(f.children[2]);
  // the options are a #js {...} literal or a map
  const opts = raw?.t === 'tagged' ? unwrap(raw.children[0]) : raw;
  const method = opts?.t === 'map' ? textOf(unwrap(entry(opts, ':method') ?? opts)) : undefined;
  return { method: (method ?? 'GET').replace(/^:/, '').toUpperCase(), ...uri, file, row: f.row, col: f.col, from };
}

function effectMaps(ctx: Context, file: string, from: string): Request[] {
  const out: Request[] = [];
  for (const f of walk(ctx.forms(file))) {
    const fetch = fetchCall(ctx, f, file, from);
    if (fetch) out.push(fetch);
    if (f.t !== 'map') continue;
    const method = entry(f, ':method');
    const at = entry(f, ':uri') ?? entry(f, ':url');
    const uri = uriOf(ctx, file, at);
    const m = method && keywordOf(method);
    if (!at || !uri || !m) continue;
    // cited where the URI is written
    out.push({ method: m.slice(1).toUpperCase(), ...uri, file, row: at.row, col: at.col, from });
  }
  return out;
}

function calls(ctx: Context): Request[] {
  return ctx.analysis.varUses.flatMap((u) => {
    const full = `${u.to}/${u.name}`;
    if (!CLIENT_FILE.test(u.file) || !(AJAX.test(full) || CLJS_HTTP.test(full))) return [];
    const form = formAt(ctx.forms(u.file), u.row, u.col);
    const uri = uriOf(ctx, u.file, form ? kids(form)[1] : undefined);
    if (!form || !uri) return [];
    return [{ method: u.name.toUpperCase(), ...uri, file: u.file, row: u.row, col: u.col, from: u.from, ...(u.fromVar ? { fromVar: u.fromVar } : {}) }];
  });
}

const routeKey = (method: string, path: string) => `${method} ${canonicalPath(path).replace(/(.)\/$/, '$1')}`;

export const requests: Adapter = {
  name: 'requests',
  edgeKinds: ['issues_request', 'requests_route'],
  detect: (ctx) => (ctx.analysis.nsDefs.some((d) => CLIENT_FILE.test(d.file)) ? 'ClojureScript sources' : null),
  run: (ctx: Context, owner: Owner) => {
    const found = [
      ...ctx.analysis.nsDefs.filter((d) => CLIENT_FILE.test(d.file)).flatMap((d) => effectMaps(ctx, d.file, d.name)),
      ...calls(ctx),
    ];
    const byKey = groupBy(serverRoutes(ctx, owner), (r) => routeKey(r.method, `${r.mount}${r.path}`));
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
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
          attrs: { copies: copies.length, reason: copies.length === 1 ? 'method and canonical path match one route' : `method and canonical path match ${copies.length} served copies` },
        });
      }
    }
    return { nodes, edges };
  },
};

