import { type Form } from '../reader.ts';
import type { Context } from '../model.ts';
export interface Permission {
    name: string;
    dynamic: boolean;
    check: number;
    checks: number;
    alternative: number;
    alternatives: number;
    allOf: number;
    scope?: string;
    line: number;
    file: string;
    guessed?: boolean;
}
export interface Authz {
    permissions: Permission[];
    exempt?: {
        reason: string;
        file: string;
        line: number;
    };
}
export declare const NO_AUTHZ: Authz;
export interface Located {
    form: Form;
    file: string;
}
export declare function definitionForm(ctx: Context, full: string): {
    file: string;
    params?: Form;
    value: Form;
} | undefined;
export declare function constant(ctx: Context, at: Located): Located;
export declare function constantMap(ctx: Context, at: Located): Located;
export declare function lookedUp(ctx: Context, at: Located, bind: (f: Located) => Located): Located | undefined;
export declare function permissionsOf(ctx: Context, at: Located, check: number, scope: string | undefined, bind?: (f: Located) => Located): Permission[];
export declare function authzMap(ctx: Context, at: Located): {
    map: Form;
    bind: (f: Located) => Located;
} | undefined;
export declare function routeDataAuthz(ctx: Context, file: string, data: Form | undefined): Authz | undefined;
export declare function formText(f: Form): string;
export interface Check extends Located {
    guessed?: boolean;
}
export declare function addChecks(ctx: Context, authz: Authz, added: readonly Check[]): Authz;
