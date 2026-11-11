// Function signatures for signature_impact: each arity's parameters (a symbol, a destructured map with its keys,
// :as and :or defaults, keyword args after &, a rest arg or a vector), the keys a parameter is read by in the body
// and where it escapes; and at a call site, the keys a literal map argument or keyword args pass.
import { flatChildren, isAnnotationMark, isThreadStep, kids, textOf, unwrap, type Form } from './reader.ts';

export interface Param {
  kind: 'symbol' | 'map' | 'kwargs' | 'rest' | 'vector' | 'other';
  name?: string;
  keys?: string[];
  as?: string;
  defaults?: string[];
  // keys the body tests for or falls back from: (or k d), (if k ..), (get m :k d), (contains? m :k)
  optional?: string[];
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

const LET_FORMS = new Set(['let', 'loop', 'if-let', 'when-let', 'if-some', 'when-some', 'doseq', 'for']);
// the let forms that bind the value itself; doseq and for bind its elements
const VALUE_LETS = new Set(['let', 'loop', 'if-let', 'when-let', 'if-some', 'when-some']);
const FN_FORMS = new Set(['fn', 'fn*']);
const THREAD_FIRST = new Set(['->', 'some->']);
// forms that only ask whether their first argument is there: no key is read and the value goes nowhere
const TESTS = new Set(['if', 'if-not', 'when', 'when-not', 'not', 'nil?', 'some?', 'map?']);

// (s/defn f :- Out [a :- A {:keys [b]} :- B] ...): a `:-` and the schema after it annotate a parameter or the result;
// they are neither parameters nor the parameter vector.
const unannotated = (xs: readonly Form[]): Form[] => xs.filter((x, i) => !isAnnotationMark(x) && !isAnnotationMark(xs[i - 1]));

const mentions = (f: Form, sym: string): boolean => {
  const u = unwrap(f);
  return (u.t === 'symbol' && u.text === sym) || kids(u).some((c) => mentions(c, sym));
};

// {:keys [a b] :as m :or {a 1}} and {x :k}, {{:keys [c]} :child}: the keys it takes, its alias and the keys with a
// default. A :strs or :syms entry takes keys this list cannot name, so the result is partial.
function mapParam(m: Form, name: Name): Omit<Param, 'kind'> & { partial: boolean; locals: Map<string, string> } {
  const xs = flatChildren(m);
  const keys: string[] = [];
  const local = new Map<string, string>();
  let as: string | undefined;
  let or: Form[] = [];
  let partial = false;
  for (let i = 0; i + 1 < xs.length; i += 2) {
    const k = unwrap(xs[i]);
    const v = unwrap(xs[i + 1]);
    // kondo resolves ::alias/keys to the namespace written in full
    const kt = k.t === 'keyword' ? name(k) : '';
    if (/^:(.+\/)?keys$/.test(kt) && v.t === 'vector') {
      const ns = kt.includes('/') ? `${kt.slice(1, kt.indexOf('/'))}/` : '';
      for (const s of flatChildren(v)) {
        const sym = (textOf(s) ?? '').replace(/^:/, '');
        if (!sym) continue;
        keys.push(`:${ns}${sym}`);
        // :keys [user/id] binds the local id
        local.set(sym.slice(sym.lastIndexOf('/') + 1), `:${ns}${sym}`);
      }
    } else if (/^:(.+\/)?(strs|syms)$/.test(kt)) partial = true;
    else if (kt === ':as') as = textOf(v);
    else if (kt === ':or' && v.t === 'map') or = flatChildren(v).filter((_, j) => j % 2 === 0);
    else if ((k.t === 'symbol' || k.t === 'map' || k.t === 'vector') && v.t === 'keyword') {
      keys.push(name(v));
      if (k.t === 'symbol') local.set(k.text, name(v));
    }
  }
  const defaults = or.map((s) => local.get(textOf(unwrap(s)) ?? '') ?? `:${textOf(unwrap(s))}`);
  return { keys, ...(as ? { as } : {}), ...(defaults.length ? { defaults } : {}), partial, locals: local };
}

const IF_LETS = new Set(['if-let', 'when-let', 'if-some', 'when-some']);
const ASKS = new Set(['if', 'when', 'if-not', 'when-not', 'not', 'nil?', 'some?', 'some->', 'some->>']);

// Whether the argument at `i` of a call to `h` is only asked about or fallen back from: the test of if and when, any
// argument of or and and but the last, a test of cond and cond->.
function asksAt(h: string | undefined, i: number, n: number): boolean {
  if (!h) return false;
  if (ASKS.has(h)) return i === 1;
  if (h === 'or' || h === 'and') return i >= 1 && i < n - 1;
  if (h === 'cond') return i % 2 === 1;
  return (h === 'cond->' || h === 'cond->>') && i >= 2 && i % 2 === 0;
}

// The keys of a map parameter the body treats as optional: read with a default ((get m :k d), (:k m d)), asked for
// with contains?, or used where the value is only tested or fallen back from ((or k d), (if k ..), (when-let [x k] ..)).
// `locals` are the names its pattern binds, `alias` its :as name. A name bound again further in is not followed: the
// result can only call a key optional that is not, never the reverse.
function optionalKeys(body: readonly Form[], locals: ReadonlyMap<string, string>, alias: string | undefined, name: Name): string[] {
  const out = new Set<string>();
  const isAlias = (f: Form | undefined) => !!alias && !!f && unwrap(f).t === 'symbol' && textOf(unwrap(f)) === alias;
  const keyword = (f: Form | undefined) => (f && unwrap(f).t === 'keyword' ? unwrap(f) : undefined);
  const visit = (f: Form, asked: boolean): void => {
    const local = f.t === 'symbol' ? locals.get(f.text) : undefined;
    if (local && asked) out.add(local);
    if (f.t !== 'list') return kids(f).forEach((c) => visit(c, false));
    const xs = f.children;
    const h = textOf(xs[0]);
    const read = keyword(xs[0]) && isAlias(xs[1]) ? keyword(xs[0]) : h === 'get' && isAlias(xs[1]) ? keyword(xs[2]) : undefined;
    const hasDefault = xs.length === (h === 'get' ? 4 : 3);
    if (read && (asked || hasDefault)) out.add(name(read));
    if (h === 'contains?' && isAlias(xs[1]) && keyword(xs[2])) out.add(name(keyword(xs[2]) as Form));
    xs.forEach((c, i) => {
      if (h && IF_LETS.has(h) && i === 1 && c.t === 'vector') c.children.forEach((b, j) => visit(b, j % 2 === 1));
      else visit(c, asksAt(h, i, xs.length));
    });
  };
  body.forEach((f) => visit(f, false));
  return [...out].sort();
}

// The default values of every :or in a binding pattern, nested patterns included.
function orDefaults(pattern: Form): Form[] {
  const p = unwrap(pattern);
  if (p.t === 'vector') return kids(p).flatMap(orDefaults);
  if (p.t !== 'map') return [];
  const xs = kids(p);
  return xs.flatMap((k, i) => {
    if (i % 2 === 1 || i + 1 >= xs.length) return [];
    const v = unwrap(xs[i + 1]);
    return textOf(unwrap(k)) === ':or' && v.t === 'map' ? kids(v).filter((_, j) => j % 2 === 1) : orDefaults(k);
  });
}

// The keys `sym` is read by in the body, and every other use of it. A read is (:k sym), (get sym :k), (contains? sym :k),
// (get-in sym [:k ...]), (sym :k), the first keyword step of (-> sym :k ...) and a let that destructures it; a
// truthiness test reads nothing. A let, loop or fn that binds the name again hides the parameter from what follows.
function readsOf(body: readonly Form[], sym: string, name: Name): { reads: string[]; escapes: string[] } {
  const reads = new Set<string>();
  const escapes = new Set<string>();
  // `threaded`: the list holding f is a step of a threading form, which puts another value in front of its arguments
  const visit = (f: Form, parent: Form | undefined, index: number, threaded = false): void => {
    if (f.t === 'symbol' && f.text === sym && !parent) escapes.add('returned');
    else if (f.t === 'symbol' && f.text === sym && parent) {
      const head = parent.t === 'list' ? unwrap(parent.children[0] ?? parent) : undefined;
      const h = head ? textOf(head) : undefined;
      const keywordAt = (i: number): Form | undefined => {
        const x = parent.t === 'list' && parent.children[i] ? unwrap(parent.children[i]) : undefined;
        return x?.t === 'keyword' ? x : undefined;
      };
      const step = index === 1 && ((h === 'get' || h === 'contains?' || (h && THREAD_FIRST.has(h))) ? keywordAt(2) : undefined);
      const called = index === 0 && parent.t === 'list' && parent.children.length <= 3 ? keywordAt(1) : undefined;
      if (threaded) escapes.add('used in a step of a threading form');
      else if (head?.t === 'keyword' && index === 1) reads.add(name(head));
      else if (step) reads.add(name(step));
      else if (called) reads.add(name(called));
      else if (h === 'get-in' && index === 1 && parent.t === 'list' && unwrap(parent.children[2] ?? parent).t === 'vector') {
        const first = flatChildren(unwrap(parent.children[2]))[0];
        if (first && unwrap(first).t === 'keyword') reads.add(name(unwrap(first)));
        else escapes.add('get-in with a computed path');
      } else if (!(h && TESTS.has(h) && index === 1)) escapes.add(h && index > 0 ? `passed to ${h}` : 'used as a value');
    }
    const head = f.t === 'list' ? textOf(kids(f)[0]) : undefined;
    if (head && LET_FORMS.has(head) && kids(f)[1]?.t === 'vector') return visitLet(f, VALUE_LETS.has(head));
    if (head && FN_FORMS.has(head)) return visitFn(f);
    kids(f).forEach((c, i) => (isThreadStep(f, i) && c.t === 'list' ? kids(c).forEach((x, j) => visit(x, c, j, true)) : visit(c, f, i)));
  };
  // (let [{:keys [a] :as all} sym] ...): the keys of the pattern are read, and its alias names the same map in the
  // rest of the let
  const destructured = (pattern: Form, rest: Form): void => {
    const m = mapParam(pattern, name);
    for (const k of m.keys ?? []) reads.add(k);
    // an :or default is evaluated while the name still means the parameter
    orDefaults(pattern).forEach((d, i) => visit(d, pattern, i));
    if (m.partial) escapes.add('destructured by :strs or :syms');
    if (!m.as) return;
    const through = readsOf([rest], m.as, name);
    for (const k of through.reads) reads.add(k);
    for (const e of through.escapes) escapes.add(e);
  };
  // binding inits are read while the name still means the parameter; the first pair that rebinds it ends the scope
  const visitLet = (f: Form, bindsValue: boolean): void => {
    const bindings = kids(f)[1];
    const pairs = kids(bindings);
    for (let i = 0; i + 1 < pairs.length; i += 2) {
      const init = unwrap(pairs[i + 1]);
      if (bindsValue && init.t === 'symbol' && init.text === sym && unwrap(pairs[i]).t === 'map') {
        destructured(unwrap(pairs[i]), { ...f, children: [kids(f)[0], { ...bindings, children: pairs.slice(i + 2) }, ...kids(f).slice(2)] } as Form);
      } else visit(pairs[i + 1], bindings, i + 1);
      if (mentions(pairs[i], sym)) return;
    }
    kids(f).slice(2).forEach((c, i) => visit(c, f, i + 2));
  };
  // a parameter vector that names it hides it from the body: the rest of a single-arity fn, one arity of a multi-arity one
  const visitFn = (f: Form): void => {
    const parts = kids(f);
    for (let i = 0; i < parts.length; i++) {
      const c = parts[i];
      const arity = c.t === 'list' && kids(c)[0]?.t === 'vector' ? c : undefined;
      const params = c.t === 'vector' ? c : arity && kids(arity)[0];
      if (!params) visit(c, f, i);
      else if (mentions(params, sym)) {
        if (c.t === 'vector') return;
      } else if (arity) kids(arity).forEach((x, j) => visit(x, arity, j));
      else visit(c, f, i);
    }
  };
  body.forEach((f) => visit(f, undefined, 0));
  return { reads: [...reads].sort(), escapes: [...escapes].sort() };
}

// A destructured parameter with the keys its body treats as optional (those without an :or default already).
function mapShaped(kind: 'map' | 'kwargs', pattern: Form, body: readonly Form[], name: Name): Param {
  const { partial, locals, ...m } = mapParam(pattern, name);
  const optional = optionalKeys(body, locals, m.as, name).filter((k) => m.keys?.includes(k) && !m.defaults?.includes(k));
  return withReads({ kind, ...m, ...(optional.length ? { optional } : {}) }, m.as, body, name, partial);
}

function withReads(p: Param, alias: string | undefined, body: readonly Form[], name: Name, partial = false): Param {
  if (!alias) return p.kind === 'map' || p.kind === 'kwargs' ? { ...p, reads_complete: !partial } : p;
  const r = readsOf(body, alias, name);
  return { ...p, ...(r.reads.length ? { reads: r.reads } : {}), reads_complete: !r.escapes.length && !partial,
    ...(r.escapes.length ? { escapes: r.escapes } : {}) };
}

function arity(params: Form, forms: readonly Form[], name: Name): Arity {
  const xs = unannotated(flatChildren(params));
  // the :or default of one parameter may read an earlier one: it is part of what the function does with it
  const body = [...xs.flatMap(orDefaults), ...forms];
  const out: Param[] = [];
  let variadic = false;
  for (let i = 0; i < xs.length; i++) {
    const x = unwrap(xs[i]);
    if (x.t === 'symbol' && x.text === '&') {
      variadic = true;
      const rest = xs[i + 1] && unwrap(xs[i + 1]);
      if (rest?.t === 'map') out.push(mapShaped('kwargs', rest, body, name));
      else out.push({ kind: 'rest', ...(rest && textOf(rest) ? { name: textOf(rest) } : {}) });
      break;
    }
    if (x.t === 'symbol') out.push(withReads({ kind: 'symbol', name: x.text }, x.text === '_' ? undefined : x.text, body, name));
    else if (x.t === 'map') out.push(mapShaped('map', x, body, name));
    else if (x.t === 'vector') out.push({ kind: 'vector' });
    else out.push({ kind: 'other' });
  }
  return { params: out, variadic };
}

// The arities of a (defn name doc? attrs? [params] body) or (defn name ([params] body) ...) form.
export function signatureOf(form: Form, name: Name): Arity[] | null {
  const xs = unannotated(kids(form).slice(2).map(unwrap));
  const start = xs.findIndex((x) => x.t === 'vector' || x.t === 'list');
  if (start < 0) return null;
  if (xs[start].t === 'vector') return [arity(xs[start], xs.slice(start + 1), name)];
  const arities = xs.slice(start).filter((x) => x.t === 'list' && unwrap(kids(x)[0] ?? x).t === 'vector')
    .map((x) => arity(unwrap(kids(x)[0]), kids(x).slice(1), name));
  return arities.length ? arities : null;
}

const fixed = (a: Arity) => a.params.filter((p) => p.kind !== 'rest' && p.kind !== 'kwargs').length;

// Whether clj-kondo counted the same parameters: its fixed arities and the least argument count of its variadic one.
// Where it did not (another platform's branch of a reader conditional, a macro that is linted as defn but shaped
// otherwise) the parameters read from the form are not the function's.
export function agreesWithKondo(arities: readonly Arity[], fixedArities: readonly number[] = [], varargsMin?: number): boolean {
  const read = arities.filter((a) => !a.variadic).map(fixed);
  const variadic = arities.find((a) => a.variadic);
  return read.length === new Set(fixedArities).size && read.every((n) => fixedArities.includes(n))
    && (variadic ? fixed(variadic) : undefined) === varargsMin;
}

// What a call passes: literal map arguments with their keys, symbols as locals, and keyword args when the callee
// takes them. Only when the written arguments are the call's arguments (not threaded, not applied).
export function callArgs(call: Form, arityCount: number, callee: Arity[] | null,
  name: Name): { args?: CallArg[]; kwargs?: { keys: string[]; band: 'static_proven' | 'unknown' } } {
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
    ? { keys: kw.filter((_, j) => j % 2 === 0).map(unwrap).filter((k) => k.t === 'keyword').map(name),
      band: kw.every((x, j) => j % 2 === 1 || unwrap(x).t === 'keyword') ? 'static_proven' as const : 'unknown' as const }
    : undefined;
  return { ...(args.length ? { args } : {}), ...(kwargs ? { kwargs } : {}) };
}

