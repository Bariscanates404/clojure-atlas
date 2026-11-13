// A local bearer token, shared by the user's clients and retained across server restarts.
import { randomBytes } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { cacheRoot } from '../build/kondo-binary.ts';

export const defaultTokenFile = (): string => path.join(cacheRoot(process.env, process.platform, homedir()), 'clojure-atlas', 'http-token');

export function httpToken(file: string): string {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  try {
    writeFileSync(file, `${randomBytes(32).toString('hex')}\n`, { flag: 'wx', mode: 0o600 });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }
  const s = lstatSync(file);
  if (!s.isFile() || s.isSymbolicLink()) throw new Error(`HTTP token must be a regular file, not a symlink: ${file}`);
  if (process.platform !== 'win32' && (s.mode & 0o077) !== 0) throw new Error(`HTTP token must be private; run chmod 600 ${file}`);
  if (s.size > 1024) throw new Error(`HTTP token file is too large: ${file}`);
  const token = readFileSync(file, 'utf8').trim();
  if (!/^[A-Za-z0-9._~+/=-]{32,256}$/.test(token)) throw new Error(`HTTP token must contain 32–256 bearer-token characters: ${file}`);
  return token;
}
