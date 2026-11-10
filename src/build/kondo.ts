// Runs clj-kondo (see kondo-binary.ts) over a list of files and returns its analysis.
// Files go in chunks (command-line length) that run in parallel; the repo's own .clj-kondo config applies
// (kondo runs in the repo root), the user's home config and the cache do not. Java class usages are not asked
// for: clj-kondo 2025.10.23 fails to encode them as JSON on some codebases.
import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { concat, normalize, type Analysis } from './analysis.ts';

// Library macros that define a var but that clj-kondo does not know without the library's exported config, and
// re-frame.alpha's re-exports of re-frame.core, which clj-kondo's re-frame analysis knows only under re-frame.core.
export const BUILT_IN_LINT_AS: Record<string, string> = {
  'mount.core/defstate': 'clojure.core/def',
  'mount.lite/defstate': 'clojure.core/def',
  ...Object.fromEntries(['reg-event-db', 'reg-event-fx', 'reg-event-ctx', 'reg-sub', 'reg-sub-raw', 'dispatch', 'dispatch-sync', 'subscribe']
    .map((n) => [`re-frame.alpha/${n}`, `re-frame.core/${n}`])),
};

// The lint-as atlas adds: its built-ins only where the project's own clj-kondo config says nothing about the symbol
// (its lint-as or hooks win), then what .clojure-atlas.edn declares.
export function effectiveLintAs(projectKnown: ReadonlySet<string>, declared: Record<string, string>): Record<string, string> {
  const builtIns = Object.entries(BUILT_IN_LINT_AS).filter(([k]) => !projectKnown.has(k));
  return { ...Object.fromEntries(builtIns), ...declared };
}

const config = (lintAs: Record<string, string>) => `{:output {:format :json}
 :lint-as {${Object.entries(lintAs).map(([k, v]) => `${k} ${v}`).join(' ')}}
 :linters ^:replace {:syntax {:level :error}}
 :analysis {:keywords true :context true :protocol-impls true :locals false}}`;

const CHUNK = 300;
// Windows refuses a command line over 32767 characters; the file names get most of that.
const CHUNK_CHARS = 24_000;

// Consecutive runs of files, each at most `CHUNK` files and `CHUNK_CHARS` characters of file names (a single longer
// name still gets a run of its own).
export function chunkFiles(files: readonly string[], maxFiles = CHUNK, maxChars = CHUNK_CHARS): string[][] {
  const chunks: string[][] = [];
  let chars = 0;
  for (const f of files) {
    const last = chunks[chunks.length - 1];
    if (!last || last.length >= maxFiles || chars + f.length + 1 > maxChars) {
      chunks.push([f]);
      chars = f.length + 1;
    } else {
      last.push(f);
      chars += f.length + 1;
    }
  }
  return chunks;
}

// A run that did not finish in time: kondo was killed, its files have no analysis.
class TimedOut extends Error {}

const head = (text: string, max = 300): string => text.replace(/\s+/g, ' ').trim().slice(0, max);

// The analysis kondo prints is one JSON document that starts with its findings. A hook (project code kondo runs) can
// print to stdout before it, even without a newline, so the document is looked for from the end: the last place the
// text from there to the end parses.
const JSON_START = '{"findings":';

export function analysisJson(text: string): Record<string, unknown> | null {
  for (let at = text.lastIndexOf(JSON_START); at >= 0; at = text.lastIndexOf(JSON_START, at - 1)) {
    try {
      return JSON.parse(text.slice(at)) as Record<string, unknown>;
    } catch {
      // noise that happens to contain the marker; an earlier start may be the document
    }
    if (at === 0) break;
  }
  return null;
}

function runChunk(cmd: string, root: string, files: string[], lintAs: Record<string, string>, timeoutMs: number): Promise<Analysis> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, ['--repro', '--cache', 'false', '--parallel', '--config', config(lintAs), '--lint', ...files], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => err.push(d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`cannot run ${cmd}: ${e.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new TimedOut(`clj-kondo did not finish within ${Math.round(timeoutMs / 1000)} s on ${files.length} file(s) from ${files[0]} (a hook that never returns?)`));
        return;
      }
      // kondo exits 2 or 3 when it reports warnings or errors; the JSON is complete either way
      const text = Buffer.concat(out).toString('utf8');
      const json = analysisJson(text);
      if (!json) {
        const stderr = Buffer.concat(err).toString('utf8').split('\n').filter((l) => l.trim() && !l.startsWith('WARNING')).slice(0, 3).join(' | ');
        const why = [stderr && `stderr: ${head(stderr)}`, text.trim() && `stdout: ${head(text)}`].filter(Boolean).join('; ') || 'no output';
        reject(new Error(`clj-kondo exited ${code} without analysis on ${files.length} file(s) from ${files[0]}: ${why}`));
        return;
      }
      resolve(normalize(json));
    });
  });
}

export interface AnalyzeOptions {
  // per run; by default 60 s, or one second per file when that is more
  timeoutMs?: number;
  maxFilesPerRun?: number;
}

export interface Analyzed {
  analysis: Analysis;
  // files of runs that were killed for taking too long: no analysis for them
  timedOut: string[];
}

export async function analyze(cmd: string, root: string, files: string[], lintAs: Record<string, string>, opts: AnalyzeOptions = {}): Promise<Analyzed> {
  const chunks = chunkFiles(files, opts.maxFilesPerRun);
  const lanes = Math.max(1, Math.min(chunks.length, Math.floor(availableParallelism() / 2)));
  const results: Analysis[] = new Array(chunks.length);
  const timedOut: string[] = [];
  let nextChunk = 0;
  await Promise.all(Array.from({ length: lanes }, async () => {
    while (nextChunk < chunks.length) {
      const k = nextChunk++;
      const chunk = chunks[k];
      try {
        results[k] = await runChunk(cmd, root, chunk, lintAs, opts.timeoutMs ?? Math.max(60_000, chunk.length * 1000));
      } catch (e) {
        if (!(e instanceof TimedOut)) throw e;
        process.stderr.write(`clojure-atlas: ${e.message}; those files are left out\n`);
        timedOut.push(...chunk);
      }
    }
  }));
  return { analysis: concat(results.filter((r) => r !== undefined)), timedOut: timedOut.sort() };
}
