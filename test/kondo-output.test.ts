// A project's own clj-kondo config must not change what atlas reads: output paths stay relative to the repository,
// and a file whose name looks like an option is still analyzed.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { buildGraph } from '../src/build/index.ts';
import { analyze, asArgument, config, requireRelativePaths } from '../src/build/kondo.ts';
import { kondo } from '../src/build/kondo-binary.ts';

const top = mkdtempSync(path.join(tmpdir(), 'atlas-output-'));
after(() => rmSync(top, { recursive: true, force: true }));
let cmd = '';
before(async () => { cmd = (await kondo()).command; });

const SRC = '(ns demo.core)\n(defn f [] 1)\n(defn g [] (f))\n';
function repo(name: string, kondoConfig: string, files: Record<string, string> = { 'src/demo/core.clj': SRC }): string {
  const root = path.join(top, name);
  mkdirSync(path.join(root, '.clj-kondo'), { recursive: true });
  writeFileSync(path.join(root, '.clj-kondo/config.edn'), kondoConfig);
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    writeFileSync(path.join(root, f), text);
  }
  return root;
}

describe('the project config cannot change what the analysis contains', () => {
  it('canonical-paths, file filters and analysis switches in the project config do not take effect', async () => {
    const plain = repo('plain', '{}');
    const hostile = repo('hostile', '{:output {:canonical-paths true :exclude-files ["demo"]} :analysis {:var-usages false :var-definitions false}}');
    const a = await analyze(cmd, plain, ['src/demo/core.clj'], {});
    const b = await analyze(cmd, hostile, ['src/demo/core.clj'], {});
    assert.deepEqual(b.analysis, a.analysis);
    assert.equal(b.analysis.varDefs.length, 2);
    assert.ok(b.analysis.varDefs.every((d) => d.file === 'src/demo/core.clj'));
  });
  it('the graph of a project that forces canonical paths equals the graph without that config', async () => {
    const plain = await buildGraph(repo('g-plain', '{}'));
    const hostile = await buildGraph(repo('g-hostile', '{:output {:canonical-paths true}}'));
    assert.equal(hostile.nodes.length, plain.nodes.length);
    assert.equal(hostile.edges.length, plain.edges.length);
    assert.ok(hostile.nodes.length > 0);
    assert.ok(!JSON.stringify(hostile).includes(top));
  });
  it('config pins canonical-paths off', () => {
    assert.match(config({}), /:canonical-paths false/);
  });
});

describe('requireRelativePaths', () => {
  it('strips the ./ kondo echoes and leaves relative paths alone', () => {
    const json = { findings: [{ filename: './--x.clj' }], analysis: { 'var-definitions': [{ filename: 'src/a.clj' }, { filename: './--x.clj' }], other: 'x' } };
    requireRelativePaths(json, 'src/a.clj');
    assert.equal(json.findings[0].filename, '--x.clj');
    assert.deepEqual(json.analysis['var-definitions'].map((r) => r.filename), ['src/a.clj', '--x.clj']);
  });
  it('fails loudly, naming the path and the likely cause, on an absolute path (posix or Windows)', () => {
    assert.throws(() => requireRelativePaths({ analysis: { keywords: [{ filename: '/home/me/repo/a.clj' }] } }, 'a.clj'), /absolute path \/home\/me\/repo\/a\.clj for files from a\.clj.*canonical-paths/);
    assert.throws(() => requireRelativePaths({ findings: [{ filename: 'C:\\repo\\a.clj' }] }, 'a.clj'), /absolute path/);
    assert.doesNotThrow(() => requireRelativePaths({}, 'a.clj'));
    assert.doesNotThrow(() => requireRelativePaths({ findings: 'x', analysis: { k: [null, {}] } } as never, 'a.clj'));
  });
});

describe('files named like options', () => {
  it('asArgument only touches names that start with a dash', () => {
    assert.deepEqual(['--debug.clj', '-x.clj', 'src/-a.clj', 'a.clj'].map(asArgument), ['./--debug.clj', './-x.clj', 'src/-a.clj', 'a.clj']);
  });
  it('a root --debug.clj and --config.clj are analyzed, under their own names', async () => {
    const root = repo('dash', '{}', { '--debug.clj': '(ns debug)\n(defn d [] 1)\n', '--config.clj': '(ns config)\n(defn c [] 1)\n', 'ok.clj': '(ns ok)\n' });
    const { analysis } = await analyze(cmd, root, ['--config.clj', '--debug.clj', 'ok.clj'], {});
    assert.deepEqual(analysis.varDefs.map((d) => `${d.file}:${d.name}`).sort(), ['--config.clj:c', '--debug.clj:d']);
    const doc = await buildGraph(root);
    assert.ok(doc.nodes.some((n) => JSON.stringify(n).includes('--debug.clj')));
  });
});

describe('the program must not live in the analyzed repository', () => {
  it('analyze refuses a kondo path inside the repo', async () => {
    const root = repo('planted', '{}');
    await assert.rejects(analyze(path.join(root, 'bin', 'clj-kondo'), root, ['src/demo/core.clj'], {}), /inside the analyzed repository/);
  });
});
