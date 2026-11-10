// A repository's own .git/config and .gitattributes must never get a command run: git is told to ignore the settings
// that execute one (core.fsmonitor, filter drivers, hooks), on every git call atlas makes (build and MCP alike).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { trackedSources, listFiles } from '../src/build/files.ts';
import { gitDistance } from '../src/mcp/staleness.ts';
import { git, runGit, SAFE_GIT_CONFIG } from '../src/shared/git.ts';
import { ignoredAmong, snapshotOf } from '../src/snapshot.ts';

const dir = mkdtempSync(path.join(tmpdir(), 'atlas-gitsafe-'));
const repo = path.join(dir, 'repo');
const marks = path.join(dir, 'marks');
const mark = (name: string) => path.join(marks, name);
const raw = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { stdio: 'ignore' });
let head = '';

before(() => {
  mkdirSync(marks);
  mkdirSync(path.join(repo, 'src'), { recursive: true });
  writeFileSync(path.join(repo, 'src/a.clj'), '(ns a)\n');
  writeFileSync(path.join(repo, '.gitattributes'), '*.clj filter=evil\n');
  raw('init', '-q');
  raw('add', '-A');
  raw('commit', '-qm', 'init');
  head = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const hooks = path.join(repo, '.git/hooks');
  mkdirSync(hooks, { recursive: true });
  writeFileSync(path.join(hooks, 'post-index-change'), `#!/bin/sh\ntouch ${mark('hook')}\n`, { mode: 0o755 });
  raw('config', 'core.fsmonitor', `touch ${mark('fsmonitor')}; echo`);
  raw('config', 'filter.evil.clean', `touch ${mark('clean')}; cat`);
  raw('config', 'filter.evil.process', `touch ${mark('process')}`);
  raw('config', 'filter.evil.smudge', `touch ${mark('smudge')}; cat`);
  raw('config', 'diff.external', `touch ${mark('diff')}`);
  // newer than the index: git must look at the content, which is when a clean filter would run
  const later = new Date(Date.now() + 5000);
  utimesSync(path.join(repo, 'src/a.clj'), later, later);
});
after(() => rmSync(dir, { recursive: true, force: true }));

beforeEach(() => { for (const n of ['fsmonitor', 'clean', 'process', 'smudge', 'diff', 'hook']) rmSync(mark(n), { force: true }); });
const marked = () => ['fsmonitor', 'clean', 'process', 'smudge', 'diff', 'hook'].filter((n) => existsSync(mark(n)));

describe('git never runs a command the analyzed repository configures', () => {
  it('snapshotOf (build and every MCP call)', () => {
    snapshotOf(repo, 'x');
    assert.deepEqual(marked(), []);
  });
  it('the commit distance and the expected-file count', () => {
    gitDistance(repo)(head, head);
    trackedSources(repo, listFiles(repo));
    ignoredAmong(repo, ['src/a.clj', 'src/untracked.clj']);
    assert.deepEqual(marked(), []);
  });
  it('the shared wrapper itself answers, and tells a failure from output', () => {
    assert.equal(git(repo, ['rev-parse', 'HEAD'])?.trim(), head);
    assert.equal(git(repo, ['rev-parse', 'no-such-ref']), null);
    assert.throws(() => runGit(repo, ['rev-parse', 'no-such-ref']));
    assert.equal(git(repo, ['hash-object', '--stdin'], 'x')?.length, 41);
    assert.deepEqual(marked(), []);
  });
  it('lists the overrides it relies on', () => {
    assert.ok(SAFE_GIT_CONFIG.includes('core.fsmonitor=false'));
    assert.equal(readFileSync(path.join(repo, '.git/config'), 'utf8').includes('fsmonitor'), true);
  });
});

