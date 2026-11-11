// What a resolved var usage is, from where its symbol stands: a call (head of a list), a macro expansion, a function
// passed to a function (partial, comp, map ...: the callee may never run it), a handler handed to a registry
// (re-frame's reg-*, add-watch, add-tap: run later on an event), a dynamic rebinding (binding, with-redefs: replaced
// at runtime, an UNKNOWN boundary) or a value use (data, an alias, a returned value).
import type { Band } from '../mcp/graph.ts';
import type { VarUse } from './analysis.ts';
import { formAt, headName, kids, type Form } from './reader.ts';
import { CORE_NS, isSpecialForm, UNKNOWN_NS, type Context } from './model.ts';

export type Relation = 'calls' | 'references' | 'passes_callback' | 'registers_handler' | 'expands_via' | 'rebinds';

export interface Classified {
  kind: Relation;
  band: Band;
  via?: string;
  // set where the usage cannot be attributed with certainty (see classify): its arity is not proven either
  weak?: true;
  // the macro around the usage that clj-kondo could not expand
  inMacro?: string;
}

// binding forms that name their value: the right-hand side of a pair is aliased (for and doseq iterate theirs)
const ALIASING = new Set(['let', 'loop', 'when-let', 'if-let', 'when-some', 'if-some', 'letfn', 'with-open']);
const REBINDINGS = new Set(['binding', 'with-redefs', 'with-bindings']);
const DEFINING = new Set(['def', 'defonce']);
// functions that store their last argument as a handler; the arguments before it (ids, interceptors, keys) are values
const REGISTRARS = new Set([
  ...['core', 'alpha'].flatMap((ns) =>
    ['reg-event-db', 'reg-event-fx', 'reg-event-ctx', 'reg-sub', 'reg-sub-raw', 'reg-fx', 'reg-cofx'].map((n) => `re-frame.${ns}/${n}`)),
  'clojure.core/add-watch', 'clojure.core/add-tap',
]);


// The clojure.core name a list's head resolves to, else undefined: a user's own `binding` or a local that shadows
// one is not the macro, whatever its text says.
function coreHeadOf(ctx: Context, file: string, f: Form | undefined): string | undefined {
  const sym = f && f.t === 'list' ? f.children[0] : undefined;
  const use = sym?.t === 'symbol' ? ctx.useAt(file, sym.row, sym.col) : undefined;
  return use && CORE_NS.test(use.to) ? use.name : undefined;
}

// The collection holding the form at this place, seen through reader conditionals: #?(:clj f :cljs f) sits where f would.
function placeOf(ctx: Context, file: string, row: number, col: number) {
  let at = ctx.parentOf(file, row, col);
  while (at?.parent.t === 'cond') at = ctx.parentOf(file, at.parent.row, at.parent.col);
  return at;
}

// Whether the form at this place sits in a syntax-quoted template and not under an unquote inside it: the template
// builds code or data for somewhere else, so the enclosing function does not call what it names.
function inTemplate(ctx: Context, file: string, row: number, col: number): boolean {
  for (let at = placeOf(ctx, file, row, col); at; at = placeOf(ctx, file, at.parent.row, at.parent.col)) {
    if (at.parent.t === 'unquote' || at.parent.t === 'unquote-splicing') return false;
    if (at.parent.t === 'syntax-quote') return true;
  }
  return false;
}

