// The core graph every codebase gets: namespaces and definitions, and the edges kondo resolves statically:
// defines (namespace -> definition), requires (namespace -> namespace), each var usage as the relation relations.ts
// names (calls, references, passes_callback, registers_handler, expands_via, rebinds) and tests (a deftest -> what it uses).
import { compareText } from "../mcp/graph.js";
import { isTestFile } from "../shared/testfile.js";
import { defId, groupBy, nsId, isSpecialForm, UNKNOWN_NS } from "./model.js";
import { formAt, kids, textOf } from "./reader.js";
import { assertionHeads, classify } from "./relations.js";
import { dynamicResolutions } from "./dynamic.js";
import { agreesWithKondo, callArgs, signatureOf } from "./signatures.js";
const SITES_PER_NAME = 5;
const MAX_SITE_NAMES = 3000;
// `[lib :as-alias x]` only names a namespace for ::x/kw keywords; nothing is loaded, unless the same vector also
// says :as or :refer.
function loadsNamespace(ctx, u) {
    const spec = ctx.parentOf(u.file, u.row, u.col)?.parent;
    const words = spec?.t === 'vector' ? kids(spec).map(textOf) : [];
    return !words.includes(':as-alias') || words.includes(':as') || words.includes(':refer');
}
const isTestDef = (d) => d.test || /(^|\/)(deftest|defspec)$/.test(d.definedBy ?? '');
function definitionNode(ctx, d, signature, files) {
    const component = ctx.componentOf(d.file);
    const test = isTestDef(d) || isTestFile(d.file);
    return {
        id: defId(`${d.ns}/${d.name}`),
        kind: 'definition',
        name: `${d.ns}/${d.name}`,
        file: d.file,
        line: d.row,
        end_line: d.endRow,
        ...(component ? { component } : {}),
        ...(test ? { roles: ['test'] } : {}),
        attrs: {
            ...(d.definedBy ? { defined_by: d.definedBy } : {}),
            ...(d.macro ? { macro: true } : {}),
            ...(d.private ? { private: true } : {}),
            ...(d.langs.length > 1 ? { platforms: d.langs } : {}),
            ...(files.length > 1 ? { defined_in: files } : {}),
            ...(signature ? { signature: { arities: signature } } : {}),
        },
    };
}
// The arities of a name's definitions: one per defn, the distinct ones when several files define it. A form the
// project's clj-kondo config lints as defn (or clj-kondo knows as one, like schema.core/defn) is read the same way,
// and any of them only when clj-kondo counted the same parameters.
function signatureOfAll(ctx, defs) {
    const seen = new Map();
    for (const d of defs) {
        const form = /\/defn-?$/.test(d.lintAs ?? d.definedBy ?? '') ? formAt(ctx.forms(d.file), d.row, d.col) : undefined;
        const arities = form && signatureOf(form, (f) => ctx.nameOf(d.file, f));
        if (!arities || !agreesWithKondo(arities, d.fixedArities, d.varargsMin))
            continue;
        for (const a of arities)
            seen.set(JSON.stringify(a), a);
    }
    return seen.size ? [...seen.values()] : null;
}
// A file without an ns form (dev/user.clj, a data-only file) or one that switches with (in-ns 'x) still lives in a
// namespace clj-kondo names on its definitions and usages: user by default.
function namespaceNodes(ctx) {
    const seen = new Set();
    const out = [];
    const add = (name, file, row, endRow) => {
        if (!name || seen.has(name))
            return;
        seen.add(name);
        const component = ctx.componentOf(file);
        const files = ctx.duplicateNs.get(name);
        out.push({
            id: nsId(name), kind: 'namespace', name, file, line: row, ...(endRow ? { end_line: endRow } : {}), ...(component ? { component } : {}),
            ...(files ? { attrs: { defined_in: files } } : {}),
        });
    };
    for (const d of ctx.analysis.nsDefs)
        add(d.name, d.file, d.row, d.endRow);
    const sites = [
        ...ctx.analysis.varDefs.map((d) => ({ ns: d.ns, file: d.file, row: d.row })),
        ...ctx.analysis.varUses.map((u) => ({ ns: u.from, file: u.file, row: u.row })),
        ...ctx.analysis.keywords.map((k) => ({ ns: k.from, file: k.file, row: k.row })),
    ].sort((a, b) => compareText(a.file, b.file) || a.row - b.row);
    for (const x of sites)
        add(x.ns, x.file, x.row);
    return out;
}
function top(counts, n = 15) {
    return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n);
}
export function core(ctx, owner) {
    const nodes = [...namespaceNodes(ctx)];
    const edges = [];
    const testIds = new Set();
    const signatures = new Map();
    const twins = groupBy(ctx.analysis.varDefs.filter((d) => ctx.duplicateNs.has(d.ns)), (d) => `${d.ns}/${d.name}`);
    for (const d of ctx.defs.values()) {
        const full = `${d.ns}/${d.name}`;
        // a name defined in two files has the arities of both
        const sig = signatureOfAll(ctx, twins.get(full) ?? [d]);
        if (sig)
            signatures.set(full, sig);
        const node = definitionNode(ctx, d, sig, [...new Set((twins.get(full) ?? []).map((t) => t.file))].sort());
        nodes.push(node);
        if (isTestDef(d))
            testIds.add(node.id);
        edges.push({ from: nsId(d.ns), to: node.id, kind: 'defines', band: 'static_proven', file: d.file, line: d.row });
    }
    for (const u of ctx.analysis.nsUses) {
        if (ctx.projectNs.has(u.to) && u.to !== u.from && loadsNamespace(ctx, u)) {
            const twin = ctx.duplicateNs.has(u.to);
            edges.push({
                from: nsId(u.from), to: nsId(u.to), kind: 'requires', band: twin ? 'heuristic' : 'static_proven', file: u.file, line: u.row,
                ...(twin ? { attrs: { via: 'duplicate-namespace' } } : {}),
            });
        }
    }
    const stats = { notVars: 0, resolved: 0, unresolved: 0, unknown: 0, external: 0, topUnresolved: [], topUnknown: [], unresolvedSites: {},
        dynamicResolve: { sites: 0, literal: 0 } };
    const unresolved = new Map();
    const unknown = new Map();
    const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
    // names project code uses but no definition matches; the ones naming a project namespace come first when the list is cut
    const sites = { named: new Map(), bare: new Map() };
    const noteSite = (m, full, u) => m.set(full, [...(m.get(full) ?? []), `${u.file}:${u.row}`]);
    const link = (from, to, kind, band, u, attrs) => {
        edges.push({ from, to, kind, band, file: u.file, line: u.nameRow, ...(attrs ? { attrs } : {}) });
        if (testIds.has(from))
            edges.push({ from, to, kind: 'tests', band, file: u.file, line: u.nameRow });
    };
    const isAssertion = assertionHeads(ctx);
    const usage = (u) => {
        if (u.defmethod)
            return;
        if (u.to === UNKNOWN_NS && (isSpecialForm(u) || u.name.endsWith('#') || isAssertion(u))) {
            stats.notVars++;
            return;
        }
        if (u.to === UNKNOWN_NS) {
            stats.unknown++;
            bump(unknown, u.name);
            noteSite(sites.bare, `${u.from}/${u.name}`, u);
            return;
        }
        if (!ctx.projectNs.has(u.to)) {
            stats.external++;
            return;
        }
        const full = `${u.to}/${u.name}`;
        if (!ctx.defs.has(full)) {
            stats.unresolved++;
            bump(unresolved, full);
            noteSite(sites.named, full, u);
            return;
        }
        stats.resolved++;
        const rel = classify(ctx, u);
        const call = rel.kind === 'calls' && u.arity !== undefined ? formAt(ctx.forms(u.file), u.row, u.col) : undefined;
        const attrs = {
            ...(rel.via ? { via: rel.via } : {}),
            ...(rel.inMacro ? { in_macro: rel.inMacro } : {}),
            ...(rel.kind === 'calls' && u.arity !== undefined
                ? {
                    arity: u.arity,
                    arity_band: rel.weak ? 'heuristic' : 'static_proven',
                    ...(call ? callArgs(call, u.arity, signatures.get(full) ?? null, (f) => ctx.nameOf(u.file, f)) : {}),
                }
                : {}),
        };
        link(owner({ ...u, row: u.nameRow, col: u.nameCol }), defId(full), rel.kind, rel.band, u, Object.keys(attrs).length ? attrs : undefined);
    };
    for (const u of ctx.analysis.varUses)
        usage(u);
    for (const { use, full } of dynamicResolutions(ctx)) {
        stats.dynamicResolve.sites++;
        if (!full)
            continue;
        stats.dynamicResolve.literal++;
        link(owner({ ...use, row: use.nameRow, col: use.nameCol }), defId(full), 'references', 'heuristic', use, { via: use.name });
    }
    stats.topUnresolved = top(unresolved);
    stats.topUnknown = top(unknown);
    const ranked = (m) => [...m].sort((a, b) => b[1].length - a[1].length || compareText(a[0], b[0]));
    stats.unresolvedSites = Object.fromEntries([...ranked(sites.named), ...ranked(sites.bare).filter(([full]) => !sites.named.has(full))]
        .slice(0, MAX_SITE_NAMES).map(([full, at]) => [full, [...new Set(at)].sort(compareText).slice(0, SITES_PER_NAME)]));
    return { nodes, edges, stats };
}
