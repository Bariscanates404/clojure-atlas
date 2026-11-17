import type { QueryResult, Row } from './queries.ts';
export type ResponseFormat = 'concise' | 'detailed' | 'json';
export type GroupBy = 'component' | 'file' | 'none';
export interface RenderOptions {
    format?: ResponseFormat;
    limit?: number;
    offset?: number;
    section?: string;
    maxTokens?: number;
    groupBy?: GroupBy;
    header?: string | null;
}
export declare const PAGING_PROPS: {
    response_format: {
        type: string;
        enum: string[];
        description: string;
    };
    limit: {
        type: string;
        description: string;
    };
    offset: {
        type: string;
        description: string;
    };
    section: {
        type: string;
        description: string;
    };
    max_tokens: {
        type: string;
        description: string;
    };
};
export interface JsonSource {
    stale: boolean;
    notice: string | null;
    [fact: string]: unknown;
}
export declare const withSource: (json: string, source: JsonSource) => string;
export declare function renderOptionsOf(args: Record<string, unknown>): RenderOptions;
export declare const DEFAULT_LIMIT: {
    readonly concise: 10;
    readonly detailed: 25;
};
export declare const MAX_LIMIT = 500;
export declare const DEFAULT_MAX_TOKENS: {
    readonly concise: 1500;
    readonly detailed: 4000;
};
export declare const CHARS_PER_TOKEN = 4;
export declare const BAND_CODE: Record<string, string>;
export declare function clampLimit(limit: number | undefined, format?: ResponseFormat): number;
export declare function where(r: Pick<Row, 'file' | 'line'>): string;
export declare function why(r: Row, crossShownInGroup?: boolean): string;
export declare function rankRows(rows: Row[]): Row[];
export declare function bandMix(rows: Row[]): string;
export declare function render(res: QueryResult, opts?: RenderOptions): string;
