// The Playwright adapters: page objects, exact selectors, tests and what the Clojure side renders, read with the
// project's TypeScript; and the MCP's browser-test answers from that graph.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { selectorsIn } from '../src/build/typescript.ts';
import { graphFromJson } from '../src/mcp/graph.ts';
import { testsCovering, testsFor } from '../src/mcp/queries.ts';
import { buildFixture, buildWithoutCompilerApi, fixtureDir, rowsText } from './helpers/atlas-fixture.ts';

describe('playwright', () => {
  it('reads CSS class tokens and test ids from a selector string', () => {
    assert.deepEqual(selectorsIn('div.item-a > input.item-b[data-testid="x"]'), [
      { kind: 'class', value: 'item-a' }, { kind: 'class', value: 'item-b' }, { kind: 'testid', value: 'x' },
    ]);
  });

  it('reads no class from a dot inside quotes, an attribute test or another selector engine', () => {
    assert.deepEqual(selectorsIn('a[href="/files/report.pdf"].report-link'), [{ kind: 'class', value: 'report-link' }]);
    assert.deepEqual(selectorsIn('text=Save.pdf'), []);
    assert.deepEqual(selectorsIn('.row >> text=Save.pdf'), [{ kind: 'class', value: 'row' }]);
  });

  it('page objects, exact selectors, tests and renders, every row', async () => {
    const doc = await buildFixture('browser');
    assert.equal(rowsText(doc), readFileSync(path.join(fixtureDir('browser'), 'expected.txt'), 'utf8'));
  });

  it('answers tests_for and tests_covering through the MCP', async () => {
    const g = graphFromJson(JSON.stringify(await buildFixture('browser')));
    assert.match(testsFor(g, 'app.views/login-form').verdict, /and 4 browser test\(s\) reach it$/);
    assert.match(testsCovering(g, 'password').verdict, /^3 browser test\(s\) in 1 spec file\(s\)$/);
  });

  it('a TypeScript without the compiler API leaves the capabilities absent, with the reason', async () => {
    const doc = await buildWithoutCompilerApi('browser');
    const cap = doc.capabilities.find((c) => c.name === 'browser_tests');
    assert.equal(cap?.status, 'absent');
    assert.match(cap?.note ?? '', /e2e: typescript 7\.\d+\.\d+ in clojure-atlas's own install has no compiler API/);
  });
});
