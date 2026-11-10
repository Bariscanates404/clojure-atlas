// Ring middleware around compojure routes, read where a route var is passed on: ->, ->>, nested calls, wrap-routes,
// then up through the definition holding the wrapped value and its uses. Any shape not plainly read (let, apply, an
// unknown call) makes the middleware unknown, never none.
import { isTestFile } from '../../shared/testfile.ts';
import type { VarUse } from '../analysis.ts';
import { contains, formAt, kids, textOf, unwrap, walk, type Form } from '../reader.ts';
import { CORE_NS, groupBy, UNKNOWN_NS, type Context } from '../model.ts';

const COMPOJURE = 'compojure.core';
const SERVER = /^(ring\.adapter\.|org\.httpkit\.server$|aleph\.http$|immutant\.web$)/;

export interface Wrapper {
  def: string;
  line: number;
  library: boolean;
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

export function wrappingOf(ctx: Context): (file: string, route: Form) => Wrapping {
  const uses = groupBy(ctx.analysis.varUses.filter((u) => !isTestFile(u.file)), fullName);
  const defAt = new Map([...ctx.defs].map(([full, d]) => [`${d.file}:${d.row}:${d.col}`, { full, routes: /(^|\/)defroutes$/.test(d.definedBy ?? '') }]));

  // a project function applying its first parameter is a middleware
  const appliesHandler = (full: string): boolean => {
    const d = ctx.defs.get(full);
    const form = d && formAt(ctx.forms(d.file), d.row, d.col);
    const xs = form ? kids(form).map(unwrap) : [];
    const param = xs.find((x, i) => i >= 2 && x.t === 'vector');
    const first = param && param.t === 'vector' ? unwrap(param.children[0] ?? param) : undefined;
    const name = first && first.t === 'symbol' ? first.text : undefined;
    return !!name && [...walk(xs.slice(3))].some((f) => f.t === 'list' && f.children[0] && textOf(unwrap(f.children[0])) === name);
  };
  const isMiddleware = (u: VarUse) => /^wrap-/.test(u.name) || /^ring\.middleware\./.test(u.to) || (u.to === 'compojure.handler' && ['site', 'api'].includes(u.name)) || appliesHandler(fullName(u));

  const useOf = (file: string, f: Form | undefined): VarUse | undefined => {
    const u = f && unwrap(f);
    const use = u && u.t === 'symbol' ? ctx.useAt(file, u.row, u.col) : undefined;
    return use && use.to !== UNKNOWN_NS ? use : undefined;
  };
  const wrapper = (use: VarUse, line: number): Wrapper => ({ def: fullName(use), line, library: !ctx.defs.has(fullName(use)) });
  const headName = (file: string, f: Form): string => {
    const use = useOf(file, f);
    return use ? fullName(use) : '';
  };
  // a threading step: a symbol, or a call whose head is the middleware; wrap-routes names it in its argument
  const stepOf = (file: string, step: Form): Wrapper | undefined => {
    const s = unwrap(step);
    const head = s.t === 'list' ? unwrap(s.children[0] ?? s) : s;
    const use = useOf(file, head);
    if (!use) return undefined;
    if (use.to === COMPOJURE && use.name === 'wrap-routes' && s.t === 'list') {
      const arg = useOf(file, s.children[1]);
      return arg ? wrapper(arg, unwrap(s.children[1]).row) : undefined;
    }
    return isMiddleware(use) ? wrapper(use, head.row) : undefined;
  };

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
      const head = unwrap(parent.children[0] ?? parent);
      const use = useOf(file, head);
      if (index === 0) {
        // a handler called with a request ends the climb; a function called for the routes it returns goes on
        if (parent.children.length > 1 && !/defn/.test(ctx.defs.get(headName(file, cur))?.definedBy ?? '')) return [wrappers];
        cur = parent;
        continue;
      }
      if (!use) return [null];
      if (CORE_NS.test(use.to) && (use.name === '->' || use.name === '->>')) {
        const steps = parent.children.slice(2).map((s) => stepOf(file, s));
        if (index !== 1 || steps.some((s) => !s)) return [null];
        wrappers.push(...steps.flatMap((s) => (s ? [s] : [])));
      } else if (use.to === COMPOJURE && (use.name === 'routes' || (use.name === 'context' && index >= 3))) {
        // combining routes adds no middleware
      } else if (use.to === COMPOJURE && use.name === 'wrap-routes') {
        const arg = index === 1 ? useOf(file, parent.children[2]) : undefined;
        if (!arg) return [null];
        wrappers.push(wrapper(arg, unwrap(parent.children[2]).row));
      } else if (index === 1 && isMiddleware(use)) wrappers.push(wrapper(use, head.row));
      else if (index === 1 && SERVER.test(use.to)) return [wrappers];
      else return [null];
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

  return (file, route) => {
    const found = climb(file, route, []);
    const chains = found.filter((c): c is Wrapper[] => c !== null);
    const same = new Set(chains.map((c) => c.map((w) => w.def).join(' '))).size <= 1;
    const out: Wrapping = found.length === chains.length && same
      ? { wrappers: [...(chains[0] ?? [])].reverse(), unknown: false }
      : { wrappers: [], unknown: true };
    return out;
  };
}
