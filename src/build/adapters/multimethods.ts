// Multimethods: one dispatch arm per defmethod (multimethod plus dispatch value), defined by its namespace and reached
// from the defmulti through a HEURISTIC may_dispatch_to edge (the dispatch value at runtime picks the method).
// A top-level defmethod owns the usages in its body.
import type { GraphEdge, GraphNode } from '../../mcp/graph.ts';
import { isTestFile } from '../../shared/testfile.ts';
import type { Span, VarUse } from '../analysis.ts';
import { contains, formAt, kids } from '../reader.ts';
import { CORE_NS, defId, groupBy, nsId, type Adapter, type Container, type Context } from '../model.ts';

export const methodId = (multi: string, dispatch: string) => `dispatch_arm:${multi}@${dispatch}`;

interface Method {
  id: string;
  use: VarUse;
  multi: string;
  dispatch: string;
  span: Span;
}

// Every defmethod. Two of the same multimethod and dispatch value (a clj and a cljs file, or an arm defined again) are
// two arms: the first in file order keeps the plain id and a later one adds its position.
export function methods(ctx: Context): Method[] {
  const forms = groupBy(ctx.analysis.varUses.filter((u) => u.name === 'defmethod' && CORE_NS.test(u.to)), (u) => u.file);
  const all = ctx.analysis.varUses
    .filter((u) => u.defmethod)
    .map((use) => {
      const form = (forms.get(use.file) ?? []).find((f) => contains(f, use.nameRow, use.nameCol));
      // kondo gives the dispatch value as written; a keyword is resolved so ::x in two namespaces stays apart
      const list = form && formAt(ctx.forms(use.file), form.row, form.col);
      const written = list ? kids(list)[2] : undefined;
      const resolved = written && written.t === 'keyword' ? ctx.keywordAt(use.file, written.row, written.col) : undefined;
      return { use, multi: `${use.to}/${use.name}`, dispatch: resolved ?? use.dispatch ?? '?', span: form ?? use };
    })
    .sort((a, b) => (a.span.file < b.span.file ? -1 : a.span.file > b.span.file ? 1 : a.span.row - b.span.row || a.span.col - b.span.col));
  const taken = new Set<string>();
  return all.map((m) => {
    const plain = methodId(m.multi, m.dispatch);
    const id = taken.has(plain) ? `${plain}#${m.span.file}:${m.span.row}` : plain;
    taken.add(id);
    return { ...m, id };
  });
}

export const multimethods: Adapter = {
  name: 'multimethods',
  edgeKinds: ['defines', 'may_dispatch_to'],
  detect: (ctx) => (ctx.analysis.varUses.some((u) => u.defmethod) ? 'defmethod' : null),
  containers: (ctx): Container[] => methods(ctx).map((m) => ({ id: m.id, span: m.span })),
  run: (ctx) => {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    for (const m of methods(ctx)) {
      const { id } = m;
      const component = ctx.componentOf(m.span.file);
      nodes.push({
        id, kind: 'dispatch_arm', name: `${m.multi.split('/').pop()} ${m.dispatch}`, file: m.span.file, line: m.span.row, end_line: m.span.endRow,
        ...(component ? { component } : {}),
        ...(isTestFile(m.span.file) ? { roles: ['test'] } : {}),
        attrs: { dispatch_value: m.dispatch, multimethod: m.multi },
      });
      edges.push({ from: nsId(m.use.from), to: id, kind: 'defines', band: 'static_proven', file: m.span.file, line: m.span.row });
      if (ctx.defs.has(m.multi)) {
        edges.push({ from: defId(m.multi), to: id, kind: 'may_dispatch_to', band: 'heuristic', file: m.span.file, line: m.span.row, attrs: { dispatch: m.dispatch } });
      }
    }
    return { nodes, edges };
  },
};
