import { type Snapshot } from '../snapshot.ts';
export declare class SnapshotRefresher {
    private cache;
    private worker?;
    private jobs;
    private next;
    private ttlMs;
    private now;
    constructor(ttlMs: number, now?: () => number);
    snapshot(root: string, analyzer: string): Snapshot;
    settled(): Promise<void>;
    private inWorker;
    private fail;
}
