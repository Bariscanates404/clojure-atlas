import type { Graph, GraphEdge, GraphNode } from './graph.ts';
import { type QueryResult } from './rows.ts';
export { entryOf, resolve, type QueryResult, type Row, type Section } from './rows.ts';
export declare function callers(g: Graph, query: string, opts?: {
    includeReferences?: boolean;
}): QueryResult;
export declare function blastRadius(g: Graph, query: string, depth?: number): QueryResult;
export declare function canonicalRoute(input: string): {
    method: string | null;
    path: string;
};
export interface RouteMatch {
    routes: GraphNode[];
    partial: boolean;
    methodless: number;
}
export declare function matchRoutes(g: Graph, query: string): RouteMatch;
export declare const findRoutes: (g: Graph, query: string) => GraphNode[];
export declare function permissionExpression(g: Graph, edges: GraphEdge[]): string;
export type AuthzState = 'permission' | 'exempt' | 'none' | 'unknown';
export declare function routeVerdict(g: Graph, routeId: string): {
    state: AuthzState;
    text: string;
};
export declare function routeSiblings(g: Graph, route: GraphNode): {
    text: string;
    odd: boolean;
} | null;
export declare function routeAuthz(g: Graph, query: string): QueryResult;
export declare function permissionRoutes(g: Graph, query: string): QueryResult;
export interface Likeness {
    score: number;
    why: string;
}
export declare function writeLikeness(context: string, caller: string, file: string | null): Likeness;
export declare function readLikeness(context: string, caller: string, file: string | null): Likeness;
export declare function attributeUsage(g: Graph, query: string): QueryResult;
export declare function eventFlow(g: Graph, query: string): QueryResult;
export declare function testsCovering(g: Graph, query: string): QueryResult;
export declare function isUnitTest(n: GraphNode | undefined): boolean;
export declare function testsFor(g: Graph, query: string, depth?: number): QueryResult;
export interface Change {
    file: string;
    ranges: [number, number][];
}
export declare function parseChange(spec: string): Change;
export interface ChangeOptions {
    deleted?: readonly string[];
    added?: readonly string[];
    repoDir?: string;
    fromDiff?: boolean;
}
export declare const CHANGE_FORMAT = "\"file\", \"file:12\" or \"file:10-20,30-41\"";
export declare function contextForChange(g: Graph, specs: string[], opts?: ChangeOptions): QueryResult;
