// Function signatures for signature_impact: each arity's parameters (a symbol, a destructured map with its keys,
// :as and :or defaults, keyword args after &, a rest arg or a vector), the keys a parameter is read by in the body
// and where it escapes; and at a call site, the keys a literal map argument or keyword args pass.
import { flatChildren, kids, textOf, unwrap, type Form } from './reader.ts';

export interface Param {
  kind: 'symbol' | 'map' | 'kwargs' | 'rest' | 'vector' | 'other';
  name?: string;
  keys?: string[];
  as?: string;
  defaults?: string[];
  reads?: string[];
  reads_complete?: boolean;
  escapes?: string[];
}

export interface Arity {
  params: Param[];
  variadic: boolean;
}

export interface CallArg {
  i: number;
  shape: string;
  band: 'static_proven' | 'unknown';
  keys?: string[];
  local?: string;
  dynamic_keys?: number;
}

type Name = (f: Form) => string;

// {:keys [a b] :as m :or {a 1}} and {x :k}: the keys it takes, its alias and the keys with a default.
function mapParam(m: Form, name: Name): Omit<Param, 'kind'> {
  const xs = flatChildren(m);
  const keys: string[] = [];
  let as: string | undefined;
  let defaults: string[] = [];
  for (let i = 0; i + 1 < xs.length; i += 2) {
    const k = unwrap(xs[i]);
    const v = unwrap(xs[i + 1]);
    const kt = textOf(k) ?? '';
    if (k.t === 'keyword' && /^:(.+\/)?keys$/.test(kt) && v.t === 'vector') {
      const ns = kt.includes('/') ? `${kt.slice(1, kt.indexOf('/'))}/` : '';
      for (const s of flatChildren(v)) if (textOf(s)) keys.push(`:${ns}${(textOf(s) ?? '').replace(/^:/, '')}`);
    } else if (kt === ':as') as = textOf(v);
    else if (kt === ':or' && v.t === 'map') defaults = flatChildren(v).filter((_, j) => j % 2 === 0).map((s) => `:${textOf(unwrap(s))}`);
    else if (k.t === 'symbol' && v.t === 'keyword') keys.push(name(v));
  }
  return { keys, ...(as ? { as } : {}), ...(defaults.length ? { defaults } : {}) };
}

// The keys `sym` is read by in the body ((:k sym), (get sym :k), (get-in sym [:k ...])) and every other use of it.
function readsOf(body: readonly Form[], sym: string, name: Name): { reads: string[]; escapes: string[] } {
  const reads = new Set<string>();
  const escapes = new Set<string>();
  const visit = (f: Form, parent: Form | undefined, index: number): void => {
    if (f.t === 'symbol' && f.text === sym && !parent) escapes.add('returned');
    else if (f.t === 'symbol' && f.text === sym && parent) {
      const head = parent.t === 'list' ? unwrap(parent.children[0] ?? parent) : undefined;
      const h = head ? textOf(head) : undefined;
      if (head?.t === 'keyword' && index === 1) reads.add(name(head));
      else if (h === 'get' && index === 1 && parent.t === 'list' && unwrap(parent.children[2] ?? parent).t === 'keyword') reads.add(name(unwrap(parent.children[2])));
      else if (h === 'get-in' && index === 1 && parent.t === 'list' && unwrap(parent.children[2] ?? parent).t === 'vector') {
        const first = flatChildren(unwrap(parent.children[2]))[0];
        if (first && unwrap(first).t === 'keyword') reads.add(name(unwrap(first)));
        else escapes.add('get-in with a computed path');
      } else escapes.add(h && index > 0 ? `passed to ${h}` : 'used as a value');
    }
    kids(f).forEach((c, i) => visit(c, f, i));
  };
  body.forEach((f) => visit(f, undefined, 0));
  return { reads: [...reads].sort(), escapes: [...escapes].sort() };
}

