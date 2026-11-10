// Resolving a var by symbol at runtime: (requiring-resolve 'ns/name), (resolve 'ns/name), (ns-resolve ns 'ns/name). A
// literal quoted ns/name that names a project var is a reference the call graph can record (HEURISTIC: the call may
// never run, or run with another symbol); a symbol built at runtime is counted as a site and not followed.
import type { VarUse } from './analysis.ts';
import { CORE_NS, type Context } from './model.ts';
import { formAt, kids, textOf, type Form } from './reader.ts';

export const DYNAMIC_RESOLVERS = new Set(['requiring-resolve', 'resolve', 'ns-resolve']);

export interface DynamicResolution {
  use: VarUse;
  // "ns/name" of the project var the literal symbol names; absent when the symbol is not a literal, or names nothing in the project
  full?: string;
}

// The symbol of a quoted argument, 'a/b or (quote a/b).
function quotedSymbol(f: Form | undefined): string | undefined {
  const inner = f && f.t === 'quote' ? f.children[0] : f && f.t === 'list' && textOf(f.children[0]) === 'quote' ? f.children[1] : undefined;
  return inner && inner.t === 'symbol' ? inner.text : undefined;
}

// Every use of a resolver, with the project var its last argument names when that is a quoted qualified symbol.
export function dynamicResolutions(ctx: Context): DynamicResolution[] {
  return ctx.analysis.varUses.filter((u) => CORE_NS.test(u.to) && DYNAMIC_RESOLVERS.has(u.name)).map((use) => {
    const form = formAt(ctx.forms(use.file), use.row, use.col);
    const sym = form && form.t === 'list' ? quotedSymbol(kids(form).at(-1)) : undefined;
    return sym && ctx.defs.has(sym) ? { use, full: sym } : { use };
  });
}
