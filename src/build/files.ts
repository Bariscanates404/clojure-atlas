// The files a build reads: Clojure sources for kondo, .edn files for system configs, and the module roots
// (directories with their own deps.edn, project.clj, ...) that name each file's component.
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const SOURCE_EXT = /\.(clj|cljs|cljc)$/;
const EDN_EXT = /\.edn$/;
const TS_EXT = /(?<!\.d)\.ts$/;
const MODULE_FILES = new Set(['deps.edn', 'project.clj', 'shadow-cljs.edn', 'bb.edn', 'build.boot']);
// build output, dependencies and tool state; hidden directories are skipped as well
const SKIP_DIRS = new Set(['node_modules', 'target', 'out', 'dist', 'classes']);
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export interface RepoFiles {
  sources: string[];
  edn: string[];
  // TypeScript sources and package.json files, for the Playwright adapter
  typescript: string[];
  packageJsons: string[];
  moduleRoots: string[];
  skippedLarge: string[];
}

// Repo-relative paths with forward slashes, sorted.
export function listFiles(root: string): RepoFiles {
  const out: RepoFiles = { sources: [], edn: [], typescript: [], packageJsons: [], moduleRoots: [], skippedLarge: [] };
  const visit = (rel: string): void => {
    for (const e of readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!e.name.startsWith('.') && !SKIP_DIRS.has(e.name)) visit(p);
        continue;
      }
      if (!e.isFile() || e.name.startsWith('.')) continue;
      if (MODULE_FILES.has(e.name)) out.moduleRoots.push(rel);
      if (e.name === 'package.json') out.packageJsons.push(p);
      if (TS_EXT.test(e.name)) out.typescript.push(p);
      // project.clj is Leiningen build configuration, not code
      if ((!SOURCE_EXT.test(e.name) && !EDN_EXT.test(e.name)) || e.name === 'project.clj') continue;
      if (statSync(path.join(root, p)).size > MAX_FILE_BYTES) out.skippedLarge.push(p);
      else (SOURCE_EXT.test(e.name) ? out.sources : out.edn).push(p);
    }
  };
  visit('');
  for (const k of Object.keys(out) as (keyof RepoFiles)[]) out[k] = [...new Set(out[k])].sort();
  return out;
}

// The innermost module root holding a file; the repo root itself names no component.
export function componentOf(moduleRoots: readonly string[], file: string): string | undefined {
  let best: string | undefined;
  for (const r of moduleRoots) {
    if (r && file.startsWith(`${r}/`) && (!best || r.length > best.length)) best = r;
  }
  return best;
}

export interface GitInfo {
  sha: string;
  ref: string | null;
}

export function gitInfo(root: string): GitInfo {
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    const sha = git('rev-parse', 'HEAD');
    const ref = git('rev-parse', '--abbrev-ref', 'HEAD');
    return { sha, ref: ref === 'HEAD' ? null : ref };
  } catch (err) {
    process.stderr.write(`clojure-atlas: ${root} is not a git checkout (${(err as Error).message.split('\n')[0]}); the graph records sha "unversioned"\n`);
    return { sha: 'unversioned', ref: null };
  }
}
