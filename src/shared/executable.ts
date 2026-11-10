// Finds an executable by searching PATH ourselves, so the process is spawned from an absolute path. The analyzed
// repository is untrusted and is the working directory of the git and clj-kondo processes; Windows looks in the
// working directory before PATH, so a planted git.exe or clj-kondo.exe there would run. An empty PATH entry means "the
// current directory" and a relative one depends on it, so both are skipped, as is any entry inside `avoid`.
import { existsSync } from 'node:fs';
import path from 'node:path';

export interface ResolveHost {
  platform: string;
  // the PATH value (the variable is called Path on some Windows setups; the caller passes whichever it has)
  pathEnv: string | undefined;
  // PATHEXT value on Windows
  pathExt?: string | undefined;
  // directories (the analyzed repository) whose executables must never be picked up
  avoid: readonly string[];
  exists: (file: string) => boolean;
}

const inside = (dir: string, parent: string, p: typeof path.posix): boolean => {
  const rel = p.relative(parent, dir);
  return rel === '' || (!rel.startsWith('..') && !p.isAbsolute(rel));
};

export function resolveExecutable(name: string, host: ResolveHost): string | null {
  const win = host.platform === 'win32';
  const p = win ? path.win32 : path.posix;
  const delimiter = win ? ';' : ':';
  const exts = win ? ['', ...(host.pathExt || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)] : [''];
  for (const raw of (host.pathEnv ?? '').split(delimiter)) {
    const entry = win ? raw.replace(/^"(.*)"$/, '$1') : raw;
    if (!entry || !p.isAbsolute(entry)) continue;
    if (host.avoid.some((a) => inside(p.resolve(entry), p.resolve(a), p))) continue;
    for (const ext of exts) {
      const candidate = p.join(entry, name + ext);
      if (host.exists(candidate)) return candidate;
    }
  }
  return null;
}

// The real machine: PATH of this process, keeping `avoid` (the analyzed directory) out of the search.
export function whichExecutable(name: string, avoid: readonly string[]): string | null {
  const key = process.platform === 'win32' ? Object.keys(process.env).find((k) => k.toLowerCase() === 'path') : 'PATH';
  return resolveExecutable(name, {
    platform: process.platform, pathEnv: key ? process.env[key] : undefined, pathExt: process.env.PATHEXT, avoid, exists: existsSync,
  });
}
