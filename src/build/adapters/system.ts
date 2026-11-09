// System keys of integrant (init-key and friends, #ig/ref and ig/ref in configs), mount (defstate) and component
// (system-map entries, component/using). registers links a key to the code that starts it, depends_on to the
// keys it needs.
import type { GraphEdge, GraphNode } from '../../mcp/graph.ts';
import { contains, flatChildren, formAt, kids, unwrap, walk, type Form } from '../reader.ts';
import { defId, type Adapter, type Context } from '../model.ts';
import { methodId, methods } from './multimethods.ts';

const IG = 'integrant.core';
const IG_METHODS = /^integrant\.core\/(init-key|halt-key!|suspend-key!|resume-key|resolve-key|prep-key|expand-key|assert-key)$/;
const MOUNT = /^mount\.(core|lite)\/defstate$/;
const COMPONENT = 'com.stuartsierra.component';

const systemKeyId = (name: string) => `system_key:${name}`;

interface Key {
  name: string;
  file: string;
  line: number;
  library: string;
}

interface Dep {
  from: string;
  to: string;
  file: string;
  line: number;
}

function igRefTarget(ctx: Context, file: string, f: Form): Form | undefined {
  if (f.t === 'tagged' && /^ig\/ref(set)?$/.test(f.tag ?? '')) return unwrap(f.children[0]);
  if (f.t === 'list') {
    const head = f.children[0];
    const use = head && head.t === 'symbol' ? ctx.useAt(file, head.row, head.col) : undefined;
    if (use?.to === IG && (use.name === 'ref' || use.name === 'refset')) return f.children[1] && unwrap(f.children[1]);
  }
  return undefined;
}

// Maps whose keys are keywords (or composite key vectors) and whose values hold integrant refs.
function integrantConfig(ctx: Context, file: string, name: (k: Form) => string): { keys: Key[]; deps: Dep[] } {
  const keys: Key[] = [];
  const deps: Dep[] = [];
  const keyName = (k: Form) => {
    const u = unwrap(k);
    if (u.t === 'keyword') return name(u);
    if (u.t === 'vector' && u.children.every((c) => c.t === 'keyword')) return `[${u.children.map(name).join(' ')}]`;
    return undefined;
  };
  // the outermost map holding refs is the config; maps inside its values are options of one key
  const visit = (forms: readonly Form[]): void => {
    for (const m of forms) {
      if (m.t !== 'map') {
        visit(kids(m));
        continue;
      }
      const xs = flatChildren(m);
      const entries: { key: string; at: Form; refs: Form[] }[] = [];
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const key = keyName(xs[k]);
        if (!key) continue;
        const refs = [...walk([xs[k + 1]])].map((f) => igRefTarget(ctx, file, f)).filter((f): f is Form => !!f && f.t === 'keyword');
        entries.push({ key, at: xs[k], refs });
      }
      if (!entries.some((e) => e.refs.length)) {
        visit(kids(m));
        continue;
      }
      for (const e of entries) {
        keys.push({ name: e.key, file, line: e.at.row, library: 'integrant' });
        for (const r of e.refs) deps.push({ from: e.key, to: name(r), file, line: r.row });
      }
    }
  };
  visit(ctx.forms(file));
  return { keys, deps };
}

function componentSystems(ctx: Context): { keys: Key[]; deps: Dep[]; starts: Dep[] } {
  const keys: Key[] = [];
  const deps: Dep[] = [];
  const starts: Dep[] = [];
  for (const call of ctx.analysis.varUses.filter((u) => u.to === COMPONENT && (u.name === 'system-map' || u.name === 'system-using'))) {
    const form = formAt(ctx.forms(call.file), call.row, call.col);
    if (!form) continue;
    const name = (k: Form) => ctx.nameOf(call.file, k);
    const depMap = kids(form)[2];
    const pairs = call.name === 'system-map' ? kids(form).slice(1) : depMap ? flatChildren(unwrap(depMap)) : [];
    for (let k = 0; k + 1 < pairs.length; k += 2) {
      const key = unwrap(pairs[k]);
      if (key.t !== 'keyword') continue;
      const keyName = name(key);
      keys.push({ name: keyName, file: call.file, line: key.row, library: 'component' });
      const value = pairs[k + 1];
      const using = [...walk([value])].find((f) => {
        const head = f.t === 'list' ? f.children[0] : undefined;
        const use = head && ctx.useAt(call.file, head.row, head.col);
        return use?.to === COMPONENT && use.name === 'using';
      });
      const depForm = call.name === 'system-using' ? value : using && kids(using)[2];
      const targets = depForm ? flatChildren(unwrap(depForm)).filter((_, i) => unwrap(depForm).t !== 'map' || i % 2 === 1) : [];
      for (const t of targets.map(unwrap)) if (t.t === 'keyword') deps.push({ from: keyName, to: name(t), file: call.file, line: t.row });
      if (call.name !== 'system-map') continue;
      for (const f of walk([value])) {
        if (f.t !== 'symbol') continue;
        const def = ctx.defAt(call.file, f.row, f.col);
        if (def) starts.push({ from: keyName, to: def, file: call.file, line: f.row });
      }
    }
  }
  return { keys, deps, starts };
}

