import { keywordName } from "../analysis.js";
import { contains, formAt, kids, unwrap } from "../reader.js";
import { defId, groupBy } from "../model.js";
const SPEC = /^(clojure|cljs)\.spec\.alpha$/;
const SPEC_DEF = /^(clojure|cljs)\.spec\.alpha\/def$/;
const MALLI = /^malli\./;
// The schema types of malli's default registry: composite, scalar, comparator and predicate schemas. A def holding a
// vector with one of these as its head is a schema.
const MALLI_TYPES = new Set([
    ':map', ':map-of', ':vector', ':sequential', ':set', ':tuple', ':enum', ':maybe', ':or', ':orn', ':and', ':not', ':multi', ':re', ':fn',
    ':cat', ':catn', ':alt', ':altn', ':=>', ':function', ':schema', ':ref', ':merge', ':union', ':select-keys', ':=', ':not=', ':>', ':>=', ':<', ':<=',
    ':any', ':some', ':nil', ':string', ':int', ':double', ':boolean', ':keyword', ':symbol', ':qualified-keyword', ':qualified-symbol', ':uuid',
]);
const schemaId = (name) => `schema:${name}`;
// Whether a place lies inside a call to one of the selected vars.
function inCallOf(ctx, select) {
    const byFile = groupBy(ctx.analysis.varUses.filter(select), (u) => u.file);
    return (file, row, col) => (byFile.get(file) ?? []).some((c) => contains(c, row, col));
}
function specDefs(ctx) {
    const calls = ctx.analysis.varUses.filter((u) => SPEC.test(u.to) && u.name === 'def');
    return ctx.analysis.keywords.flatMap((k) => {
        if (!SPEC_DEF.test(k.reg ?? ''))
            return [];
        const form = calls.find((c) => c.file === k.file && contains(c, k.row, k.col));
        return form ? [{ name: keywordName(k), form }] : [];
    });
}
// "ns/name" of every def whose value is a malli vector schema, in namespaces that use malli.
function malliDefs(ctx) {
    const users = new Set(ctx.analysis.nsUses.filter((u) => MALLI.test(u.to)).map((u) => u.file));
    const out = new Set();
    for (const d of ctx.defs.values()) {
        if (!users.has(d.file) || !/\/def$/.test(d.definedBy ?? ''))
            continue;
        const form = formAt(ctx.forms(d.file), d.row, d.col);
        const value = form && kids(form).length >= 3 ? unwrap(kids(form)[kids(form).length - 1]) : undefined;
        const head = value?.t === 'vector' ? value.children[0] : undefined;
        if (head?.t === 'keyword' && MALLI_TYPES.has(head.text))
            out.add(`${d.ns}/${d.name}`);
    }
    return out;
}
export const schemas = {
    name: 'schemas',
    edgeKinds: ['registers', 'uses_schema'],
    detect: (ctx) => {
        const libs = new Set(ctx.analysis.nsUses.flatMap((u) => (SPEC.test(u.to) ? ['spec'] : MALLI.test(u.to) ? ['malli'] : [])));
        return libs.size ? [...libs].sort().join(', ') : null;
    },
    containers: (ctx) => specDefs(ctx).map((s) => ({ id: schemaId(s.name), span: s.form })),
    run: (ctx, owner) => {
        const nodes = [];
        const edges = [];
        const node = (name, file, line, library) => {
            const component = ctx.componentOf(file);
            nodes.push({ id: schemaId(name), kind: 'schema', name, file, line, ...(component ? { component } : {}), attrs: { library } });
        };
        const specs = specDefs(ctx);
        const specNames = new Set(specs.map((s) => s.name));
        for (const s of specs)
            node(s.name, s.form.file, s.form.row, 'spec');
        const inSpecCall = inCallOf(ctx, (u) => SPEC.test(u.to));
        for (const k of ctx.analysis.keywords) {
            const name = keywordName(k);
            if (!specNames.has(name) || SPEC_DEF.test(k.reg ?? '') || !inSpecCall(k.file, k.row, k.col))
                continue;
            edges.push({ from: owner(k), to: schemaId(name), kind: 'uses_schema', band: 'static_proven', file: k.file, line: k.row });
        }
        const malli = malliDefs(ctx);
        for (const full of malli) {
            const d = ctx.defs.get(full);
            if (!d)
                continue;
            node(full, d.file, d.row, 'malli');
            edges.push({ from: schemaId(full), to: defId(full), kind: 'registers', band: 'static_proven', file: d.file, line: d.row });
        }
        const inMalliCall = inCallOf(ctx, (u) => MALLI.test(u.to));
        for (const u of ctx.analysis.varUses) {
            const full = `${u.to}/${u.name}`;
            if (!malli.has(full))
                continue;
            const inCall = inMalliCall(u.file, u.nameRow, u.nameCol);
            const inSchema = !!u.fromVar && malli.has(`${u.from}/${u.fromVar}`);
            if (!inCall && !inSchema)
                continue;
            const from = inSchema ? schemaId(`${u.from}/${u.fromVar}`) : owner({ ...u, row: u.nameRow, col: u.nameCol });
            if (from !== schemaId(full))
                edges.push({ from, to: schemaId(full), kind: 'uses_schema', band: 'static_proven', file: u.file, line: u.nameRow });
        }
        return { nodes, edges };
    },
};
