// How far the graph's commit is from the commit a caller is looking at. The distance comes from a
// read-only `git rev-list --count` in a local clone when one is configured; without a clone a differing
// sha is reported as STALE with an unknown distance, never as fresh.
import { execFileSync } from 'node:child_process';
import type { Graph } from './graph.ts';

export const DEFAULT_MAX_DISTANCE = 20;

export interface StalenessOptions {
  repoDir?: string;
  maxDistance?: number;
  // Commits reachable from `base` but not from `graphSha`; null when git cannot tell. Injectable for tests.
  distance?: (graphSha: string, base: string) => number | null;
}

export interface Staleness {
  stale: boolean;
  distance: number | null;
  header: string | null;
}

const short = (s: string) => s.slice(0, 10);

export function gitDistance(repoDir: string): (graphSha: string, base: string) => number | null {
  return (graphSha, base) => {
    try {
      const out = execFileSync('git', ['-C', repoDir, 'rev-list', '--count', `${graphSha}..${base}`], {
        encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'],
      });
      const n = Number.parseInt(out.trim(), 10);
      return Number.isFinite(n) ? n : null;
    } catch (err) {
      process.stderr.write(`clojure-atlas: git rev-list failed in ${repoDir}: ${(err as Error).message.split('\n')[0]}\n`);
      return null;
    }
  };
}

export function sameCommit(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (!x || !y) return false;
  return x.length >= 7 && y.length >= 7 ? x.startsWith(y) || y.startsWith(x) : x === y;
}

export function staleness(g: Graph, base: string | undefined, opts: StalenessOptions = {}): Staleness {
  const sha = g.doc.source.sha;
  if (!base || !base.trim()) return { stale: false, distance: null, header: null };
  if (sameCommit(sha, base)) return { stale: false, distance: 0, header: null };
  const max = opts.maxDistance ?? DEFAULT_MAX_DISTANCE;
  const measure = opts.distance ?? (opts.repoDir ? gitDistance(opts.repoDir) : undefined);
  const distance = measure ? measure(sha, base.trim()) : null;
  if (distance === null) {
    return {
      stale: true,
      distance: null,
      header: `STALE: graph built at ${short(sha)}, base ${short(base)}; distance unknown${measure ? ' (git could not compare them)' : ' (no repo configured)'}. Cited lines may have moved since.`,
    };
  }
  if (distance > max) {
    return {
      stale: true,
      distance,
      header: `STALE: graph built at ${short(sha)} is ${distance} commits behind base ${short(base)} (threshold ${max}). Cited lines may have moved since.`,
    };
  }
  return { stale: false, distance, header: `graph ${short(sha)} is ${distance} commit(s) behind base ${short(base)} (within threshold ${max})` };
}
