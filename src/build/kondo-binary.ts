// The clj-kondo atlas runs: the native release binary for this platform, version and sha256 pinned, fetched on first
// use into a per-user cache (no JVM, no install script). Without a native release, or when the download fails, a
// clj-kondo on PATH is used; with neither, the build stops and says why.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';

export const KONDO_VERSION = '2025.10.23';

// platform-arch -> release asset and the sha256 GitHub records for it
export const ASSETS: Record<string, [suffix: string, sha256: string]> = {
  'darwin-arm64': ['macos-aarch64', '9915429099bdb5d35ce0cc88e0e346d9be78a7fd44d9ea8689b19843927e3a07'],
  'darwin-x64': ['macos-amd64', 'b6876f9311f2998cce0df226adf4792eacf287cfeba9bd067f44d56650956970'],
  'linux-x64': ['linux-static-amd64', '78800fe62fb20be046067e7b90e0066a4cdf0e96b5dde1e0d73c8e141fa70663'],
  'linux-arm64': ['linux-aarch64', '75c90f734caac87e1cabb163fbe2201a2e985f6be72eb1e0f132a7f774b33fcb'],
  'win32-x64': ['windows-amd64', '0a72b26b6cd0b80089285a845b1428b6636eb2a77fbf581a78f417d1e5557c27'],
};

// The one file named `name` in a zip archive: central directory, then its local header and data.
export function unzipEntry(zip: Buffer, name: string): Buffer {
  let eocd = zip.length - 22;
  while (eocd >= 0 && zip.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip archive');
  const count = zip.readUInt16LE(eocd + 10);
  let at = zip.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLen = zip.readUInt16LE(at + 28);
    const local = zip.readUInt32LE(at + 42);
    if (zip.toString('utf8', at + 46, at + 46 + nameLen) === name) {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + size);
      return method === 8 ? inflateRawSync(data) : data;
    }
    at += 46 + nameLen + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  }
  throw new Error(`${name} is not in the archive`);
}

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
  // `<command> --version`, or null when the command cannot run
  version: (command: string) => string | null;
  warn: (message: string) => void;
}

export async function locateKondo(host: KondoHost): Promise<Kondo> {
  const exe = host.platform === 'win32' ? 'clj-kondo.exe' : 'clj-kondo';
  const fromPath = (why: string): Kondo => {
    const version = host.version('clj-kondo');
    if (version === null) throw new Error(`${why}, and there is no clj-kondo on PATH; install clj-kondo (https://github.com/clj-kondo/clj-kondo) and run again`);
    host.warn(`${why}; using clj-kondo on PATH (${version})`);
    return { command: 'clj-kondo', version };
  };
  const asset = host.assets[`${host.platform}-${host.arch}`];
  if (!asset) return fromPath(`clj-kondo ${KONDO_VERSION} has no native release for ${host.platform}-${host.arch}`);
  const [suffix, sha] = asset;
  const target = path.join(host.cacheDir, `clj-kondo-${KONDO_VERSION}-${suffix}`, exe);
  if (!existsSync(target)) {
    const url = `https://github.com/clj-kondo/clj-kondo/releases/download/v${KONDO_VERSION}/clj-kondo-${KONDO_VERSION}-${suffix}.zip`;
    let zip: Buffer;
    host.warn(`downloading clj-kondo ${KONDO_VERSION} (${suffix}) once, to ${target}`);
    try {
      zip = await host.download(url);
    } catch (err) {
      return fromPath(`cannot download ${url} (${(err as Error).message})`);
    }
    const got = createHash('sha256').update(zip).digest('hex');
    if (got !== sha) return fromPath(`${url} answered sha256 ${got}, expected ${sha}; refusing to run it`);
    mkdirSync(path.dirname(target), { recursive: true });
    // renamed into place, so a concurrent build never runs a half-written binary
    const partial = `${target}.${process.pid}.partial`;
    writeFileSync(partial, unzipEntry(zip, exe));
    chmodSync(partial, 0o755);
    renameSync(partial, target);
    host.warn(`fetched clj-kondo ${KONDO_VERSION} (${suffix}) to ${target}`);
  }
  const version = host.version(target);
  if (version === null) throw new Error(`${target} does not run; delete it and run again`);
  return { command: target, version };
}

// The per-user cache directory: an absolute XDG_CACHE_HOME (LOCALAPPDATA on Windows), else the platform default. An
// empty or relative value is as good as unset (the spec says to ignore it); a relative one would put the binary
// in whatever directory the command runs in.
export function cacheRoot(env: Record<string, string | undefined>, platform: string, home: string): string {
  const named = platform === 'win32' ? env.LOCALAPPDATA : env.XDG_CACHE_HOME;
  if (named && path.isAbsolute(named)) return named;
  return platform === 'win32' ? path.join(home, 'AppData', 'Local') : path.join(home, '.cache');
}

export const DOWNLOAD_TIMEOUT_MS = 120_000;

// Fetches a URL into memory, giving up after `timeoutMs` for the whole transfer.
export const downloader = (timeoutMs: number) => async (url: string): Promise<Buffer> => {
  const res = await fetch(url, { headers: { 'user-agent': 'clojure-atlas' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
};

export const HOST: KondoHost = {
  platform: process.platform,
  arch: process.arch,
  assets: ASSETS,
  cacheDir: path.join(cacheRoot(process.env, process.platform, homedir()), 'clojure-atlas'),
  download: downloader(DOWNLOAD_TIMEOUT_MS),
  version: (command) => {
    try {
      return execFileSync(command, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') process.stderr.write(`clojure-atlas: ${command} --version failed: ${(err as Error).message.split('\n')[0]}\n`);
      return null;
    }
  },
  warn: (message) => process.stderr.write(`clojure-atlas: ${message}\n`),
};

let located: Promise<Kondo> | undefined;

// The clj-kondo of this machine, located once per process.
export function kondo(): Promise<Kondo> {
  located ??= locateKondo(HOST);
  return located;
}
