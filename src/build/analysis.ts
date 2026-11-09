// The slice of clj-kondo's analysis the builder reads, normalized: camelCase fields, the copies a .cljc file
// yields per platform merged, and two kinds of var usage dropped: the arity-only copy kondo synthesizes for a
// higher-order call (the value use at the same place stays) and a :refer in the ns form.

export interface Span {
  file: string;
  row: number;
  col: number;
  endRow: number;
  endCol: number;
}

export interface NsDef extends Span {
  name: string;
}

export interface NsUse {
  file: string;
  row: number;
  col: number;
  from: string;
  to: string;
}

export interface VarDef extends Span {
  ns: string;
  name: string;
  definedBy?: string;
  test: boolean;
  macro: boolean;
  private: boolean;
  langs: string[];
}

export interface ReFrameContext {
  inId?: string;
  id?: string;
  eventRef?: boolean;
  subscriptionRef?: boolean;
}

export interface VarUse extends Span {
  nameRow: number;
  nameCol: number;
  from: string;
  fromVar?: string;
  to: string;
  name: string;
  arity?: number;
  defmethod: boolean;
  dispatch?: string;
}

export interface Keyword extends Span {
  ns?: string;
  name: string;
  from: string;
  fromVar?: string;
  reg?: string;
  reFrame?: ReFrameContext;
}

export interface ProtocolImpl extends Span {
  protocolNs: string;
  protocolName: string;
  method: string;
  implNs: string;
  definedBy: string;
}

export interface SyntaxError {
  file: string;
  row: number;
  message: string;
}

export interface Analysis {
  nsDefs: NsDef[];
  nsUses: NsUse[];
  varDefs: VarDef[];
  varUses: VarUse[];
  keywords: Keyword[];
  protocolImpls: ProtocolImpl[];
  syntaxErrors: SyntaxError[];
}

export const emptyAnalysis = (): Analysis => ({
  nsDefs: [], nsUses: [], varDefs: [], varUses: [], keywords: [], protocolImpls: [], syntaxErrors: [],
});

type Raw = Record<string, unknown>;
const s = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const n = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
const list = (v: unknown): Raw[] => (Array.isArray(v) ? v.filter((x): x is Raw => typeof x === 'object' && x !== null) : []);

function span(r: Raw): Span {
  const row = n(r.row) ?? 0;
  const col = n(r.col) ?? 0;
  return { file: s(r.filename) ?? '', row, col, endRow: n(r['end-row']) ?? row, endCol: n(r['end-col']) ?? col };
}

const key = (...xs: unknown[]) => xs.map(String).join('\0');

// Keeps the first entry per key and folds later duplicates into it (a .cljc file is analyzed once per platform).
function dedupe<T>(xs: T[], k: (x: T) => string, merge: (a: T, b: T) => T = (a) => a): T[] {
  const m = new Map<string, T>();
  for (const x of xs) {
    const id = k(x);
    const prev = m.get(id);
    m.set(id, prev === undefined ? x : merge(prev, x));
  }
  return [...m.values()];
}

function reFrame(r: Raw): ReFrameContext | undefined {
  const ctx = r.context as Raw | undefined;
  const rf = ctx && (ctx['re-frame.core'] as Raw | undefined);
  if (!rf || typeof rf !== 'object') return undefined;
  return {
    ...(s(rf['in-id']) ? { inId: s(rf['in-id']) } : {}),
    ...(s(rf.id) ? { id: s(rf.id) } : {}),
    ...(rf['event-ref'] === true ? { eventRef: true } : {}),
    ...(rf['subscription-ref'] === true ? { subscriptionRef: true } : {}),
  };
}

