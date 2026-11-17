#!/usr/bin/env node
export declare class UsageError extends Error {
}
export type Command = {
    cmd: 'help';
} | {
    cmd: 'version';
} | {
    cmd: 'build';
    dir: string;
    out?: string;
} | {
    cmd: 'mcp';
    graph: string;
    repo?: string;
    maxDistance?: number;
} | {
    cmd: 'serve';
    repos: string[];
    graph?: string;
    port: number;
    tokenFile?: string;
    maxDistance?: number;
} | {
    cmd: 'coverage';
    graph: string;
} | {
    cmd: 'init';
    yes: boolean;
};
export declare function parseCommand(argv: string[]): Command;
export declare const MCP_ENTRY: {
    command: string;
    args: string[];
};
export declare function withMcpEntry(existing: string | undefined): string;
