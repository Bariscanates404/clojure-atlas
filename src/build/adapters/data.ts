// Persisted attributes of Datomic, datascript and XTDB: schema maps define them, transaction and query calls
// prove writes and reads; a query literal outside a call reads them HEURISTICALLY, and any other use of a known
// attribute keyword is a reference of UNKNOWN role whose context the attribute_usage tool ranks.
import type { GraphEdge, GraphNode } from '../../mcp/graph.ts';
import { keywordName } from '../analysis.ts';
import { flatChildren, formAt, kids, textOf, unwrap, walk, type Form } from '../reader.ts';
import type { Adapter, Context, Owner } from '../model.ts';

const DB_LIBS: Record<string, string> = {
  'datomic.api': 'datomic', 'datomic.client.api': 'datomic', 'datascript.core': 'datascript', 'xtdb.api': 'xtdb', 'crux.api': 'xtdb',
};
const WRITES = new Set(['transact', 'transact!', 'transact-async', 'with', 'db-with', 'submit-tx', 'submit-tx-async', 'reset-conn!']);
const READS = new Set(['q', 'query', 'qseq', 'pull', 'pull-many', 'entity', 'entity-history', 'datoms', 'seek-datoms', 'index-range']);
const RESERVED = /^:(db|db\.[a-z]+|xt|xtdb\.api|crux\.db|crux\.tx|fressian)\//;
const TX_OPS = /^:(db\/(add|retract|cas)|db\.fn\/[a-z]+|xtdb\.api\/(put|delete|match)|xt\/(put|delete|match))$/;
// the operations whose third element is an attribute; the others take functions, ids or documents there
const ATTRIBUTE_OPS = /^:db\/(add|retract|cas)$/;

const attributeId = (kind: string, name: string) => `${kind}:${name}`;

// The name of a keyword form. A key of #:ns{...} is written without its namespace; kondo resolves it in code but an
// edn file has no analysis, so the prefix is applied here (#::{} and #::alias{} need the code's own resolution).
function keywordIn(ctx: Context, file: string, f: Form): string {
  const name = ctx.nameOf(file, f);
  const at = ctx.parentOf(file, f.row, f.col);
  const prefix = at && at.parent.t === 'map' && at.index % 2 === 0 ? at.parent.ns : undefined;
  return forwardName(prefix && !prefix.startsWith(':') && !name.includes('/') ? `:${prefix}/${name.slice(1)}` : name);
}

// :ns/_attr follows :ns/attr backwards: it is a use of that attribute
const forwardName = (name: string): string => name.replace(/^(:[^/]+)\/_/, '$1/');

const isKeyword = (f: Form) => unwrap(f).t === 'keyword';

// The datomic client takes {:tx-data [...]}: the transaction is its value, the key is the argument's.
function txData(name: (f: Form) => string, arg: Form): Form {
  const u = unwrap(arg);
  if (u.t !== 'map') return arg;
  const xs = flatChildren(u);
  const at = xs.findIndex((x, k) => k % 2 === 0 && isKeyword(x) && name(unwrap(x)) === ':tx-data');
  return at >= 0 ? xs[at + 1] : arg;
}

// Keyword forms that name attributes in transaction data: map keys (nested maps included) and the attribute slot of
// an operation vector such as [:db/add e :attr v].
function txAttributes(name: (f: Form) => string, f: Form): Form[] {
  const u = unwrap(f);
  if (u.t === 'map') {
    const xs = flatChildren(u);
    return xs.flatMap((x, k) => (k % 2 === 0 ? (isKeyword(x) ? [unwrap(x)] : []) : txAttributes(name, x)));
  }
  if (u.t === 'vector' || u.t === 'list') {
    const xs = flatChildren(u);
    if (xs[0] && isKeyword(xs[0]) && TX_OPS.test(name(unwrap(xs[0])))) {
      return [...(xs[2] && isKeyword(xs[2]) && ATTRIBUTE_OPS.test(name(unwrap(xs[0]))) ? [unwrap(xs[2])] : []),
        ...xs.slice(1).flatMap((x) => (unwrap(x).t === 'map' ? txAttributes(name, x) : []))];
    }
    return xs.flatMap((x) => txAttributes(name, x));
  }
  return [];
}

