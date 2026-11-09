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

// .qa-x class tokens and [data-testid="x"] in a CSS selector string.
export function selectorsIn(css: string): Selector[] {
  const out: Selector[] = [];
  for (const m of css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) out.push({ kind: 'class', value: m[1] });
  for (const m of css.matchAll(/\[data-testid=["']?([^"'\]]+)["']?\]/g)) out.push({ kind: 'testid', value: m[1] });
  return out;
}

export function readProject(ts: Ts, root: string, dir: string, files: readonly string[]): PlaywrightProject {
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
        for (const m of n.members) {
          if (!m.name || !(ts.isPropertyDeclaration(m) || ts.isMethodDeclaration(m) || ts.isGetAccessorDeclaration(m))) continue;
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
          scan(m);
          members.push({ name: m.name.getText(sf), line: lineOf(sf, m.getStart(sf)), endLine: lineOf(sf, m.getEnd()), selectors, uses: [...uses].sort() });
        }
        const base = n.heritageClauses?.[0]?.types?.[0]?.expression?.getText(sf);
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
  const memberOf = (access: Node): string | undefined => {
    // the declaration's own name: the symbol of `export default class X` is named "default"
    const decl = checker.getTypeAtLocation(access.expression)?.getSymbol?.()?.declarations?.[0];
    const cls = decl && ts.isClassDeclaration(decl) ? decl.name?.text : undefined;
    return cls && classes.get(cls)?.has(access.name.text) ? `${cls}.${access.name.text}` : undefined;
  };
  // const { qaX } = page; qaX(): an identifier bound by destructuring a page object names its member
  const boundMember = (id: Node): string | undefined => {
    const decl = checker.getSymbolAtLocation(id)?.valueDeclaration;
    if (!decl || !ts.isBindingElement(decl) || !ts.isObjectBindingPattern(decl.parent) || decl.name === id) return undefined;
    const source = checker.getTypeAtLocation(decl.parent)?.getSymbol?.()?.declarations?.[0];
    const cls = source && ts.isClassDeclaration(source) ? source.name?.text : undefined;
    const name = (decl.propertyName ?? decl.name).getText();
    return cls && classes.get(cls)?.has(name) ? `${cls}.${name}` : undefined;
  };
  // expect(<member access or its call>).not?.toX(...): the matcher
  const matcherOf = (n: Node): string | undefined => {
    let x = n;
    while (x.parent && !(ts.isCallExpression(x.parent) && ts.isIdentifier(x.parent.expression) && x.parent.expression.text === 'expect')) {
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
    return literal(n) ?? '<dynamic title>';
  };
  const tests: BrowserTest[] = [];
  for (const sf of program.getSourceFiles()) {
    if (!files.includes(rel(sf)) || !TEST_FILE.test(sf.fileName)) continue;
    const visit = (n: Node, describe: string[]): void => {
      if (ts.isCallExpression(n)) {
        const callee = n.expression;
        const head = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) ? callee.expression.text : undefined;
        const prop = ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined;
        const title = titleOf(n.arguments[0]);
        const body = n.arguments.find((a: Node) => ts.isArrowFunction(a) || ts.isFunctionExpression(a));
        if (head && TEST_FNS.has(head) && title !== undefined && body && prop === 'describe') {
          ts.forEachChild(body, (c: Node) => visit(c, [...describe, title]));
          return;
        }
        if (head && TEST_FNS.has(head) && title !== undefined && body && !SKIP_TEST_PROPS.has(prop ?? '')) {
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
