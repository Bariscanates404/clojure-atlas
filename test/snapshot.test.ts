// The snapshot identity and the working-tree staleness it drives; the project's clj-kondo config wins over atlas's.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { BUILT_IN_LINT_AS, effectiveLintAs } from '../src/build/kondo.ts';
import { graphFromJson } from '../src/mcp/graph.ts';
import { graphInfo } from '../src/mcp/server.ts';
import { gitDistance, staleness } from '../src/mcp/staleness.ts';
import { changedPaths, configSources, projectKnownSymbols, snapshotOf } from '../src/snapshot.ts';

const root = mkdtempSync(path.join(tmpdir(), 'atlas-snapshot-'));
after(() => rmSync(root, { recursive: true, force: true }));
const put = (rel: string, body: string) => {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), body);
};
const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });

describe('snapshot', () => {
  put('src/a.clj', '(ns a)');
  put('.clj-kondo/config.edn', '{:config-paths ["../vendor/kondo"] :lint-as {mount.core/defstate clojure.core/defonce}}');
  put('vendor/kondo/config.edn', '{:hooks {:analyze-call {my.lib/defthing hooks/defthing}}}');
  put('.clj-kondo/acme/widgets/config.edn', '{:lint-as {acme.widgets/defwidget clojure.core/def}}');
  git('init', '-q');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');

  it('lists the project config files clj-kondo reads, imports and config paths included', () => {
    assert.deepEqual(configSources(root), ['.clj-kondo/config.edn', 'vendor/kondo/config.edn', '.clj-kondo/acme/widgets/config.edn']);
  });

  it('never overrides what the project config already says about a symbol', () => {
    const known = projectKnownSymbols(root);
    assert.deepEqual([...known].sort(), ['acme.widgets/defwidget', 'mount.core/defstate', 'my.lib/defthing']);
    const lintAs = effectiveLintAs(known, { 'x.y/defz': 'clojure.core/def' });
    assert.equal(lintAs['mount.core/defstate'], undefined);
    assert.equal(lintAs['mount.lite/defstate'], BUILT_IN_LINT_AS['mount.lite/defstate']);
    assert.equal(lintAs['x.y/defz'], 'clojure.core/def');
  });

  it('a change in a file, the config or the analyzer changes the id; the graph output does not', () => {
    const a = snapshotOf(root, 'v1');
    put('.clojure-atlas/graph.json.gz', 'x');
    assert.equal(snapshotOf(root, 'v1').id, a.id);
    assert.notEqual(snapshotOf(root, 'v2').id, a.id);
    put('src/a.clj', '(ns a) (def x 1)');
    const b = snapshotOf(root, 'v1');
    assert.notEqual(b.id, a.id);
    assert.deepEqual(b.dirty.map(([f]) => f), ['src/a.clj']);
    put('vendor/kondo/config.edn', '{}');
    assert.notEqual(snapshotOf(root, 'v1').configHash, b.configHash);
  });

  it('measures the commit distance with git, and answers null where git cannot', () => {
    const head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    assert.equal(gitDistance(root)(head, head), 0);
    assert.equal(gitDistance(root)('0'.repeat(40), head), null);
  });

  it('reads both paths of a rename or copy from git status, and leaves the graph output out', () => {
    const status = [' M src/a.clj', 'R  src/new.clj', 'src/old.clj', 'C  src/copy.clj', 'src/orig.clj', '?? .clojure-atlas/graph.json.gz', '?? z.clj', ''].join('\0');
    assert.deepEqual(changedPaths(status), ['src/a.clj', 'src/copy.clj', 'src/new.clj', 'src/old.clj', 'src/orig.clj', 'z.clj']);
    assert.deepEqual(changedPaths(''), []);
  });

  it('a renamed file counts as changed under its old and new path', () => {
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qam', 'edit');
    git('mv', 'src/a.clj', 'src/moved.clj');
    assert.deepEqual(snapshotOf(root, 'v1').dirty, [['src/a.clj', 'deleted'], ['src/moved.clj', snapshotOf(root, 'v1').dirty[1][1]]]);
    assert.match(snapshotOf(root, 'v1').dirty[1][1], /^[0-9a-f]{64}$/);
    git('mv', 'src/moved.clj', 'src/a.clj');
  });

  it('answers carry STALE when the working tree is not the graph snapshot, and graph_info names the config', () => {
    const built = snapshotOf(root, 'v1');
    const g = graphFromJson(JSON.stringify({
      format: 'code-graph', version: 2, capabilities: [], nodes: [], edges: [],
      source: { sha: built.sha, snapshot: built.id, dirty_files: built.dirty.length, config_hash: built.configHash, config_sources: built.configSources, analyzer: 'v1' },
    }));
    assert.equal(staleness(g, undefined, { snapshot: () => snapshotOf(root, 'v1') }).stale, false);
    put('src/b.clj', '(ns b)');
    const st = staleness(g, undefined, { snapshot: () => snapshotOf(root, 'v1') });
    assert.equal(st.stale, true);
    assert.match(st.header ?? '', /^STALE: the working tree is not the snapshot this graph describes \(\d+ uncommitted file\(s\) now/);
    assert.match(graphInfo(g, undefined, {}), /config [0-9a-f]{12} from \.clj-kondo\/config\.edn, vendor\/kondo\/config\.edn/);
  });
});
