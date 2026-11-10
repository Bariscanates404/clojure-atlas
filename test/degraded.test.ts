// A file kondo cannot parse and an edge with a missing end are "not extracted", never "none": the build log, graph_info
// and every answer say so, and a name from an unparsed namespace is not blamed on its spelling.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { assemble, type AtlasDocument } from '../src/build/assemble.ts';
import { EMPTY_CONFIG } from '../src/build/config.ts';
import { createContext, type Adapter } from '../src/build/model.ts';
import { degradation, degradedLine, unparsedFor } from '../src/mcp/degraded.ts';
import { indexGraph } from '../src/mcp/graph.ts';
import { callTool } from '../src/mcp/server.ts';
import { fixtureDir } from './helpers/atlas-fixture.ts';
import { graphOf } from './helpers/inline-graph.ts';

const NO_LARGE = { files: 0, names: [] };
const CORE = '(ns demo.core)\n(defn target [a] (inc a))\n(defn lonely [] 1)\n(defn user [] (target 1))\n';
const BROKEN = '(ns demo.broken\n  (:require [demo.core :as c]))\n(defn oops [] (c/target 2)\n';

let doc: AtlasDocument;
before(async () => {
  doc = await graphOf({ 'src/demo/core.clj': CORE, 'src/demo/broken.clj': BROKEN });
});
const g = () => indexGraph(doc);
const ask = (tool: string, args: Record<string, unknown>) => callTool(g(), tool, args);

describe('degraded builds: what the graph carries', () => {
  it('names the files kondo could not parse, beside the exact count', () => {
    assert.equal(doc.stats.syntax_errors.files, 1);
    assert.deepEqual(doc.stats.syntax_errors.names, ['src/demo/broken.clj']);
  });
});

describe('degraded builds: answers', () => {
  it('a found answer carries the DEGRADED line too (its callers may sit in the unparsed file)', () => {
    const t = ask('callers', { var: 'demo.core/target' }).text;
    assert.match(t, /DEGRADED: 1 file\(s\) could not be parsed \(src\/demo\/broken\.clj\)/);
  });

  it('an empty answer says it may be a gap, not absence', () => {
    const r = ask('callers', { var: 'demo.core/lonely' });
    assert.match(r.text, /^DEGRADED: /);
    assert.match(r.text, /0 direct caller/);
  });

  it('a name from the unparsed namespace is not blamed on its spelling', () => {
    const r = ask('callers', { var: 'demo.broken/oops' });
    assert.match(r.text, /DEGRADED: 1 file\(s\) could not be parsed/);
    assert.match(r.text, /demo\.broken\/oops probably lives in src\/demo\/broken\.clj, which could not be parsed/);
    assert.doesNotMatch(r.text, /check the spelling/);
  });

  it('a name that matches no unparsed file keeps the spelling hint', () => {
    const t = ask('callers', { var: 'demo.nowhere/x' }).text;
    assert.match(t, /check the spelling/);
    assert.match(t, /DEGRADED/);
    assert.doesNotMatch(t, /which could not be parsed\n/);
  });

  it('graph_info states it, and json answers carry it in source', () => {
    assert.match(ask('graph_info', {}).text, /^DEGRADED: 1 file\(s\) could not be parsed/m);
    const j = JSON.parse(ask('callers', { var: 'demo.core/target', response_format: 'json' }).text);
    assert.match(j.source.degraded, /^DEGRADED: 1 file/);
  });

  it('a clean graph says nothing', () => {
    const clean = indexGraph({ ...doc, stats: { ...doc.stats, syntax_errors: { files: 0, errors: 0, names: [] }, dropped_edges: 0 } } as AtlasDocument);
    assert.doesNotMatch(callTool(clean, 'callers', { var: 'demo.core/target' }).text, /DEGRADED/);
    assert.doesNotMatch(callTool(clean, 'graph_info', {}).text, /DEGRADED/);
  });
});

describe('files over the size limit', () => {
  const HUGE = `(ns app.big)\n(defn huge-fn [] 1)\n;${'x'.repeat(2 * 1024 * 1024)}\n`;
  let big: AtlasDocument;
  before(async () => {
    big = await graphOf({ 'src/app/big.clj': HUGE, 'src/app/use.clj': '(ns app.use (:require [app.big :as b]))\n(defn go [] (b/huge-fn))\n' });
  });
  const askBig = (tool: string, args: Record<string, unknown>) => callTool(indexGraph(big), tool, args).text;

  it('are counted with their names in the build stats', () => {
    assert.equal(big.stats.files.skipped_large, 1);
    assert.deepEqual(big.stats.files.skipped_large_names, ['src/app/big.clj']);
  });

  it('are named in the DEGRADED line of an answer and of graph_info', () => {
    assert.match(askBig('graph_info', {}), /^DEGRADED: 1 file\(s\) over 2 MB were skipped \(src\/app\/big\.clj\), so their definitions and calls are missing/m);
    assert.match(askBig('callers', { var: 'app.use/go' }), /DEGRADED: 1 file\(s\) over 2 MB were skipped/);
  });

  it('a name that matches a skipped file is not blamed on its spelling', () => {
    const t = askBig('callers', { var: 'app.big/huge-fn' });
    assert.match(t, /app\.big\/huge-fn probably lives in src\/app\/big\.clj, which is over 2 MB and was skipped/);
    assert.doesNotMatch(t, /check the spelling/);
  });

  it('are listed in the build log line, three names at most', () => {
    const line = degradedLine({ files: 0, names: [], edges: 0, large: { files: 5, names: ['a.clj', 'b.clj', 'c.clj', 'd.clj', 'e.clj'] }, duplicates: [] });
    assert.match(line, /5 file\(s\) over 2 MB were skipped \(a\.clj, b\.clj, c\.clj, \.\.\.\)/);
  });
});

