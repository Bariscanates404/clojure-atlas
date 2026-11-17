import { type Form } from '../reader.ts';
import { type Context } from '../model.ts';
export interface Wrapper {
    def: string;
    file: string;
    line: number;
    library: boolean;
    permission?: {
        form: Form;
        file: string;
    };
}
export interface Wrapping {
    wrappers: Wrapper[];
    unknown: boolean;
}
export declare function wrappingOf(ctx: Context): (file: string, route: Form) => Wrapping;
