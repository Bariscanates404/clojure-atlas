import { type Context, type Owner, type Rows } from './model.ts';
export interface UsageStats {
    notVars: number;
    resolved: number;
    unresolved: number;
    unknown: number;
    external: number;
    topUnresolved: [string, number][];
    topUnknown: [string, number][];
    unresolvedSites: Record<string, string[]>;
    dynamicResolve: {
        sites: number;
        literal: number;
    };
}
export declare function core(ctx: Context, owner: Owner): Rows & {
    stats: UsageStats;
};
