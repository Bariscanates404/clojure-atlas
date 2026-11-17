import type { Span, VarUse } from '../analysis.ts';
import { type Adapter, type Context } from '../model.ts';
export declare const methodId: (multi: string, dispatch: string) => string;
interface Method {
    id: string;
    use: VarUse;
    multi: string;
    dispatch: string;
    span: Span;
}
export declare function methods(ctx: Context): Method[];
export declare const multimethods: Adapter;
export {};