function shape(ctx: Context, u: VarUse): Classified {
  if (inTemplate(ctx, u.file, u.nameRow, u.nameCol)) return { kind: 'references', band: 'heuristic', via: 'syntax-quote' };
  if (u.macro) return { kind: 'expands_via', band: 'static_proven' };
  const at = placeOf(ctx, u.file, u.nameRow, u.nameCol);
  const parent = at?.parent;
  const head = headName(parent);
  if (parent?.t === 'list' && at?.index === 0) return { kind: 'calls', band: 'static_proven' };
  // (apply f args): a call with an argument count known only at runtime
  if (coreHeadOf(ctx, u.file, parent) === 'apply' && at?.index === 1) return { kind: 'calls', band: 'heuristic', via: 'apply' };
  // kondo gives an argument count to a call it sees through a macro: (-> x f)
  if (u.arity !== undefined) return { kind: 'calls', band: 'static_proven' };
  if (parent?.t === 'list' && head && DEFINING.has(head)) return { kind: 'references', band: 'static_proven', via: 'alias' };
  // a function passed to a function is a callback the callee may or may not run; in a macro or special form
  // (defn, let, if, try, new, reify, extend-type ...), in a call kondo cannot resolve, or when it is not a
  // function (data, a record class), it is a value
  if (parent?.t === 'list' && parent.children[0]?.t === 'symbol' && ctx.defs.get(`${u.to}/${u.name}`)?.fn) {
    const callee = ctx.useAt(u.file, parent.children[0].row, parent.children[0].col);
    if (callee && REGISTRARS.has(`${callee.to}/${callee.name}`)) {
      return at?.index === parent.children.length - 1
        ? { kind: 'registers_handler', band: 'static_proven', via: head }
        : { kind: 'references', band: 'static_proven' };
    }
    if (callee && callee.to !== UNKNOWN_NS && !callee.macro && !isSpecialForm(callee)) return { kind: 'passes_callback', band: 'static_proven', via: head };
  }
  if (parent?.t === 'vector') {
    const owner = placeOf(ctx, u.file, parent.row, parent.col)?.parent;
    const binder = coreHeadOf(ctx, u.file, owner);
    if (binder && REBINDINGS.has(binder) && (at?.index ?? 0) % 2 === 0) return { kind: 'rebinds', band: 'unknown', via: binder };
    if (binder && ALIASING.has(binder) && (at?.index ?? 0) % 2 === 1) return { kind: 'references', band: 'static_proven', via: 'alias' };
  }
  return { kind: 'references', band: 'static_proven' };
}

// Whether a call head is a macro clj-kondo cannot see through: a symbol it could not resolve at all (an unknown
// macro, an unbound name), or a project macro the project's configuration does not teach it. Special forms and
// the language's and libraries' macros are known.
const unexpanded = (ctx: Context, head: VarUse): boolean =>
  head.to === UNKNOWN_NS
    ? !isSpecialForm(head) && !assertionHeads(ctx)(head)
    : head.macro && ctx.projectNs.has(head.to) && !ctx.understood.has(`${head.to}/${head.name}`);

// The innermost unexpanded macro whose arguments hold the usage; the call the usage heads is not its own argument.
function macroAround(ctx: Context, u: VarUse): string | undefined {
  let at = placeOf(ctx, u.file, u.nameRow, u.nameCol);
  if (at?.parent.t === 'list' && at.index === 0) at = placeOf(ctx, u.file, at.parent.row, at.parent.col);
  for (; at; at = placeOf(ctx, u.file, at.parent.row, at.parent.col)) {
    const head = at.parent.t === 'list' && at.index > 0 ? at.parent.children[0] : undefined;
    const use = head?.t === 'symbol' ? ctx.useAt(u.file, head.row, head.col) : undefined;
    if (use && unexpanded(ctx, use)) return use.to === UNKNOWN_NS ? use.name : `${use.to}/${use.name}`;
  }
  return undefined;
}

const heads = new WeakMap<Context, (u: VarUse) => boolean>();
const TEST_NS = /^(clojure|cljs)\.test$/;

// Places where a list is the assertion of an `is`: its head symbol is an assert-expr dispatch value.
export function assertionHeads(ctx: Context): (u: VarUse) => boolean {
  const memo = heads.get(ctx);
  if (memo) return memo;
  const byFile = new Map<string, Set<string>>();
  for (const u of ctx.analysis.varUses) {
    if (u.name !== 'is' || !TEST_NS.test(u.to)) continue;
    const form = formAt(ctx.forms(u.file), u.row, u.col);
    const arg = form ? kids(form)[1] : undefined;
    const head = arg && arg.t === 'list' ? arg.children[0] : undefined;
    if (head) byFile.set(u.file, (byFile.get(u.file) ?? new Set()).add(`${head.row}:${head.col}`));
  }
  const isHead = (u: VarUse) => byFile.get(u.file)?.has(`${u.nameRow}:${u.nameCol}`) ?? false;
  heads.set(ctx, isHead);
  return isHead;
}

// What the usage is, and how far it can be trusted: a name defined in two files, or a call inside a macro that is
// not expanded, may mean something else than kondo's static reading, so it is never STATIC_PROVEN.
export function classify(ctx: Context, u: VarUse): Classified {
  const rel = shape(ctx, u);
  const inMacro = macroAround(ctx, u);
  const reason = inMacro ? 'unexpanded-macro' : ctx.duplicateNs.has(u.to) ? 'duplicate-namespace' : undefined;
  if (!reason) return rel;
  return { ...rel, band: rel.band === 'static_proven' ? 'heuristic' : rel.band, via: rel.via ?? reason, weak: true, ...(inMacro ? { inMacro } : {}) };
}
