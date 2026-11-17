export declare const SUPPORTED_PROTOCOLS: string[];
export declare const DEFAULT_PROTOCOL: string;
export type Args = Record<string, unknown>;
export interface ToolOutput {
    text: string;
    isError: boolean;
}
export interface McpServerDef<C> {
    name: string;
    version: string;
    instructions?: string;
    listTools: () => unknown[];
    callTool: (ctx: C, name: string, args: Args) => ToolOutput | Promise<ToolOutput>;
}
export declare function missingArguments(required: readonly string[], args: Args): string[];
export interface PropSchema {
    type?: string;
    enum?: readonly string[];
    items?: {
        type?: string;
    };
}
export declare function invalidArguments(props: Record<string, PropSchema>, args: Args): string[];
export interface StdioServer<C> {
    handleMessage: (ctx: C, msg: unknown) => unknown;
    handleLine: (ctx: C, line: string) => unknown;
    serve: (ctx: C) => void;
}
export declare function stdioServer<C>(def: McpServerDef<C>): StdioServer<C>;
export declare function lineSplitter(onLine: (line: string) => void): {
    push: (chunk: string) => void;
    end: () => void;
};
