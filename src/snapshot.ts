// What a graph was built from, as one id: the commit, every dirty or untracked file's content, the configuration that
// shapes the analysis (the project's clj-kondo config files and .clojure-atlas.edn) and the analyzer versions. A
// working tree with another id is not what the graph describes.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { ednValue } from './build/config.ts';
import { listFiles } from './build/files.ts';
import { readForms } from './build/reader.ts';
import { VERSION } from './version.ts';

export interface Snapshot {
  id: string;
  sha: string;
  ref: string | null;
  dirty: [string, string][];
  configHash: string;
  configSources: string[];
  analyzer: string;
}

const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

// The config files clj-kondo reads in this repo, repo-relative: .clj-kondo/config.edn, the configs it imports through
// :config-paths, the ones it loads from .clj-kondo/<org>/<lib>/config.edn, and .clojure-atlas.edn.
export function configSources(root: string): string[] {
  const out: string[] = [];
  const add = (rel: string) => {
    if (!out.includes(rel) && existsSync(path.join(root, rel))) out.push(rel);
  };
  const kondoDir = '.clj-kondo';
  const visit = (rel: string): void => {
    if (out.includes(rel) || !existsSync(path.join(root, rel))) return;
    add(rel);
    const doc = parsed(path.join(root, rel));
    const paths = doc[':config-paths'];
    for (const p of Array.isArray(paths) ? paths : []) {
      if (typeof p === 'string') visit(path.posix.join(path.posix.dirname(rel), p, 'config.edn'));
    }
  };
  visit(`${kondoDir}/config.edn`);
  if (existsSync(path.join(root, kondoDir))) {
    for (const org of readdirSync(path.join(root, kondoDir), { withFileTypes: true })) {
      if (!org.isDirectory()) continue;
      for (const lib of readdirSync(path.join(root, kondoDir, org.name), { withFileTypes: true })) {
        if (lib.isDirectory()) visit(`${kondoDir}/${org.name}/${lib.name}/config.edn`);
      }
    }
  }
  add('.clojure-atlas.edn');
  return out;
}

type Edn = ReturnType<typeof ednValue>;

