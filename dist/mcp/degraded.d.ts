import type { GraphDocument } from './graph.ts';
export interface Degradation {
    files: number;
    names: string[];
    recovered: {
        files: number;
        names: string[];
    };
    edges: number;
    large: {
        files: number;
        names: string[];
        edn: number;
    };
    duplicates: string[];
    timedOut: {
        files: number;
        names: string[];
    };
    unread: {
        files: number;
        names: string[];
    };
    unreadWhy: Record<string, string>;
}
export declare const strings: (v: unknown) => string[];
export declare function degradation(doc: GraphDocument): Degradation | null;
export declare function degradedLine(d: Degradation): string;
export declare const unparsedFor: (d: Degradation | null, query: string) => string[];
export declare const recoveredFor: (d: Degradation | null, query: string) => string[];
export declare const unanalyzedFor: (d: Degradation | null, query: string) => {
    timedOut: string[];
    unread: string[];
};
export declare const skippedFor: (d: Degradation | null, query: string) => string[];
