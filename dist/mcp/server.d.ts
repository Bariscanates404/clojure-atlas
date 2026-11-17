import { type Args, type ToolOutput } from './stdio.ts';
import { type Graph } from './graph.ts';
import { type QueryResult } from './queries.ts';
import { type StalenessOptions } from './staleness.ts';
export interface ServerOptions extends StalenessOptions {
    graphDir?: string;
    baseDir?: string;
}
interface ToolDef {
    name: string;
    description: string;
    required: string[];
    props: Record<string, unknown>;
    run: (g: Graph, a: Args, opts: ServerOptions) => QueryResult;
}
export declare const MAX_BASE_GRAPHS = 4;
export declare const TOOLS: ToolDef[];
export declare function toolList(): unknown[];
export declare function graphInfo(g: Graph, base: string | undefined, opts: ServerOptions): string;
export declare function callTool(g: Graph, name: string, args: Args, opts?: ServerOptions): ToolOutput;
export declare const INSTRUCTIONS: string;
export declare const handleMessage: (g: Graph, msg: unknown, opts?: ServerOptions) => unknown;
export declare const handleGraphlessMessage: (msg: unknown) => unknown;
export declare const handleLine: (g: Graph, line: string, opts?: ServerOptions) => unknown;
export declare const serveStdio: (g: Graph, opts?: ServerOptions) => void;
export {};