function parsed(file: string): Record<string, Edn> {
  const forms = readForms(readFileSync(file, 'utf8')).forms;
  const v = forms[0] ? ednValue(forms[0]) : {};
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

// Symbols the project's own clj-kondo config already teaches kondo (:lint-as, hooks): atlas adds nothing for them.
export function projectKnownSymbols(root: string): Set<string> {
  const out = new Set<string>();
  for (const rel of configSources(root).filter((f) => f !== '.clojure-atlas.edn')) {
    const doc = parsed(path.join(root, rel));
    const lintAs = doc[':lint-as'];
    if (lintAs && typeof lintAs === 'object' && !Array.isArray(lintAs)) for (const k of Object.keys(lintAs)) out.add(k);
    const hooks = doc[':hooks'];
    if (hooks && typeof hooks === 'object' && !Array.isArray(hooks)) {
      for (const kind of Object.values(hooks)) if (kind && typeof kind === 'object' && !Array.isArray(kind)) for (const k of Object.keys(kind)) out.add(k);
    }
  }
  return out;
}

const warned = new Set<string>();
const warnOnce = (message: string) => {
  if (warned.has(message)) return;
  warned.add(message);
  process.stderr.write(`clojure-atlas: ${message}\n`);
};

function git(root: string, args: string[], input?: string): string | null {
  try {
    return execFileSync('git', ['-C', root, ...args],
      { encoding: 'utf8', input, maxBuffer: 1 << 30, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

// The paths `git status --porcelain=v1 -z` names, sorted: a rename or copy names both its paths. They are relative to
// the top of the repository, not to the directory git ran in.
export function changedPaths(status: string): string[] {
  const tokens = status.split('\0').filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    out.push(tokens[i].slice(3));
    if (tokens[i][0] === 'R' || tokens[i][0] === 'C') out.push(tokens[++i]);
  }
  return out.sort();
}

// A file of the kinds the builder reads that is gone from the disk: only its extension tells.
const CODE_FILE = /\.(clj|cljs|cljc|edn|ts)$|(^|\/)package\.json$/;

// Which of the files the builder reads differ from the commit. `changed` are git's changed paths made relative to the
// analyzed directory: a file the builder reads counts; a directory is a submodule, so every file read under it
// counts; a path that is gone counts when it looks like code. `ignored` are the read files git ignores (never in the
// commit). Files the builder never reads (logs, build output) are not part of the snapshot.
export function dirtyFiles(analyzed: readonly string[], changed: readonly string[], ignored: readonly string[], isDirectory: (rel: string) => boolean,
  exists: (rel: string) => boolean): string[] {
  const read = new Set(analyzed);
  const out = new Set(ignored);
  for (const p of changed) {
    if (read.has(p)) out.add(p);
    else if (isDirectory(p)) {
      for (const f of analyzed) if (f.startsWith(`${p}/`)) out.add(f);
    } else if (!exists(p) && CODE_FILE.test(p)) out.add(p);
  }
  return [...out].sort();
}

interface Stamp { mtimeMs: number; size: number; hash: string }

// sha256 of a file's content, remembered per path while its modification time and size stay as they were: the MCP
// server asks again on every tool call.
export function fileHasher(read: (file: string) => Buffer = readFileSync): (abs: string) => string {
  const seen = new Map<string, Stamp>();
  return (abs) => {
    const st = statSync(abs, { throwIfNoEntry: false });
    if (!st?.isFile()) return 'deleted';
    const known = seen.get(abs);
    if (known && known.mtimeMs === st.mtimeMs && known.size === st.size) return known.hash;
    const hash = sha256(read(abs));
    seen.set(abs, { mtimeMs: st.mtimeMs, size: st.size, hash });
    return hash;
  };
}

const hashOf = fileHasher();

function readFileList(root: string): string[] {
  const f = listFiles(root);
  return [...f.sources, ...f.edn, ...f.typescript, ...f.packageJsons];
}

// The read files git ignores and does not track, which `git status` never lists. A tracked file is never one of them,
// so only the untracked ones are put to check-ignore: asking about every file of a large repository costs seconds.
export function ignoredAmong(root: string, files: readonly string[]): string[] {
  const tracked = git(root, ['ls-files', '-z', '--', '.']);
  const known = new Set(tracked === null ? [] : tracked.split('\0'));
  const untracked = files.filter((f) => !known.has(f));
  if (!untracked.length) return [];
  const out = git(root, ['check-ignore', '-z', '--stdin'], untracked.join('\0'));
  return out === null ? [] : out.split('\0').filter(Boolean);
}

// The sha of a tree git could not name (no repository, or git failed).
export const UNVERSIONED = 'unversioned';

export function snapshotOf(root: string, analyzer: string): Snapshot {
  const analyzed = readFileList(root);
  const prefix = git(root, ['rev-parse', '--show-prefix'])?.trim();
  let sha: string = UNVERSIONED;
  let ref: string | null = null;
  let dirtyList: string[];
  if (prefix === undefined) {
    warnOnce(`${root} is not a git checkout; the snapshot id follows the content of every file the build reads`);
    dirtyList = analyzed;
  } else {
    sha = git(root, ['rev-parse', 'HEAD'])?.trim() || sha;
    const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])?.trim();
    ref = branch && branch !== 'HEAD' ? branch : null;
    const status = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.']);
    if (status === null) warnOnce(`git status failed in ${root}; the snapshot id follows the content of every file the build reads`);
    const changed = changedPaths(status ?? '').filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length));
    const at = (rel: string) => path.join(root, rel);
    dirtyList = status === null ? analyzed : dirtyFiles(
      analyzed, changed, ignoredAmong(root, analyzed),
      (rel) => statSync(at(rel), { throwIfNoEntry: false })?.isDirectory() ?? false,
      (rel) => existsSync(at(rel)),
    );
  }
  const dirty = dirtyList.map((file): [string, string] => [file, hashOf(path.join(root, file))]);
  const configSourcesList = configSources(root);
  const configHash = sha256(configSourcesList.map((f) => `${f}\0${sha256(readFileSync(path.join(root, f)))}`).join('\n'));
  const id = sha256(JSON.stringify({ sha, dirty, configHash, analyzer })).slice(0, 16);
  return { id, sha, ref, dirty, configHash, configSources: configSourcesList, analyzer };
}

// A snapshot function that walks the tree at most once per `ttlMs`: the MCP server asks on every tool call, and a walk
// of a large repository takes seconds. An edit shows from the first call after the window ends.
export const SNAPSHOT_TTL_MS = 3000;

export function cachedSnapshot(take: () => Snapshot, ttlMs: number, now: () => number = Date.now): () => Snapshot {
  let last: { at: number; snapshot: Snapshot } | undefined;
  return () => {
    const at = now();
    if (!last || at - last.at >= ttlMs || at < last.at) last = { at, snapshot: take() };
    return last.snapshot;
  };
}

export const analyzerVersion = (kondoVersion: string) => `clojure-atlas ${VERSION}, ${kondoVersion}`;

// The analyzer identity of a working tree checked against a graph, without running clj-kondo: this clojure-atlas
// version with the clj-kondo version the graph records (the release atlas pins comes with its version).
export function analyzerFor(graphAnalyzer: string | undefined): string {
  const kondo = graphAnalyzer?.split(', ').slice(1).join(', ');
  return kondo ? analyzerVersion(kondo) : '';
}
