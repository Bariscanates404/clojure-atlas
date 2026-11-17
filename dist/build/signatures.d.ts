import { type Form } from './reader.ts';
export interface Param {
    kind: 'symbol' | 'map' | 'kwargs' | 'rest' | 'vector' | 'other';
    name?: string;
    keys?: string[];
    as?: string;
    defaults?: string[];
    optional?: string[];
    reads?: string[];
    reads_complete?: boolean;
    escapes?: string[];
}
export interface Arity {
    params: Param[];
    variadic: boolean;
}
export interface CallArg {
    i: number;
    shape: string;
    band: 'static_proven' | 'unknown';
    keys?: string[];
    local?: string;
    dynamic_keys?: number;
}
type Name = (f: Form) => string;
export declare function signatureOf(form: Form, name: Name): Arity[] | null;
export declare function agreesWithKondo(arities: readonly Arity[], fixedArities?: readonly number[], varargsMin?: number): boolean;
export declare function callArgs(call: Form, arityCount: number, callee: Arity[] | null, name: Name): {
    args?: CallArg[];
    kwargs?: {
        keys: string[];
        band: 'static_proven' | 'unknown';
    };
};
export {};
