export interface RepoFiles {
    sources: string[];
    edn: string[];
    typescript: string[];
    packageJsons: string[];
    moduleRoots: string[];
    skippedLarge: string[];
}
export declare function listFiles(root: string): RepoFiles;
export declare function componentOf(moduleRoots: readonly string[], file: string): string | undefined;
export interface Tracked {
    expected: number;
    unread: string[];
    unreadWhy: Record<string, UnreadReason>;
}
export type UnreadReason = 'symlink' | 'deleted' | 'hidden-or-build-folder';
export declare function trackedSources(root: string, files: RepoFiles): Tracked;
