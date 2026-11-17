import type { VarUse } from './analysis.ts';
import { type Context } from './model.ts';
export declare const DYNAMIC_RESOLVERS: Set<string>;
export interface DynamicResolution {
    use: VarUse;
    full?: string;
}
export declare function dynamicResolutions(ctx: Context): DynamicResolution[];
