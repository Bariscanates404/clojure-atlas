// Ring middleware around a routing table, read where a compojure route var or a reitit router is passed on: ->, ->>,
// nested calls, wrap-routes, reitit's ring-handler (and the :middleware of its options), then up through the definition
// holding the wrapped value and its uses. Any shape not plainly read (let, apply, an unknown call) makes the middleware
// unknown, never none.
import { isTestFile } from '../../shared/testfile.ts';
import type { VarUse } from '../analysis.ts';
import { contains, flatChildren, formAt, kids, textOf, unwrap, walk, type Form } from '../reader.ts';
import { CORE_NS, groupBy, UNKNOWN_NS, type Context } from '../model.ts';
import { COMPOJURE, entry } from './route-data.ts';

const RING_HANDLER = 'reitit.ring/ring-handler';
const SERVER = /^(ring\.adapter\.|org\.httpkit\.server$|aleph\.http$|immutant\.web$)/;

export interface Wrapper {
  def: string;
  // where the middleware is applied: the wrapping call can be in another file than the route
  file: string;
  line: number;
  library: boolean;
  // the permission argument when this is a configured permission middleware: (wrap-permission handler :admin)
  permission?: { form: Form; file: string };
}

export interface Wrapping {
  // outermost first
  wrappers: Wrapper[];
  // wrapped by something the build cannot follow, or by different things in different places
  unknown: boolean;
}

// null: this way up could not be followed
type Climb = Wrapper[] | null;

const fullName = (u: VarUse) => `${u.to}/${u.name}`;
const ownerOf = (u: VarUse) => (u.fromVar ? `${u.from}/${u.fromVar}` : u.from);

// a project function applying its first parameter is a middleware
function appliesHandler(ctx: Context, full: string): boolean {
  const d = ctx.defs.get(full);
  const form = d && formAt(ctx.forms(d.file), d.row, d.col);
  const xs = form ? kids(form).map(unwrap) : [];
  const param = xs.find((x, i) => i >= 2 && x.t === 'vector');
  const first = param && param.t === 'vector' ? unwrap(param.children[0] ?? param) : undefined;
  const name = first && first.t === 'symbol' ? first.text : undefined;
  return !!name && [...walk(xs.slice(3))].some((f) => f.t === 'list' && f.children[0] && textOf(unwrap(f.children[0])) === name);
}

const isMiddleware = (ctx: Context, u: VarUse): boolean => /^wrap-/.test(u.name) || /^ring\.middleware\./.test(u.to)
  || (u.to === 'compojure.handler' && ['site', 'api'].includes(u.name)) || appliesHandler(ctx, fullName(u));

function useOf(ctx: Context, file: string, f: Form | undefined): VarUse | undefined {
  const u = f && unwrap(f);
  const use = u && u.t === 'symbol' ? ctx.useAt(file, u.row, u.col) : undefined;
  return use && use.to !== UNKNOWN_NS ? use : undefined;
}

const wrapper = (ctx: Context, use: VarUse, file: string, line: number,
  arg?: Form): Wrapper => ({ def: fullName(use), file, line, library: !ctx.defs.has(fullName(use)),
  ...(arg && ctx.config.permissionMiddleware.includes(fullName(use)) ? { permission: { form: arg, file } } : {}) });

function headName(ctx: Context, file: string, f: Form): string {
  const use = useOf(ctx, file, f);
  return use ? fullName(use) : '';
}

// a threading step: a symbol, or a call whose head is the middleware; wrap-routes names it in its argument
function stepOf(ctx: Context, file: string, step: Form): Wrapper | undefined {
  const s = unwrap(step);
  const head = s.t === 'list' ? unwrap(s.children[0] ?? s) : s;
  const use = useOf(ctx, file, head);
  if (!use) return undefined;
  if (use.to === COMPOJURE && use.name === 'wrap-routes' && s.t === 'list') {
    const arg = useOf(ctx, file, s.children[1]);
    return arg ? wrapper(ctx, arg, file, unwrap(s.children[1]).row, s.children[2]) : undefined;
  }
  return isMiddleware(ctx, use) ? wrapper(ctx, use, file, head.row, s.t === 'list' ? s.children[1] : undefined) : undefined;
}

// an element of a :middleware vector: a symbol, or a vector or call whose head is the middleware and whose next element is its argument
function itemOf(ctx: Context, file: string, f: Form): Wrapper | undefined {
  const item = unwrap(f);
  const parts = item.t === 'vector' || item.t === 'list' ? flatChildren(item) : [item];
  const head = unwrap(parts[0] ?? item);
  const use = useOf(ctx, file, head);
  return use ? wrapper(ctx, use, file, head.row, parts[1]) : undefined;
}

// ring-handler's options map: its :middleware wraps the whole handler, innermost last in the vector; null when unreadable
function optionsWrappers(ctx: Context, file: string, opts: Form | undefined): Wrapper[] | null {
  if (!opts) return [];
  const o = unwrap(opts);
  if (o.t !== 'map') return null;
  const mw = entry(o, ':middleware');
  const v = mw && unwrap(mw);
  if (!v) return [];
  const items = v.t === 'vector' ? flatChildren(v).map((x) => itemOf(ctx, file, x)) : [];
  return v.t === 'vector' && items.every((x) => x) ? items.flatMap((x) => (x ? [x] : [])).reverse() : null;
}

