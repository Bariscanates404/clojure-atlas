// What a graph was built from, as one id: the commit, every dirty or untracked file's content, the configuration that
// shapes the analysis (the project's clj-kondo config files and .clojure-atlas.edn) and the analyzer versions. A
// working tree with another id is not what the graph describes.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { ednValue } from './build/config.ts';
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

function git(root: string, ...args: string[]): string | null {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (err) {
    process.stderr.write(`clojure-atlas: git ${args[0]} failed in ${root}: ${(err as Error).message.split('\n')[0]}\n`);
    return null;
  }
}

// The paths `git status --porcelain=v1 -z` names, sorted: a rename or copy names both its paths. The graph
// clojure-atlas writes is output, not input.
export function changedPaths(status: string): string[] {
  const tokens = status.split('\0').filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    out.push(tokens[i].slice(3));
    if (tokens[i][0] === 'R' || tokens[i][0] === 'C') out.push(tokens[++i]);
  }
  return out.filter((f) => !f.startsWith('.clojure-atlas/')).sort();
}

// The sha of a tree git could not name (no repository, or git failed).
export const UNVERSIONED = 'unversioned';

export function snapshotOf(root: string, analyzer: string): Snapshot {
  const sha = git(root, 'rev-parse', 'HEAD')?.trim() || UNVERSIONED;
  const branch = git(root, 'rev-parse', '--abbrev-ref', 'HEAD')?.trim();
  const ref = branch && branch !== 'HEAD' ? branch : null;
  const status = git(root, 'status', '--porcelain=v1', '-z', '--untracked-files=all') ?? '';
  const dirty: [string, string][] = changedPaths(status).map((file): [string, string] => {
    const abs = path.join(root, file);
    return [file, existsSync(abs) && statSync(abs).isFile() ? sha256(readFileSync(abs)) : 'deleted'];
  });
  const configSourcesList = configSources(root);
  const configHash = sha256(configSourcesList.map((f) => `${f}\0${sha256(readFileSync(path.join(root, f)))}`).join('\n'));
  const id = sha256(JSON.stringify({ sha, dirty, configHash, analyzer })).slice(0, 16);
  return { id, sha, ref, dirty, configHash, configSources: configSourcesList, analyzer };
}

export const analyzerVersion = (kondoVersion: string) => `clojure-atlas ${VERSION}, ${kondoVersion}`;
