import type { AtlasDocument } from './build/assemble.ts';
export interface CoverageRow {
    repo: string;
    sha: string;
    filesExpected: number;
    files: number;
    syntaxErrorFiles: number;
    definitions: number;
    resolved: number;
    unresolved: number;
    unknown: number;
    resolutionRate: number | null;
    adapters: Record<string, number>;
    nodes: number;
    edges: number;
    unknownEdges: number;
    droppedEdges: number;
    buildMs: number;
    graphBytes: number;
}
export declare function coverageRow(doc: AtlasDocument, graphBytes: number): CoverageRow;
export declare const pct: (x: number | null) => string;
export declare function coverageTable(rows: readonly CoverageRow[]): string;
