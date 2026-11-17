import { type Form } from '../reader.ts';
export declare const COMPOJURE = "compojure.core";
export declare const keywordOf: (f: Form) => string | undefined;
export declare function entries(m: Form): [Form, Form][];
export declare const entry: (m: Form, key: string) => Form | undefined;
export declare const joinPath: (prefix: string, seg: string) => string;
export declare const isRoute: (f: Form) => boolean;
export declare const isRouteGroup: (f: Form) => boolean;
