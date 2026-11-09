// re-frame, from kondo's own re-frame analysis: reg-event-db/fx/ctx register events, reg-sub and reg-sub-raw
// register subscriptions, dispatch and subscribe (and a subscription's :<- inputs) reference them. A handler
// passed as a var is linked to that definition; an inline handler becomes a handler node owning its body.
import type { GraphEdge, GraphNode } from '../../mcp/graph.ts';
import { keywordName, type Keyword, type VarUse } from '../analysis.ts';
import { contains, formAt, kids } from '../reader.ts';
import { defId, type Adapter, type Container, type Context, type Owner } from '../model.ts';

const RF = 're-frame.core';
const EVENT_REG = /^re-frame\.core\/reg-event-(db|fx|ctx)$/;
const SUB_REG = /^re-frame\.core\/reg-sub(-raw)?$/;

interface Registration {
  kw: Keyword;
  kind: 'event' | 'subscription';
  name: string;
  form: VarUse;
  // the definition passed as the handler, when it is a var
  handlerDef?: string;
}

const nodeId = (kind: string, name: string) => `${kind}:${name}`;
export const handlerId = (name: string) => `handler:${name}`;

export function registrations(ctx: Context): Registration[] {
  const regCalls = new Map<string, VarUse[]>();
  for (const u of ctx.analysis.varUses) {
    if (u.to === RF && u.name.startsWith('reg-')) regCalls.set(u.file, [...(regCalls.get(u.file) ?? []), u]);
  }
  const out: Registration[] = [];
  for (const kw of ctx.analysis.keywords) {
    const kind = EVENT_REG.test(kw.reg ?? '') ? 'event' : SUB_REG.test(kw.reg ?? '') ? 'subscription' : null;
    if (!kind) continue;
    const form = (regCalls.get(kw.file) ?? []).find((u) => `${RF}/${u.name}` === kw.reg && contains(u, kw.row, kw.col));
    if (!form) continue;
    const list = formAt(ctx.forms(kw.file), form.row, form.col);
    const handlerDef = (list ? kids(list).slice(2) : [])
      .filter((f) => f.t === 'symbol')
      .map((f) => ctx.defAt(kw.file, f.row, f.col))
      .find((full): full is string => !!full);
    out.push({ kw, kind, name: keywordName(kw), form, ...(handlerDef ? { handlerDef } : {}) });
  }
  return out;
}

export const reFrame: Adapter = {
  name: 'events',
  edgeKinds: ['registers', 'dispatches', 'subscribes'],
  detect: (ctx) => (ctx.analysis.nsUses.some((u) => u.to === RF) ? RF : null),
  containers: (ctx): Container[] => registrations(ctx).filter((r) => !r.handlerDef).map((r) => ({ id: handlerId(r.name), span: r.form })),
  run: (ctx: Context, owner: Owner) => {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const node = (kind: string, kw: Keyword, extra: Partial<GraphNode> = {}) => {
      const component = ctx.componentOf(kw.file);
      nodes.push({ id: nodeId(kind, keywordName(kw)), kind, name: keywordName(kw), file: kw.file, line: kw.row, ...(component ? { component } : {}), ...extra });
    };
    for (const r of registrations(ctx)) {
      node(r.kind, r.kw, { attrs: { registered_by: r.kw.reg } });
      const handler = r.handlerDef ? defId(r.handlerDef) : handlerId(r.name);
      if (!r.handlerDef) {
        const component = ctx.componentOf(r.form.file);
        nodes.push({ id: handler, kind: 'handler', name: `${r.name} handler`, file: r.form.file, line: r.form.row, end_line: r.form.endRow, ...(component ? { component } : {}) });
      }
      edges.push({ from: nodeId(r.kind, r.name), to: handler, kind: 'registers', band: 'static_proven', file: r.kw.file, line: r.kw.row });
    }
    for (const kw of ctx.analysis.keywords) {
      const kind = kw.reFrame?.eventRef ? 'event' : kw.reFrame?.subscriptionRef ? 'subscription' : null;
      if (!kind) continue;
      // a referenced id nobody registers still gets a node, so "no handler" is an answer
      node(kind, kw, { attrs: { registered_by: null } });
      edges.push({
        from: owner(kw), to: nodeId(kind, keywordName(kw)), kind: kind === 'event' ? 'dispatches' : 'subscribes', band: 'static_proven', file: kw.file, line: kw.row,
      });
    }
    return { nodes, edges };
  },
};
