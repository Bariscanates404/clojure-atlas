// A Clojure reader that keeps positions: rows and columns are 1-based and the end column is exclusive, the same
// convention clj-kondo's analysis uses, so a form and a kondo usage at the same place line up. It reads structure
// only (nothing is evaluated or resolved) and never throws: a syntax error ends the read and is reported.
const WS = /[\s,]/;
const TERMINATOR = /[\s,";@^`~()[\]{}\\]/;
const CLOSER = { '(': ')', '[': ']', '{': '}' };
class ReadError extends Error {
}
export function readForms(src) {
    let i = 0;
    let row = 1;
    let col = 1;
    const peek = (k = 0) => src[i + k];
    const next = () => {
        const c = src[i++];
        if (c === '\r' && src[i] === '\n')
            i++;
        if (c === '\n' || c === '\r') {
            row++;
            col = 1;
        }
        else
            col++;
        return c === '\r' ? '\n' : c;
    };
    const fail = (message) => {
        throw new ReadError(message);
    };
    const skipSpace = () => {
        while (i < src.length) {
            const c = peek();
            if (WS.test(c))
                next();
            else if (c === ';' || (c === '#' && peek(1) === '!'))
                while (i < src.length && peek() !== '\n' && peek() !== '\r')
                    next();
            else
                break;
        }
    };
    const token = () => {
        let s = '';
        while (i < src.length && !TERMINATOR.test(peek()))
            s += next();
        return s;
    };
    const stringBody = () => {
        let s = '';
        for (;;) {
            if (i >= src.length)
                fail('unterminated string');
            const c = next();
            if (c === '"')
                return s;
            if (c === '\\') {
                const e = next();
                s += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : e;
            }
            else
                s += c;
        }
    };
    const children = (close) => {
        const out = [];
        for (;;) {
            skipSpace();
            if (i >= src.length)
                fail(`missing ${close}`);
            if (peek() === close) {
                next();
                return out;
            }
            const f = read();
            if (f)
                out.push(f);
        }
    };
    // one form, or null for a discarded one (#_)
    const read = () => {
        skipSpace();
        if (i >= src.length)
            fail('unexpected end of input');
        const start = { row, col };
        const done = (f) => ({ ...start, ...f, endRow: row, endCol: col });
        const wrapped = (t, extra = {}) => {
            const inner = readPresent();
            return done({ t, children: [inner], ...extra });
        };
        const c = peek();
        if (c === '(' || c === '[' || c === '{') {
            next();
            return done({ t: c === '(' ? 'list' : c === '[' ? 'vector' : 'map', children: children(CLOSER[c]) });
        }
        if (c === ')' || c === ']' || c === '}')
            fail(`unexpected ${c}`);
        if (c === '"') {
            next();
            return done({ t: 'string', text: stringBody() });
        }
        if (c === '\\') {
            next();
            const first = next();
            return done({ t: 'char', text: /[A-Za-z0-9]/.test(first) ? first + token() : first });
        }
        if (c === "'")
            return next(), wrapped('quote');
        if (c === '`')
            return next(), wrapped('syntax-quote');
        if (c === '@')
            return next(), wrapped('deref');
        if (c === '~') {
            next();
            if (peek() === '@')
                return next(), wrapped('unquote-splicing');
            return wrapped('unquote');
        }
        const withMeta = () => {
            const meta = readPresent();
            const target = readPresent();
            return done({ t: 'meta', children: [meta, target] });
        };
        if (c === '^')
            return next(), withMeta();
        if (c === '#') {
            next();
            const d = peek();
            if (d === '{')
                return next(), done({ t: 'set', children: children('}') });
            if (d === '(')
                return next(), done({ t: 'fn', children: children(')') });
            if (d === '"')
                return next(), done({ t: 'regex', text: stringBody() });
            if (d === "'")
                return next(), wrapped('var');
            if (d === '=')
                return next(), wrapped('tagged', { tag: '=' });
            if (d === '^')
                return next(), withMeta();
            if (d === '_') {
                next();
                readPresent();
                return null;
            }
            if (d === '#') {
                next();
                return done({ t: 'other', text: `##${token()}` });
            }
            if (d === '?') {
                next();
                const splice = peek() === '@';
                if (splice)
                    next();
                skipSpace();
                if (peek() !== '(')
                    fail('reader conditional without a list');
                next();
                return done({ t: 'cond', children: children(')'), ...(splice ? { splice } : {}) });
            }
            if (d === ':') {
                next();
                const prefix = token();
                skipSpace();
                if (peek() !== '{')
                    fail('namespaced map without a map');
                next();
                return done({ t: 'map', ns: prefix, children: children('}') });
            }
            const tag = token();
            if (!tag)
                fail(`unknown dispatch #${d ?? ''}`);
            return wrapped('tagged', { tag });
        }
        const text = token();
        if (!text)
            fail(`unexpected ${c}`);
        if (text.startsWith(':'))
            return done({ t: 'keyword', text });
        if (/^[+-]?\d/.test(text))
            return done({ t: 'number', text });
        if (text === 'nil' || text === 'true' || text === 'false')
            return done({ t: 'other', text });
        return done({ t: 'symbol', text });
    };
    const readPresent = () => {
        for (;;) {
            const f = read();
            if (f)
                return f;
        }
    };
    const forms = [];
    try {
        for (;;) {
            skipSpace();
            if (i >= src.length)
                return { forms };
            const f = read();
            if (f)
                forms.push(f);
        }
    }
    catch (err) {
        if (!(err instanceof ReadError))
            throw err;
        return { forms, error: { row, col, message: err.message } };
    }
}
// The text of an atom (symbol, keyword, string, ...); collections and wrappers have none.
export const textOf = (f) => (f && 'text' in f ? f.text : undefined);
// Children of any form that has them (collections and wrappers alike).
export const kids = (f) => ('children' in f ? f.children : []);
// Every form in depth-first order, the given ones included.
export function* walk(forms) {
    for (const f of forms) {
        yield f;
        yield* walk(kids(f));
    }
}
// The form a wrapper stands for: quote, syntax quote, metadata and var quote are looked through.
export function unwrap(f) {
    if (f.t === 'quote' || f.t === 'syntax-quote' || f.t === 'var')
        return unwrap(f.children[0]);
    if (f.t === 'meta')
        return unwrap(f.children[1]);
    return f;
}
// The values a reader conditional can stand for, one per branch. A splicing one (#?@) contributes its branches'
// elements, a nested one flattens in turn.
const isCond = (f) => f.t === 'cond';
const branches = (cond) => cond.children.filter((_, k) => k % 2 === 1).flatMap((x) => {
    const u = unwrap(x);
    if (isCond(u))
        return branches(u);
    return cond.splice ? kids(u) : [x];
});
// The elements of a collection with its reader conditionals resolved. In a sequence every platform's branch is
// listed so an adapter sees both. In a map the slots pair up as key and value, so a conditional there is one slot
// holding its first branch; a splicing one still contributes whole pairs.
export function flatChildren(f) {
    return kids(f).flatMap((c) => {
        const u = unwrap(c);
        if (!isCond(u))
            return [c];
        const all = branches(u);
        return f.t === 'map' && !u.splice ? all.slice(0, 1) : all;
    });
}
export const contains = (outer, row, col) => (row > outer.row || (row === outer.row && col >= outer.col)) && (row < outer.endRow || (row === outer.endRow && col < outer.endCol));
export const at = (f, row, col) => f.row === row && f.col === col;
// The innermost form starting exactly at (row, col).
export function formAt(forms, row, col) {
    for (const f of forms) {
        if (!contains(f, row, col))
            continue;
        if (at(f, row, col))
            return f;
        return formAt(kids(f), row, col);
    }
    return undefined;
}
// The macro or function a list calls, without its namespace alias: p/let and async/go-loop read like let and go-loop.
export const headName = (f) => (f && f.t === 'list' ? textOf(f.children[0])?.replace(/^.*\//, '') : undefined);
const THREADING = new Set(['->', '->>', 'cond->', 'cond->>', 'some->', 'some->>', 'doto']);
// Whether the form at `index` of `parent` is a step the threaded value passes through: not the head, not the value
// that starts the thread, not a cond-> test and not an as-> form (which names its value explicitly).
export function isThreadStep(parent, index) {
    const head = parent.t === 'list' ? textOf(parent.children[0]) : undefined;
    if (!head || !THREADING.has(head))
        return false;
    return head.startsWith('cond') ? index >= 3 && index % 2 === 1 : index >= 2;
}
// (s/defn f :- Out [a :- A]), (mu/defn ...): a `:-` says the next form is a schema, not a parameter or a pattern.
export const isAnnotationMark = (f) => !!f && unwrap(f).t === 'keyword' && textOf(unwrap(f)) === ':-';
