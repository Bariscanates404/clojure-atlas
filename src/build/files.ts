// The files a build reads: Clojure sources for kondo, .edn files for system configs, and the module roots
// (directories with their own deps.edn, project.clj, ...) that name each file's component.
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const SOURCE_EXT = /\.(clj|cljs|cljc)$/;
const EDN_EXT = /\.edn$/;
const TS_EXT = /(?<!\.d)\.ts$/;
const MODULE_FILES = new Set(['deps.edn', 'project.clj', 'shadow-cljs.edn', 'bb.edn', 'build.boot']);
// dependencies are skipped at any depth; build output only where a build writes it, the repo root or a module root,
// because a namespace can be named app.out or app.dist; hidden directories are skipped as well
const DEPENDENCY_DIR = 'node_modules';
const BUILD_DIRS = new Set(['target', 'out', 'dist', 'classes']);
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
    const entries = readdirSync(path.join(root, rel), { withFileTypes: true });
    const isModuleRoot = !rel || entries.some((e) => e.isFile() && MODULE_FILES.has(e.name));
    for (const e of entries) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!e.name.startsWith('.') && e.name !== DEPENDENCY_DIR && !(isModuleRoot && BUILD_DIRS.has(e.name))) visit(p);
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

// Clojure files git tracks, whatever directory they sit in; without git, the ones listed plus the large ones skipped.
export function expectedSources(root: string, files: RepoFiles): number {
  try {
    const out = execFileSync('git', ['-C', root, 'ls-files', '-z', '--', '*.clj', '*.cljs', '*.cljc'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\0').filter((f) => f && path.posix.basename(f) !== 'project.clj').length;
  } catch (err) {
    process.stderr.write(`clojure-atlas: ${root} is not a git checkout (${(err as Error).message.split('\n')[0]}); expected files = files listed\n`);
    return files.sources.length + files.skippedLarge.filter((f) => SOURCE_EXT.test(f)).length;
  }
}
