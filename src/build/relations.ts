// What a resolved var usage is, from where its symbol stands: a call (head of a list), a macro expansion, a function
// passed to a function (partial, comp, map ...: the callee may never run it), a handler handed to a registry
// (re-frame's reg-*, add-watch, add-tap: run later on an event), a dynamic rebinding (binding, with-redefs: replaced
// at runtime, an UNKNOWN boundary) or a value use (data, an alias, a returned value).
import type { Band } from '../mcp/graph.ts';
import type { VarUse } from './analysis.ts';
import { textOf, type Form } from './reader.ts';
import type { Context } from './model.ts';

export type Relation = 'calls' | 'references' | 'passes_callback' | 'registers_handler' | 'expands_via' | 'rebinds';

export interface Classified {
  kind: Relation;
  band: Band;
  via?: string;
}

const BINDINGS = new Set(['let', 'loop', 'when-let', 'if-let', 'when-some', 'if-some', 'letfn', 'with-open', 'doseq', 'for']);
const REBINDINGS = new Set(['binding', 'with-redefs', 'with-bindings']);
const DEFINING = new Set(['def', 'defonce']);
// functions that store their last argument as a handler; the arguments before it (ids, interceptors, keys) are values
const REGISTRARS = new Set([
  ...['reg-event-db', 'reg-event-fx', 'reg-event-ctx', 'reg-sub', 'reg-sub-raw', 'reg-fx', 'reg-cofx'].map((n) => `re-frame.core/${n}`),
  'clojure.core/add-watch', 'clojure.core/add-tap',
]);

const headOf = (f: Form | undefined) => (f && f.t === 'list' ? textOf(f.children[0])?.replace(/^.*\//, '') : undefined);

export function classify(ctx: Context, u: VarUse): Classified {
  if (u.macro) return { kind: 'expands_via', band: 'static_proven' };
  const at = ctx.parentOf(u.file, u.nameRow, u.nameCol);
  const parent = at?.parent;
  const head = headOf(parent);
  if (parent?.t === 'list' && at?.index === 0) return { kind: 'calls', band: 'static_proven' };
  // (apply f args): a call with an argument count known only at runtime
  if (head === 'apply' && at?.index === 1) return { kind: 'calls', band: 'heuristic', via: 'apply' };
  // kondo gives an argument count to a call it sees through a macro: (-> x f)
  if (u.arity !== undefined) return { kind: 'calls', band: 'static_proven' };
  if (parent?.t === 'list' && head && DEFINING.has(head)) return { kind: 'references', band: 'static_proven', via: 'alias' };
  // a function passed to a function is a callback the callee may or may not run; in a macro or special form
  // (defn, let, reify, extend-type ...), or when it is not a function (data, a record class), it is a value
  if (parent?.t === 'list' && parent.children[0]?.t === 'symbol' && ctx.defs.get(`${u.to}/${u.name}`)?.fn) {
    const callee = ctx.useAt(u.file, parent.children[0].row, parent.children[0].col);
    if (callee && REGISTRARS.has(`${callee.to}/${callee.name}`)) {
      return at?.index === parent.children.length - 1
        ? { kind: 'registers_handler', band: 'static_proven', via: head }
        : { kind: 'references', band: 'static_proven' };
    }
    if (callee && !callee.macro) return { kind: 'passes_callback', band: 'static_proven', via: head };
  }
  if (parent?.t === 'vector') {
    const owner = ctx.parentOf(u.file, parent.row, parent.col)?.parent;
    const binder = headOf(owner);
    if (binder && REBINDINGS.has(binder) && (at?.index ?? 0) % 2 === 0) return { kind: 'rebinds', band: 'unknown', via: binder };
    if (binder && BINDINGS.has(binder) && (at?.index ?? 0) % 2 === 1) return { kind: 'references', band: 'static_proven', via: 'alias' };
  }
  return { kind: 'references', band: 'static_proven' };
}
