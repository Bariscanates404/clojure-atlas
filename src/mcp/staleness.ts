// How far the graph's commit is from the commit a caller is looking at. The distance comes from a
// read-only `git rev-list --count` in a local clone when one is configured; without a clone a differing
// sha is reported as STALE with an unknown distance, never as fresh.
import { execFileSync } from 'node:child_process';
import { UNVERSIONED, type Snapshot } from '../snapshot.ts';
import type { Graph } from './graph.ts';

export const DEFAULT_MAX_DISTANCE = 20;

export interface StalenessOptions {
  repoDir?: string;
  // the working tree's snapshot (src/snapshot.ts), compared with the graph's when both are known
  snapshot?: () => Snapshot;
  maxDistance?: number;
  // Commits reachable from `base` but not from `graphSha`; null when git cannot tell. Injectable for tests.
  distance?: (graphSha: string, base: string) => number | null;
}

export interface Staleness {
  stale: boolean;
  distance: number | null;
  header: string | null;
}

// A full hex sha is shortened to ten characters; any other name (a branch, a tag) is shown whole.
const short = (s: string) => (/^[0-9a-f]{11,}$/i.test(s) ? s.slice(0, 10) : s);

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

// What differs between the working tree and the snapshot the graph was built from, or null when nothing does.
function treeDifference(g: Graph, now: Snapshot): string | null {
  const s = g.doc.source;
  if (!s.snapshot || s.snapshot === now.id) return null;
  // git could not read the tree: what changed in it is unknown, not zero
  const unreadable = now.sha === UNVERSIONED && s.sha !== UNVERSIONED;
  const why = unreadable ? ['git could not read the working tree (no repository there, or git failed), so what changed in it is unknown'] : [
    ...(sameCommit(s.sha, now.sha) ? [] : [`commit ${short(now.sha)} (graph ${short(s.sha)})`]),
    ...((s.dirty_files ?? 0) || now.dirty.length ? [`${now.dirty.length} uncommitted file(s) now, ${s.dirty_files ?? 0} at build`] : []),
    ...(s.config_hash && s.config_hash !== now.configHash ? ['the clj-kondo or .clojure-atlas.edn config changed'] : []),
    ...(s.analyzer && s.analyzer !== now.analyzer ? [`analyzer ${now.analyzer} (graph ${s.analyzer})`] : []),
  ];
  return `STALE: the working tree is not the snapshot this graph describes (${why.join('; ') || 'contents differ'}); rebuild with clojure-atlas build.`;
}

export function staleness(g: Graph, base: string | undefined, opts: StalenessOptions = {}): Staleness {
  const tree = opts.snapshot ? treeDifference(g, opts.snapshot()) : null;
  const byBase = stalenessToBase(g, base, opts);
  if (!tree) return byBase;
  return { stale: true, distance: byBase.distance, header: [tree, byBase.header].filter(Boolean).join('\n') };
}

function stalenessToBase(g: Graph, base: string | undefined, opts: StalenessOptions): Staleness {
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
