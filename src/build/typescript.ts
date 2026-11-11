// Playwright page objects and tests, read with the TypeScript compiler API of clojure-atlas's own install (an optional
// peer dependency; never the analyzed repository's copy, which would run that repository's code during a build). Page objects are classes whose
// members hold literal locators; a test reaches a member when the type
// checker proves the receiver is that class. Only exact literals count: a selector built at runtime is not followed.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

export interface Selector {
  kind: 'class' | 'testid';
  value: string;
}

export interface PageObjectMember {
  name: string;
  line: number;
  endLine: number;
  selectors: Selector[];
  // other members of the same class it uses
  uses: string[];
}

export interface PageObject {
  name: string;
  file: string;
  line: number;
  base?: string;
  members: PageObjectMember[];
}

export interface TestRef {
  // "Class.member"
  member: string;
  line: number;
  // the expect matcher when the member is asserted on
  matcher?: string;
}

export interface BrowserTest {
  file: string;
  line: number;
  endLine: number;
  title: string;
  describe: string[];
  refs: TestRef[];
}

export interface PlaywrightProject {
  dir: string;
  typescript: string;
  pageObjects: PageObject[];
  tests: BrowserTest[];
}

export interface Playwright {
  projects: PlaywrightProject[];
  // projects found but not read, with the reason
  skipped: string[];
}

// The compiler API is loaded at runtime from the project; this module is the one place that touches it.
type Ts = any;
type Node = any;

const TEST_FILE = /\.(spec|test)\.ts$/;
const LOCATOR_FNS = /^(locator|getBy[A-Z]\w*|\$|\$\$|frameLocator)$/;
const TEST_FNS = new Set(['test', 'it']);
const SKIP_TEST_PROPS = new Set(['describe', 'beforeEach', 'afterEach', 'beforeAll', 'afterAll', 'use', 'step', 'extend', 'info', 'setTimeout', 'slow']);

// Playwright selector engines whose text is not CSS: text=Save.pdf, xpath=..., //div, role=button[name="a.b"]
const OTHER_ENGINE = /^\s*((text|xpath|id|role|internal:[\w-]+)=|\/\/)/;

// .x class tokens and [data-testid="x"] in a CSS selector string. A dot inside quotes or an attribute test is not
// a class, and a part written for another engine has none.
export function selectorsIn(css: string): Selector[] {
  const out: Selector[] = [];
  const cssParts = css.split('>>').filter((part) => !OTHER_ENGINE.test(part)).join(' ');
  const bare = cssParts.replace(/"[^"]*"|'[^']*'/g, '""').replace(/\[[^\]]*\]/g, '[]');
  for (const m of bare.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) out.push({ kind: 'class', value: m[1] });
  for (const m of css.matchAll(/\[data-testid=["']?([^"'\]]+)["']?\]/g)) out.push({ kind: 'testid', value: m[1] });
  return out;
}

// What reading one project needs from the compiler: the program and the helpers that turn its nodes into repo paths and lines.
interface Reader {
  ts: Ts;
  files: readonly string[];
  program: Node;
  checker: Node;
  rel: (sf: Node) => string;
  lineOf: (sf: Node, pos: number) => number;
  literal: (n: Node) => string | undefined;
}

// The members of a page object class and whether its code locates elements: the locators and sibling members each one names.
function classMembers(r: Reader, sf: Node, n: Node): { members: PageObjectMember[]; locates: boolean } {
  const { ts, lineOf, literal } = r;
  const names = new Set<string>(n.members.map((m: Node) => m.name?.getText?.(sf)).filter(Boolean));
  const members: PageObjectMember[] = [];
  let locates = false;
  // the locators and sibling members a piece of code names
  const inspect = (root: Node) => {
    const selectors: Selector[] = [];
    const uses = new Set<string>();
    const scan = (x: Node): void => {
      if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression)) {
        const fn = x.expression.name.text;
        if (LOCATOR_FNS.test(fn)) locates = true;
        const arg = literal(x.arguments[0]);
        if (arg !== undefined && (fn === 'locator' || fn === '$' || fn === '$$')) selectors.push(...selectorsIn(arg));
        if (arg !== undefined && fn === 'getByTestId') selectors.push({ kind: 'testid', value: arg });
      }
      if (ts.isPropertyAccessExpression(x) && x.expression.kind === ts.SyntaxKind.ThisKeyword && names.has(x.name.text)) uses.add(x.name.text);
      ts.forEachChild(x, scan);
    };
    scan(root);
    return { selectors, uses };
  };
  const added = (name: string, line: number, endLine: number, found: { selectors: Selector[]; uses: Set<string> }) => {
    const own = members.find((m) => m.name === name);
    if (!own) members.push({ name, line, endLine, selectors: found.selectors, uses: [...found.uses].sort() });
    else {
      own.selectors.push(...found.selectors);
      own.uses = [...new Set([...own.uses, ...found.uses])].sort();
    }
  };
  for (const m of n.members) {
    if (!m.name || !(ts.isPropertyDeclaration(m) || ts.isMethodDeclaration(m) || ts.isGetAccessorDeclaration(m))) continue;
    added(m.name.getText(sf), lineOf(sf, m.getStart(sf)), lineOf(sf, m.getEnd()), inspect(m));
  }
  // this.x = page.locator(...) in the constructor belongs to member x
  for (const ctor of n.members.filter(ts.isConstructorDeclaration)) {
    const assigned = (x: Node): void => {
      const left = ts.isBinaryExpression(x) && x.operatorToken.kind === ts.SyntaxKind.EqualsToken ? x.left : undefined;
      if (left && ts.isPropertyAccessExpression(left) && left.expression.kind === ts.SyntaxKind.ThisKeyword) added(left.name.text,
        lineOf(sf, x.getStart(sf)), lineOf(sf, x.getEnd()), inspect(x.right));
      ts.forEachChild(x, assigned);
    };
    if (ctor.body) assigned(ctor.body);
  }
  return { members, locates };
}

