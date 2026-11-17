export declare const FORMAT = "code-graph";
export declare const VERSION = 2;
export declare const BANDS: readonly ["static_proven", "heuristic", "unknown"];
export type Band = (typeof BANDS)[number];
export interface GraphNode {
    id: string;
    kind: string;
    name: string;
    file?: string;
    line?: number;
    end_line?: number;
    component?: string;
    roles?: string[];
    attrs?: Record<string, unknown>;
}
export interface GraphEdge {
    from: string;
    to: string;
    kind: string;
    band: Band;
    file: string;
    line?: number;
    attrs?: Record<string, unknown>;
}
export interface Capability {
    name: string;
    status: 'available' | 'absent';
    edge_kinds?: string[];
    edges?: number;
    bands?: Record<string, number>;
    note?: string;
}
export interface GraphSource {
    repo_name?: string;
    ref?: string | null;
    sha: string;
    built_at?: string;
    snapshot?: string;
    dirty_files?: number;
    config_hash?: string;
    config_sources?: string[];
    analyzer?: string;
}
export interface GraphDocument {
    format: string;
    version: number;
    source: GraphSource;
    capabilities: Capability[];
    nodes: GraphNode[];
    edges: GraphEdge[];
}
export interface Graph {
    doc: GraphDocument;
    byId: Map<string, GraphNode>;
    out: Map<string, GraphEdge[]>;
    in: Map<string, GraphEdge[]>;
    byKind: Map<string, GraphNode[]>;
    byName: Map<string, GraphNode[]>;
}
export declare class GraphFormatError extends Error {
    constructor(message: string);
}
export declare function parseDocument(raw: unknown, origin?: string): GraphDocument;
export declare function indexGraph(doc: GraphDocument): Graph;
export declare function graphFromJson(text: string, origin?: string): Graph;
export declare function loadGraph(path: string, limits?: {
    file: number;
    inflated: number;
}): Graph;
export declare const outEdges: (g: Graph, id: string, kinds?: readonly string[]) => GraphEdge[];
export declare const inEdges: (g: Graph, id: string, kinds?: readonly string[]) => GraphEdge[];
export declare function capability(g: Graph, name: string): Capability | undefined;
export declare const compareText: (a: string, b: string) => number;
export declare function weakest(a: Band, b: Band): Band;
