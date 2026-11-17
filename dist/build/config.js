// The optional project file .clojure-atlas.edn: project-specific semantics the generic adapters cannot guess.
// Every key is optional; an unknown key or a value of the wrong shape is an error that names it.
import { readForms, unwrap } from "./reader.js";
export const EMPTY_CONFIG = { lintAs: {}, permissionMiddleware: [], permissionFns: [], routeMacros: {}, selectorPrefixes: [] };
export class ConfigError extends Error {
}
const fail = (msg) => {
    throw new ConfigError(`.clojure-atlas.edn: ${msg}`);
};
// the key a #:ns{} map gives an unqualified keyword or symbol: :k becomes :ns/k, s becomes ns/s
const qualified = (ns, key) => (key.startsWith(':') ? `:${ns}/${key.slice(1)}` : `${ns}/${key}`);
// Keywords keep their colon, symbols and strings become plain strings, sequences arrays, maps objects. A map key
// given twice is an error (Clojure's reader refuses it too), and #:ns{...} qualifies the keys it holds.
export function ednValue(f) {
    const u = unwrap(f);
    if (u.t === 'map') {
        const xs = u.children;
        const out = {};
        for (let k = 0; k + 1 < xs.length; k += 2) {
            const bare = String(ednValue(xs[k]));
            const key = u.ns && (xs[k].t === 'keyword' || xs[k].t === 'symbol') && !bare.includes('/') ? qualified(u.ns, bare) : bare;
            if (Object.hasOwn(out, key))
                fail(`duplicate key ${key}`);
            out[key] = ednValue(xs[k + 1]);
        }
        return out;
    }
    if ('children' in u)
        return u.children.map(ednValue);
    return u.text;
}
const symbolMap = (v, key) => {
    if (typeof v !== 'object' || Array.isArray(v))
        return fail(`${key} must be a map of symbol to symbol`);
    for (const [k, x] of Object.entries(v))
        if (typeof x !== 'string' || !k.includes('/')
            || !x.includes('/'))
            fail(`${key} entry ${k} must map a qualified symbol to a qualified symbol`);
    return v;
};
const symbolList = (v, key) => {
    if (!Array.isArray(v) || !v.every((x) => typeof x === 'string' && x.includes('/')))
        return fail(`${key} must be a vector of qualified symbols`);
    return v;
};
const keyword = (v, key) => {
    if (v === undefined)
        return undefined;
    if (typeof v !== 'string' || !v.startsWith(':'))
        return fail(`${key} must be a keyword`);
    return v;
};
export function parseConfig(text) {
    const read = readForms(text);
    if (read.error)
        fail(`line ${read.error.row}: ${read.error.message}`);
    if (read.forms.length !== 1 || unwrap(read.forms[0]).t !== 'map')
        fail('must hold one map');
    const doc = ednValue(read.forms[0]);
    const config = { ...EMPTY_CONFIG };
    for (const [k, v] of Object.entries(doc)) {
        if (k === ':lint-as')
            config.lintAs = symbolMap(v, k);
        else if (k === ':route-macros')
            config.routeMacros = symbolMap(v, k);
        else if (k === ':permission-middleware')
            config.permissionMiddleware = symbolList(v, k);
        else if (k === ':permission-fns')
            config.permissionFns = symbolList(v, k);
        else if (k === ':selector-prefixes') {
            if (!Array.isArray(v) || !v.every((x) => typeof x === 'string' && /^[A-Za-z][\w-]*$/.test(x)))
                fail(`${k} must be a vector of class prefixes like "qa-"`);
            config.selectorPrefixes = v;
        }
        else if (k === ':route-authz') {
            if (typeof v !== 'object' || Array.isArray(v))
                fail(':route-authz must be a map');
            const m = v;
            for (const x of Object.keys(m))
                if (![':key', ':permission', ':exempt', ':scope',
                    ':alternative'].includes(x))
                    fail(`:route-authz has an unknown key ${x}`);
            const key = keyword(m[':key'], ':route-authz :key') ?? fail(':route-authz needs :key');
            const permission = keyword(m[':permission'], ':route-authz :permission');
            const exempt = keyword(m[':exempt'], ':route-authz :exempt');
            const scope = keyword(m[':scope'], ':route-authz :scope');
            const alternative = keyword(m[':alternative'], ':route-authz :alternative');
            config.routeAuthz = { key, ...(permission ? { permission } : {}), ...(exempt ? { exempt } : {}), ...(scope ? { scope } : {}),
                ...(alternative ? { alternative } : {}) };
        }
        else
            fail(`unknown key ${k}`);
    }
    return config;
}
// Whether the config says how this project authorizes routes, so a route without a check means something.
export const declaresAuthz = (c) => !!c.routeAuthz || c.permissionMiddleware.length > 0 || c.permissionFns.length > 0;