// The classes of the page object files that locate elements, or are the base of one that does.
function pageObjectsOf(r: Reader): PageObject[] {
  const { ts, files, program, rel, lineOf } = r;
  const classes0: (PageObject & { locates: boolean })[] = [];
  for (const sf of program.getSourceFiles()) {
    if (!files.includes(rel(sf)) || TEST_FILE.test(sf.fileName)) continue;
    const visit = (n: Node): void => {
      if (ts.isClassDeclaration(n) && n.name) {
        const { members, locates } = classMembers(r, sf, n);
        const base = n.heritageClauses?.find((h: Node) => h.token === ts.SyntaxKind.ExtendsKeyword)?.types?.[0]?.expression?.getText(sf);
        classes0.push({ name: n.name.text, file: rel(sf), line: lineOf(sf, n.getStart(sf)), ...(base ? { base } : {}), members, locates });
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  // a page object locates elements, or is the class one extends
  const bases = new Set(classes0.filter((c) => c.locates && c.base).map((c) => c.base));
  return classes0.filter((c) => c.locates || bases.has(c.name)).map(({ locates: _, ...c }) => c);
}

// The page object member an expression names: through the class that declares the property, or a destructured binding.
function memberResolver(r: Reader,
  pageObjects: readonly PageObject[]): { memberOf: (access: Node) => string | undefined; boundMember: (id: Node) => string | undefined } {
  const { ts, checker } = r;
  const classes = new Map(pageObjects.map((p) => [p.name, new Set(p.members.map((m) => m.name))]));
  // the class that declares a property, which for an inherited one is its base class; named by the declaration itself,
  // since the symbol of `export default class X` is called "default"
  const declaringClass = (prop: Node | undefined): string | undefined => {
    const decl = prop?.valueDeclaration?.parent;
    return decl && ts.isClassDeclaration(decl) ? decl.name?.text : undefined;
  };
  const pageMember = (cls: string | undefined, name: string) => (cls && classes.get(cls)?.has(name) ? `${cls}.${name}` : undefined);
  const memberOf = (access: Node): string | undefined => pageMember(declaringClass(checker.getSymbolAtLocation(access.name)), access.name.text);
  // const { fieldX } = page; fieldX(): an identifier bound by destructuring a page object names its member
  const boundMember = (id: Node): string | undefined => {
    const decl = checker.getSymbolAtLocation(id)?.valueDeclaration;
    if (!decl || !ts.isBindingElement(decl) || !ts.isObjectBindingPattern(decl.parent) || decl.name === id) return undefined;
    const name = (decl.propertyName ?? decl.name).getText();
    return pageMember(declaringClass(checker.getPropertyOfType(checker.getTypeAtLocation(decl.parent), name)), name);
  };
  return { memberOf, boundMember };
}

// expect(x), expect.soft(x) or expect.poll(x)
function isExpectCall(ts: Ts, n: Node): boolean {
  if (!ts.isCallExpression(n)) return false;
  const callee = n.expression;
  if (ts.isIdentifier(callee)) return callee.text === 'expect';
  return ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'expect' && ['soft',
    'poll'].includes(callee.name.text);
}

// expect(<member access or its call>).not?.toX(...): the matcher
function matcherOf(ts: Ts, n: Node): string | undefined {
  let x = n;
  while (x.parent && !isExpectCall(ts, x.parent)) {
    if (ts.isBlock(x.parent) || ts.isSourceFile(x.parent)) return undefined;
    x = x.parent;
  }
  let up = x.parent?.parent;
  while (up && ts.isPropertyAccessExpression(up)) {
    if (up.name.text !== 'not' && up.name.text !== 'soft') return up.name.text;
    up = up.parent;
  }
  return x.parent ? 'expect' : undefined;
}

// a title as written: a template keeps its literal parts, ${…} for each runtime part
function titleOf(r: Reader, n: Node): string | undefined {
  const { ts, literal } = r;
  if (!n) return undefined;
  if (ts.isTemplateExpression(n)) return n.head.text + n.templateSpans.map((sp: Node) => `\${…}${sp.literal.text}`).join('');
  // test.skip(({ browserName }) => ..., 'reason') takes a condition where a title would stand
  return ts.isArrowFunction(n) || ts.isFunctionExpression(n) ? undefined : literal(n) ?? '<dynamic title>';
}

// The page object members a test body names, each with the matcher it is asserted with.
function refsIn(r: Reader, sf: Node, body: Node, resolve: ReturnType<typeof memberResolver>): TestRef[] {
  const { ts, lineOf } = r;
  const refs: TestRef[] = [];
  const scan = (x: Node): void => {
    if (ts.isPropertyAccessExpression(x) || ts.isIdentifier(x)) {
      const member = ts.isIdentifier(x) ? resolve.boundMember(x) : resolve.memberOf(x);
      if (member) {
        const matcher = matcherOf(ts, x);
        refs.push({ member, line: lineOf(sf, x.getStart(sf)), ...(matcher ? { matcher } : {}) });
      }
    }
    ts.forEachChild(x, scan);
  };
  scan(body);
  return refs;
}

// The tests of the spec files, with the page object members each one names.
function testsOf(r: Reader, resolve: ReturnType<typeof memberResolver>): BrowserTest[] {
  const { ts, files, program, rel, lineOf } = r;
  const tests: BrowserTest[] = [];
  for (const sf of program.getSourceFiles()) {
    if (!files.includes(rel(sf)) || !TEST_FILE.test(sf.fileName)) continue;
    const visit = (n: Node, describe: string[]): void => {
      if (ts.isCallExpression(n)) {
        const callee = n.expression;
        // test.describe.serial(...): the identifier at the root and every property name after it
        const props: string[] = [];
        let root = callee;
        while (ts.isPropertyAccessExpression(root)) {
          props.unshift(root.name.text);
          root = root.expression;
        }
        const head = ts.isIdentifier(root) ? root.text : undefined;
        const title = titleOf(r, n.arguments[0]);
        const body = n.arguments.find((a: Node) => ts.isArrowFunction(a) || ts.isFunctionExpression(a));
        if (head && TEST_FNS.has(head) && title !== undefined && body && props.includes('describe')) {
          ts.forEachChild(body, (c: Node) => visit(c, [...describe, title]));
          return;
        }
        if (head && TEST_FNS.has(head) && title !== undefined && body && !props.some((p) => SKIP_TEST_PROPS.has(p))) {
          tests.push({ file: rel(sf), line: lineOf(sf, n.getStart(sf)), endLine: lineOf(sf, n.getEnd()), title, describe, refs: refsIn(r, sf, body, resolve) });
          return;
        }
      }
      ts.forEachChild(n, (c: Node) => visit(c, describe));
    };
    visit(sf, []);
  }
  return tests;
}

const PLAYWRIGHT = '@playwright/test';
// A name no project file has; the declaration below is served under it from memory and never written to the repository.
const PLAYWRIGHT_TYPES_FILE = '__clojure-atlas-playwright-test.d.ts';

// Stands in for @playwright/test where the project has no node_modules (a clean checkout, a CI build): without it
// `test.extend<{ loginPage: LoginPage }>()` is untyped and a fixture has no class, so a test loses its page object links.
// Fixtures are listed by name on purpose: an index signature would turn every property of `F & T` into any.
const PLAYWRIGHT_TYPES = `declare module '${PLAYWRIGHT}' {
  type Body<F> = (fixtures: F, testInfo: any) => any;
  interface Declare<F> {
    (title: string, body: Body<F>): void;
    (title: string, details: any, body: Body<F>): void;
  }
  interface Hook<F> {
    (body: Body<F>): void;
    (title: string, body: Body<F>): void;
  }
  // test.skip('title', body) declares a test; test.skip(condition, 'reason') and test.skip() do not
  type Modifier<F> = Declare<F> & ((...args: any[]) => void);
  type Merged<L> = L extends [TestType<infer F>, ...infer Rest] ? F & Merged<Rest> : {};
  interface BuiltIn {
    page: any; context: any; browser: any; browserName: any; request: any; playwright: any;
    baseURL: any; viewport: any; isMobile: any; hasTouch: any; locale: any; storageState: any;
  }
  export interface TestType<F> extends Declare<F> {
    extend<T = {}, W = {}>(fixtures: any): TestType<F & T & W>;
    only: Declare<F>;
    skip: Modifier<F>;
    fixme: Modifier<F>;
    fail: Modifier<F>;
    beforeAll: Hook<F>;
    beforeEach: Hook<F>;
    afterAll: Hook<F>;
    afterEach: Hook<F>;
    describe: any; step: any; use: any; info: any; slow: any; setTimeout: any; expect: any;
  }
  export const test: TestType<BuiltIn>;
  export default test;
  export function mergeTests<L extends any[]>(...tests: L): TestType<Merged<L>>;
  export const expect: any, mergeExpects: any, defineConfig: any, devices: any;
  export const chromium: any, firefox: any, webkit: any, request: any, selectors: any;
  export type Page = any;
  export type Frame = any;
  export type Locator = any;
  export type FrameLocator = any;
  export type Browser = any;
  export type BrowserContext = any;
  export type APIRequestContext = any;
  export type APIResponse = any;
  export type Request = any;
  export type Response = any;
  export type Route = any;
  export type Download = any;
  export type Dialog = any;
  export type TestInfo = any;
  export type PlaywrightTestConfig = any;
}
`;

// The program of one Playwright project. An ambient declaration of a module takes precedence over the installed package,
// so the stand-in is added (as one more root file) only where the project does not resolve @playwright/test itself.
function programOf(ts: Ts, dir: string, rootNames: string[], options: object): Node {
  if (ts.resolveModuleName(PLAYWRIGHT, path.join(dir, 'index.ts'), options, ts.sys).resolvedModule) return ts.createProgram(rootNames, options);
  const standIn = path.resolve(dir, PLAYWRIGHT_TYPES_FILE);
  const host = ts.createCompilerHost(options);
  const fromDisk = host.getSourceFile;
  host.getSourceFile = (file: string, ...rest: unknown[]) => (path.resolve(file) === standIn
    ? ts.createSourceFile(file, PLAYWRIGHT_TYPES, ts.ScriptTarget.ES2022)
    : fromDisk.call(host, file, ...rest));
  return ts.createProgram([...rootNames, standIn], options, host);
}

function readProject(ts: Ts, root: string, dir: string, files: readonly string[]): PlaywrightProject {
  const abs = (f: string) => path.join(root, f);
  const configPath = ts.findConfigFile(abs(dir), ts.sys.fileExists);
  const options = configPath
    ? ts.getParsedCommandLineOfConfigFile(configPath, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined })?.options ?? {}
    : { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, allowJs: false };
  const program = programOf(ts, abs(dir), files.map(abs), { ...options, noEmit: true });
  const r: Reader = {
    ts, files, program, checker: program.getTypeChecker(),
    rel: (sf) => path.relative(root, sf.fileName).split(path.sep).join('/'),
    lineOf: (sf, pos) => sf.getLineAndCharacterOfPosition(pos).line + 1,
    literal: (n) => (n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : undefined),
  };
  const pageObjects = pageObjectsOf(r);
  return { dir, typescript: ts.version, pageObjects, tests: testsOf(r, memberResolver(r, pageObjects)) };
}

// The compiler is resolved from this package's own location, so a clone's node_modules (or a parent directory of it) is
// never searched.
const ownTypeScript = (): Ts => createRequire(import.meta.url)('typescript');

// Every Playwright project in the repo (a package.json naming @playwright/test), read with clojure-atlas's own TypeScript.
export function readPlaywright(root: string, packageJsons: readonly string[], typescript: readonly string[],
  load: (pkg: string) => Ts = ownTypeScript): Playwright {
  const out: Playwright = { projects: [], skipped: [] };
  for (const pkg of packageJsons) {
    const text = readFileSync(path.join(root, pkg), 'utf8');
    if (!text.includes(`"${PLAYWRIGHT}"`)) continue;
    const dir = path.posix.dirname(pkg);
    let ts: Ts;
    try {
      ts = load(pkg);
    } catch (err) {
      out.skipped.push(`${dir}: no TypeScript 5 compiler in clojure-atlas's own install (${(err as NodeJS.ErrnoException).code ?? 'error'}); `
        + 'install typescript@5 beside clojure-atlas to read browser tests');
      continue;
    }
    if (typeof ts.createProgram !== 'function') {
      out.skipped.push(`${dir}: typescript ${String(ts.version)} in clojure-atlas's own install has no compiler API (TypeScript 7 removed it); `
        + 'install typescript@5 beside clojure-atlas');
      continue;
    }
    out.projects.push(readProject(ts, root, dir, typescript.filter((f) => dir === '.' || f.startsWith(`${dir}/`))));
  }
  return out;
}
