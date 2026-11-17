import { flatChildren, textOf, unwrap, walk } from "../reader.js";
import { entries, keywordOf } from "./route-data.js";
const selectorKey = (s) => (s.kind === 'class' ? s.value : `testid=${s.value}`);
const selectorId = (s) => `selector:${selectorKey(s)}`;
const memberId = (member) => `page_object_member:${member}`;
const testId = (file, line) => `test:${file}:${line}`;
// Classes and test ids a hiccup form names: :div.a.b#id, {:class "a b"}, {:class ["a" "b"]}, {:data-testid "x"}.
function rendered(f) {
    if (f.t === 'vector') {
        const tag = keywordOf(f.children[0] ?? f);
        return tag ? [...tag.matchAll(/\.([^.#]+)/g)].map((m) => ({ kind: 'class', value: m[1] })) : [];
    }
    if (f.t !== 'map')
        return [];
    return entries(f).flatMap(([k, v]) => {
        const key = keywordOf(k);
        const u = unwrap(v);
        const strings = u.t === 'string' ? [u.text] : u.t === 'vector' ? flatChildren(u).map(unwrap).filter((x) => x.t === 'string').map((x) => textOf(x) ?? '')
            : [];
        if (key === ':class' || key === ':className')
            return strings.flatMap((s) => s.split(/\s+/)).filter(Boolean).map((value) => ({ kind: 'class', value }));
        if (key === ':data-testid' && u.t === 'string')
            return [{ kind: 'testid', value: u.text }];
        return [];
    });
}
// In-house: classes with a test-hook prefix of the project (.clojure-atlas.edn :selector-prefixes) in a string literal, wherever
// it stands. A name match on the literal, so the edge is heuristic; what `rendered` reads from hiccup stays proven.
function hookClasses(f, prefixes) {
    if (f.t !== 'string' || prefixes.length === 0)
        return [];
    return f.text.split(/[\s."'=]+/).filter((t) => prefixes.some((p) => t.startsWith(p) && t.length > p.length)).map((value) => ({ kind: 'class', value }));
}
function pomSelectors(ctx) {
    return new Set(ctx.playwright.projects.flatMap((p) => p.pageObjects.flatMap((o) => o.members.flatMap((m) => m.selectors.map(selectorKey)))));
}
const detect = (ctx) => (ctx.playwright.projects.length ? `Playwright with TypeScript ${ctx.playwright.projects.map((p) => p.typescript).join(', ')}`
    : null);
const unavailable = (ctx) => (ctx.playwright.skipped.length ? ctx.playwright.skipped.join('; ') : null);
export const selectors = {
    name: 'selectors',
    edgeKinds: ['renders', 'uses_selector'],
    detect,
    unavailable,
    run: (ctx, owner) => {
        const nodes = [];
        const edges = [];
        const used = pomSelectors(ctx);
        for (const p of ctx.playwright.projects) {
            for (const o of p.pageObjects) {
                nodes.push({ id: `page_object:${o.name}`, kind: 'page_object', name: o.name, file: o.file, line: o.line,
                    attrs: { members: o.members.length, ...(o.base ? { base: o.base } : {}) } });
                for (const m of o.members) {
                    const id = memberId(`${o.name}.${m.name}`);
                    nodes.push({ id, kind: 'page_object_member', name: `${o.name}.${m.name}`, file: o.file, line: m.line, end_line: m.endLine,
                        attrs: { class: o.name, selectors: m.selectors.length } });
                    for (const s of m.selectors) {
                        nodes.push({ id: selectorId(s), kind: 'selector', name: selectorKey(s) });
                        edges.push({ from: id, to: selectorId(s), kind: 'uses_selector', band: 'static_proven', file: o.file, line: m.line });
                    }
                    for (const u of m.uses)
                        edges.push({ from: id, to: memberId(`${o.name}.${u}`), kind: 'calls', band: 'static_proven', file: o.file, line: m.line });
                }
            }
        }
        const prefixes = ctx.config.selectorPrefixes;
        for (const d of ctx.analysis.nsDefs) {
            const proven = new Set();
            const hooks = [];
            for (const f of walk(ctx.forms(d.file))) {
                for (const s of rendered(f)) {
                    if (!used.has(selectorKey(s)))
                        continue;
                    const from = owner({ file: d.file, row: f.row, col: f.col, from: d.name });
                    proven.add(`${from} ${selectorId(s)}`);
                    edges.push({ from, to: selectorId(s), kind: 'renders', band: 'static_proven', file: d.file, line: f.row });
                }
                for (const s of hookClasses(f, prefixes)) {
                    if (!used.has(selectorKey(s)))
                        continue;
                    hooks.push({ from: owner({ file: d.file, row: f.row, col: f.col, from: d.name }), to: selectorId(s), kind: 'renders', band: 'heuristic', file: d.file, line: f.row });
                }
            }
            // one edge per owner and selector: the proven hiccup reading wins over the literal match
            const seen = new Set();
            for (const e of hooks) {
                const key = `${e.from} ${e.to}`;
                if (proven.has(key) || seen.has(key))
                    continue;
                seen.add(key);
                edges.push(e);
            }
        }
        return { nodes, edges };
    },
};
export const browserTests = {
    name: 'browser_tests',
    edgeKinds: ['declares_test', 'asserts_on', 'calls'],
    detect,
    unavailable,
    run: (ctx) => {
        const nodes = [];
        const edges = [];
        for (const p of ctx.playwright.projects) {
            for (const t of p.tests) {
                const id = testId(t.file, t.line);
                nodes.push({ id: `test_file:${t.file}`, kind: 'test_file', name: t.file, file: t.file, line: 1 });
                nodes.push({
                    id, kind: 'test', name: [...t.describe, t.title].join(' > '), file: t.file, line: t.line, end_line: t.endLine,
                    attrs: { describe: t.describe, assertions: t.refs.filter((r) => r.matcher).length },
                });
                edges.push({ from: `test_file:${t.file}`, to: id, kind: 'declares_test', band: 'static_proven', file: t.file, line: t.line });
                for (const r of t.refs) {
                    edges.push({
                        from: id, to: memberId(r.member), kind: r.matcher ? 'asserts_on' : 'calls', band: 'static_proven', file: t.file, line: r.line,
                        ...(r.matcher ? { attrs: { matcher: r.matcher } } : {}),
                    });
                }
            }
        }
        return { nodes, edges };
    },
};
