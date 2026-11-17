import { type Snapshot } from '../snapshot.ts';
import type { Graph } from './graph.ts';
export declare const DEFAULT_MAX_DISTANCE = 20;
export interface StalenessOptions {
    repoDir?: string;
    snapshot?: () => Snapshot;
    maxDistance?: number;
    distance?: (graphSha: string, base: string) => Divergence | null;
}
export interface Divergence {
    behind: number;
    ahead: number;
}
export interface Staleness {
    stale: boolean;
    distance: number | null;
    header: string | null;
}
export declare function gitDistance(repoDir: string): (graphSha: string, base: string) => Divergence | null;
export declare function sameCommit(a: string, b: string): boolean;
export declare function staleness(g: Graph, base: string | undefined, opts?: StalenessOptions): Staleness;
