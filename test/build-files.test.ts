// Which files a build reads: build output is skipped where a build writes it, never inside the sources, and
// Leiningen's own project.clj is not code (the file count git reports leaves out exactly that name).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { listFiles, trackedSources } from '../src/build/files.ts';
import { buildGraph } from '../src/build/index.ts';
import { degradation, degradedLine, unanalyzedFor } from '../src/mcp/degraded.ts';

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

describe('trackedSources', () => {
  it('leaves out project.clj by its name, not a file that merely ends in it', () => {
    const root = repo({ 'project.clj': '(defproject a "1")', 'sub/myproject.clj': '(ns my)', 'sub/other.clj': '(ns other)' });
    execFileSync('git', ['-C', root, 'init', '-q']);
    execFileSync('git', ['-C', root, 'add', '-A']);
    assert.equal(trackedSources(root, listFiles(root)).expected, 2);
  });
});

describe('tracked sources the walk does not read', () => {
  const tracked = () => {
    const root = repo({
      'deps.edn': '{}',
      'src/app/core.clj': '(ns app.core)\n(defn f [] 1)\n',
      '.dev/user.clj': '(ns user)',
      'dist/app/gen.clj': '(ns app.gen)',
      '.clj-kondo/hooks/h.clj': '(ns hooks.h)',
      'lib/.clj-kondo/hooks/k.clj': '(ns hooks.k)',
    });
    execFileSync('git', ['-C', root, 'init', '-q']);
    execFileSync('git', ['-C', root, 'add', '-A']);
    return root;
  };

  it('are listed as unread; the clj-kondo config folders are neither expected nor missing', () => {
    const root = tracked();
    const t = trackedSources(root, listFiles(root));
    assert.equal(t.expected, 3);
    assert.deepEqual(t.unread, ['.dev/user.clj', 'dist/app/gen.clj']);
  });

  it('a build counts them, says so in DEGRADED, and a lookup of their namespace names them', async () => {
    const doc = await buildGraph(tracked());
    assert.equal(doc.stats.files.expected, 3);
    assert.equal(doc.stats.files.sources, 1);
    assert.deepEqual(doc.stats.files.unread_names, ['.dev/user.clj', 'dist/app/gen.clj']);
    const d = degradation(doc);
    assert.match(degradedLine(d!), /^DEGRADED: 2 tracked Clojure file\(s\) were not analyzed, as git tracks them but the file walk did not read them, whether they sit in a hidden path, node_modules or a build folder, are symbolic links, or are deleted in the working tree \(\.dev\/user\.clj, dist\/app\/gen\.clj\)/);
    assert.deepEqual(unanalyzedFor(d, 'app.gen/anything'), { timedOut: [], unread: ['dist/app/gen.clj'] });
  });
});
