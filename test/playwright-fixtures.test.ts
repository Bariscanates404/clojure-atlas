// Page objects handed to a test as Playwright fixtures (`test.extend<{ loginPage: LoginPage }>`): the test's links to
// their members must not depend on the analyzed project having its node_modules installed. A clean checkout and a CI
// build have none, so `@playwright/test` does not resolve there.
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { readPlaywright } from '../src/build/typescript.ts';
import { buildFixture, fixtureDir, rowsText } from './helpers/atlas-fixture.ts';

const FIXTURE = 'browser-fixtures';

// title -> the page object members the test names, in source order, with the matcher where one is asserted on
function linksOf(root: string): Record<string, string[]> {
  const files = (readdirSync(root, { recursive: true }) as string[]).map((f) => f.split(path.sep).join('/'))
    .filter((f) => f.endsWith('.ts') && !f.includes('node_modules/')).sort();
  const out = readPlaywright(root, ['e2e/package.json'], files);
  assert.deepEqual(out.skipped, []);
  return Object.fromEntries(out.projects[0].tests.map((t) => [t.title, t.refs.map((r) => (r.matcher ? `${r.member} ${r.matcher}` : r.member))]));
}

// A stand-in for an installed @playwright/test, shaped like the real declarations (test and worker arguments kept
// apart) but of a version that exports no mergeTests: what tells it apart from the declaration clojure-atlas supplies.
const INSTALLED = `export interface Locator { locator(selector: string): Locator; click(): Promise<void>; first(): Locator }
export interface Page {
  goto(url: string): Promise<void>;
  locator(selector: string): Locator;
  getByTestId(id: string): Locator;
  keyboard: { type(text: string): Promise<void> };
}
type Body<A> = (args: A, testInfo: object) => Promise<void> | void;
export interface TestType<TestArgs, WorkerArgs> {
  (title: string, body: Body<TestArgs & WorkerArgs>): void;
  (title: string, details: { tag?: string }, body: Body<TestArgs & WorkerArgs>): void;
  skip(title: string, body: Body<TestArgs & WorkerArgs>): void;
  describe(title: string, body: () => void): void;
  beforeEach(body: Body<TestArgs & WorkerArgs>): void;
  step<T>(title: string, body: () => Promise<T>): Promise<T>;
  extend<T extends {}, W extends {} = {}>(fixtures: object): TestType<TestArgs & T, WorkerArgs & W>;
}
export const test: TestType<{ page: Page }, {}>;
export const expect: (actual: unknown) => { toBeVisible(): Promise<void>; toHaveText(text: string): Promise<void> };
`;

// The fixture copied to a temporary directory with the package installed: node_modules cannot be committed.
function withInstalledPlaywright(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'atlas-pw-installed-'));
  cpSync(fixtureDir(FIXTURE), root, { recursive: true });
  const pkg = path.join(root, 'e2e', 'node_modules', '@playwright', 'test');
  mkdirSync(pkg, { recursive: true });
  writeFileSync(path.join(pkg, 'package.json'), '{"name":"@playwright/test","version":"1.0.0","types":"index.d.ts"}');
  writeFileSync(path.join(pkg, 'index.d.ts'), INSTALLED);
  return root;
}

describe('playwright fixtures without the project node_modules', () => {
  assert.equal(existsSync(path.join(fixtureDir(FIXTURE), 'e2e', 'node_modules')), false, 'the fixture must have no node_modules');
  const links = linksOf(fixtureDir(FIXTURE));

  it('a test.extend fixture in the spec file links the test to the page object members', () => {
    assert.deepEqual(links['logs in'], ['LoginPage.open', 'LoginPage.submit']);
  });

  it('a spec importing the extended test from a fixture file, inside test.describe, with and without details', () => {
    assert.deepEqual(links['shows the form'], ['LoginPage.form toBeVisible']);
    assert.deepEqual(links['rejects a wrong password'], ['LoginPage.submit', 'LoginPage.error toHaveText']);
  });

  it('a test extended twice across files, with worker fixtures, keeps both page objects, also under test.skip and test.step', () => {
    assert.deepEqual(links['adds an item'], ['LoginPage.open', 'CartPage.add']);
    assert.deepEqual(links['empties the cart'], ['CartPage.rows']);
  });

  it('test.extend chained twice in one expression keeps both page objects', () => {
    assert.deepEqual(links['checks out'], ['LoginPage.submit', 'CartPage.add']);
  });

  it('mergeTests keeps the page objects of every merged test', () => {
    assert.deepEqual(links['buys as a member'], ['LoginPage.open', 'CartPage.add']);
  });

  it('test.extend without a type argument proves no class, so no link is claimed', () => {
    assert.deepEqual(links['logs in untyped'], []);
  });

  it('every test of the fixture is read, and a hook is not one of them', () => {
    assert.deepEqual(Object.keys(links).sort(), ['adds an item', 'buys as a member', 'checks out', 'empties the cart', 'logs in',
      'logs in untyped', 'rejects a wrong password', 'shows the form']);
  });

  it('a whole build draws the edges from the test to the page object members and writes nothing into the project', async () => {
    const rows = rowsText(await buildFixture(FIXTURE)).split('\n');
    assert.deepEqual(readdirSync(path.join(fixtureDir(FIXTURE), 'e2e')).sort(),
      ['fixtures.ts', 'package.json', 'pages', 'shop-fixtures.ts', 'tests', 'tsconfig.json']);
    const from = (id: string) => rows.filter((row) => row.startsWith(`edge ${id} `));
    assert.deepEqual(from('test:e2e/tests/inline.spec.ts:10'), [
      'edge test:e2e/tests/inline.spec.ts:10 -calls-> page_object_member:LoginPage.open static_proven e2e/tests/inline.spec.ts:11',
      'edge test:e2e/tests/inline.spec.ts:10 -calls-> page_object_member:LoginPage.submit static_proven e2e/tests/inline.spec.ts:12',
    ]);
    assert.deepEqual(from('test:e2e/tests/login.spec.ts:8'), [
      'edge test:e2e/tests/login.spec.ts:8 -asserts_on-> page_object_member:LoginPage.form static_proven e2e/tests/login.spec.ts:9 {"matcher":"toBeVisible"}',
    ]);
  });
});

describe('playwright fixtures with @playwright/test installed in the project', () => {
  const links = linksOf(withInstalledPlaywright());

  it('the same links come from the installed declarations', () => {
    assert.deepEqual(links['logs in'], ['LoginPage.open', 'LoginPage.submit']);
    assert.deepEqual(links['rejects a wrong password'], ['LoginPage.submit', 'LoginPage.error toHaveText']);
    assert.deepEqual(links['adds an item'], ['LoginPage.open', 'CartPage.add']);
    assert.deepEqual(links['checks out'], ['LoginPage.submit', 'CartPage.add']);
  });

  it('the installed declarations win: an export only the supplied declaration has stays unknown', () => {
    assert.deepEqual(links['buys as a member'], []);
  });
});
