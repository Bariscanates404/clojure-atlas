import { CORE_NS, UNKNOWN_NS, keywordName } from "./analysis.js";
import { contains, kids, readForms, textOf, walk } from "./reader.js";
const LANGUAGE_NS = /^(clojure|cljs)\.(core|string|set|walk|test|edn|zip|data|pprint|repl|template|spec\.alpha|core\.async)$/;
export { CORE_NS, UNKNOWN_NS };
const SPECIAL_FORMS = new Set(['def', 'if', 'do', 'let*', 'letfn*', 'loop*', 'recur', 'fn*', 'quote', 'var', 'throw', 'try', 'catch',
    'finally', 'monitor-enter', 'monitor-exit', 'new', 'set!', '.', 'case*', 'deftype*', 'reify*', 'import*', '&']);
// kondo names a special form after clojure.core where it analyzes both platforms, and leaves it unresolved elsewhere
export const isSpecialForm = (u) => SPECIAL_FORMS.has(u.name) && (u.to === UNKNOWN_NS || CORE_NS.test(u.to));
export function groupBy(xs, key) {
    const out = new Map();
    for (const x of xs) {
        const k = key(x);
        const list = out.get(k);
        if (list)
            list.push(x);
        else
            out.set(k, [x]);
    }
    return out;
}
export const defId = (fullName) => `definition:${fullName}`;
export const nsId = (ns) => `namespace:${ns}`;
const isDeclare = (d) => /(^|\/)declare$/.test(d.definedBy ?? '');
// The definitions of one name: the first one stands, unless it is a (declare ...) and a later one is the real
// definition; the platforms they are defined for add up (the same namespace in a .clj and a .cljs file).
function merged(prev, d) {
    const winner = isDeclare(prev) && !isDeclare(d) ? d : prev;
    return { ...winner, langs: [...new Set([...prev.langs, ...d.langs])].sort() };
}
// The files defining each namespace more than once. One namespace in a .clj and a .cljs file of the same path is one
// namespace; the same name under two different paths is two.
function duplicateNamespaces(nsDefs) {
    const out = new Map();
    for (const [name, defs] of groupBy(nsDefs.filter((d) => d.name), (d) => d.name)) {
        if (new Set(defs.map((d) => d.file.replace(/\.clj[sc]?$/, ''))).size > 1)
            out.set(name, [...new Set(defs.map((d) => d.file))].sort());
    }
    return out;
}
export function createContext(analysis, config, playwright, sources, edn, componentOf, understood = new Set()) {
    const defs = new Map();
    for (const d of analysis.varDefs) {
        if (!d.name || LANGUAGE_NS.test(d.ns))
            continue;
        const full = `${d.ns}/${d.name}`;
        const prev = defs.get(full);
        defs.set(full, prev ? merged(prev, d) : d);
    }
    const cache = new Map();
    const parents = new Map();
    const at = (file, row, col) => `${file}:${row}:${col}`;
    const uses = new Map();
    for (const u of analysis.varUses)
        if (!u.defmethod)
            uses.set(at(u.file, u.nameRow, u.nameCol), u);
    const keywords = new Map();
    for (const k of analysis.keywords)
        keywords.set(at(k.file, k.row, k.col), k);
    const useAt = (file, row, col) => uses.get(at(file, row, col));
    const forms = (file) => {
        let f = cache.get(file);
        if (!f) {
            f = readForms(sources.get(file) ?? '').forms;
            cache.set(file, f);
        }
        return f;
    };
    return {
        config,
        playwright,
        useAt,
        defAt: (file, row, col) => {
            const u = useAt(file, row, col);
            return u && defs.has(`${u.to}/${u.name}`) ? `${u.to}/${u.name}` : undefined;
        },
        keywordAt: (file, row, col) => {
            const k = keywords.get(at(file, row, col));
            return k && keywordName(k);
        },
        parentOf: (file, row, col) => {
            let m = parents.get(file);
            if (!m) {
                m = new Map();
                for (const f of walk(forms(file)))
                    kids(f).forEach((c, index) => m?.set(`${c.row}:${c.col}`, { parent: f, index }));
                parents.set(file, m);
            }
            return m.get(`${row}:${col}`);
        },
        nameOf: (file, f) => {
            const k = keywords.get(at(file, f.row, f.col));
            return k ? keywordName(k) : textOf(f) ?? '';
        },
        analysis,
        // the language's own namespaces are never the project's, even where a repo declares them in test fixtures
        projectNs: new Set(analysis.nsDefs.map((d) => d.name).filter((n) => !LANGUAGE_NS.test(n))),
        defs,
        duplicateNs: duplicateNamespaces(analysis.nsDefs),
        understood: new Set([...understood, ...Object.keys(config.lintAs), ...Object.keys(config.routeMacros)]),
        edn,
        componentOf,
        forms,
    };
}
const size = (s) => (s.endRow - s.row) * 100000 + (s.endCol - s.col);
export function makeOwner(ctx, containers) {
    const byFile = groupBy(containers, (c) => c.span.file);
    // a site read from the forms has no var: the definition whose span holds it stands in
    const defsByFile = groupBy([...ctx.defs.values()].map((d) => ({ id: defId(`${d.ns}/${d.name}`), span: d })), (c) => c.span.file);
    const innermost = (cs, site) => {
        let best;
        for (const c of cs ?? [])
            if (contains(c.span, site.row, site.col) && (!best || size(c.span) < size(best.span)))
                best = c;
        return best;
    };
    return (site) => {
        if (site.fromVar && ctx.defs.has(`${site.from}/${site.fromVar}`))
            return defId(`${site.from}/${site.fromVar}`);
        return (innermost(byFile.get(site.file), site) ?? innermost(defsByFile.get(site.file), site))?.id ?? nsId(site.from);
    };
}
