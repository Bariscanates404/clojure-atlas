// The optional project file .clojure-atlas.edn: project-specific semantics the generic adapters cannot guess.
// Every key is optional; an unknown key or a value of the wrong shape is an error that names it.
import { readForms, unwrap, type Form } from './reader.ts';

export interface RouteAuthz {
  // route-data key holding the check, e.g. :authz
  key: string;
  // keys inside it: the permission (keyword, set = any of, vector = all of), the exemption reason, the scope
  permission?: string;
  exempt?: string;
  scope?: string;
  // key holding a second authz map that satisfies the same check: {:permission :a :or {:permission :b}}
  alternative?: string;
}

export interface ProjectConfig {
  // extra clj-kondo :lint-as pairs (macros that define vars, wrappers of re-frame registration fns)
  lintAs: Record<string, string>;
  routeAuthz?: RouteAuthz;
  // middleware taking the permission as its argument: [wrap-permission :edit] in a :middleware chain
  permissionMiddleware: string[];
  // functions that check the permission given as a keyword argument: (require-permission! req :edit)
  permissionFns: string[];
  // project macros used like compojure's: {my.app/GET* compojure.core/GET}
  routeMacros: Record<string, string>;
}

export const EMPTY_CONFIG: ProjectConfig = { lintAs: {}, permissionMiddleware: [], permissionFns: [], routeMacros: {} };

export class ConfigError extends Error {}

type Edn = string | Edn[] | { [k: string]: Edn };

// Keywords keep their colon, symbols and strings become plain strings, sequences arrays, maps objects.
export function ednValue(f: Form): Edn {
  const u = unwrap(f);
  if (u.t === 'map') {
    const xs = u.children;
    const out: Record<string, Edn> = {};
    for (let k = 0; k + 1 < xs.length; k += 2) out[String(ednValue(xs[k]))] = ednValue(xs[k + 1]);
    return out;
  }
  if ('children' in u) return u.children.map(ednValue);
  return u.text;
}

const fail = (msg: string): never => {
  throw new ConfigError(`.clojure-atlas.edn: ${msg}`);
};

const symbolMap = (v: Edn, key: string): Record<string, string> => {
  if (typeof v !== 'object' || Array.isArray(v)) return fail(`${key} must be a map of symbol to symbol`);
  for (const [k, x] of Object.entries(v)) if (typeof x !== 'string' || !k.includes('/') || !x.includes('/')) fail(`${key} entry ${k} must map a qualified symbol to a qualified symbol`);
  return v as Record<string, string>;
};

const symbolList = (v: Edn, key: string): string[] => {
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string' && x.includes('/'))) return fail(`${key} must be a vector of qualified symbols`);
  return v as string[];
};

const keyword = (v: Edn | undefined, key: string): string | undefined => {
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || !v.startsWith(':')) return fail(`${key} must be a keyword`);
  return v;
};

export function parseConfig(text: string): ProjectConfig {
  const read = readForms(text);
  if (read.error) fail(`line ${read.error.row}: ${read.error.message}`);
  if (read.forms.length !== 1 || unwrap(read.forms[0]).t !== 'map') fail('must hold one map');
  const doc = ednValue(read.forms[0]) as Record<string, Edn>;
  const config: ProjectConfig = { ...EMPTY_CONFIG };
  for (const [k, v] of Object.entries(doc)) {
    if (k === ':lint-as') config.lintAs = symbolMap(v, k);
    else if (k === ':route-macros') config.routeMacros = symbolMap(v, k);
    else if (k === ':permission-middleware') config.permissionMiddleware = symbolList(v, k);
    else if (k === ':permission-fns') config.permissionFns = symbolList(v, k);
    else if (k === ':route-authz') {
      if (typeof v !== 'object' || Array.isArray(v)) fail(':route-authz must be a map');
      const m = v as Record<string, Edn>;
      for (const x of Object.keys(m)) if (![':key', ':permission', ':exempt', ':scope', ':alternative'].includes(x)) fail(`:route-authz has an unknown key ${x}`);
      const key = keyword(m[':key'], ':route-authz :key') ?? fail(':route-authz needs :key');
      const permission = keyword(m[':permission'], ':route-authz :permission');
      const exempt = keyword(m[':exempt'], ':route-authz :exempt');
      const scope = keyword(m[':scope'], ':route-authz :scope');
      const alternative = keyword(m[':alternative'], ':route-authz :alternative');
      config.routeAuthz = { key, ...(permission ? { permission } : {}), ...(exempt ? { exempt } : {}), ...(scope ? { scope } : {}), ...(alternative ? { alternative } : {}) };
    } else fail(`unknown key ${k}`);
  }
  return config;
}

// Whether the config says how this project authorizes routes, so a route without a check means something.
export const declaresAuthz = (c: ProjectConfig): boolean => !!c.routeAuthz || c.permissionMiddleware.length > 0 || c.permissionFns.length > 0;