const isLogicVar = (f: Form | undefined): boolean => !!f && unwrap(f).t === 'symbol' && /^(\?|_$)/.test(textOf(unwrap(f)) ?? '');
const isSource = (f: Form | undefined): boolean => !!f && unwrap(f).t === 'symbol' && /^\$/.test(textOf(unwrap(f)) ?? '');
const keywordsOf = (fs: readonly (Form | undefined)[]): Form[] => fs.flatMap((f) => (f && isKeyword(f) ? [unwrap(f)] : []));

// The attribute of a data pattern [?e :attr ?v] or [$ ?e :attr ?v]. A constant entity (an id, or an ident that is no
// attribute) only makes a pattern when the value is a variable, which a pull pattern never holds.
function dataPatternAttribute(xs: readonly Form[]): Form[] | undefined {
  const [e, a, v] = isSource(xs[0]) ? xs.slice(1) : xs;
  if (isLogicVar(e) || isSource(xs[0])) return keywordsOf([a]);
  const constant = e && ['number', 'keyword'].includes(unwrap(e).t);
  return constant && isLogicVar(v) ? keywordsOf([a]) : undefined;
}

// The attribute a function clause reads: [(get-else $ ?e :attr default) ?v], get-some (one or more) and missing?.
function clauseAttributes(xs: readonly Form[]): Form[] {
  const args = isSource(xs[1]) ? xs.slice(2) : xs.slice(1);
  const head = textOf(unwrap(xs[0]));
  if (head === 'get-some') return keywordsOf(args.slice(1));
  return head === 'get-else' || head === 'missing?' ? keywordsOf([args[1]]) : [];
}

// The attribute of a pull attribute expression: (:attr :as "x"), (limit :attr 10), (default :attr 0).
function pullExpression(list: Form): Form[] {
  const xs = flatChildren(list);
  if (xs[0] && isKeyword(xs[0])) return keywordsOf([xs[0]]);
  return /^(limit|default)$/.test(textOf(xs[0] && unwrap(xs[0])) ?? '') ? keywordsOf([xs[1]]) : readAttributes(list);
}

// Keyword forms a query or pull reads: the attribute slot of a data pattern and of the function clauses, every key
// of a pull pattern and the attributes of its expressions; :find, :in and value positions are not attributes.
function readAttributes(f: Form): Form[] {
  const u = unwrap(f);
  if (u.t !== 'vector' && u.t !== 'list' && u.t !== 'map') return [];
  const xs = flatChildren(u);
  if (u.t === 'list' && /^(get-else|get-some|missing\?)$/.test(textOf(unwrap(xs[0] ?? u)) ?? '')) return clauseAttributes(xs);
  if (u.t === 'vector') {
    const pattern = dataPatternAttribute(xs);
    if (pattern) return pattern;
  }
  if (u.t === 'vector' && xs.length && !xs.some(isLogicVar) && xs.every((x) => ['keyword', 'map', 'symbol', 'list', 'vector'].includes(unwrap(x).t))
    && xs.some((x) => isKeyword(x) || unwrap(x).t === 'list') && !xs.some((x) => /^:(find|where|in|keys)$/.test((unwrap(x) as { text?: string }).text ?? ''))) {
    return xs.flatMap((x) => {
      const y = unwrap(x);
      if (y.t === 'keyword') return [y];
      if (y.t === 'list') return pullExpression(y);
      return y.t === 'map' ? flatChildren(y).flatMap((z, k) => (k % 2 === 0 && isKeyword(z) ? [unwrap(z)] : readAttributes(z))) : readAttributes(x);
    });
  }
  return xs.flatMap(readAttributes);
}

// The attribute a call names by position: (index-range db :attr start end), (datoms db :aevt :attr), (datoms db :eavt e :attr).
function positionalAttributes(name: string, args: readonly Form[]): Form[] {
  if (name === 'index-range') return keywordsOf([args[1]]);
  if (name !== 'datoms' && name !== 'seek-datoms') return [];
  const index = args[1] && textOf(unwrap(args[1]));
  return index === ':aevt' || index === ':avet' ? keywordsOf([args[2]]) : index === ':eavt' ? keywordsOf([args[3]]) : [];
}

