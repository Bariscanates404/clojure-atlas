import { type Adapter, type Context, type Owner } from '../model.ts';
import { type Authz } from './route-authz.ts';
interface Link {
    def: string;
    file?: string;
    line: number;
    band?: 'heuristic';
    unresolved?: boolean;
}
interface Guard extends Link {
    level: string;
    inheritedFrom?: string;
    library?: boolean;
}
export interface Route {
    method: string;
    path: string;
    mount: string;
    base: string;
    file: string;
    line: number;
    library: string;
    handlers: Link[];
    guards: Guard[];
    authz: Authz;
    middlewareUnknown?: boolean;
}
export declare const routeId: (r: Pick<Route, "method" | "path" | "base" | "mount">) => string;
export declare const serverRoutes: (ctx: Context, owner: Owner) => Route[];
export declare const httpRoutes: Adapter;
export {};
