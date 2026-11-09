// `clojure-atlas build`: the I/O shell around the pure builder. Lists the files, runs kondo, reads the sources,
// assembles the graph and writes it (gzipped when the name ends in .gz).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { ADAPTERS } from './adapters/index.ts';
import { assemble, type AtlasDocument } from './assemble.ts';
import { EMPTY_CONFIG, parseConfig } from './config.ts';
import { componentOf, expectedSources, listFiles } from './files.ts';
import { analyze, effectiveLintAs } from './kondo.ts';
import { kondo } from './kondo-binary.ts';
import { analyzerVersion, projectKnownSymbols, snapshotOf } from '../snapshot.ts';
import { readPlaywright } from './typescript.ts';
import { createContext } from './model.ts';

export const DEFAULT_GRAPH = '.clojure-atlas/graph.json.gz';
const CONFIG_FILE = '.clojure-atlas.edn';

// readTs reads the Playwright side; tests hand in one bound to a TypeScript of their choosing.
export async function buildGraph(dir: string, readTs: typeof readPlaywright = readPlaywright): Promise<AtlasDocument> {
  const started = Date.now();
  const root = path.resolve(dir);
  const files = listFiles(root);
  const configFile = path.join(root, CONFIG_FILE);
  const config = existsSync(configFile) ? parseConfig(readFileSync(configFile, 'utf8')) : EMPTY_CONFIG;
  const k = await kondo();
  const analysis = await analyze(k.command, root, files.sources, effectiveLintAs(projectKnownSymbols(root), config.lintAs));
  const sources = new Map<string, string>();
  for (const f of [...files.sources, ...files.edn]) sources.set(f, readFileSync(path.join(root, f), 'utf8'));
  const playwright = readTs(root, files.packageJsons, files.typescript);
  const ctx = createContext(analysis, config, playwright, sources, files.edn, (f) => componentOf(files.moduleRoots, f));
  const snap = snapshotOf(root, analyzerVersion(k.version));
  const doc = assemble(ctx, ADAPTERS, {
    repo_name: path.basename(root), ref: snap.ref, sha: snap.sha, built_at: new Date().toISOString(),
    snapshot: snap.id, dirty_files: snap.dirty.length, config_hash: snap.configHash, config_sources: snap.configSources, analyzer: snap.analyzer,
  }, {
    expected: expectedSources(root, files), sources: files.sources.length, edn: files.edn.length, skipped_large: files.skippedLarge.length,
  });
  doc.stats.build_ms = Date.now() - started;
  return doc;
}

export function writeGraph(doc: AtlasDocument, out: string): void {
  mkdirSync(path.dirname(out), { recursive: true });
  const json = JSON.stringify(doc);
  writeFileSync(out, out.endsWith('.gz') ? gzipSync(json) : json);
}
