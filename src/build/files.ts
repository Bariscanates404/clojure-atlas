// The files a build reads: Clojure sources for kondo, .edn files for system configs, and the module roots
// (directories with their own deps.edn, project.clj, ...) that name each file's component.
import { lstatSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { runGit } from '../shared/git.ts';

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

// What git tracks of Clojure code against what the walk read. `.clj-kondo/` files (hooks, config) are configuration,
// never project source: they are neither expected nor missing. `unread` are tracked sources the walk left out (a hidden
// folder, or a build folder such as dist/ at the repo root); the large ones are counted as skipped, not unread.
// Without git, only what the walk saw can be told.
export interface Tracked {
  expected: number;
  unread: string[];
  // why each unread file was left out
  unreadWhy: Record<string, UnreadReason>;
}

// symlink: the walk does not follow links; deleted: tracked by git, gone from the working tree; otherwise the file sits
// in a hidden path, node_modules or a module-root build folder
export type UnreadReason = 'symlink' | 'deleted' | 'hidden-or-build-folder';

function unreadReason(root: string, file: string): UnreadReason {
  const st = lstatSync(path.join(root, file), { throwIfNoEntry: false });
  return !st ? 'deleted' : st.isSymbolicLink() ? 'symlink' : 'hidden-or-build-folder';
}

const KONDO_CONFIG_DIR = /(^|\/)\.clj-kondo\//;

export function trackedSources(root: string, files: RepoFiles): Tracked {
  try {
    const out = runGit(root, ['ls-files', '-z', '--', '*.clj', '*.cljs', '*.cljc']);
    const tracked = out.split('\0').filter((f) => f && path.posix.basename(f) !== 'project.clj' && !KONDO_CONFIG_DIR.test(f));
    const seen = new Set([...files.sources, ...files.skippedLarge]);
    const unread = tracked.filter((f) => !seen.has(f)).sort();
    return { expected: tracked.length, unread, unreadWhy: Object.fromEntries(unread.map((f) => [f, unreadReason(root, f)])) };
  } catch (err) {
    process.stderr.write(`clojure-atlas: ${root} is not a git checkout (${(err as Error).message.split('\n')[0]}); expected files = files listed\n`);
    return { expected: files.sources.length + files.skippedLarge.filter((f) => SOURCE_EXT.test(f)).length, unread: [], unreadWhy: {} };
  }
}
