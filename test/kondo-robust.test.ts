// A project's clj-kondo hooks are project code kondo runs. One that prints must not corrupt the analysis, one that never
// returns must not hang the build, and every failure says why.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { buildGraph } from '../src/build/index.ts';
import { analysisJson, analyze } from '../src/build/kondo.ts';
import { kondo } from '../src/build/kondo-binary.ts';
import { degradedLine, degradation } from '../src/mcp/degraded.ts';

const top = mkdtempSync(path.join(tmpdir(), 'atlas-hooks-'));
after(() => rmSync(top, { recursive: true, force: true }));

const CORE = '(ns demo.core)\n(defmacro mymacro [& body] `(do ~@body))\n(defn f [] (mymacro (+ 1 2)))\n';
const GOOD = '(ns demo.good)\n(defn g [] 1)\n';

function repoWithHook(name: string, hookBody: string): string {
  const root = path.join(top, name);
  mkdirSync(path.join(root, '.clj-kondo/hooks'), { recursive: true });
  mkdirSync(path.join(root, 'src/demo'), { recursive: true });
  writeFileSync(path.join(root, '.clj-kondo/config.edn'), '{:hooks {:analyze-call {demo.core/mymacro hooks.h/mymacro}}}');
  writeFileSync(path.join(root, '.clj-kondo/hooks/h.clj'), `(ns hooks.h)\n(defn mymacro [{:keys [node]}] ${hookBody} node)\n`);
  writeFileSync(path.join(root, 'src/demo/core.clj'), CORE);
  writeFileSync(path.join(root, 'src/demo/good.clj'), GOOD);
  execFileSync('git', ['-C', root, 'init', '-q']);
  execFileSync('git', ['-C', root, 'add', '-A']);
  return root;
}

let cmd = '';
before(async () => {
  cmd = (await kondo()).command;
});

describe('analysisJson', () => {
  it('finds the document after noise, with or without a newline, and ignores a marker inside the noise', () => {
    const doc = '{"findings":[],"analysis":{}}';
    assert.deepEqual(analysisJson(doc), { findings: [], analysis: {} });
    assert.deepEqual(analysisJson(`noise${doc}\n`), { findings: [], analysis: {} });
    assert.deepEqual(analysisJson(`line\n{"findings":oops\n${doc}`), { findings: [], analysis: {} });
    assert.equal(analysisJson('{"findings":'), null);
    assert.equal(analysisJson('nothing'), null);
  });
});

describe('a hook that prints to stdout', () => {
  it('does not corrupt the analysis', async () => {
    const root = repoWithHook('print', '(print "noise-without-newline") (println "noise")');
    const { analysis, timedOut } = await analyze(cmd, root, ['src/demo/core.clj'], {});
    assert.deepEqual(timedOut, []);
    assert.ok(analysis.varDefs.some((d) => d.name === 'f'));
  });
});

describe('a hook that never returns', () => {
  const LOOP = '(loop [] (recur))';
  it('is killed at the timeout and its batch is reported, the other batches still run', async () => {
    const root = repoWithHook('loop', LOOP);
    const started = Date.now();
    const { analysis, timedOut } = await analyze(cmd, root, ['src/demo/core.clj', 'src/demo/good.clj'], {}, { timeoutMs: 4000, maxFilesPerRun: 1 });
    assert.ok(Date.now() - started < 30_000);
    assert.deepEqual(timedOut, ['src/demo/core.clj']);
    assert.ok(analysis.varDefs.some((d) => d.name === 'g'));
    assert.ok(!analysis.varDefs.some((d) => d.name === 'f'));
  });

  it('a build records the timed-out files in DEGRADED', async () => {
    const root = repoWithHook('loop-build', LOOP);
    const doc = await buildGraph(root, undefined, { timeoutMs: 4000, maxFilesPerRun: 1 });
    assert.deepEqual(doc.stats.files.timed_out_names, ['src/demo/core.clj']);
    assert.equal(doc.stats.files.timed_out, 1);
    const line = degradedLine(degradation(doc)!);
    assert.match(line, /1 file\(s\) were not analyzed because clj-kondo did not finish on them \(src\/demo\/core\.clj\)/);
  });
});

