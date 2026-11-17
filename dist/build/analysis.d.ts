export interface Span {
    file: string;
    row: number;
    col: number;
    endRow: number;
    endCol: number;
}
export interface NsDef extends Span {
    name: string;
}
export interface NsUse {
    file: string;
    row: number;
    col: number;
    from: string;
    to: string;
}
export interface VarDef extends Span {
    ns: string;
    name: string;
    definedBy?: string;
    lintAs?: string;
    fixedArities?: number[];
    varargsMin?: number;
    test: boolean;
    macro: boolean;
    fn: boolean;
    private: boolean;
    langs: string[];
}
export interface ReFrameContext {
    inId?: string;
    id?: string;
    eventRef?: boolean;
    subscriptionRef?: boolean;
}
export interface VarUse extends Span {
    nameRow: number;
    nameCol: number;
    from: string;
    fromVar?: string;
    to: string;
    name: string;
    arity?: number;
    macro: boolean;
    defmethod: boolean;
    dispatch?: string;
}
export interface Keyword extends Span {
    ns?: string;
    name: string;
    from: string;
    fromVar?: string;
    reg?: string;
    reFrame?: ReFrameContext;
    destructured?: boolean;
}
export interface ProtocolImpl extends Span {
    protocolNs: string;
    protocolName: string;
    method: string;
    implNs: string;
    definedBy: string;
}
export interface SyntaxError {
    file: string;
    row: number;
    message: string;
}
export interface Analysis {
    nsDefs: NsDef[];
    nsUses: NsUse[];
    varDefs: VarDef[];
    varUses: VarUse[];
    keywords: Keyword[];
    protocolImpls: ProtocolImpl[];
    syntaxErrors: SyntaxError[];
}
type Raw = Record<string, unknown>;
export declare function normalize(raw: Raw): Analysis;
export declare const CORE_NS: RegExp;
export declare const UNKNOWN_NS = "clj-kondo/unknown-namespace";
export declare function concat(parts: Analysis[]): Analysis;
export declare const keywordName: (k: {
    ns?: string;
    name: string;
}) => string;
export {};
