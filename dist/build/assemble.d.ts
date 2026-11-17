import { type GraphDocument, type GraphSource } from '../mcp/graph.ts';
import { type UsageStats } from './core.ts';
import { type Adapter, type Context } from './model.ts';
export interface AdapterStats {
    detected: string | null;
    nodes: number;
    edges: number;
}
export interface BuildStats {
    files: {
        expected: number;
        sources: number;
        edn: number;
        skipped_large: number;
        skipped_large_names: string[];
        unread: number;
        unread_names: string[];
        timed_out: number;
        timed_out_names: string[];
        skipped_large_edn: number;
        unread_why?: Record<string, string>;
    };
    duplicate_namespaces: {
        ns: string;
        files: string[];
    }[];
    syntax_errors: {
        files: number;
        errors: number;
        names: string[];
        recovered: number;
        recovered_names: string[];
    };
    definitions: number;
    usages: UsageStats;
    adapters: Record<string, AdapterStats>;
    dropped_edges: number;
    build_ms?: number;
}
export type AtlasDocument = GraphDocument & {
    stats: BuildStats;
};
export declare function assemble(ctx: Context, adapters: readonly Adapter[], source: GraphSource, files: Omit<BuildStats['files'], 'skipped_large_edn'>): AtlasDocument;