// A submodule has its own config under .git/modules, which the top-level overrides do not reach: nothing atlas runs
// may start git inside one.
describe('git never runs a command a submodule configures', () => {
  const sdir = mkdtempSync(path.join(tmpdir(), 'atlas-submod-'));
  const upstream = path.join(sdir, 'upstream');
  const top = path.join(sdir, 'top');
  const smarks = path.join(sdir, 'marks');
  const NAMES = ['fsmonitor', 'clean', 'process', 'smudge', 'hook'];
  const sm = (name: string) => path.join(smarks, name);
  const inTop = (...args: string[]) => execFileSync('git', ['-C', top, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'protocol.file.allow=always', ...args], { stdio: 'ignore' });
  const subConfig = path.join(top, '.git/modules/sub/config');
  before(() => {
    mkdirSync(smarks);
    mkdirSync(upstream);
    writeFileSync(path.join(upstream, 'lib.clj'), '(ns lib)\n');
    writeFileSync(path.join(upstream, '.gitattributes'), '*.clj filter=evil\n');
    for (const args of [['init', '-q'], ['add', '-A'], ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'u']]) execFileSync('git', ['-C', upstream, ...args], { stdio: 'ignore' });
    mkdirSync(top);
    writeFileSync(path.join(top, 'a.clj'), '(ns a)\n');
    inTop('init', '-q');
    inTop('submodule', 'add', '-q', upstream, 'sub');
    inTop('add', '-A');
    inTop('commit', '-qm', 'top');
    const cfg = (k: string, v: string) => execFileSync('git', ['config', '-f', subConfig, k, v]);
    cfg('core.fsmonitor', `touch ${sm('fsmonitor')}; echo`);
    cfg('filter.evil.clean', `touch ${sm('clean')}; cat`);
    cfg('filter.evil.process', `touch ${sm('process')}`);
    cfg('filter.evil.smudge', `touch ${sm('smudge')}; cat`);
    const hooks = path.join(top, '.git/modules/sub/hooks');
    mkdirSync(hooks, { recursive: true });
    writeFileSync(path.join(hooks, 'post-index-change'), `#!/bin/sh\ntouch ${sm('hook')}\n`, { mode: 0o755 });
    const later = new Date(Date.now() + 5000);
    utimesSync(path.join(top, 'sub/lib.clj'), later, later);
  });
  after(() => rmSync(sdir, { recursive: true, force: true }));
  beforeEach(() => { for (const n of NAMES) rmSync(sm(n), { force: true }); });
  const smarked = () => NAMES.filter((n) => existsSync(sm(n)));

  it('snapshotOf (build and every MCP call) starts nothing, and a changed submodule file changes the snapshot', () => {
    const before = snapshotOf(top, 'x');
    assert.deepEqual(smarked(), []);
    writeFileSync(path.join(top, 'sub/lib.clj'), '(ns lib) ; edited\n');
    const after = snapshotOf(top, 'x');
    assert.deepEqual(smarked(), []);
    assert.notEqual(after.id, before.id);
    assert.ok(after.dirty.some(([f]) => f === 'sub/lib.clj'));
  });
  it('the commit distance and the expected-file count start nothing', () => {
    const sha = execFileSync('git', ['-C', top, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    gitDistance(top)(sha, sha);
    trackedSources(top, listFiles(top));
    assert.deepEqual(smarked(), []);
  });
});

describe('a directory that is not a git checkout', () => {
  it('is reported in one human line, without the git command line', () => {
    const plain = mkdtempSync(path.join(tmpdir(), 'atlas-nogit-'));
    writeFileSync(path.join(plain, 'a.clj'), '(ns a)\n');
    const lines: string[] = [];
    const write = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string) => { lines.push(String(chunk)); return true; }) as typeof process.stderr.write;
    try {
      trackedSources(plain, listFiles(plain));
    } finally {
      process.stderr.write = write;
      rmSync(plain, { recursive: true, force: true });
    }
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^clojure-atlas: .* is not a git checkout \(git ls-files exited 128\); expected files = files listed\n$/);
    assert.ok(!lines[0].includes('-c core') && !lines[0].includes('Command failed'));
  });
  it('a missing git is named as such', () => {
    const saved = process.env.PATH;
    process.env.PATH = '/nonexistent-dir';
    try {
      assert.throws(() => runGit(repo, ['rev-parse', 'HEAD']), /^Error: git is not installed or not on PATH$/);
      assert.equal(git(repo, ['rev-parse', 'HEAD']), null);
    } finally {
      process.env.PATH = saved;
    }
  });
  it('reports a timeout and a signal in words', () => {
    assert.throws(() => runGit(repo, ['rev-parse', 'HEAD'], { timeoutMs: 1 }), /^Error: git rev-parse (timed out|exited \d+)$/);
  });
});