export const systemKeys: Adapter = {
  name: 'system',
  edgeKinds: ['registers', 'depends_on'],
  detect: (ctx) => {
    const libs = new Set(ctx.analysis.nsUses.flatMap((u) => (u.to === IG ? ['integrant'] : /^mount\./.test(u.to) ? ['mount'] : u.to === COMPONENT ? ['component'] : [])));
    return libs.size ? [...libs].sort().join(', ') : null;
  },
  run: (ctx) => {
    const keys: Key[] = [];
    const edges: GraphEdge[] = [];
    for (const m of methods(ctx).filter((x) => IG_METHODS.test(x.multi) && x.dispatch.startsWith(':'))) {
      keys.push({ name: m.dispatch, file: m.span.file, line: m.span.row, library: 'integrant' });
      edges.push({ from: systemKeyId(m.dispatch), to: methodId(m.multi, m.dispatch), kind: 'registers', band: 'static_proven', file: m.span.file, line: m.span.row, attrs: { via: m.multi.split('/')[1] } });
    }
    const igFiles = new Set(ctx.analysis.nsUses.filter((u) => u.to === IG).map((u) => u.file));
    const deps: Dep[] = [];
    for (const file of [...igFiles, ...(igFiles.size ? ctx.edn : [])]) {
      const name = (k: Form) => ctx.nameOf(file, k);
      const cfg = integrantConfig(ctx, file, name);
      keys.push(...cfg.keys);
      deps.push(...cfg.deps);
    }
    // a var defined inside a defstate form, whether kondo saw it through lint-as or through the library's hook
    const defstates = ctx.analysis.varUses.filter((u) => MOUNT.test(`${u.to}/${u.name}`));
    const states = ctx.analysis.varDefs.filter((d) => defstates.some((u) => u.file === d.file && contains(u, d.row, d.col)));
    const stateNames = new Set(states.map((d) => `${d.ns}/${d.name}`));
    for (const d of states) {
      const full = `${d.ns}/${d.name}`;
      keys.push({ name: full, file: d.file, line: d.row, library: 'mount' });
      edges.push({ from: systemKeyId(full), to: defId(full), kind: 'registers', band: 'static_proven', file: d.file, line: d.row, attrs: { via: 'defstate' } });
    }
    for (const u of ctx.analysis.varUses) {
      const target = `${u.to}/${u.name}`;
      const from = u.fromVar && `${u.from}/${u.fromVar}`;
      if (from && from !== target && stateNames.has(from) && stateNames.has(target)) deps.push({ from, to: target, file: u.file, line: u.nameRow });
    }
    const comp = componentSystems(ctx);
    keys.push(...comp.keys);
    deps.push(...comp.deps);
    for (const s of comp.starts) edges.push({ from: systemKeyId(s.from), to: defId(s.to), kind: 'registers', band: 'static_proven', file: s.file, line: s.line, attrs: { via: 'system-map' } });
    for (const d of deps) edges.push({ from: systemKeyId(d.from), to: systemKeyId(d.to), kind: 'depends_on', band: 'static_proven', file: d.file, line: d.line });
    const nodes: GraphNode[] = keys.map((k) => {
      const component = ctx.componentOf(k.file);
      return { id: systemKeyId(k.name), kind: 'system_key', name: k.name, file: k.file, line: k.line, ...(component ? { component } : {}), attrs: { library: k.library } };
    });
    return { nodes, edges };
  },
};
