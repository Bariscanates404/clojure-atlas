import type { Band, Graph, GraphEdge, GraphNode } from './graph.ts';
export interface Row {
    label: string;
    id: string;
    file: string | null;
    line: number | null;
    band: Band;
    kind?: string;
    detail?: string;
    component?: string;
    depth?: number;
    entry?: string;
    fanIn?: number;
    cross?: boolean;
    parentId?: string;
    parentLabel?: string;
    reason?: string;
    finding?: FindingKind;
    key?: string;
}
export type FindingKind = 'arity-missing' | 'never-passed' | 'unread' | 'lacks-key';
export interface Section {
    name: string;
    rows: Row[];
    ordered?: boolean;
    tree?: boolean;
    searched?: string;
    short?: string;
    unextracted?: string;
}
export interface QueryResult {
    name: string;
    query: string;
    title: string;
    verdict: string;
    found: boolean;
    matches: string[];
    sections: Section[];
    counts?: Record<string, number>;
    notes: string[];
    next: string[];
    badArgument?: boolean;
    unparsed?: string[];
    used?: string[];
}
export declare const site: (e: GraphEdge) => {
    file: string;
    line: number | null;
};
export declare function entryOf(g: Graph, id: string): string | undefined;
export declare function edgeRow(g: Graph, nodeId: string, e: GraphEdge, extra?: Partial<Row>): Row;
export declare function nodeRow(n: GraphNode, extra?: Partial<Row>): Row;
export declare const call: (tool: string, args: Record<string, string | number>) => string;
export declare const MACRO_HINT = "probably defined by a macro clj-kondo cannot expand; add :lint-as for the macro in .clj-kondo/config.edn";
export declare function notFound(g: Graph, name: string, query: string, title: string, what: string, caps: string[], note?: string): QueryResult;
export declare function unextractedBy(g: Graph, caps: string[]): string | undefined;
export declare const gated: (g: Graph, caps: string[], sections: Section[]) => Section[];
export declare function capabilityNotes(g: Graph, names: string[]): string[];
export declare function dynamicResolveNote(g: Graph): string[];
export declare function unknownNote(rows: Row[]): string[];
export declare function resolve(g: Graph, kinds: readonly string[], query: string): GraphNode[];
export declare function countBy(rows: Row[], key: (r: Row) => string): Record<string, number>;
export declare function ambiguous(name: string, query: string, title: string, nodes: GraphNode[], argName: string): QueryResult;
