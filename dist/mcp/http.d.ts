import { type Server } from 'node:http';
import { GraphStore } from './graph-store.ts';
export declare const HTTP_PROTOCOLS: string[];
export declare const MAX_HTTP_BODY: number;
export declare function createAtlasHttpServer(store: GraphStore, token: string): Server;
export declare function listenAtlasHttp(server: Server, port: number): Promise<number>;
export declare function shutdownOnSignal(server: Server): void;
