import { keywordName } from "../analysis.js";
import { contains, flatChildren, formAt, kids, textOf, unwrap, walk } from "../reader.js";
import { defId, groupBy } from "../model.js";
import { entries } from "./route-data.js";
// re-frame.alpha re-exports re-frame.core's registration and dispatch fns
const RF = new Set(['re-frame.core', 're-frame.alpha']);
const EVENT_REG = /^re-frame\.(core|alpha)\/reg-event-(db|fx|ctx)$/;
const SUB_REG = /^re-frame\.(core|alpha)\/reg-sub(-raw)?$/;
const nodeId = (kind, name) => `${kind}:${name}`;
// an inline handler, keyed by what it registers and where: an event and a subscription may share a keyword
const handlerId = (r) => `handler:${r.kind} ${r.name} ${r.form.file}:${r.form.row}`;
function registrations(ctx) {
    const regCalls = groupBy(ctx.analysis.varUses.filter((u) => RF.has(u.to) && u.name.startsWith('reg-')), (u) => u.file);
    const out = [];
    for (const kw of ctx.analysis.keywords) {
        const kind = EVENT_REG.test(kw.reg ?? '') ? 'event' : SUB_REG.test(kw.reg ?? '') ? 'subscription' : null;
        if (!kind)
            continue;
        const form = (regCalls.get(kw.file) ?? []).find((u) => `${u.to}/${u.name}` === kw.reg && contains(u, kw.row, kw.col));
        if (!form)
            continue;
        const list = formAt(ctx.forms(kw.file), form.row, form.col);
        // the handler is the last argument; interceptors and signal inputs come before it
        const last = list ? unwrap(kids(list)[kids(list).length - 1] ?? list) : undefined;
        const handlerDef = last && last.t === 'symbol' ? ctx.defAt(kw.file, last.row, last.col) : undefined;
        out.push({ kw, kind, name: keywordName(kw), form, ...(handlerDef ? { handlerDef } : {}) });
    }
    return out;
}
const at = (k) => `${k.file}:${k.row}:${k.col}`;
// The event id of an event vector written as a literal.
const eventId = (f) => {
    const v = f && unwrap(f);
    const id = v?.t === 'vector' ? flatChildren(v)[0] : undefined;
    return id && unwrap(id).t === 'keyword' ? unwrap(id) : undefined;
};
const textEntries = (m) => entries(m).map(([k, v]) => [textOf(unwrap(k)), unwrap(v)]);
// Events dispatched by the :dispatch-n and :dispatch-later effects, which kondo's re-frame analysis does not follow.
// The map is only known to be an effect map by its keys, so these are not proven.
function effectDispatches(ctx) {
    const keywords = new Map(ctx.analysis.keywords.map((k) => [at(k), k]));
    const files = new Set(ctx.analysis.nsUses.filter((u) => RF.has(u.to)).map((u) => u.file));
    const out = [];
    for (const file of files) {
        for (const f of walk(ctx.forms(file))) {
            if (f.t !== 'map')
                continue;
            for (const [key, value] of textEntries(f)) {
                if (value.t !== 'vector')
                    continue;
                const events = key === ':dispatch-n'
                    ? flatChildren(value)
                    : key === ':dispatch-later'
                        ? flatChildren(value).flatMap((m) => (unwrap(m).t === 'map' ? textEntries(unwrap(m)).filter(([k]) => k === ':dispatch').map(([, v]) => v) : []))
                        : [];
                for (const e of events) {
                    const id = eventId(e);
                    const kw = id && keywords.get(at({ file, row: id.row, col: id.col }));
                    if (kw && !kw.reFrame?.eventRef)
                        out.push(kw);
                }
            }
        }
    }
    return out;
}
const DISPATCH = /^dispatch(-sync)?$/;
const DYNAMIC_EVENT = 'dynamic_event:(non-literal event id)';
// Calls of dispatch and dispatch-sync whose event id is not a keyword written at the call: a parameter, a call, a
// whole event vector held in a variable. Any event may be dispatched there; the sites are the boundary.
function dynamicDispatches(ctx) {
    return ctx.analysis.varUses.filter((u) => {
        if (!RF.has(u.to) || !DISPATCH.test(u.name))
            return false;
        const call = formAt(ctx.forms(u.file), u.row, u.col);
        return !!call && !eventId(kids(call)[1]);
    });
}
export const reFrame = {
    name: 'events',
    edgeKinds: ['registers', 'dispatches', 'subscribes'],
    detect: (ctx) => ctx.analysis.nsUses.find((u) => RF.has(u.to))?.to ?? null,
    containers: (ctx) => registrations(ctx).filter((r) => !r.handlerDef).map((r) => ({ id: handlerId(r), span: r.form })),
    run: (ctx, owner) => {
        const nodes = [];
        const edges = [];
        const node = (kind, kw, extra = {}) => {
            const component = ctx.componentOf(kw.file);
            nodes.push({ id: nodeId(kind, keywordName(kw)), kind, name: keywordName(kw), file: kw.file, line: kw.row, ...(component ? { component } : {}),
                ...extra });
        };
        for (const r of registrations(ctx)) {
            node(r.kind, r.kw, { attrs: { registered_by: r.kw.reg } });
            const handler = r.handlerDef ? defId(r.handlerDef) : handlerId(r);
            if (!r.handlerDef) {
                const component = ctx.componentOf(r.form.file);
                nodes.push({ id: handler, kind: 'handler', name: `${r.name} ${r.kind} handler`, file: r.form.file, line: r.form.row, end_line: r.form.endRow,
                    ...(component ? { component } : {}) });
            }
            edges.push({ from: nodeId(r.kind, r.name), to: handler, kind: 'registers', band: 'static_proven', file: r.kw.file, line: r.kw.row });
        }
        for (const kw of ctx.analysis.keywords) {
            const kind = kw.reFrame?.eventRef ? 'event' : kw.reFrame?.subscriptionRef ? 'subscription' : null;
            if (!kind)
                continue;
            // a referenced id nobody registers still gets a node, so "no handler" is an answer
            node(kind, kw, { attrs: { registered_by: null } });
            edges.push({
                from: owner(kw), to: nodeId(kind, keywordName(kw)), kind: kind === 'event' ? 'dispatches' : 'subscribes', band: 'static_proven', file: kw.file,
                line: kw.row,
            });
        }
        for (const kw of effectDispatches(ctx)) {
            node('event', kw, { attrs: { registered_by: null } });
            edges.push({ from: owner(kw), to: nodeId('event', keywordName(kw)), kind: 'dispatches', band: 'heuristic', file: kw.file, line: kw.row });
        }
        const dynamic = dynamicDispatches(ctx);
        if (dynamic.length)
            nodes.push({ id: DYNAMIC_EVENT, kind: 'dynamic_event', name: '(non-literal event id)', file: dynamic[0].file, line: dynamic[0].row });
        for (const u of dynamic)
            edges.push({ from: owner(u), to: DYNAMIC_EVENT, kind: 'dispatches', band: 'unknown', file: u.file, line: u.row });
        return { nodes, edges };
    },
};
