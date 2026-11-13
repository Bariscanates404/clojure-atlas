// Working-tree snapshots for a shared server. A large repository takes about a second of git and hashing, and a
// synchronous walk stalls every client of the one process: the first snapshot of a repo is taken in place, later ones
// are refreshed in a worker thread once the TTL has passed, and the last finished one answers meanwhile. The cache is
// per repo, so a reloaded graph keeps it. An edit shows once the refresh after the window has finished.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { snapshotOf, type Snapshot } from '../snapshot.ts';

// src/*.ts under the test runner, dist/*.js when installed
const WORKER = new URL(`../snapshot-worker${path.extname(fileURLToPath(import.meta.url))}`, import.meta.url);

interface Cached {
  at: number;
  snapshot: Snapshot;
  refreshing: boolean;
}

export class SnapshotRefresher {
  private cache = new Map<string, Cached>();
  private worker?: Worker;
  private jobs = new Map<number, (s: Snapshot | undefined) => void>();
  private next = 0;
  private ttlMs: number;
  private now: () => number;

  constructor(ttlMs: number, now: () => number = Date.now) {
    this.ttlMs = ttlMs;
    this.now = now;
  }

  snapshot(root: string, analyzer: string): Snapshot {
    const key = `${root}\0${analyzer}`;
    const hit = this.cache.get(key);
    if (!hit) {
      const fresh = { at: this.now(), snapshot: snapshotOf(root, analyzer), refreshing: false };
      this.cache.set(key, fresh);
      return fresh.snapshot;
    }
    const at = this.now();
    if (!hit.refreshing && (at - hit.at >= this.ttlMs || at < hit.at)) {
      hit.refreshing = true;
      void this.inWorker(root, analyzer).then((s) => {
        // a failed refresh is never papered over with the old snapshot: the next call takes one in place and shows the error
        if (!s) { this.cache.delete(key); return; }
        hit.snapshot = s;
        hit.at = this.now();
        hit.refreshing = false;
      });
    }
    return hit.snapshot;
  }

  // Resolves once no refresh is running (tests, shutdown).
  async settled(): Promise<void> {
    while (this.jobs.size) await new Promise((r) => setTimeout(r, 10));
  }

  private inWorker(root: string, analyzer: string): Promise<Snapshot | undefined> {
    if (!this.worker) {
      const worker = new Worker(WORKER);
      worker.on('message', ({ id, snapshot }: { id: number; snapshot?: Snapshot }) => {
        this.jobs.get(id)?.(snapshot);
        this.jobs.delete(id);
      });
      worker.on('error', () => this.fail(worker));
      worker.on('exit', () => this.fail(worker));
      // after the listeners, which ref the worker again: a running refresh never keeps the process alive
      worker.unref();
      this.worker = worker;
    }
    const id = this.next++;
    return new Promise((resolve) => {
      this.jobs.set(id, resolve);
      this.worker!.postMessage({ id, root, analyzer });
    });
  }

  private fail(worker: Worker): void {
    if (this.worker !== worker) return;
    this.worker = undefined;
    for (const done of this.jobs.values()) done(undefined);
    this.jobs.clear();
  }
}
