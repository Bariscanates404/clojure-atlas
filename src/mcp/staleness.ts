// How far the graph's commit is from the commit a caller is looking at, in both directions: commits the base has that
// the graph lacks (behind) and commits the graph has that the base lacks (ahead). The distance comes from a read-only
// `git rev-list --left-right --count` in a local clone when one is configured; without a clone a differing sha is
// reported as STALE with an unknown distance, never as fresh. A graph ahead of or diverged from the base describes
// code the base does not contain, so it is stale however few commits that is.
import { UNVERSIONED, type Snapshot } from '../snapshot.ts';
import type { Graph } from './graph.ts';
import { runGit } from '../shared/git.ts';
import { shortSha } from '../shared/sha.ts';

export const DEFAULT_MAX_DISTANCE = 20;

export interface StalenessOptions {
  repoDir?: string;
  // the working tree's snapshot (src/snapshot.ts), compared with the graph's when both are known
  snapshot?: () => Snapshot;
  maxDistance?: number;
  // How the graph's commit and the base relate; null when git cannot tell. Injectable for tests.
  distance?: (graphSha: string, base: string) => Divergence | null;
}

export interface Divergence {
  // commits reachable from the base but not from the graph's commit
  behind: number;
  // commits reachable from the graph's commit but not from the base
  ahead: number;
}

export interface Staleness {
  stale: boolean;
  distance: number | null;
  header: string | null;
}

export function gitDistance(repoDir: string): (graphSha: string, base: string) => Divergence | null {
  return (graphSha, base) => {
    try {
      const out = runGit(repoDir, ['rev-list', '--left-right', '--count', `${graphSha}...${base}`], { timeoutMs: 10000 });
      const [ahead, behind] = out.trim().split(/\s+/).map((x) => Number.parseInt(x, 10));
      return Number.isFinite(ahead) && Number.isFinite(behind) ? { ahead, behind } : null;
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
    ...(sameCommit(s.sha, now.sha) ? [] : [`commit ${shortSha(now.sha)} (graph ${shortSha(s.sha)})`]),
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
  const found = measure ? measure(sha, base.trim()) : null;
  if (found === null) {
    return {
      stale: true,
      distance: null,
      header: `STALE: graph built at ${shortSha(sha)}, base ${shortSha(base)}; `
        + `distance unknown${measure ? ' (git could not compare them)' : ' (no repo configured)'}. Cited lines may have moved since.`,
    };
  }
  const { behind: distance, ahead } = found;
  if (ahead > 0) {
    const relation = distance > 0
      ? `diverged from base ${shortSha(base)} (${ahead} commit(s) ahead, ${distance} behind)`
      : `${ahead} commit(s) ahead of base ${shortSha(base)}`;
    return {
      stale: true,
      distance,
      header: `STALE: graph built at ${shortSha(sha)} is ${relation}: it describes code the base does not contain. Cited lines may not exist there.`,
    };
  }
  if (distance > max) {
    return {
      stale: true,
      distance,
      header: `STALE: graph built at ${shortSha(sha)} is ${distance} commits behind base ${shortSha(base)} (threshold ${max}). Cited lines may have moved since.`,
    };
  }
  return { stale: false, distance, header: `graph ${shortSha(sha)} is ${distance} commit(s) behind base ${shortSha(base)} (within threshold ${max})` };
}
