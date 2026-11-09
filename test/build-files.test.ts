// Which files a build reads: build output is skipped where a build writes it, never inside the sources, and
// Leiningen's own project.clj is not code (the file count git reports leaves out exactly that name).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { expectedSources, listFiles } from '../src/build/files.ts';

const roots: string[] = [];
function repo(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'atlas-files-'));
  roots.push(root);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), body);
  }
  return root;
}
after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

describe('listFiles', () => {
  it('skips build output beside a deps.edn or at the top, keeps a namespace that happens to be named out or dist', () => {
    const root = repo({
      'deps.edn': '{}',
      'src/app/out/thing.clj': '(ns app.out.thing)',
      'src/app/dist/thing.clj': '(ns app.dist.thing)',
      'target/classes/gen.clj': '(ns gen)',
      'out/gen.clj': '(ns gen2)',
      'components/ui/deps.edn': '{}',
      'components/ui/classes/gen.clj': '(ns gen3)',
      'components/ui/src/ui/core.clj': '(ns ui.core)',
      'node_modules/lib/x.clj': '(ns x)',
      'src/app/node_modules/y.clj': '(ns y)',
    });
    assert.deepEqual(listFiles(root).sources, ['components/ui/src/ui/core.clj', 'src/app/dist/thing.clj', 'src/app/out/thing.clj']);
  });
});

describe('expectedSources', () => {
  it('leaves out project.clj by its name, not a file that merely ends in it', () => {
    const root = repo({ 'project.clj': '(defproject a "1")', 'sub/myproject.clj': '(ns my)', 'sub/other.clj': '(ns other)' });
    execFileSync('git', ['-C', root, 'init', '-q']);
    execFileSync('git', ['-C', root, 'add', '-A']);
    assert.equal(expectedSources(root, listFiles(root)), 2);
  });
});
