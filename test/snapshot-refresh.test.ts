// A shared server refreshes working-tree snapshots in a worker thread: the first is taken in place, later calls answer
// at once from the last finished snapshot, a refresh after the TTL picks up edits, and a failed refresh is not hidden.
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { SnapshotRefresher } from '../src/mcp/snapshot-refresh.ts';
import { GraphStore } from '../src/mcp/graph-store.ts';
import { GraphBuilder } from './helpers/code-graph-fixture.ts';

const root = mkdtempSync(path.join(tmpdir(), 'atlas-refresh-'));
after(() => rmSync(root, { recursive: true, force: true }));
let serial = 0;
const repo = () => {
  const d = path.join(root, String(serial++));
  mkdirSync(path.join(d, 'src'), { recursive: true });
  writeFileSync(path.join(d, 'src', 'a.clj'), '(ns a)\n(defn f [] 1)\n');
  return d;
};

describe('SnapshotRefresher', () => {
  it('takes the first snapshot in place, answers from it within the TTL, and refreshes in a worker after it', async () => {
    let clock = 1000;
    const r = new SnapshotRefresher(3000, () => clock);
    const dir = repo();
    const first = r.snapshot(dir, 'an');
    assert.equal(r.snapshot(dir, 'an'), first, 'within the TTL the same snapshot');
    writeFileSync(path.join(dir, 'src', 'a.clj'), '(ns a)\n(defn f [] 2)\n');
    clock += 3000;
    assert.equal(r.snapshot(dir, 'an'), first, 'after the TTL the last snapshot answers at once while the worker runs');
    assert.equal(r.snapshot(dir, 'an'), first, 'one refresh at a time');
    await r.settled();
    const next = r.snapshot(dir, 'an');
    assert.notEqual(next.id, first.id, 'the refreshed snapshot sees the edit');
    clock = 0;
    r.snapshot(dir, 'an');
    await r.settled();
    assert.notEqual(r.snapshot(dir, 'an'), next, 'a clock that went back refreshes too');
    assert.notEqual(r.snapshot(dir, 'other analyzer').analyzer, next.analyzer);
  });

  it('drops a snapshot whose refresh failed, so the next call takes one in place and shows the error', async () => {
    let clock = 0;
    const r = new SnapshotRefresher(10, () => clock);
    const dir = repo();
    r.snapshot(dir, 'an');
    rmSync(dir, { recursive: true, force: true });
    clock += 10;
    r.snapshot(dir, 'an');
    await r.settled();
    assert.throws(() => r.snapshot(dir, 'an'));
  });

  it('recovers from a worker that exited', async () => {
    let clock = 0;
    const r = new SnapshotRefresher(10, () => clock);
    const dir = repo();
    const first = r.snapshot(dir, 'an');
    clock += 10;
    r.snapshot(dir, 'an');
    await (r as unknown as { worker: { terminate: () => Promise<number> } }).worker.terminate();
    await r.settled();
    assert.notEqual(r.snapshot(dir, 'an'), first, 'taken in place again after the failed refresh');
    clock += 10;
    r.snapshot(dir, 'an');
    await r.settled();
    assert.ok(r.snapshot(dir, 'an').id, 'a new worker serves the next refresh');
  });
});

describe('GraphStore snapshots', () => {
  it('keeps one working-tree snapshot per repo across graph reloads', () => {
    const dir = repo();
    const file = path.join(dir, 'graph.json.gz');
    const put = (sha: string) => {
      const b = new GraphBuilder(); b.sha = sha; b.def('demo/target');
      writeFileSync(`${file}.next`, gzipSync(JSON.stringify(b.doc()))); renameSync(`${file}.next`, file);
    };
    put('a'.repeat(40));
    const store = new GraphStore([{ file, repo: dir }]);
    const old = store.get(dir);
    const before = old.options.snapshot!();
    put('b'.repeat(40));
    const next = store.get(dir);
    assert.notEqual(next, old);
    assert.equal(next.options.snapshot!(), before, 'the reload did not take a new snapshot in place');
  });
});
