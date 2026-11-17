import { type Graph } from './graph.ts';
import type { ServerOptions } from './server.ts';
import { SnapshotRefresher } from './snapshot-refresh.ts';
export interface GraphTarget {
    file: string;
    repo?: string;
}
export interface GraphSnapshot {
    graph: Graph;
    options: ServerOptions;
}
export declare class GraphAccessError extends Error {
}
export declare class GraphStore {
    private entries;
    private maxDistance?;
    readonly snapshots: SnapshotRefresher;
    constructor(targets: GraphTarget[], maxDistance?: number);
    private entry;
    select(repo?: string | null): void;
    get(repo?: string | null): GraphSnapshot;
    status(): unknown[];
}
