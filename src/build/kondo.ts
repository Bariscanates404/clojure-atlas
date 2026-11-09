// Runs the clj-kondo binary from the npm "clj-kondo" package over a list of files and returns its analysis.
// Files go in chunks (command-line length) that run in parallel; the repo's own .clj-kondo config applies
// (kondo runs in the repo root), the user's home config and the cache do not. Java class usages are not asked
// for: clj-kondo 2025.10.23 fails to encode them as JSON on some codebases.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { availableParallelism } from 'node:os';
import path from 'node:path';
import { concat, normalize, type Analysis } from './analysis.ts';

// Library macros that define a var but that clj-kondo does not know without the library's exported config.
const LINT_AS: Record<string, string> = { 'mount.core/defstate': 'clojure.core/def', 'mount.lite/defstate': 'clojure.core/def' };

const config = (lintAs: Record<string, string>) => `{:output {:format :json}
 :lint-as {${Object.entries({ ...LINT_AS, ...lintAs }).map(([k, v]) => `${k} ${v}`).join(' ')}}
 :linters ^:replace {:syntax {:level :error}}
 :analysis {:keywords true :context true :protocol-impls true :locals false}}`;

const CHUNK = 300;

// The npm "clj-kondo" package when it is installed (its bin is a node script), else clj-kondo on PATH (the
// single-file bundle runs without node_modules).
export function kondoCommand(): string[] {
  try {
    const pkg = createRequire(import.meta.url).resolve('clj-kondo/package.json');
    return [process.execPath, path.join(path.dirname(pkg), 'bin', 'clj-kondo')];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'MODULE_NOT_FOUND') throw err;
    return ['clj-kondo'];
  }
}

function runChunk(root: string, files: string[], lintAs: Record<string, string>): Promise<Analysis> {
  return new Promise((resolve, reject) => {
    const [cmd, ...pre] = kondoCommand();
    const child = spawn(cmd, [...pre, '--repro', '--cache', 'false', '--parallel', '--config', config(lintAs), '--lint', ...files], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => err.push(d));
    child.on('error', (err) => reject(new Error(`cannot run ${cmd}: ${err.message}; install the npm package clj-kondo or put clj-kondo on PATH`)));
    child.on('close', (code) => {
      // kondo exits 2 or 3 when it reports warnings or errors; the JSON is complete either way
      const text = Buffer.concat(out).toString('utf8');
      if (!text.trim().startsWith('{')) {
        const why = Buffer.concat(err).toString('utf8').split('\n').filter((l) => l.trim() && !l.startsWith('WARNING')).slice(0, 3).join(' | ');
        reject(new Error(`clj-kondo exited ${code} without analysis on ${files.length} file(s) from ${files[0]}: ${why}`));
        return;
      }
      resolve(normalize(JSON.parse(text) as Record<string, unknown>));
    });
  });
}

export async function analyze(root: string, files: string[], lintAs: Record<string, string> = {}): Promise<Analysis> {
  const chunks: string[][] = [];
  for (let k = 0; k < files.length; k += CHUNK) chunks.push(files.slice(k, k + CHUNK));
  const lanes = Math.max(1, Math.min(chunks.length, Math.floor(availableParallelism() / 2)));
  const results: Analysis[] = new Array(chunks.length);
  let nextChunk = 0;
  await Promise.all(Array.from({ length: lanes }, async () => {
    while (nextChunk < chunks.length) {
      const k = nextChunk++;
      results[k] = await runChunk(root, chunks[k], lintAs);
    }
  }));
  return concat(results);
}
