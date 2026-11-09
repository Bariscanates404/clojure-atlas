// Map keys: every keyword in code, classified by where it stands. A map-literal key, hash-map, assoc, assoc-in,
// update and update-in produce it (the updates consume it too); a keyword in call position or as a threading step,
// get, get-in, select-keys, contains?, find and destructuring consume it; dissoc removes it. Threaded slots are HEURISTIC.
import type { GraphEdge, GraphNode } from '../../mcp/graph.ts';
import { keywordName, type Keyword } from '../analysis.ts';
import { flatChildren, textOf, unwrap, walk, type Form } from '../reader.ts';
import { CORE_NS, type Adapter, type Context, type Owner } from '../model.ts';

type Role = 'produces_key' | 'consumes_key' | 'removes_key';

interface Site {
  role: Role;
  via: string;
  threaded: boolean;
}

const THREADING = new Set(['->', '->>', 'cond->', 'cond->>', 'some->', 'some->>', 'doto']);
const COND_THREADING = new Set(['cond->', 'cond->>']);
const BINDING_FORMS = new Set(['let', 'loop', 'binding', 'when-let', 'if-let', 'when-some', 'if-some', 'doseq', 'for', 'with-open', 'with-redefs', 'letfn']);
const FN_FORMS = new Set(['fn', 'defn', 'defn-', 'defmacro', 'defmethod', 'bound-fn']);
const DESTRUCTURE_KEYS = new Set([':keys', ':strs', ':syms', ':as', ':or']);

const keyId = (name: string) => `key:${name}`;

// The clojure.core function a list calls, by name.
function coreHead(ctx: Context, file: string, list: Form): string | undefined {
  const head = list.t === 'list' ? list.children[0] : undefined;
  const use = head && head.t === 'symbol' ? ctx.useAt(file, head.row, head.col) : undefined;
  return use && CORE_NS.test(use.to) ? use.name : undefined;
}

// A map in a binding position: a let-style binding target or a function parameter.
function isDestructuring(ctx: Context, file: string, map: Form): boolean {
  const p = ctx.parentOf(file, map.row, map.col);
  // a map in the key slot of a binding map destructures a nested value: {{:keys [c]} :child}
  if (p?.parent.t === 'map' && p.index % 2 === 0) return isDestructuring(ctx, file, p.parent);
  if (!p || p.parent.t !== 'vector') return false;
  const owner = ctx.parentOf(file, p.parent.row, p.parent.col)?.parent;
  const head = owner && owner.t === 'list' ? textOf(owner.children[0]) : undefined;
  if (!head) return false;
  if (BINDING_FORMS.has(head)) return p.index % 2 === 0;
  if (FN_FORMS.has(head)) return true;
  // a multi-arity body: ([a {:keys [b]}] ...)
  const grand = ctx.parentOf(file, owner?.row ?? 0, owner?.col ?? 0)?.parent;
  return !!grand && grand.t === 'list' && FN_FORMS.has(textOf(grand.children[0]) ?? '');
}

// Whether the form at `index` of `parent` is a step the threaded value passes through: not the head, not the value
// that starts the thread, not a cond-> test and not an as-> form (which names its value explicitly).
// The :keys, :or or :as of a binding map, as opposed to a data key that happens to be named so.
function isBindingKey(ctx: Context, k: Keyword): boolean {
  const at = ctx.parentOf(k.file, k.row, k.col);
  return !k.destructured && !!at && at.parent.t === 'map' && at.index % 2 === 0 && isDestructuring(ctx, k.file, at.parent);
}

function isThreadStep(parent: Form, index: number): boolean {
  const head = parent.t === 'list' ? textOf(parent.children[0]) : undefined;
  if (!head || !THREADING.has(head)) return false;
  return COND_THREADING.has(head) ? index >= 3 && index % 2 === 1 : index >= 2;
}

function isThreaded(ctx: Context, file: string, list: Form): boolean {
  const at = ctx.parentOf(file, list.row, list.col);
  return !!at && isThreadStep(at.parent, at.index);
}

const site = (role: Role, via: string, threaded = false): Site => ({ role, via, threaded });
// update and update-in read the old value and write the new one
const both = (via: string, threaded = false): Site[] => [site('produces_key', via, threaded), site('consumes_key', via, threaded)];

// What a keyword at this place does to a map: none, one or two roles.
export function classify(ctx: Context, k: Keyword): Site[] {
  if (k.destructured) return [site('consumes_key', 'destructure')];
  const at = ctx.parentOf(k.file, k.row, k.col);
  if (!at) return [];
  const { parent, index } = at;
  if (parent.t === 'map') {
    if (isDestructuring(ctx, k.file, parent)) return index % 2 === 1 ? [site('consumes_key', 'destructure')] : [];
    return index % 2 === 0 ? [site('produces_key', 'map-literal')] : [];
  }
  if (parent.t === 'vector') {
    // a key path: (get-in m [:a :b]), (assoc-in m [:a :b] v), (select-keys m [:a :b])
    const call = ctx.parentOf(k.file, parent.row, parent.col)?.parent;
    const fn = call && coreHead(ctx, k.file, call);
    if (fn === 'get-in' || fn === 'select-keys') return [site('consumes_key', fn)];
    if (fn === 'assoc-in') return [site('produces_key', fn)];
    if (fn === 'update-in') return both(fn);
    return [];
  }
  if (parent.t !== 'list') return [];
  if (index === 0) return [site('consumes_key', 'keyword-fn')];
  // (-> m :a :b): each keyword is a lookup step
  if (isThreadStep(parent, index)) return [site('consumes_key', 'keyword-fn', true)];
  const fn = coreHead(ctx, k.file, parent);
  if (!fn) return [];
  const threaded = isThreaded(ctx, k.file, parent);
  const arg = index - (threaded ? 0 : 1);
  if (fn === 'dissoc' && arg >= 1) return [site('removes_key', 'dissoc', threaded)];
  if (fn === 'assoc' && arg >= 1 && arg % 2 === 1) return [site('produces_key', 'assoc', threaded)];
  if (fn === 'hash-map' && index % 2 === 1) return [site('produces_key', 'hash-map')];
  if (fn === 'update' && arg === 1) return both('update', threaded);
  if ((fn === 'get' || fn === 'contains?' || fn === 'find') && arg === 1) return [site('consumes_key', fn, threaded)];
  return [];
}

