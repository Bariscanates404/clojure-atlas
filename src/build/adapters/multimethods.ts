// Multimethods: one node per defmethod (multimethod plus dispatch value), defined by its namespace and reached
// from the defmulti through a HEURISTIC call edge (which method runs is decided by the dispatch value at runtime).
// A top-level defmethod owns the usages in its body.
import type { GraphEdge, GraphNode } from '../../mcp/graph.ts';
import { isTestFile } from '../../mcp/keyflow.ts';
import type { Span, VarUse } from '../analysis.ts';
import { contains, formAt, kids } from '../reader.ts';
import { CORE_NS, defId, groupBy, nsId, type Adapter, type Container, type Context } from '../model.ts';

export const methodId = (multi: string, dispatch: string) => defId(`${multi} ${dispatch}`);

interface Method {
  use: VarUse;
  multi: string;
  dispatch: string;
  span: Span;
}

export function methods(ctx: Context): Method[] {
  const forms = groupBy(ctx.analysis.varUses.filter((u) => u.name === 'defmethod' && CORE_NS.test(u.to)), (u) => u.file);
  return ctx.analysis.varUses
    .filter((u) => u.defmethod)
    .map((use) => {
      const form = (forms.get(use.file) ?? []).find((f) => contains(f, use.nameRow, use.nameCol));
      // kondo gives the dispatch value as written; a keyword is resolved so ::x in two namespaces stays apart
      const list = form && formAt(ctx.forms(use.file), form.row, form.col);
      const written = list ? kids(list)[2] : undefined;
      const resolved = written && written.t === 'keyword' ? ctx.keywordAt(use.file, written.row, written.col) : undefined;
      return { use, multi: `${use.to}/${use.name}`, dispatch: resolved ?? use.dispatch ?? '?', span: form ?? use };
    });
}

export const multimethods: Adapter = {
  name: 'multimethods',
  edgeKinds: ['defines', 'calls'],
  detect: (ctx) => (ctx.analysis.varUses.some((u) => u.defmethod) ? 'defmethod' : null),
  containers: (ctx): Container[] => methods(ctx).map((m) => ({ id: methodId(m.multi, m.dispatch), span: m.span })),
  run: (ctx) => {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    for (const m of methods(ctx)) {
      const id = methodId(m.multi, m.dispatch);
      const component = ctx.componentOf(m.span.file);
      nodes.push({
        id, kind: 'definition', name: `${m.multi} ${m.dispatch}`, file: m.span.file, line: m.span.row, end_line: m.span.endRow,
        ...(component ? { component } : {}),
        ...(isTestFile(m.span.file) ? { roles: ['test'] } : {}),
        attrs: { defined_by: 'clojure.core/defmethod', multi: m.multi, dispatch: m.dispatch },
      });
      edges.push({ from: nsId(m.use.from), to: id, kind: 'defines', band: 'static_proven', file: m.span.file, line: m.span.row });
      if (ctx.defs.has(m.multi)) {
        edges.push({ from: defId(m.multi), to: id, kind: 'calls', band: 'heuristic', file: m.span.file, line: m.span.row, attrs: { via: 'multimethod dispatch', dispatch: m.dispatch } });
      }
    }
    return { nodes, edges };
  },
};
