import type { Band } from '../mcp/graph.ts';
import type { VarUse } from './analysis.ts';
import { type Context } from './model.ts';
export type Relation = 'calls' | 'references' | 'passes_callback' | 'registers_handler' | 'expands_via' | 'rebinds';
export interface Classified {
    kind: Relation;
    band: Band;
    via?: string;
    weak?: true;
    inMacro?: string;
}
export declare function assertionHeads(ctx: Context): (u: VarUse) => boolean;
export declare function classify(ctx: Context, u: VarUse): Classified;