// ---------- key tables ----------

interface TableRow {
  line: number;
  keys: string[];
  tags?: Record<string, string>;
  vecs?: Record<string, string[]>;
  dynamic_keys?: number;
}

function row(ctx: Context, file: string, m: Form): TableRow {
  const xs = flatChildren(m);
  const keys: string[] = [];
  const tags: Record<string, string> = {};
  const vecs: Record<string, string[]> = {};
  let dynamic = 0;
  for (let i = 0; i + 1 < xs.length; i += 2) {
    const k = unwrap(xs[i]);
    if (k.t !== 'keyword') {
      dynamic++;
      continue;
    }
    const name = ctx.nameOf(file, k);
    keys.push(name);
    const v = unwrap(xs[i + 1]);
    if (v.t === 'keyword') tags[name] = ctx.nameOf(file, v);
    if (v.t === 'vector') vecs[name] = flatChildren(v).map((x) => (unwrap(x).t === 'keyword' ? ctx.nameOf(file, unwrap(x)) : '_'));
  }
  return {
    line: m.row, keys,
    ...(Object.keys(tags).length ? { tags } : {}),
    ...(Object.keys(vecs).length ? { vecs } : {}),
    ...(dynamic ? { dynamic_keys: dynamic } : {}),
  };
}

const MIN_ROWS = 3;

function tables(ctx: Context, owner: Owner, file: string, from: string): GraphNode[] {
  const out: GraphNode[] = [];
  const component = ctx.componentOf(file);
  for (const top of ctx.forms(file)) {
    for (const f of walk([top])) {
      const u = unwrap(f);
      if (u !== f) continue;
      const items = u.t === 'vector' ? flatChildren(u) : u.t === 'map' ? flatChildren(u).filter((_, i) => i % 2 === 1) : [];
      const maps = items.filter((x) => unwrap(x).t === 'map');
      if (maps.length < MIN_ROWS) continue;
      const holder = owner({ file, row: u.row, col: u.col, from });
      const varName = holder.startsWith('definition:') ? holder.slice('definition:'.length) : undefined;
      out.push({
        id: `key_table:${file}:${u.row}:${u.col}`, kind: 'key_table', name: varName ? varName.split('/').pop() ?? varName : from,
        file, line: u.row, end_line: u.endRow, ...(component ? { component } : {}),
        attrs: {
          shape: u.t, form_line: top.row, ...(varName ? { var: varName } : {}),
          rows: maps.map((m) => row(ctx, file, unwrap(m))),
          ...(u.t === 'vector' && maps.length < items.length ? { other_rows: items.filter((x) => unwrap(x).t !== 'map').map((x) => ({ line: x.row, shape: unwrap(x).t })) } : {}),
        },
      });
    }
  }
  return out;
}

export const mapKeys: Adapter = {
  name: 'key_flow',
  edgeKinds: ['produces_key', 'consumes_key', 'removes_key'],
  detect: (ctx) => (ctx.analysis.keywords.length ? 'keywords in code' : null),
  run: (ctx, owner) => {
    const edges: GraphEdge[] = [];
    const other = new Map<string, number>();
    for (const k of ctx.analysis.keywords) {
      const name = keywordName(k);
      if (DESTRUCTURE_KEYS.has(name) && isBindingKey(ctx, k)) continue;
      const sites = classify(ctx, k);
      if (!sites.length) other.set(name, (other.get(name) ?? 0) + 1);
      for (const s of sites) {
        edges.push({ from: owner(k), to: keyId(name), kind: s.role, band: s.threaded ? 'heuristic' : 'static_proven', file: k.file, line: k.row, attrs: { via: s.via } });
      }
    }
    const used = new Set(edges.map((e) => e.to));
    const nodes: GraphNode[] = [...used].sort().map((id) => {
      const name = id.slice('key:'.length);
      return { id, kind: 'key', name, ...(other.get(name) ? { attrs: { other_uses: other.get(name) } } : {}) };
    });
    return { nodes, edges };
  },
};

// Literal tables of 3+ map rows (a vector of maps, or a map whose values are maps) for key_siblings.
export const keyTables: Adapter = {
  name: 'key_tables',
  edgeKinds: [],
  detect: (ctx) => (ctx.analysis.nsDefs.length ? 'map literals in code' : null),
  run: (ctx, owner) => ({ nodes: ctx.analysis.nsDefs.flatMap((d) => tables(ctx, owner, d.file, d.name)), edges: [] }),
};