function withReads(p: Param, alias: string | undefined, body: readonly Form[], name: Name): Param {
  if (!alias) return p.kind === 'map' || p.kind === 'kwargs' ? { ...p, reads_complete: true } : p;
  const r = readsOf(body, alias, name);
  return { ...p, ...(r.reads.length ? { reads: r.reads } : {}), reads_complete: !r.escapes.length, ...(r.escapes.length ? { escapes: r.escapes } : {}) };
}

function arity(params: Form, body: readonly Form[], name: Name): Arity {
  const xs = flatChildren(params);
  const out: Param[] = [];
  let variadic = false;
  for (let i = 0; i < xs.length; i++) {
    const x = unwrap(xs[i]);
    if (x.t === 'symbol' && x.text === '&') {
      variadic = true;
      const rest = xs[i + 1] && unwrap(xs[i + 1]);
      if (rest?.t === 'map') {
        const m = mapParam(rest, name);
        out.push(withReads({ kind: 'kwargs', ...m }, m.as, body, name));
      } else out.push({ kind: 'rest', ...(rest && textOf(rest) ? { name: textOf(rest) } : {}) });
      break;
    }
    if (x.t === 'symbol') out.push(withReads({ kind: 'symbol', name: x.text }, x.text === '_' ? undefined : x.text, body, name));
    else if (x.t === 'map') {
      const m = mapParam(x, name);
      out.push(withReads({ kind: 'map', ...m }, m.as, body, name));
    } else if (x.t === 'vector') out.push({ kind: 'vector' });
    else out.push({ kind: 'other' });
  }
  return { params: out, variadic };
}

// The arities of a (defn name doc? attrs? [params] body) or (defn name ([params] body) ...) form.
export function signatureOf(form: Form, name: Name): Arity[] | null {
  const xs = kids(form).slice(2).map(unwrap);
  const start = xs.findIndex((x) => x.t === 'vector' || x.t === 'list');
  if (start < 0) return null;
  if (xs[start].t === 'vector') return [arity(xs[start], xs.slice(start + 1), name)];
  const arities = xs.slice(start).filter((x) => x.t === 'list' && unwrap(kids(x)[0] ?? x).t === 'vector')
    .map((x) => arity(unwrap(kids(x)[0]), kids(x).slice(1), name));
  return arities.length ? arities : null;
}

const fixed = (a: Arity) => a.params.filter((p) => p.kind !== 'rest' && p.kind !== 'kwargs').length;

// What a call passes: literal map arguments with their keys, symbols as locals, and keyword args when the callee
// takes them. Only when the written arguments are the call's arguments (not threaded, not applied).
export function callArgs(call: Form, arityCount: number, callee: Arity[] | null, name: Name): { args?: CallArg[]; kwargs?: { keys: string[]; band: 'static_proven' | 'unknown' } } {
  const written = kids(call).slice(1);
  if (call.t !== 'list' || written.length !== arityCount) return {};
  const args: CallArg[] = [];
  written.forEach((a, i) => {
    const u = unwrap(a);
    if (u.t === 'map') {
      const ks = flatChildren(u).filter((_, j) => j % 2 === 0).map(unwrap);
      const keys = ks.filter((k) => k.t === 'keyword').map(name);
      args.push({ i, shape: 'map', keys, band: 'static_proven', ...(keys.length < ks.length ? { dynamic_keys: ks.length - keys.length } : {}) });
    } else if (u.t === 'symbol') args.push({ i, shape: 'symbol', band: 'unknown', local: u.text });
  });
  const kwArity = callee?.find((a) => a.params.some((p) => p.kind === 'kwargs'));
  const kw = kwArity && arityCount >= fixed(kwArity) ? written.slice(fixed(kwArity)) : undefined;
  const kwargs = kw && kw.length
    ? { keys: kw.filter((_, j) => j % 2 === 0).map(unwrap).filter((k) => k.t === 'keyword').map(name), band: kw.every((x, j) => j % 2 === 1 || unwrap(x).t === 'keyword') ? 'static_proven' as const : 'unknown' as const }
    : undefined;
  return { ...(args.length ? { args } : {}), ...(kwargs ? { kwargs } : {}) };
}

