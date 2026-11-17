export declare const KONDO_VERSION = "2025.10.23";
export declare const ASSETS: Record<string, [suffix: string, sha256: string]>;
export declare function unzipEntry(zip: Buffer, name: string): Buffer;
export interface Kondo {
    command: string;
    version: string;
}
export interface KondoHost {
    platform: string;
    arch: string;
    assets: Record<string, [suffix: string, sha256: string]>;
    cacheDir: string;
    download: (url: string) => Promise<Buffer>;
    resolve: (name: string) => string | null;
    version: (command: string) => string | null;
    warn: (message: string) => void;
}
export declare function locateKondo(host: KondoHost): Promise<Kondo>;
export declare function cacheRoot(env: Record<string, string | undefined>, platform: string, home: string): string;
export declare const DOWNLOAD_TIMEOUT_MS = 120000;
export declare const downloader: (timeoutMs: number) => (url: string) => Promise<Buffer>;
export declare const VERSION_TIMEOUT_MS = 10000;
export declare const versionProbe: (timeoutMs: number) => (command: string) => string | null;
export declare const HOST: KondoHost;
export declare function kondo(): Promise<Kondo>;
