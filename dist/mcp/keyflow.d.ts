import type { Band, Graph, GraphEdge, GraphNode } from './graph.ts';
import { type QueryResult, type Row } from './rows.ts';
export interface ParamDesc {
    kind: string;
    name?: string;
    keys?: string[];
    as?: string;
    defaults?: string[];
    optional?: string[];
    reads?: string[];
    reads_complete?: boolean;
    escapes?: string[];
}
export interface ArityDesc {
    params: ParamDesc[];
    variadic: boolean;
    platform?: string;
}
export interface CallArg {
    i: number;
    shape: string;
    keys?: string[];
    band: Band;
    dynamic_keys?: number;
    local?: string;
}
export interface CallAttrs {
    arity: number;
    arity_band: Band;
    args?: CallArg[];
    kwargs?: {
        keys: string[];
        band: Band;
    };
    arity_defined?: boolean;
}
export interface TableRow {
    line: number;
    keys: string[];
    tags?: Record<string, string>;
    vecs?: Record<string, string[]>;
    dynamic_keys?: number;
}
export declare function signatureOf(n: GraphNode | undefined): ArityDesc[] | null;
export declare function arityFor(arities: ArityDesc[], n: number): ArityDesc | undefined;
export interface SignatureChange {
    addedKeys?: string[];
    removedKeys?: string[];
    arities?: number[];
}
export declare function siteCalls(g: Graph, id: string): GraphEdge[];
export declare function signatureImpact(g: Graph, query: string, opts?: {
    base?: Graph;
    change?: SignatureChange;
}): QueryResult;
export declare function similarKeys(g: Graph, key: string, max?: number): GraphNode[];
export declare function keyFlow(g: Graph, query: string): QueryResult;
export declare function tableRows(n: GraphNode): TableRow[];
export declare function commonPrefix(a: string[], b: string[]): number;
export declare function rowLabel(r: TableRow): string;
export interface SiblingFinding {
    row: TableRow;
    missing: {
        key: string;
        reasons: string[];
        have: number;
        of: number;
    }[];
}
export interface SiblingAnalysis {
    findings: SiblingFinding[];
    explained: {
        row: TableRow;
        key: string;
        why: string;
    }[];
}
export declare const WEAK_PATTERN_ABSENT = 0.3;
export declare function siblingAnalysis(rows: TableRow[], formRows: TableRow[], allRows?: TableRow[]): SiblingAnalysis;
export interface TablePool {
    allRows: TableRow[];
    formRows: (t: GraphNode) => TableRow[];
}
export declare function tablePool(g: Graph): TablePool;
export declare function keySiblings(g: Graph, target: string, opts?: {
    maxAbsent?: number;
    onWeak?: (rows: number) => void;
    pool?: TablePool;
}): QueryResult;
export declare function changeKeyRows(g: Graph, changes: {
    file: string;
    ranges: [number, number][];
}[]): {
    rows: Row[];
    weak: number;
};
export declare function changeSignatureRows(g: Graph, defs: GraphNode[]): Row[];
