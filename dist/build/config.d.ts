import { type Form } from './reader.ts';
export interface RouteAuthz {
    key: string;
    permission?: string;
    exempt?: string;
    scope?: string;
    alternative?: string;
}
export interface ProjectConfig {
    lintAs: Record<string, string>;
    routeAuthz?: RouteAuthz;
    permissionMiddleware: string[];
    permissionFns: string[];
    routeMacros: Record<string, string>;
    selectorPrefixes: string[];
}
export declare const EMPTY_CONFIG: ProjectConfig;
export declare class ConfigError extends Error {
}
type Edn = string | Edn[] | {
    [k: string]: Edn;
};
export declare function ednValue(f: Form): Edn;
export declare function parseConfig(text: string): ProjectConfig;
export declare const declaresAuthz: (c: ProjectConfig) => boolean;
export {};
