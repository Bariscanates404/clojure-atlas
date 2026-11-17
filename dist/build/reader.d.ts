export interface Pos {
    row: number;
    col: number;
    endRow: number;
    endCol: number;
}
export type Coll = 'list' | 'vector' | 'map' | 'set' | 'fn';
export type Wrap = 'quote' | 'syntax-quote' | 'unquote' | 'unquote-splicing' | 'deref' | 'var' | 'meta' | 'tagged' | 'cond';
export type Atom = 'symbol' | 'keyword' | 'string' | 'number' | 'char' | 'regex' | 'other';
export type Form = (Pos & {
    t: Coll;
    children: Form[];
    ns?: string;
}) | (Pos & {
    t: Wrap;
    children: Form[];
    tag?: string;
    splice?: boolean;
}) | (Pos & {
    t: Atom;
    text: string;
});
export interface ReadResult {
    forms: Form[];
    error?: {
        row: number;
        col: number;
        message: string;
    };
}
export declare function readForms(src: string): ReadResult;
export declare const textOf: (f: Form | undefined) => string | undefined;
export declare const kids: (f: Form) => Form[];
export declare function walk(forms: readonly Form[]): Generator<Form>;
export declare function unwrap(f: Form): Form;
export declare function flatChildren(f: Form): Form[];
export declare const contains: (outer: Pos, row: number, col: number) => boolean;
export declare const at: (f: Form, row: number, col: number) => boolean;
export declare function formAt(forms: readonly Form[], row: number, col: number): Form | undefined;
export declare const headName: (f: Form | undefined) => string | undefined;
export declare function isThreadStep(parent: Form, index: number): boolean;
export declare const isAnnotationMark: (f: Form | undefined) => boolean;
