// `clojure-atlas build`: the I/O shell around the pure builder. Lists the files, runs kondo, reads the sources,
// assembles the graph and writes it (gzipped when the name ends in .gz).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { ADAPTERS } from './adapters/index.ts';
import { assemble, type AtlasDocument } from './assemble.ts';
import { componentOf, gitInfo, listFiles } from './files.ts';
import { analyze } from './kondo.ts';
import { createContext } from './model.ts';

export const DEFAULT_GRAPH = '.clojure-atlas/graph.json.gz';

export async function buildGraph(dir: string): Promise<AtlasDocument> {
  const started = Date.now();
  const root = path.resolve(dir);
  const files = listFiles(root);
  const analysis = await analyze(root, files.sources);
  const sources = new Map<string, string>();
  for (const f of [...files.sources, ...files.edn]) sources.set(f, readFileSync(path.join(root, f), 'utf8'));
  const ctx = createContext(analysis, sources, files.edn, (f) => componentOf(files.moduleRoots, f));
  const git = gitInfo(root);
  const doc = assemble(ctx, ADAPTERS, { repo_name: path.basename(root), ref: git.ref, sha: git.sha, built_at: new Date().toISOString() }, {
    sources: files.sources.length, edn: files.edn.length, skipped_large: files.skippedLarge.length,
  });
  doc.stats.build_ms = Date.now() - started;
  return doc;
}

export function writeGraph(doc: AtlasDocument, out: string): void {
  mkdirSync(path.dirname(out), { recursive: true });
  const json = JSON.stringify(doc);
  writeFileSync(out, out.endsWith('.gz') ? gzipSync(json) : json);
}
