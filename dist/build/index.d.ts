import { type AtlasDocument } from './assemble.ts';
import { type AnalyzeOptions } from './kondo.ts';
import { readPlaywright } from './typescript.ts';
export declare const DEFAULT_GRAPH = ".clojure-atlas/graph.json.gz";
export declare function buildGraph(dir: string, readTs?: typeof readPlaywright, kondoOptions?: AnalyzeOptions): Promise<AtlasDocument>;
export declare function writeGraph(doc: AtlasDocument, out: string): void;
