// Wording that must match the facts: why a tracked file was not analyzed, what a skipped .edn file loses, which
// route an entry label names, and a capability note said once.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { listFiles, trackedSources } from '../src/build/files.ts';
import { degradation, degradedLine } from '../src/mcp/degraded.ts';
import { keySiblings } from '../src/mcp/keyflow.ts';
import { entryOf, routeAuthz } from '../src/mcp/queries.ts';
import { GraphBuilder } from './helpers/code-graph-fixture.ts';
import { graphOf } from './helpers/inline-graph.ts';

const roots: string[] = [];
after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

describe('why a tracked Clojure file was not analyzed', () => {
  const repo = (): string => {
    const root = mkdtempSync(path.join(tmpdir(), 'atlas-why-'));
    roots.push(root);
    for (const [rel, body] of Object.entries({
      'deps.edn': '{}', 'src/app/core.clj': '(ns app.core)\n', '.dev/user.clj': '(ns user)', 'src/app/gone.clj': '(ns app.gone)', 'src/app/real.clj': '(ns app.real)',
    })) {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      writeFileSync(path.join(root, rel), body);
    }
    symlinkSync('real.clj', path.join(root, 'src/app/link.clj'));
    execFileSync('git', ['-C', root, 'init', '-q']);
    execFileSync('git', ['-C', root, 'add', '-A']);
    rmSync(path.join(root, 'src/app/gone.clj'));
    return root;
  };

  it('gives each file its own reason: hidden folder, symlink, deleted in the working tree', () => {
    const root = repo();
    const t = trackedSources(root, listFiles(root));
    assert.deepEqual(t.unread, ['.dev/user.clj', 'src/app/gone.clj', 'src/app/link.clj']);
    assert.deepEqual(t.unreadWhy, { '.dev/user.clj': 'hidden-or-build-folder', 'src/app/gone.clj': 'deleted', 'src/app/link.clj': 'symlink' });
  });

  it('the DEGRADED line says each reason, and does not blame a symlink or a deleted file on a build folder', () => {
    const stats = { files: { unread: 3, unread_names: ['.dev/user.clj', 'src/app/gone.clj', 'src/app/link.clj'],
      unread_why: { '.dev/user.clj': 'hidden-or-build-folder', 'src/app/gone.clj': 'deleted', 'src/app/link.clj': 'symlink' } } };
    const line = degradedLine(degradation({ stats } as never)!);
    assert.match(line, /1 tracked Clojure file\(s\) sit in a hidden path, node_modules or a module-root build folder \(\.dev\/user\.clj\)/);
    assert.match(line, /1 tracked Clojure file\(s\) are symbolic links, which the build does not follow \(src\/app\/link\.clj\)/);
    assert.match(line, /1 tracked Clojure file\(s\) are deleted in the working tree \(src\/app\/gone\.clj\)/);
    assert.doesNotMatch(line, /3 tracked/);
  });

  it('a graph that recorded no reason names the possible ones instead of picking a folder', () => {
    const line = degradedLine(degradation({ stats: { files: { unread: 1, unread_names: ['a/b.clj'] } } } as never)!);
    assert.match(line, /1 tracked Clojure file\(s\) were not analyzed, as git tracks them but the file walk did not read them, whether they sit in a hidden path, node_modules or a build folder, are symbolic links, or are deleted in the working tree \(a\/b\.clj\)/);
    assert.doesNotMatch(line, /file\(s\) sit in a hidden path/);
  });
});

describe('a skipped .edn file', () => {
  const BIG_EDN = `{:a 1}\n;${'x'.repeat(2 * 1024 * 1024)}\n`;
  const BIG_CLJ = `(ns app.big)\n;${'x'.repeat(2 * 1024 * 1024)}\n`;

  it('is said to lose its data, keys and config, not definitions and calls', async () => {
    const doc = await graphOf({ 'src/app/core.clj': '(ns app.core)\n', 'resources/config.edn': BIG_EDN });
    assert.equal(doc.stats.files.skipped_large_edn, 1);
    const line = degradedLine(degradation(doc)!);
    assert.match(line, /1 \.edn file\(s\) over 2 MB were skipped \(resources\/config\.edn\), so the data, keys and config they hold are missing/);
    assert.doesNotMatch(line, /definitions and calls/);
  });

  it('beside a skipped source file each is counted and worded on its own', async () => {
    const doc = await graphOf({ 'src/app/big.clj': BIG_CLJ, 'resources/config.edn': BIG_EDN });
    const line = degradedLine(degradation(doc)!);
    assert.match(line, /1 file\(s\) over 2 MB were skipped \(src\/app\/big\.clj\), so their definitions and calls are missing/);
    assert.match(line, /1 \.edn file\(s\) over 2 MB were skipped \(resources\/config\.edn\), so the data, keys and config they hold are missing/);
  });
});

describe('the entry label of a handler row', () => {
  const graph = () => {
    const b = new GraphBuilder();
    const h = b.def('app/h');
    for (const path of ['/admin/users', '/p/users']) b.edge(b.route('GET', path, 'app', ''), 'routes_to', h);
    return b.build();
  };

  it('route_authz names the route asked about, not the first route of the handler', () => {
    const r = routeAuthz(graph(), '/p/users');
    const row = r.sections.find((s) => s.name.endsWith(': handler'))?.rows[0];
    assert.equal(row?.entry, 'route GET /p/users @app');
  });

  it('a handler of several routes says so when no route is asked about', () => {
    assert.equal(entryOf(graph(), 'definition:app/h'), 'route GET /admin/users @app (and 1 more route)');
  });
});

describe('key_siblings', () => {
  it('says a missing key_tables capability once when the table is not found', () => {
    const notes = keySiblings(new GraphBuilder().build(), 'nowhere.clj').notes.filter((n) => /capability key_tables/.test(n));
    assert.equal(notes.length, 1, notes.join(' | '));
  });
});
