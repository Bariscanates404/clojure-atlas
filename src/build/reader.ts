// A Clojure reader that keeps positions: rows and columns are 1-based and the end column is exclusive, the same
// convention clj-kondo's analysis uses, so a form and a kondo usage at the same place line up. It reads structure
// only (nothing is evaluated or resolved) and never throws: a syntax error ends the read and is reported.

export interface Pos {
  row: number;
  col: number;
  endRow: number;
  endCol: number;
}

export type Coll = 'list' | 'vector' | 'map' | 'set' | 'fn';
export type Wrap = 'quote' | 'syntax-quote' | 'unquote' | 'unquote-splicing' | 'deref' | 'var' | 'meta' | 'tagged' | 'cond';
export type Atom = 'symbol' | 'keyword' | 'string' | 'number' | 'char' | 'regex' | 'other';

export type Form =
  | (Pos & { t: Coll; children: Form[]; ns?: string })
  | (Pos & { t: Wrap; children: Form[]; tag?: string })
  | (Pos & { t: Atom; text: string });

export interface ReadResult {
  forms: Form[];
  error?: { row: number; col: number; message: string };
}

const WS = /[\s,]/;
const TERMINATOR = /[\s,";@^`~()[\]{}\\]/;
const CLOSER: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

class ReadError extends Error {}

export function readForms(src: string): ReadResult {
  let i = 0;
  let row = 1;
  let col = 1;
  const peek = (k = 0) => src[i + k];
  const next = (): string => {
    const c = src[i++];
    if (c === '\r' && src[i] === '\n') i++;
    if (c === '\n' || c === '\r') {
      row++;
      col = 1;
    } else col++;
    return c === '\r' ? '\n' : c;
  };
  const fail = (message: string): never => {
    throw new ReadError(message);
  };

  const skipSpace = (): void => {
    while (i < src.length) {
      const c = peek();
      if (WS.test(c)) next();
      else if (c === ';' || (c === '#' && peek(1) === '!')) while (i < src.length && peek() !== '\n' && peek() !== '\r') next();
      else break;
    }
  };

  const token = (): string => {
    let s = '';
    while (i < src.length && !TERMINATOR.test(peek())) s += next();
    return s;
  };

  const stringBody = (): string => {
    let s = '';
    for (;;) {
      if (i >= src.length) fail('unterminated string');
      const c = next();
      if (c === '"') return s;
      if (c === '\\') {
        const e = next();
        s += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : e;
      } else s += c;
    }
  };

  const children = (close: string): Form[] => {
    const out: Form[] = [];
    for (;;) {
      skipSpace();
      if (i >= src.length) fail(`missing ${close}`);
      if (peek() === close) {
        next();
        return out;
      }
      const f = read();
      if (f) out.push(f);
    }
  };

  // one form, or null for a discarded one (#_)
  const read = (): Form | null => {
    skipSpace();
    if (i >= src.length) fail('unexpected end of input');
    const start = { row, col };
    const done = <T extends object>(f: T): T & Pos => ({ ...start, ...f, endRow: row, endCol: col });
    const wrapped = (t: Wrap, extra: { tag?: string } = {}): Form => {
      const inner = readPresent();
      return done({ t, children: [inner], ...extra });
    };
    const c = peek();
    if (c === '(' || c === '[' || c === '{') {
      next();
      return done({ t: c === '(' ? 'list' : c === '[' ? 'vector' : 'map', children: children(CLOSER[c]) } as const);
    }
    if (c === ')' || c === ']' || c === '}') fail(`unexpected ${c}`);
    if (c === '"') {
      next();
      return done({ t: 'string', text: stringBody() } as const);
    }
    if (c === '\\') {
      next();
      const first = next();
      return done({ t: 'char', text: /[A-Za-z0-9]/.test(first) ? first + token() : first } as const);
    }
    if (c === "'") return next(), wrapped('quote');
    if (c === '`') return next(), wrapped('syntax-quote');
    if (c === '@') return next(), wrapped('deref');
    if (c === '~') {
      next();
      if (peek() === '@') return next(), wrapped('unquote-splicing');
      return wrapped('unquote');
    }
    const withMeta = (): Form => {
      const meta = readPresent();
      const target = readPresent();
      return done({ t: 'meta' as const, children: [meta, target] });
    };
    if (c === '^') return next(), withMeta();
    if (c === '#') {
      next();
      const d = peek();
      if (d === '{') return next(), done({ t: 'set', children: children('}') } as const);
      if (d === '(') return next(), done({ t: 'fn', children: children(')') } as const);
      if (d === '"') return next(), done({ t: 'regex', text: stringBody() } as const);
      if (d === "'") return next(), wrapped('var');
      if (d === '=') return next(), wrapped('tagged', { tag: '=' });
      if (d === '^') return next(), withMeta();
      if (d === '_') {
        next();
        readPresent();
        return null;
      }
      if (d === '#') {
        next();
        return done({ t: 'other', text: `##${token()}` } as const);
      }
      if (d === '?') {
        next();
        if (peek() === '@') next();
        skipSpace();
        if (peek() !== '(') fail('reader conditional without a list');
        next();
        return done({ t: 'cond', children: children(')') } as const);
      }
      if (d === ':') {
        next();
        const prefix = token();
        skipSpace();
        if (peek() !== '{') fail('namespaced map without a map');
        next();
        return done({ t: 'map', ns: prefix, children: children('}') } as const);
      }
      const tag = token();
      if (!tag) fail(`unknown dispatch #${d ?? ''}`);
      return wrapped('tagged', { tag });
    }
    const text = token();
    if (!text) fail(`unexpected ${c}`);
    if (text.startsWith(':')) return done({ t: 'keyword', text } as const);
    if (/^[+-]?\d/.test(text)) return done({ t: 'number', text } as const);
    if (text === 'nil' || text === 'true' || text === 'false') return done({ t: 'other', text } as const);
    return done({ t: 'symbol', text } as const);
  };

  const readPresent = (): Form => {
    for (;;) {
      const f = read();
      if (f) return f;
    }
  };

  const forms: Form[] = [];
  try {
    for (;;) {
      skipSpace();
      if (i >= src.length) return { forms };
      const f = read();
      if (f) forms.push(f);
    }
  } catch (err) {
    if (!(err instanceof ReadError)) throw err;
    return { forms, error: { row, col, message: err.message } };
  }
}

// The text of an atom (symbol, keyword, string, ...); collections and wrappers have none.
export const textOf = (f: Form | undefined): string | undefined => (f && 'text' in f ? f.text : undefined);

export const isColl = (f: Form): f is Pos & { t: Coll; children: Form[]; ns?: string } =>
  f.t === 'list' || f.t === 'vector' || f.t === 'map' || f.t === 'set' || f.t === 'fn';

// Children of any form that has them (collections and wrappers alike).
export const kids = (f: Form): Form[] => ('children' in f ? f.children : []);

// Every form in depth-first order, the given ones included.
export function* walk(forms: readonly Form[]): Generator<Form> {
  for (const f of forms) {
    yield f;
    yield* walk(kids(f));
  }
}

// The form a wrapper stands for: quote, syntax quote, metadata and var quote are looked through.
export function unwrap(f: Form): Form {
  if (f.t === 'quote' || f.t === 'syntax-quote' || f.t === 'var') return unwrap(f.children[0]);
  if (f.t === 'meta') return unwrap(f.children[1]);
  return f;
}

// Branches of a reader conditional flatten to every platform's form, so an adapter sees both.
export function flatChildren(f: Form): Form[] {
  return kids(f).flatMap((c) => {
    const u = unwrap(c);
    if (u.t !== 'cond') return [c];
    return u.children.filter((_, k) => k % 2 === 1).flatMap((x) => (unwrap(x).t === 'cond' ? flatChildren(unwrap(x)) : [x]));
  });
}

export const contains = (outer: Pos, row: number, col: number): boolean =>
  (row > outer.row || (row === outer.row && col >= outer.col)) && (row < outer.endRow || (row === outer.endRow && col < outer.endCol));

export const at = (f: Form, row: number, col: number): boolean => f.row === row && f.col === col;

// The innermost form starting exactly at (row, col).
export function formAt(forms: readonly Form[], row: number, col: number): Form | undefined {
  for (const f of forms) {
    if (!contains(f, row, col)) continue;
    if (at(f, row, col)) return f;
    return formAt(kids(f), row, col);
  }
  return undefined;
}
