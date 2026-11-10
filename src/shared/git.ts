// The one way atlas runs git. The analyzed repository is untrusted: its .git/config and .gitattributes are read by
// every git command, and some settings make git execute a command. Every call therefore carries overrides.
//
// Why the set is complete for the subcommands atlas uses (status, rev-parse, rev-list, ls-files, check-ignore):
//  - core.fsmonitor runs a hook command on status/ls-files (index refresh); core.untrackedCache goes with it. Both off.
//  - filter.<driver>.clean/smudge/process run when status compares a stat-dirty file's content, with the driver named
//    by a .gitattributes file in the tree. Driver names are free text, so they are read from the config (`git config`
//    runs nothing) and each is switched off: empty clean/smudge are skipped by git, `process` is cleared and
//    `required` is false so an unusable driver is not an error.
//  - core.hooksPath/.git/hooks: status may rewrite the index, which fires post-index-change. Hooks point at the null
//    device, and GIT_OPTIONAL_LOCKS=0 stops status writing the index at all.
//  - diff.external, diff.<driver>.textconv, core.pager, core.editor, credential/ssh/proxy settings belong to diff,
//    pagers, editors and network commands, which atlas never runs (stdout is a pipe, so no pager starts anyway).
// GIT_TERMINAL_PROMPT=0 makes any credential question fail instead of waiting, and a timeout bounds every call.
import { execFileSync } from 'node:child_process';
import { devNull } from 'node:os';

export const SAFE_GIT_CONFIG = ['core.fsmonitor=false', 'core.untrackedCache=false', `core.hooksPath=${devNull}`];

export const GIT_TIMEOUT_MS = 60_000;

const ENV = { GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' };
const overrides = (config: readonly string[]) => config.flatMap((c) => ['-c', c]);

export interface GitOptions {
  input?: string;
  timeoutMs?: number;
}

function exec(root: string, args: string[], config: readonly string[], opts: GitOptions): string {
  return execFileSync('git', [...overrides(config), '-C', root, ...args], {
    encoding: 'utf8',
    input: opts.input,
    maxBuffer: 1 << 30,
    timeout: opts.timeoutMs ?? GIT_TIMEOUT_MS,
    env: { ...process.env, ...ENV },
    stdio: [opts.input === undefined ? 'ignore' : 'pipe', 'pipe', 'ignore'],
  });
}

// Overrides that switch off every filter driver the repository's config defines.
function filterOverrides(root: string): string[] {
  let listed = '';
  try {
    listed = exec(root, ['config', '-z', '--get-regexp', '^filter\\.'], SAFE_GIT_CONFIG, {});
  } catch {
    return [];
  }
  const drivers = new Set<string>();
  for (const entry of listed.split('\0')) {
    const key = entry.split('\n')[0];
    const m = /^filter\.(.+)\.[^.]+$/.exec(key);
    if (m) drivers.add(m[1]);
  }
  return [...drivers].flatMap((d) => [`filter.${d}.clean=`, `filter.${d}.smudge=`, `filter.${d}.process=`, `filter.${d}.required=false`]);
}

// Output of `git <args>` in `root`; throws when git fails or times out.
export function runGit(root: string, args: string[], opts: GitOptions = {}): string {
  return exec(root, args, [...SAFE_GIT_CONFIG, ...filterOverrides(root)], opts);
}

// The same, null on any failure (no repository, no git, timeout).
export function git(root: string, args: string[], input?: string, timeoutMs?: number): string | null {
  try {
    return runGit(root, args, { input, timeoutMs });
  } catch {
    return null;
  }
}
