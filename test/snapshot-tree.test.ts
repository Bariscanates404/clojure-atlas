// What the snapshot id follows in a working tree: the files the builder reads, found from the right directory, in a
// monorepo subdirectory, with the graph written anywhere, with ignored files, submodules, and without git.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { dirtyFiles, fileHasher, snapshotOf } from '../src/snapshot.ts';

const base = mkdtempSync(path.join(tmpdir(), 'atlas-tree-'));
after(() => rmSync(base, { recursive: true, force: true }));

const sh = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'protocol.file.allow=always', ...args], { cwd, stdio: 'ignore' });
const put = (dir: string, rel: string, body: string) => {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  writeFileSync(path.join(dir, rel), body);
};
let n = 0;
function repo(files: Record<string, string>, commit = true): string {
  const dir = path.join(base, `r${n++}`);
  mkdirSync(dir);
  sh(dir, 'init', '-q');
  for (const [rel, body] of Object.entries(files)) put(dir, rel, body);
  if (commit) {
    sh(dir, 'add', '.');
    sh(dir, 'commit', '-qm', 'one');
  }
  return dir;
}
const ids = (root: string) => snapshotOf(root, 'v').id;

describe('snapshot of a subdirectory of a repository', () => {
  it('names the dirty files of the subdirectory with their content, and ignores the rest of the repository', () => {
    const top = repo({ 'a.clj': '(ns a)', 'sub/src/b.clj': '(ns b)' });
    const sub = path.join(top, 'sub');
    const clean = snapshotOf(sub, 'v');
    put(top, 'sub/src/b.clj', '(ns b) (def x 1)');
    const one = snapshotOf(sub, 'v');
    assert.deepEqual(one.dirty.map(([f]) => f), ['src/b.clj']);
    assert.match(one.dirty[0][1], /^[0-9a-f]{64}$/);
    put(top, 'sub/src/b.clj', '(ns b) (def x 2)');
    assert.notEqual(snapshotOf(sub, 'v').id, one.id);
    put(top, 'sub/src/b.clj', '(ns b)');
    put(top, 'a.clj', '(ns a) (def y 1)');
    assert.equal(snapshotOf(sub, 'v').id, clean.id);
  });
});

describe('snapshot of what the builder reads', () => {
  it('does not follow a graph written outside .clojure-atlas, a log or any file the builder never reads', () => {
    const dir = repo({ 'a.clj': '(ns a)' });
    const clean = ids(dir);
    put(dir, 'graph.json.gz', 'x');
    put(dir, 'out/g.json', 'x');
    put(dir, 'test.log', 'x');
    put(dir, 'junk/f.js', 'x');
    assert.equal(ids(dir), clean);
  });

  it('follows an edit to a git-ignored file the builder reads', () => {
    const dir = repo({ 'a.clj': '(ns a)', '.gitignore': 'gen/\n' });
    put(dir, 'gen/g.clj', '(ns g) (def a 1)');
    const first = snapshotOf(dir, 'v');
    assert.deepEqual(first.dirty.map(([f]) => f), ['gen/g.clj']);
    put(dir, 'gen/g.clj', '(ns g) (def a 2)');
    assert.notEqual(ids(dir), first.id);
  });

  it('follows an edit inside a submodule, also the second one', () => {
    const sm = repo({ 's.clj': '(ns s)' });
    const dir = repo({ 'a.clj': '(ns a)' });
    sh(dir, 'submodule', 'add', '-q', sm, 'vendor-sm');
    sh(dir, 'commit', '-qm', 'sub');
    const clean = ids(dir);
    put(dir, 'vendor-sm/s.clj', '(ns s) (def a 1)');
    const first = ids(dir);
    assert.notEqual(first, clean);
    put(dir, 'vendor-sm/s.clj', '(ns s) (def a 2)');
    assert.notEqual(ids(dir), first);
  });

  it('counts a deleted file the builder read, not a deleted log', () => {
    const dir = repo({ 'a.clj': '(ns a)', 'x.log': 'x' });
    rmSync(path.join(dir, 'x.log'));
    assert.deepEqual(snapshotOf(dir, 'v').dirty, []);
    rmSync(path.join(dir, 'a.clj'));
    assert.deepEqual(snapshotOf(dir, 'v').dirty, [['a.clj', 'deleted']]);
  });

  it('picks the changed files out of git paths, submodule directories and ignored files', () => {
    const analyzed = ['a.clj', 'm/b.clj', 'm/c.edn', 'z.clj'];
    const dirs = new Set(['m']);
    const gone = new Set(['old.cljs', 'old.log']);
    const got = dirtyFiles(analyzed, ['a.clj', 'm', 'x.log', 'old.cljs', 'old.log', 'z.clj'], ['gen/g.clj'], (p) => dirs.has(p), (p) => !gone.has(p) && p !== 'old.cljs');
    assert.deepEqual(got, ['a.clj', 'gen/g.clj', 'm/b.clj', 'm/c.edn', 'old.cljs', 'z.clj']);
  });
});

describe('snapshot cost', () => {
  it('reads a file again only when its modification time or size changed', () => {
    const dir = repo({ 'a.clj': '(ns a)' }, false);
    const reads: string[] = [];
    const hash = fileHasher((f) => { reads.push(f); return Buffer.from('x'); });
    const f = path.join(dir, 'a.clj');
    assert.equal(hash(f), hash(f));
    assert.equal(reads.length, 1);
    put(dir, 'a.clj', '(ns a) (def longer 1)');
    hash(f);
    assert.equal(reads.length, 2);
    assert.equal(hash(path.join(dir, 'missing.clj')), 'deleted');
  });
});

describe('snapshot without a usable git history', () => {
  const quiet = (run: () => void): string => {
    const lines: string[] = [];
    const write = process.stderr.write;
    process.stderr.write = ((s: string) => { lines.push(s); return true; }) as typeof process.stderr.write;
    try { run(); } finally { process.stderr.write = write; }
    return lines.join('');
  };

  it('without git, follows the content of every file the build reads and says so once', () => {
    const dir = path.join(base, 'nogit');
    put(dir, 'a.clj', '(ns a)');
    let first = '';
    const err = quiet(() => { first = ids(dir); put(dir, 'a.clj', '(ns a) (def x 1)'); assert.notEqual(ids(dir), first); });
    assert.equal(err.match(/is not a git checkout/g)?.length, 1);
  });

  it('in a repository without a commit, follows the files and writes nothing to stderr', () => {
    const dir = repo({ 'a.clj': '(ns a)' }, false);
    let first = '';
    const err = quiet(() => { first = ids(dir); put(dir, 'a.clj', '(ns a) (def x 1)'); assert.notEqual(ids(dir), first); });
    assert.equal(err, '');
    assert.equal(snapshotOf(dir, 'v').sha, 'unversioned');
  });
});
