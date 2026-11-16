// What a route requires, as .clojure-atlas.edn declares it: the permissions of route-data authz maps (one, any of,
// all of, decided at runtime), the exemption, and the permission middleware whose argument is a permission.
import { flatChildren, formAt, kids, textOf as text, unwrap, type Form } from '../reader.ts';
import type { Context } from '../model.ts';
import { entries, entry } from './route-data.ts';

export interface Permission {
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
  // the file the permission is cited in, with line: where it is written, which is not always the route's file
  file: string;
  // a guess: a wrapper around the routing table
  guessed?: boolean;
}

export interface Authz {
  permissions: Permission[];
  exempt?: { reason: string; file: string; line: number };
}

export const NO_AUTHZ: Authz = { permissions: [] };

export interface Located {
  form: Form;
  file: string;
}

// The value form of a project definition: (def x v), (defn f [params] body) gives its params and body.
export function definitionForm(ctx: Context, full: string): { file: string; params?: Form; value: Form } | undefined {
  const d = ctx.defs.get(full);
  const form = d && formAt(ctx.forms(d.file), d.row, d.col);
  const xs = form ? kids(form) : [];
  const params = xs.find((x, i) => i >= 2 && unwrap(x).t === 'vector');
  const value = xs[xs.length - 1];
  return d && value && xs.length >= 3 ? { file: d.file, ...(params && params !== value ? { params: unwrap(params) } : {}), value: unwrap(value) } : undefined;
}

// A symbol naming a constant var, (def p :edit), stands for its value.
export function constant(ctx: Context, at: Located): Located {
  const u = unwrap(at.form);
  const def = u.t === 'symbol' ? ctx.defAt(at.file, u.row, u.col) : undefined;
  const d = def ? definitionForm(ctx, def) : undefined;
  return d && !d.params && ['keyword', 'set', 'vector'].includes(d.value.t) ? { form: d.value, file: d.file } : at;
}

// A symbol naming a var whose value is a map literal stands for that map.
export function constantMap(ctx: Context, at: Located): Located {
  const u = unwrap(at.form);
  const def = u.t === 'symbol' ? ctx.defAt(at.file, u.row, u.col) : undefined;
  const d = def ? definitionForm(ctx, def) : undefined;
  return d && !d.params && d.value.t === 'map' ? { form: d.value, file: d.file } : at;
}

// A symbol naming a var whose value is a map literal, also through vars that only name another var, stands for that map.
function tableOf(ctx: Context, at: Located, depth = 0): Located | undefined {
  const u = unwrap(at.form);
  const def = u.t === 'symbol' ? ctx.defAt(at.file, u.row, u.col) : undefined;
  const d = def ? definitionForm(ctx, def) : undefined;
  if (!d || d.params) return undefined;
  if (d.value.t === 'map') return { form: d.value, file: d.file };
  return d.value.t === 'symbol' && depth < 4 ? tableOf(ctx, { form: d.value, file: d.file }, depth + 1) : undefined;
}

// (table k), (get table k) and (k table) with a literal key stand for that entry of a table held by a var: a permission
// table shared by the routes and the code that links to them. A key the table lacks stays decided at runtime.
export function lookedUp(ctx: Context, at: Located, bind: (f: Located) => Located): Located | undefined {
  const u = unwrap(at.form);
  const xs = u.t === 'list' ? u.children.map((form) => ({ form, file: at.file })) : [];
  const viaGet = xs.length === 3 && text(unwrap(xs[0].form)) === 'get';
  const keyFirst = xs.length === 2 && unwrap(xs[0].form).t === 'keyword';
  if (!viaGet && xs.length !== 2) return undefined;
  const [tableAt, keyAt] = viaGet ? [xs[1], xs[2]] : keyFirst ? [xs[1], xs[0]] : [xs[0], xs[1]];
  const table = tableOf(ctx, tableAt);
  const key = unwrap(bind(keyAt).form);
  if (!table || (key.t !== 'keyword' && key.t !== 'string')) return undefined;
  const hit = entries(table.form).find(([k]) => {
    const e = unwrap(k);
    return e.t === key.t && e.text === key.text;
  });
  return hit ? { form: hit[1], file: table.file } : undefined;
}

