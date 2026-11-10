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