// One kondo JSON document (one `--lint` run) to the normalized model.
export function normalize(raw: Raw): Analysis {
  const a = (raw.analysis ?? {}) as Raw;
  const nsDefs = dedupe(list(a['namespace-definitions']).map((r) => ({ ...span(r), name: s(r.name) ?? '' })), (x) => key(x.file, x.name));
  const nsUses = dedupe(
    list(a['namespace-usages']).map((r) => ({ file: s(r.filename) ?? '', row: n(r.row) ?? 0, col: n(r.col) ?? 0, from: s(r.from) ?? '', to: s(r.to) ?? '' })),
    (x) => key(x.file, x.row, x.col, x.to),
  );
  const varDefs = dedupe(
    list(a['var-definitions']).map((r): VarDef => ({
      ...span(r),
      ns: s(r.ns) ?? '',
      name: s(r.name) ?? '',
      ...(s(r['defined-by']) ? { definedBy: s(r['defined-by']) } : {}),
      test: r.test === true,
      macro: r.macro === true,
      private: r.private === true,
      langs: s(r.lang) ? [s(r.lang) as string] : [],
    })),
    (x) => key(x.file, x.ns, x.name, x.row, x.col),
    (p, q) => ({ ...p, langs: [...new Set([...p.langs, ...q.langs])].sort() }),
  );
  const varUses = dedupe(
    list(a['var-usages'])
      // an arity-only copy has no name position; a :refer in the ns form names a var without using it
      .filter((r) => typeof r['name-row'] === 'number' && r.refer !== true)
      .map((r): VarUse => ({
        ...span(r),
        nameRow: n(r['name-row']) ?? 0,
        nameCol: n(r['name-col']) ?? 0,
        from: s(r.from) ?? '',
        ...(s(r['from-var']) ? { fromVar: s(r['from-var']) } : {}),
        to: s(r.to) ?? '',
        name: s(r.name) ?? '',
        ...(n(r.arity) !== undefined ? { arity: n(r.arity) } : {}),
        defmethod: r.defmethod === true,
        ...(s(r['dispatch-val-str']) ? { dispatch: s(r['dispatch-val-str']) } : {}),
      })),
    (x) => key(x.file, x.nameRow, x.nameCol, x.to, x.name, x.defmethod),
  );
  const keywords = dedupe(
    list(a.keywords)
      .filter((r) => s(r.from) !== 'user' || s(r.ns) !== undefined)
      .map((r): Keyword => {
        const rf = reFrame(r);
        return {
          ...span(r),
          ...(s(r.ns) ? { ns: s(r.ns) } : {}),
          name: s(r.name) ?? '',
          from: s(r.from) ?? '',
          ...(s(r['from-var']) ? { fromVar: s(r['from-var']) } : {}),
          ...(s(r.reg) ? { reg: s(r.reg) } : {}),
          ...(rf ? { reFrame: rf } : {}),
        };
      }),
    (x) => key(x.file, x.row, x.col),
    (p, q) => ({ ...p, ...q, ...(p.reg ?? q.reg ? { reg: p.reg ?? q.reg } : {}), ...(p.reFrame || q.reFrame ? { reFrame: { ...q.reFrame, ...p.reFrame } } : {}) }),
  );
  const protocolImpls = dedupe(
    list(a['protocol-impls']).map((r) => ({
      ...span(r),
      protocolNs: s(r['protocol-ns']) ?? '',
      protocolName: s(r['protocol-name']) ?? '',
      method: s(r['method-name']) ?? '',
      implNs: s(r['impl-ns']) ?? '',
      definedBy: s(r['defined-by']) ?? '',
    })),
    (x) => key(x.file, x.row, x.col, x.method),
  );
  const syntaxErrors = dedupe(
    list(raw.findings)
      .filter((r) => r.type === 'syntax')
      .map((r) => ({ file: s(r.filename) ?? '', row: n(r.row) ?? 0, message: s(r.message) ?? '' })),
    (x) => key(x.file, x.row, x.message),
  );
  return { nsDefs, nsUses, varDefs, varUses, keywords, protocolImpls, syntaxErrors };
}

// Several runs (one per chunk of files) into one model; chunks never share a file.
export function concat(parts: Analysis[]): Analysis {
  const out = emptyAnalysis();
  for (const k of Object.keys(out) as (keyof Analysis)[]) (out[k] as unknown[]) = parts.flatMap((p) => p[k] as unknown[]);
  return out;
}

// "ns/name" for a keyword, with its leading colon.
export const keywordName = (k: { ns?: string; name: string }): string => `:${k.ns ? `${k.ns}/` : ''}${k.name}`;
