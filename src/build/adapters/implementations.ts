// Protocol implementations: each method a defrecord, deftype, extend-type, extend-protocol or reify implements is an
// implementation node that implements the protocol method (when the protocol is in the project, which also reaches it
// through a HEURISTIC call: the implementation that runs depends on the value). A top-level one owns its body.
import type { GraphEdge, GraphNode } from '../../mcp/graph.ts';
import type { ProtocolImpl } from '../analysis.ts';
import { defId, nsId, type Adapter, type Container } from '../model.ts';

const implementationId = (p: ProtocolImpl) => `implementation:${p.file}:${p.row}:${p.col}`;

export const implementations: Adapter = {
  name: 'implementations',
  edgeKinds: ['implements', 'calls', 'defines'],
  detect: (ctx) => (ctx.analysis.protocolImpls.length ? 'protocol implementations' : null),
  containers: (ctx): Container[] => ctx.analysis.protocolImpls.map((p) => ({ id: implementationId(p), span: p })),
  run: (ctx) => {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
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
      if (!ctx.defs.has(method)) continue;
      edges.push({ from: id, to: defId(method), kind: 'implements', band: 'static_proven', file: p.file, line: p.row });
      edges.push({ from: defId(method), to: id, kind: 'calls', band: 'heuristic', file: p.file, line: p.row, attrs: { via: 'protocol dispatch' } });
    }
    return { nodes, edges };
  },
};
