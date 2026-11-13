// One shared snapshot per explicitly registered graph. A request keeps the snapshot it acquired;
// a rebuilt file replaces it only after the replacement has been completely loaded and validated.
import { realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { loadGraph, type Graph } from './graph.ts';
import type { ServerOptions } from './server.ts';
import { analyzerFor, SNAPSHOT_TTL_MS } from '../snapshot.ts';
import { SnapshotRefresher } from './snapshot-refresh.ts';

export interface GraphTarget {
  file: string;
  repo?: string;
}

export interface GraphSnapshot {
  graph: Graph;
  options: ServerOptions;
}

export class GraphAccessError extends Error {}

const stamp = (file: string): string => {
  const s = statSync(file, { bigint: true });
  return `${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;
};

interface Entry extends GraphTarget {
  stamp?: string;
  snapshot?: GraphSnapshot;
  generation: number;
  error?: string;
}

export class GraphStore {
  private entries: Entry[];
  private maxDistance?: number;
  readonly snapshots = new SnapshotRefresher(SNAPSHOT_TTL_MS);

  constructor(targets: GraphTarget[], maxDistance?: number) {
    if (targets.length === 0 || targets.length > 32) throw new Error('serve needs between 1 and 32 graphs');
    this.maxDistance = maxDistance;
    this.entries = targets.map(({ file, repo }) => {
      // native realpath returns the on-disk letter case, so case-insensitive file systems match case variants
      const canonical = repo === undefined ? undefined : realpathSync.native(repo);
      if (canonical && !statSync(canonical).isDirectory()) throw new Error(`${repo} is not a directory`);
      return { file: path.resolve(file), repo: canonical, generation: 0 };
    });
    const repos = this.entries.map((e) => e.repo);
    if (new Set(repos).size !== repos.length) throw new Error('serve needs distinct repositories (including symlink aliases)');
  }

  private entry(repo: string | null): Entry {
    if (repo === null && this.entries.length === 1) return this.entries[0];
    if (!repo || !path.isAbsolute(repo)) throw new GraphAccessError('select a registered graph with ?repo=<absolute repo path>');
    // Canonicalize only the supplied repo, never a client-selected graph file. Unknown repos are not loaded.
    let canonical: string;
    try { canonical = realpathSync.native(repo); } catch { throw new GraphAccessError('repository is not registered with this server'); }
    const entry = this.entries.find((e) => e.repo === canonical);
    if (!entry) throw new GraphAccessError('repository is not registered with this server');
    return entry;
  }

  // Checks that a request selects a registered graph, without loading it.
  select(repo: string | null = null): void {
    this.entry(repo);
  }

  get(repo: string | null = null): GraphSnapshot {
    const entry = this.entry(repo);
    try {
      const before = stamp(entry.file);
      if (entry.snapshot && entry.stamp === before) {
        entry.error = undefined;
        return entry.snapshot;
      }
      const graph = loadGraph(entry.file);
      if (stamp(entry.file) !== before) throw new Error('graph changed while loading; retry after the build finishes');
      const analyzer = analyzerFor(graph.doc.source.analyzer);
      const options: ServerOptions = {
        repoDir: entry.repo, maxDistance: this.maxDistance, graphDir: path.dirname(entry.file),
        // a relative base_graph is the agent's path, written from the repo it works in, not from the server's directory
        baseDir: entry.repo ?? path.dirname(entry.file),
        ...(entry.repo ? { snapshot: () => this.snapshots.snapshot(entry.repo!, analyzer) } : {}),
      };
      // Never mutate the old graph: in-flight requests can finish against their original snapshot.
      entry.snapshot = { graph, options };
      entry.stamp = before;
      entry.generation++;
      entry.error = undefined;
      return entry.snapshot;
    } catch (err) {
      entry.error = (err as Error).message;
      // Retain the old snapshot for in-flight calls, but don't silently serve it to new calls.
      throw new Error(`graph unavailable: ${entry.error}; rebuild or replace the graph atomically, then retry`);
    }
  }

  status(): unknown[] {
    return this.entries.map((e) => ({
      repo: e.repo ?? null, graph: e.file, loaded: !!e.snapshot, generation: e.generation,
      source: e.snapshot?.graph.doc.source ?? null, error: e.error ?? null,
    }));
  }
}