// A clj-kondo that hangs the way a very deeply nested file makes it hang: only with --parallel (`parallelOnly`), or on
// the file named bad.clj whatever the flags. Everything else runs the real binary; a log line per run says what ran.
function hangingKondo(name: string, parallelOnly: boolean): { wrapper: string; log: string } {
  const wrapper = path.join(top, `${name}.sh`);
  const log = path.join(top, `${name}.log`);
  const hang = parallelOnly
    ? 'case " $* " in *" --parallel "*) case " $* " in *bad.clj*) exec sleep 30;; esac;; esac'
    : 'case " $* " in *bad.clj*) exec sleep 30;; esac';
  writeFileSync(wrapper, `#!/bin/sh\ncase " $* " in *" --parallel "*) echo parallel >> '${log}';; *) echo serial >> '${log}';; esac\n${hang}\nexec '${cmd}' "$@"\n`);
  chmodSync(wrapper, 0o755);
  return { wrapper, log };
}

function repoOfFiles(name: string, names: string[]): { root: string; files: string[] } {
  const root = path.join(top, name);
  mkdirSync(path.join(root, 'src/demo'), { recursive: true });
  for (const n of names) writeFileSync(path.join(root, 'src/demo', n), `(ns demo.${n.replace('.clj', '')})\n(defn ${n.replace('.clj', '')}-fn [] 1)\n`);
  return { root, files: names.map((n) => `src/demo/${n}`) };
}

describe('a batch that times out is retried without --parallel in smaller batches', () => {
  const quiet = async <T>(f: () => Promise<T>): Promise<{ result: T; stderr: string }> => {
    const real = process.stderr.write;
    let stderr = '';
    process.stderr.write = ((c: string) => { stderr += String(c); return true; }) as typeof process.stderr.write;
    try {
      return { result: await f(), stderr };
    } finally {
      process.stderr.write = real;
    }
  };

  it('a file that only hangs under --parallel is analyzed by the retry: nothing is left out', async () => {
    const { wrapper, log } = hangingKondo('par-only', true);
    const { root, files } = repoOfFiles('par-only', ['a.clj', 'bad.clj', 'c.clj', 'd.clj']);
    const { result, stderr } = await quiet(() => analyze(wrapper, root, files, {}, { timeoutMs: 2000 }));
    assert.deepEqual(result.timedOut, []);
    assert.deepEqual(result.analysis.varDefs.map((d) => d.name).sort(), ['a-fn', 'bad-fn', 'c-fn', 'd-fn']);
    assert.match(readFileSync(log, 'utf8'), /serial/);
    assert.match(stderr, /retrying them in smaller batches without --parallel/);
    assert.doesNotMatch(stderr, /a hook that never returns\?\)/);
  });

  it('a file that hangs whatever the flags is reported by name, the others are saved', async () => {
    const { wrapper } = hangingKondo('always', false);
    const { root, files } = repoOfFiles('always', ['a.clj', 'bad.clj', 'c.clj', 'd.clj']);
    const started = Date.now();
    const { result, stderr } = await quiet(() => analyze(wrapper, root, files, {}, { timeoutMs: 2000 }));
    assert.deepEqual(result.timedOut, ['src/demo/bad.clj']);
    assert.deepEqual(result.analysis.varDefs.map((d) => d.name).sort(), ['a-fn', 'c-fn', 'd-fn']);
    assert.ok(Date.now() - started < 20_000, 'the retry is bounded');
    assert.match(stderr, /src\/demo\/bad\.clj/);
    assert.match(stderr, /a hook that never returns, or a file clj-kondo cannot finish/);
  });
});