// What one step up the tree adds to the wrappers met so far: a middleware, nothing (routes combined, a router handed to a
// lookup), or the end of the climb. `undefined` means the climb goes on from the parent; null a way that cannot be followed.
function absorb(ctx: Context, file: string, parent: Form & { children: Form[] }, index: number, wrappers: Wrapper[]): Climb[] | undefined {
  const head = unwrap(parent.children[0] ?? parent);
  const use = useOf(ctx, file, head);
  if (!use) return [null];
  if (CORE_NS.test(use.to) && (use.name === '->' || use.name === '->>')) {
    const steps = parent.children.slice(2).map((s) => stepOf(ctx, file, s));
    if (index !== 1 || steps.some((s) => !s)) return [null];
    wrappers.push(...steps.flatMap((s) => (s ? [s] : [])));
  } else if (use.to === COMPOJURE && (use.name === 'routes' || (use.name === 'context' && index >= 3))) {
    // combining routes adds no middleware
  } else if (use.to === COMPOJURE && use.name === 'wrap-routes') {
    const arg = index === 1 ? useOf(ctx, file, parent.children[2]) : undefined;
    if (!arg) return [null];
    wrappers.push(wrapper(ctx, arg, file, unwrap(parent.children[2]).row, parent.children[3]));
  } else if (index === 1 && fullName(use) === RING_HANDLER) {
    const own = optionsWrappers(ctx, file, parent.children[3]);
    if (!own) return [null];
    wrappers.push(...own);
  } else if (index === 1 && /^reitit\./.test(use.to)) {
    // the router handed to a lookup (match-by-name, routes): it serves nothing there
    return [];
  } else if (index === 1 && isMiddleware(ctx, use)) wrappers.push(wrapper(ctx, use, file, head.row, parent.children[2]));
  else if (index === 1 && SERVER.test(use.to)) return [wrappers];
  else return [null];
  return undefined;
}

// The ways up from a value to the top of the program, memoised per definition.
function climber(ctx: Context): (file: string, from: Form) => Climb[] {
  const uses = groupBy(ctx.analysis.varUses.filter((u) => !isTestFile(u.file)), fullName);
  const defAt = new Map([...ctx.defs].map(([full, d]) => [`${d.file}:${d.row}:${d.col}`, { full, routes: /(^|\/)defroutes$/.test(d.definedBy ?? '') }]));

  // from a value up to the top: the wrappers met, innermost first, then those around the definition holding the value
  const climb = (file: string, from: Form, stack: readonly string[]): Climb[] => {
    const wrappers: Wrapper[] = [];
    let cur = from;
    for (;;) {
      const up = ctx.parentOf(file, cur.row, cur.col);
      if (!up) return [null];
      const { parent, index } = up;
      const holder = defAt.get(`${file}:${parent.row}:${parent.col}`);
      if (holder) {
        if (index < 2 || (!holder.routes && index !== kids(parent).length - 1)) return [null];
        return outcomes(holder.full, stack).map((o) => (o ? [...wrappers, ...o] : null));
      }
      if (parent.t !== 'list') return [null];
      if (index === 0) {
        // a handler called with a request ends the climb; a function called for the routes it returns goes on
        if (parent.children.length > 1 && !/defn/.test(ctx.defs.get(headName(ctx, file, cur))?.definedBy ?? '')) return [wrappers];
        cur = parent;
        continue;
      }
      const ended = absorb(ctx, file, parent, index, wrappers);
      if (ended) return ended;
      cur = parent;
    }
  };

  const inComment = (u: VarUse): boolean => {
    const top = ctx.forms(u.file).find((f) => contains(f, u.row, u.col));
    return !!top && top.t === 'list' && textOf(unwrap(top.children[0] ?? top)) === 'comment';
  };

  const memo = new Map<string, Climb[]>();

  // every way up from a definition, through each of its uses; a definition nothing uses is the top
  function outcomes(full: string, stack: readonly string[]): Climb[] {
    const known = stack.length ? undefined : memo.get(full);
    if (known) return known;
    const found = climbUses(full, stack);
    if (!stack.length) memo.set(full, found);
    return found;
  }

  // uses in a top-level (comment ...) are not part of the program
  function climbUses(full: string, stack: readonly string[]): Climb[] {
    const here = (uses.get(full) ?? []).filter((u) => ownerOf(u) !== full && !stack.includes(ownerOf(u)) && !inComment(u));
    const found = here.flatMap((u) => {
      const sym = formAt(ctx.forms(u.file), u.nameRow, u.nameCol);
      return sym ? climb(u.file, sym, [...stack, full]) : [null];
    });
    return found.length ? found : [[]];
  }

  return (file, from) => climb(file, from, []);
}

export function wrappingOf(ctx: Context): (file: string, route: Form) => Wrapping {
  const climb = climber(ctx);
  return (file, route) => {
    const found = climb(file, route);
    const chains = found.filter((c): c is Wrapper[] => c !== null);
    const same = new Set(chains.map((c) => c.map((w) => w.def).join(' '))).size <= 1;
    const out: Wrapping = found.length === chains.length && same
      ? { wrappers: [...(chains[0] ?? [])].reverse(), unknown: false }
      : { wrappers: [], unknown: true };
    return out;
  };
}
