import type { GraphEdge, GraphNode } from '../mcp/graph.ts';
import { CORE_NS, UNKNOWN_NS, type Analysis, type Span, type VarDef, type VarUse } from './analysis.ts';
import type { ProjectConfig } from './config.ts';
import type { Playwright } from './typescript.ts';
import { type Form } from './reader.ts';
export interface Rows {
    nodes: GraphNode[];
    edges: GraphEdge[];
}
export interface Container {
    id: string;
    span: Span;
}
export interface Context {
    analysis: Analysis;
    config: ProjectConfig;
    playwright: Playwright;
    projectNs: ReadonlySet<string>;
    defs: ReadonlyMap<string, VarDef>;
    duplicateNs: ReadonlyMap<string, string[]>;
    understood: ReadonlySet<string>;
    edn: readonly string[];
    forms: (file: string) => Form[];
    componentOf: (file: string) => string | undefined;
    useAt: (file: string, row: number, col: number) => VarUse | undefined;
    defAt: (file: string, row: number, col: number) => string | undefined;
    keywordAt: (file: string, row: number, col: number) => string | undefined;
    nameOf: (file: string, f: Form) => string;
    parentOf: (file: string, row: number, col: number) => {
        parent: Form;
        index: number;
    } | undefined;
}
export interface Adapter {
    name: string;
    edgeKinds: readonly string[];
    detect: (ctx: Context) => string | null;
    unavailable?: (ctx: Context) => string | null;
    containers?: (ctx: Context) => Container[];
    run: (ctx: Context, owner: Owner) => Rows;
}
export interface Site {
    file: string;
    row: number;
    col: number;
    from: string;
    fromVar?: string;
}
export type Owner = (site: Site) => string;
export { CORE_NS, UNKNOWN_NS };
export declare const isSpecialForm: (u: VarUse) => boolean;
export declare function groupBy<T>(xs: Iterable<T>, key: (x: T) => string): Map<string, T[]>;
export declare const defId: (fullName: string) => string;
export declare const nsId: (ns: string) => string;
export declare function createContext(analysis: Analysis, config: ProjectConfig, playwright: Playwright, sources: ReadonlyMap<string, string>, edn: readonly string[], componentOf: (file: string) => string | undefined, understood?: ReadonlySet<string>): Context;
export declare function makeOwner(ctx: Context, containers: readonly Container[]): Owner;
