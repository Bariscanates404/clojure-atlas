// A build never executes code from the analyzed repository: its node_modules/typescript (or one in a parent
// directory) is not required, however it is named: the Playwright side is read with the typescript clojure-atlas ships with.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { buildGraph } from '../src/build/index.ts';
import { readPlaywright } from '../src/build/typescript.ts';

function untrustedRepo(parent: boolean): { repo: string; marker: string } {
  const top = mkdtempSync(path.join(tmpdir(), 'atlas-untrusted-'));
  const marker = path.join(top, 'PWNED');
  const repo = parent ? path.join(top, 'clone') : top;
  mkdirSync(path.join(top, 'node_modules', 'typescript'), { recursive: true });
  writeFileSync(path.join(top, 'node_modules', 'typescript', 'package.json'), '{"name":"typescript","version":"5.0.0","main":"index.js"}');
  writeFileSync(path.join(top, 'node_modules', 'typescript', 'index.js'),
    `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'x'); module.exports = { version: '5.0.0', createProgram() { throw new Error('ran'); } };`);
  mkdirSync(path.join(repo, 'e2e'), { recursive: true });
  writeFileSync(path.join(repo, 'package.json'), '{"devDependencies":{"@playwright/test":"1.0.0"}}');
  writeFileSync(path.join(repo, 'e2e', 'a.spec.ts'), "import { test } from '@playwright/test';\ntest('x', async () => {});\n");
  mkdirSync(path.join(repo, 'src'), { recursive: true });
  writeFileSync(path.join(repo, 'src', 'a.clj'), '(ns a)\n(defn f [] 1)\n');
  return { repo, marker };
}

describe('untrusted repositories', () => {
  for (const parent of [false, true]) {
    it(`never requires the typescript package of the analyzed repo${parent ? ' found in a parent directory' : ''}`, () => {
      const { repo, marker } = untrustedRepo(parent);
      const out = readPlaywright(repo, ['package.json'], ['e2e/a.spec.ts']);
      assert.equal(existsSync(marker), false, 'the repo typescript was executed');
      assert.equal(out.projects.length, 1, 'the page was read with the typescript of clojure-atlas itself');
      assert.deepEqual(out.skipped, []);
    });
  }

  it('a whole build reads the browser tests with its own typescript and runs nothing from the repo', async () => {
    const { repo, marker } = untrustedRepo(false);
    const doc = await buildGraph(repo);
    assert.equal(existsSync(marker), false);
    assert.equal(doc.capabilities.find((c) => c.name === 'browser_tests')?.status, 'available');
  });
});
