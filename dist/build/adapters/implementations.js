import { defId, nsId } from "../model.js";
const implementationId = (p) => `implementation:${p.file}:${p.row}:${p.col}`;
export const implementations = {
    name: 'implementations',
    edgeKinds: ['implements', 'may_dispatch_to', 'defines'],
    detect: (ctx) => (ctx.analysis.protocolImpls.length ? 'protocol implementations' : null),
    containers: (ctx) => ctx.analysis.protocolImpls.map((p) => ({ id: implementationId(p), span: p })),
    run: (ctx) => {
        const nodes = [];
        const edges = [];
        for (const p of ctx.analysis.protocolImpls) {
            const id = implementationId(p);
            const method = `${p.protocolNs}/${p.method}`;
            const component = ctx.componentOf(p.file);
            nodes.push({
                id, kind: 'implementation', name: `${p.protocolName}/${p.method} impl`, file: p.file, line: p.row, end_line: p.endRow,
                ...(component ? { component } : {}),
                attrs: { defined_by: p.definedBy, protocol: `${p.protocolNs}/${p.protocolName}`, method, impl_ns: p.implNs },
            });
            edges.push({ from: nsId(p.implNs), to: id, kind: 'defines', band: 'static_proven', file: p.file, line: p.row });
            if (!ctx.defs.has(method))
                continue;
            edges.push({ from: id, to: defId(method), kind: 'implements', band: 'static_proven', file: p.file, line: p.row });
            edges.push({ from: defId(method), to: id, kind: 'may_dispatch_to', band: 'heuristic', file: p.file, line: p.row });
        }
        return { nodes, edges };
    },
};
