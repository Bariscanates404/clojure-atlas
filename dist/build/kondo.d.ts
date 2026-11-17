import { type Analysis } from './analysis.ts';
export declare const BUILT_IN_LINT_AS: Record<string, string>;
export declare function effectiveLintAs(projectKnown: ReadonlySet<string>, declared: Record<string, string>): Record<string, string>;
export declare const config: (lintAs: Record<string, string>) => string;
export declare const asArgument: (file: string) => string;
export declare function requireRelativePaths(json: Record<string, unknown>, from: string): void;
export declare function chunkFiles(files: readonly string[], maxFiles?: number, maxChars?: number): string[][];
export declare function analysisJson(text: string): Record<string, unknown> | null;
export interface AnalyzeOptions {
    timeoutMs?: number;
    maxFilesPerRun?: number;
}
export interface Analyzed {
    analysis: Analysis;
    timedOut: string[];
}
export declare function analyze(cmd: string, root: string, files: string[], lintAs: Record<string, string>, opts?: AnalyzeOptions): Promise<Analyzed>;