// :p one permission; #{:a :b} any of them; [:a :b] all of them; an entry of a constant table (see lookedUp); anything
// else is decided at runtime. bind turns a helper's parameter into the argument of the call.
export function permissionsOf(ctx: Context, at: Located, check: number, scope: string | undefined,
  bind: (f: Located) => Located = (f) => f): Permission[] {
  const value = constant(ctx, lookedUp(ctx, at, bind) ?? at);
  const u = unwrap(value.form);
  const one = (x: Form, alternative: number, alternatives: number, allOf: number): Permission => {
    const v = unwrap(x);
    return { name: text(v) ?? `(runtime ${v.t})`, dynamic: v.t !== 'keyword', check, checks: check, alternative, alternatives, allOf,
      ...(scope ? { scope } : {}), file: value.file, line: x.row };
  };
  if (u.t === 'set') return flatChildren(u).map((x, i, all) => one(x, i + 1, all.length, 1));
  if (u.t === 'vector') return flatChildren(u).map((x, _i, all) => one(x, 1, 1, all.length));
  return [one(u, 1, 1, 1)];
}

// An authz map, or (helper args) whose body is one: its parameters are bound to the call's arguments.
export function authzMap(ctx: Context, at: Located): { map: Form; bind: (f: Located) => Located } | undefined {
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

export function routeDataAuthz(ctx: Context, file: string, data: Form | undefined): Authz | undefined {
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
    if (reason) exempt = { reason: text(unwrap(reason)) ?? '?', file, line: value.row };
    // the check itself, then the alternative map that also satisfies it
    const check = permissions.reduce((n, p) => Math.max(n, p.check), 0) + 1;
    const alt = cfg.alternative ? entry(m.map, cfg.alternative) : undefined;
    const options = [m.map, ...(alt && unwrap(alt).t === 'map' ? [unwrap(alt)] : [])];
    const found = options.map((o) => {
      const perm = cfg.permission ? entry(o, cfg.permission) : undefined;
      const scopeForm = cfg.scope ? entry(o, cfg.scope) : undefined;
      const scope = scopeForm && m.bind({ form: scopeForm, file }).form;
      return perm ? permissionsOf(ctx, m.bind({ form: perm, file }), check, scope && formText(scope), m.bind) : [];
    }).filter((ps) => ps.length);
    const single = found.length > 1 && found.every((ps) => ps.length === 1);
    permissions.push(...(single ? found.map(([p], k) => ({ ...p, alternative: k + 1, alternatives: found.length })) : found.flat()));
  }
  // cited at the route's own authz entry: a constant or helper may live in another file
  const checks = permissions.reduce((n, p) => Math.max(n, p.check), 0);
  if (!permissions.length && !exempt) return undefined;
  return { permissions: permissions.map((p) => ({ ...p, checks, file, line: value.row })), ...(exempt ? { exempt } : {}) };
}

// Short source-like text of a scope form, for the edge attribute.
export function formText(f: Form): string {
  const u = unwrap(f);
  if ('text' in u) return u.text;
  return u.t === 'list' ? `(${u.children.map(formText).join(' ')})` : u.t;
}

// The permission argument of a permission middleware, and the file it is written in; guessed: the middleware wraps the
// whole routing table, so which routes it reaches is read from the code around it.
export interface Check extends Located {
  guessed?: boolean;
}

// Each permission middleware in a chain is one more check that every request must pass.
export function addChecks(ctx: Context, authz: Authz, added: readonly Check[]): Authz {
  if (!added.length) return authz;
  const before = authz.permissions.reduce((m, p) => Math.max(m, p.check), 0);
  const all = [...authz.permissions, ...added.flatMap((c, i) => permissionsOf(ctx, c, before + i + 1, undefined)
    .map((p) => ({ ...p, file: c.file, line: c.form.row, ...(c.guessed ? { guessed: true } : {}) })))];
  const checks = before + added.length;
  return { ...authz, permissions: all.map((p) => ({ ...p, checks })) };
}
