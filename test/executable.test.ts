// The git and clj-kondo programs are found by atlas itself, never by the operating system looking in the analyzed
// repository first (Windows searches the working directory before PATH).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveExecutable, whichExecutable } from '../src/shared/executable.ts';

const present = (...files: string[]) => (f: string) => files.includes(f);

describe('resolveExecutable', () => {
  it('returns the first absolute PATH entry that holds the program', () => {
    const host = { platform: 'linux', pathEnv: '/a:/b:/c', avoid: [], exists: present('/b/git', '/c/git') };
    assert.equal(resolveExecutable('git', host), '/b/git');
    assert.equal(resolveExecutable('nope', host), null);
  });
  it('skips empty and relative entries, even when they hold the program', () => {
    const host = { platform: 'linux', pathEnv: ':.:bin:/ok', avoid: [], exists: present('git', './git', 'bin/git', '/ok/git') };
    assert.equal(resolveExecutable('git', host), '/ok/git');
    assert.equal(resolveExecutable('git', { ...host, pathEnv: undefined }), null);
  });
  it('skips the analyzed repository and anything inside it', () => {
    const host = { platform: 'linux', pathEnv: '/repo:/repo/bin:/usr/bin', avoid: ['/repo'], exists: present('/repo/git', '/repo/bin/git', '/usr/bin/git') };
    assert.equal(resolveExecutable('git', host), '/usr/bin/git');
    assert.equal(resolveExecutable('git', { ...host, pathEnv: '/repo2:/repo' , exists: present('/repo2/git', '/repo/git') }), '/repo2/git');
  });
  it('on Windows tries the PATHEXT extensions, uses ; and honours quotes and the default extensions', () => {
    const host = { platform: 'win32', pathEnv: '"C:\\Git\\cmd";D:\\x', pathExt: '.EXE;.CMD', avoid: ['D:\\x'], exists: present('C:\\Git\\cmd\\git.CMD', 'D:\\x\\git.EXE') };
    assert.equal(resolveExecutable('git', host), 'C:\\Git\\cmd\\git.CMD');
    assert.equal(resolveExecutable('git', { ...host, pathExt: undefined, exists: present('C:\\Git\\cmd\\git.EXE') }), 'C:\\Git\\cmd\\git.EXE');
    assert.equal(resolveExecutable('git', { ...host, pathEnv: '.;rel;C:\\Git', exists: present('.\\git.exe', 'rel\\git.exe') }), null);
  });
  it('whichExecutable finds the real git, and not one inside an avoided directory', () => {
    const found = whichExecutable('git', []);
    assert.ok(found && found.startsWith('/'));
    assert.equal(whichExecutable('git', ['/']), null);
  });
});