describe('degradation helpers', () => {
  it('reads nothing from a graph without stats, and ignores malformed ones', () => {
    assert.equal(degradation({ format: 'code-graph', version: 2, source: { sha: 'a' }, capabilities: [], nodes: [], edges: [] }), null);
    assert.equal(degradation({ stats: { syntax_errors: { files: 'x', names: 7 }, dropped_edges: 'y' } } as never), null);
  });

  it('lists the first three files and the dropped edges', () => {
    const line = degradedLine({ files: 5, names: ['a.clj', 'b.clj', 'c.clj', 'd.clj', 'e.clj'], edges: 670, large: NO_LARGE, duplicates: [] });
    assert.match(line, /5 file\(s\) could not be parsed \(a\.clj, b\.clj, c\.clj, \.\.\.\)/);
    assert.match(line, /670 edge\(s\) dropped because an end was not a node/);
    assert.match(degradedLine({ files: 0, names: [], edges: 2, large: NO_LARGE, duplicates: [] }), /^DEGRADED: 2 edge\(s\) dropped/);
    assert.match(degradedLine({ files: 2, names: [], edges: 0, large: NO_LARGE, duplicates: [] }), /^DEGRADED: 2 file\(s\) could not be parsed, so/);
  });

  it('matches a namespace to a path with dashes as underscores, and a path to itself', () => {
    const d = { files: 2, names: ['src/my_app/core_x.cljc', 'docs/a.clj'], edges: 0, large: NO_LARGE, duplicates: [] };
    assert.deepEqual(unparsedFor(d, 'my-app.core-x/f'), ['src/my_app/core_x.cljc']);
    assert.deepEqual(unparsedFor(d, 'docs/a.clj'), ['docs/a.clj']);
    assert.deepEqual(unparsedFor(d, 'other.ns/f'), []);
    assert.deepEqual(unparsedFor(null, 'x'), []);
    assert.deepEqual(unparsedFor(d, ''), []);
  });
});

describe('dropped edges', () => {
  it('are counted when an end is not a node, and surface in graph_info', async () => {
    const adapter: Adapter = {
      name: 'fake', edgeKinds: ['calls'], detect: () => 'test', run: () => ({
        nodes: [{ id: 'x:a', kind: 'x', name: 'a' }],
        edges: [
          { from: 'x:a', to: 'x:missing', kind: 'calls', band: 'static_proven', file: 'f.clj', line: 1 },
          { from: 'x:ghost', to: 'x:a', kind: 'calls', band: 'static_proven', file: 'f.clj', line: 2 },
        ],
      }),
    };
    const empty = { nsDefs: [], nsUses: [], varDefs: [], varUses: [], keywords: [], protocolImpls: [], syntaxErrors: [] };
    const ctx = createContext(empty, EMPTY_CONFIG, { projects: [], skipped: [] }, new Map(), [], () => undefined);
    const d = assemble(ctx, [adapter], { sha: 'a' }, { expected: 0, sources: 0, edn: 0, skipped_large: 0, skipped_large_names: [] });
    assert.equal(d.stats.dropped_edges, 2);
    assert.match(callTool(indexGraph(d), 'graph_info', {}).text, /DEGRADED: 2 edge\(s\) dropped because an end was not a node/);
  });
});

describe('the build log', () => {
  const work = mkdtempSync(path.join(tmpdir(), 'atlas-degraded-'));
  after(() => rmSync(work, { recursive: true, force: true }));
  it('prints the DEGRADED line when a file could not be parsed', () => {
    const repo = path.join(work, 'repo');
    cpSync(fixtureDir('core'), repo, { recursive: true });
    mkdirSync(path.join(repo, 'src', 'demo'), { recursive: true });
    writeFileSync(path.join(repo, 'src', 'demo', 'broken_one.clj'), BROKEN);
    const git = (...a: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a]);
    git('init', '-q');
    git('add', '.');
    git('commit', '-qm', 'one');
    const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.ts');
    const r = spawnSync(process.execPath, [cli, 'build', repo], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /\nclojure-atlas: DEGRADED: 1 file\(s\) could not be parsed \(src\/demo\/broken_one\.clj\)/);
  });
});
