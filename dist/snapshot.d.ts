export interface Snapshot {
    id: string;
    sha: string;
    ref: string | null;
    dirty: [string, string][];
    configHash: string;
    configSources: string[];
    analyzer: string;
}
export declare function configSources(root: string): string[];
export declare function projectKnownSymbols(root: string): Set<string>;
export declare function changedPaths(status: string): string[];
export declare function dirtyFiles(analyzed: readonly string[], changed: readonly string[], ignored: readonly string[], isDirectory: (rel: string) => boolean, exists: (rel: string) => boolean): string[];
export declare function fileHasher(read?: (file: string) => Buffer): (abs: string) => string;
export declare function submodulePaths(root: string): string[];
export declare function ignoredAmong(root: string, files: readonly string[]): string[];
export declare const UNVERSIONED = "unversioned";
export declare function snapshotOf(root: string, analyzer: string): Snapshot;
export declare const SNAPSHOT_TTL_MS = 3000;
export declare function cachedSnapshot(take: () => Snapshot, ttlMs: number, now?: () => number): () => Snapshot;
export declare const analyzerVersion: (kondoVersion: string) => string;
export declare function analyzerFor(graphAnalyzer: string | undefined): string;