const isQueryLiteral = (f: Form): boolean => {
  const xs = flatChildren(f);
  if (f.t === 'vector') return !!xs[0] && (unwrap(xs[0]) as { text?: string }).text === ':find';
  if (f.t === 'map') return xs.some((x, k) => k % 2 === 0 && (unwrap(x) as { text?: string }).text === ':find');
  return false;
};

interface Definition {
  name: string;
  kind: 'data_attribute' | 'data_value';
  file: string;
  line: number;
  col: number;
}

// {:db/ident :a ...} defines an attribute (with :db/valueType) or an enum value; a datascript schema map
// {:a {:db/unique ...}} defines its keys.
function schemaDefinitions(name: (f: Form) => string, file: string, forms: readonly Form[]): Definition[] {
  const out: Definition[] = [];
  for (const f of walk(forms)) {
    if (f.t !== 'map') continue;
    const xs = flatChildren(f);
    const keys = xs.filter((_, k) => k % 2 === 0).map((x) => (isKeyword(x) ? name(unwrap(x)) : ''));
    const ident = keys.indexOf(':db/ident');
    if (ident >= 0 && xs[ident * 2 + 1] && isKeyword(xs[ident * 2 + 1])) {
      const target = unwrap(xs[ident * 2 + 1]);
      out.push({ name: name(target), kind: keys.includes(':db/valueType') ? 'data_attribute' : 'data_value', file, line: target.row, col: target.col });
      continue;
    }
    const vals = xs.filter((_, k) => k % 2 === 1).map(unwrap);
    const isSchema = vals.length > 0 && vals.every((v) => v.t === 'map' && flatChildren(v).length > 0
      && flatChildren(v).every((y, k) => k % 2 === 1 || (isKeyword(y) && /^:db\//.test(name(unwrap(y))))));
    if (isSchema && keys.every((k) => k && !RESERVED.test(k))) {
      xs.forEach((x, k) => { if (k % 2 === 0) out.push({ name: name(unwrap(x)), kind: 'data_attribute', file, line: x.row, col: x.col }); });
    }
  }
  return out;
}

interface Use {
  name: string;
  kind: 'writes' | 'reads' | 'references';
  band: 'static_proven' | 'heuristic' | 'unknown';
  file: string;
  row: number;
  col: number;
  from: string;
  fromVar?: string;
  context: string;
}

export const dataAttributes: Adapter = {
  name: 'data_attributes',
  edgeKinds: ['writes', 'reads', 'references'],
  detect: (ctx) => {
    const libs = new Set(ctx.analysis.nsUses.flatMap((u) => (DB_LIBS[u.to] ? [DB_LIBS[u.to]] : [])));
    return libs.size ? [...libs].sort().join(', ') : null;
  },
  run: (ctx: Context, owner: Owner) => {
    const nsOf = new Map(ctx.analysis.nsDefs.map((d) => [d.file, d.name]));
    const nameIn = (file: string) => (f: Form) => keywordIn(ctx, file, f);
    const defs: Definition[] = [];
    const uses: Use[] = [];
    const seen = new Set<string>();
    const add = (u: Use) => {
      const k = `${u.file}:${u.row}:${u.col}`;
      if (seen.has(k) || RESERVED.test(u.name)) return;
      seen.add(k);
      uses.push(u);
    };
    for (const file of [...ctx.edn, ...nsOf.keys()]) defs.push(...schemaDefinitions(nameIn(file), file, ctx.forms(file)));
    // a definition site is neither a read nor a write nor a reference
    for (const d of defs) seen.add(`${d.file}:${d.line}:${d.col}`);

    const calls = ctx.analysis.varUses.filter((u) => DB_LIBS[u.to] && (WRITES.has(u.name) || READS.has(u.name)));
    for (const call of calls) {
      const form = formAt(ctx.forms(call.file), call.row, call.col);
      if (!form) continue;
      const name = nameIn(call.file);
      const write = WRITES.has(call.name);
      const args = kids(form).slice(1);
      const found = write ? args.flatMap((a) => txAttributes(name, txData(name, a)))
        : [...args.flatMap(readAttributes), ...positionalAttributes(call.name, args)];
      for (const f of found) {
        add({ name: name(f), kind: write ? 'writes' : 'reads', band: 'static_proven', file: call.file, row: f.row, col: f.col, from: call.from,
          ...(call.fromVar ? { fromVar: call.fromVar } : {}), context: `@${call.to}/${call.name}` });
      }
    }
    const kwAt = new Map(ctx.analysis.keywords.map((k) => [`${k.file}:${k.row}:${k.col}`, k]));
    for (const [file, ns] of nsOf) {
      const name = nameIn(file);
      for (const f of walk(ctx.forms(file))) {
        if (!isQueryLiteral(f)) continue;
        for (const k of readAttributes(f)) {
          const fromVar = kwAt.get(`${file}:${k.row}:${k.col}`)?.fromVar;
          add({ name: name(k), kind: 'reads', band: 'heuristic', file, row: k.row, col: k.col, from: ns, ...(fromVar ? { fromVar } : {}),
            context: 'query literal' });
        }
      }
    }

    const known = new Set([...defs.map((d) => d.name), ...uses.map((u) => u.name)]);
    const contextOf = (file: string, row: number, col: number): string => {
      const p = ctx.parentOf(file, row, col)?.parent;
      if (!p) return 'reference';
      const xs = flatChildren(p);
      const name = nameIn(file);
      if (p.t === 'list' && xs[0] && xs[0].row === row && xs[0].col === col) return 'non-write-position (keyword as function)';
      if ((p.t === 'vector' || p.t === 'list') && xs[0] && isKeyword(xs[0]) && TX_OPS.test(name(unwrap(xs[0])))) return name(unwrap(xs[0]));
      if (p.t === 'map' && xs.some((x, k) => k % 2 === 0 && isKeyword(x)
        && /^:(db\/id|xt\/id|xtdb\.api\/id|crux\.db\/id)$/.test(name(unwrap(x))))) return ':db/id-map';
      return 'reference';
    };
    for (const k of ctx.analysis.keywords) {
      const name = forwardName(keywordName(k));
      if (!k.ns || !known.has(name)) continue;
      add({ name, kind: 'references', band: 'unknown', file: k.file, row: k.row, col: k.col, from: k.from, ...(k.fromVar ? { fromVar: k.fromVar } : {}),
        context: contextOf(k.file, k.row, k.col) });
    }

    const nodes: GraphNode[] = [];
    const firstUse = new Map<string, Use>();
    for (const u of uses) if (!firstUse.has(u.name) || u.kind !== 'references' && firstUse.get(u.name)?.kind === 'references') firstUse.set(u.name, u);
    const defined = new Map<string, Definition>();
    // a map with :db/valueType defines the attribute, whatever alter maps without one come before it
    for (const d of defs) if (!defined.has(d.name) || (defined.get(d.name)?.kind === 'data_value' && d.kind === 'data_attribute')) defined.set(d.name, d);
    for (const name of [...known].sort()) {
      const d = defined.get(name);
      const at = d ?? firstUse.get(name);
      if (!at) continue;
      const kind = d?.kind ?? 'data_attribute';
      const component = ctx.componentOf(d ? d.file : (at as Use).file);
      nodes.push({ id: attributeId(kind, name), kind, name, file: d ? d.file : (at as Use).file, line: d ? d.line : (at as Use).row,
        ...(component ? { component } : {}), attrs: { schema: !!d } });
    }
    const kindOf = new Map(nodes.map((n) => [n.name, n.kind]));
    const edges: GraphEdge[] = uses.map((u) => ({
      from: owner(u), to: attributeId(kindOf.get(u.name) ?? 'data_attribute', u.name), kind: u.kind, band: u.band, file: u.file, line: u.row,
        attrs: { context: u.context },
    }));
    return { nodes, edges };
  },
};

