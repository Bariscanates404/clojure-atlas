// Playwright page objects and tests, read with the analyzed project's own TypeScript (its compiler API; clojure-atlas
// ships none). Page objects are classes whose members hold literal locators; a test reaches a member when the type
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

function readProject(ts: Ts, root: string, dir: string, files: readonly string[]): PlaywrightProject {
  const abs = (f: string) => path.join(root, f);
  const configPath = ts.findConfigFile(abs(dir), ts.sys.fileExists);
  const options = configPath
    ? ts.getParsedCommandLineOfConfigFile(configPath, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined })?.options ?? {}
    : { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, allowJs: false };
  const program = ts.createProgram(files.map(abs), { ...options, noEmit: true });
  const checker = program.getTypeChecker();
  const rel = (sf: Node) => path.relative(root, sf.fileName).split(path.sep).join('/');
  const lineOf = (sf: Node, pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const literal = (n: Node): string | undefined => (n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : undefined);

  const classes0: (PageObject & { locates: boolean })[] = [];
  for (const sf of program.getSourceFiles()) {
    if (!files.includes(rel(sf)) || TEST_FILE.test(sf.fileName)) continue;
    const visit = (n: Node): void => {
      if (ts.isClassDeclaration(n) && n.name) {
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
            if (left && ts.isPropertyAccessExpression(left) && left.expression.kind === ts.SyntaxKind.ThisKeyword) added(left.name.text, lineOf(sf, x.getStart(sf)), lineOf(sf, x.getEnd()), inspect(x.right));
            ts.forEachChild(x, assigned);
          };
          if (ctor.body) assigned(ctor.body);
        }
        const base = n.heritageClauses?.find((h: Node) => h.token === ts.SyntaxKind.ExtendsKeyword)?.types?.[0]?.expression?.getText(sf);
        classes0.push({ name: n.name.text, file: rel(sf), line: lineOf(sf, n.getStart(sf)), ...(base ? { base } : {}), members, locates });
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }

  // a page object locates elements, or is the class one extends
  const bases = new Set(classes0.filter((c) => c.locates && c.base).map((c) => c.base));
  const pageObjects: PageObject[] = classes0.filter((c) => c.locates || bases.has(c.name)).map(({ locates: _, ...c }) => c);
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
  // expect(x), expect.soft(x) or expect.poll(x)
  const isExpectCall = (n: Node): boolean => {
    if (!ts.isCallExpression(n)) return false;
    const callee = n.expression;
    if (ts.isIdentifier(callee)) return callee.text === 'expect';
    return ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'expect' && ['soft', 'poll'].includes(callee.name.text);
  };
  // expect(<member access or its call>).not?.toX(...): the matcher
  const matcherOf = (n: Node): string | undefined => {
    let x = n;
    while (x.parent && !isExpectCall(x.parent)) {
      if (ts.isBlock(x.parent) || ts.isSourceFile(x.parent)) return undefined;
      x = x.parent;
    }
    let up = x.parent?.parent;
    while (up && ts.isPropertyAccessExpression(up)) {
      if (up.name.text !== 'not' && up.name.text !== 'soft') return up.name.text;
      up = up.parent;
    }
    return x.parent ? 'expect' : undefined;
  };

  // a title as written: a template keeps its literal parts, ${…} for each runtime part
  const titleOf = (n: Node): string | undefined => {
    if (!n) return undefined;
    if (ts.isTemplateExpression(n)) return n.head.text + n.templateSpans.map((sp: Node) => `\${…}${sp.literal.text}`).join('');
    // test.skip(({ browserName }) => ..., 'reason') takes a condition where a title would stand
    return ts.isArrowFunction(n) || ts.isFunctionExpression(n) ? undefined : literal(n) ?? '<dynamic title>';
  };
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
        const title = titleOf(n.arguments[0]);
        const body = n.arguments.find((a: Node) => ts.isArrowFunction(a) || ts.isFunctionExpression(a));
        if (head && TEST_FNS.has(head) && title !== undefined && body && props.includes('describe')) {
          ts.forEachChild(body, (c: Node) => visit(c, [...describe, title]));
          return;
        }
        if (head && TEST_FNS.has(head) && title !== undefined && body && !props.some((p) => SKIP_TEST_PROPS.has(p))) {
          const refs: TestRef[] = [];
          const scan = (x: Node): void => {
            if (ts.isPropertyAccessExpression(x) || ts.isIdentifier(x)) {
              const member = ts.isIdentifier(x) ? boundMember(x) : memberOf(x);
              if (member) {
                const matcher = matcherOf(x);
                refs.push({ member, line: lineOf(sf, x.getStart(sf)), ...(matcher ? { matcher } : {}) });
              }
            }
            ts.forEachChild(x, scan);
          };
          scan(body);
          tests.push({ file: rel(sf), line: lineOf(sf, n.getStart(sf)), endLine: lineOf(sf, n.getEnd()), title, describe, refs });
          return;
        }
      }
      ts.forEachChild(n, (c: Node) => visit(c, describe));
    };
    visit(sf, []);
  }
  return { dir, typescript: ts.version, pageObjects, tests };
}

// Every Playwright project in the repo (a package.json naming @playwright/test), read with its own TypeScript.
export function readPlaywright(root: string, packageJsons: readonly string[], typescript: readonly string[], load: (pkg: string) => Ts = (pkg) => createRequire(path.join(root, pkg))('typescript')): Playwright {
  const out: Playwright = { projects: [], skipped: [] };
  for (const pkg of packageJsons) {
    const text = readFileSync(path.join(root, pkg), 'utf8');
    if (!text.includes('"@playwright/test"')) continue;
    const dir = path.posix.dirname(pkg);
    let ts: Ts;
    try {
      ts = load(pkg);
    } catch (err) {
      out.skipped.push(`${dir}: typescript is not installed there (${(err as NodeJS.ErrnoException).code ?? 'error'})`);
      continue;
    }
    if (typeof ts.createProgram !== 'function') {
      out.skipped.push(`${dir}: typescript ${String(ts.version)} has no compiler API (TypeScript 7 removed it)`);
      continue;
    }
    out.projects.push(readProject(ts, root, dir, typescript.filter((f) => dir === '.' || f.startsWith(`${dir}/`))));
  }
  return out;
}
