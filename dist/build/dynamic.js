import { CORE_NS } from "./model.js";
import { formAt, kids, textOf } from "./reader.js";
export const DYNAMIC_RESOLVERS = new Set(['requiring-resolve', 'resolve', 'ns-resolve']);
// The symbol of a quoted argument, 'a/b or (quote a/b).
function quotedSymbol(f) {
    const inner = f && f.t === 'quote' ? f.children[0] : f && f.t === 'list' && textOf(f.children[0]) === 'quote' ? f.children[1] : undefined;
    return inner && inner.t === 'symbol' ? inner.text : undefined;
}
// Every use of a resolver, with the project var its last argument names when that is a quoted qualified symbol.
export function dynamicResolutions(ctx) {
    return ctx.analysis.varUses.filter((u) => CORE_NS.test(u.to) && DYNAMIC_RESOLVERS.has(u.name)).map((use) => {
        const form = formAt(ctx.forms(use.file), use.row, use.col);
        const sym = form && form.t === 'list' ? quotedSymbol(kids(form).at(-1)) : undefined;
        return sym && ctx.defs.has(sym) ? { use, full: sym } : { use };
    });
}
