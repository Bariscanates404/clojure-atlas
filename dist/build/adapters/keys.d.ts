import { type Keyword } from '../analysis.ts';
import { type Adapter, type Context } from '../model.ts';
type Role = 'produces_key' | 'consumes_key' | 'removes_key';
interface Site {
    role: Role;
    via: string;
    threaded: boolean;
}
export declare function classify(ctx: Context, k: Keyword): Site[];
export declare const mapKeys: Adapter;
export declare const keyTables: Adapter;
export {};
