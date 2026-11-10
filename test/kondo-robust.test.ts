// A project's clj-kondo hooks are project code kondo runs. One that prints must not corrupt the analysis, one that never
// returns must not hang the build, and every failure says why.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
