export interface ResolveHost {
    platform: string;
    pathEnv: string | undefined;
    pathExt?: string | undefined;
    avoid: readonly string[];
    exists: (file: string) => boolean;
}
export declare function resolveExecutable(name: string, host: ResolveHost): string | null;
export declare function whichExecutable(name: string, avoid: readonly string[]): string | null;
