export declare const SAFE_GIT_CONFIG: string[];
export declare const GIT_TIMEOUT_MS = 60000;
export interface GitOptions {
    input?: string;
    timeoutMs?: number;
}
export declare function runGit(root: string, args: string[], opts?: GitOptions): string;
export declare function git(root: string, args: string[], input?: string, timeoutMs?: number): string | null;
