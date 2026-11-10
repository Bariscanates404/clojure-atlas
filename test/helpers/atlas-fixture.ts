// Builds a fixture directory under test/fixtures and renders the graph as sorted text rows, the form expected.txt holds.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AtlasDocument } from '../../src/build/assemble.ts';
import { buildGraph } from '../../src/build/index.ts';
import { readPlaywright } from '../../src/build/typescript.ts';

export const fixtureDir = (name: string) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', name);

const json = (v: unknown) => (v && typeof v === 'object' && Object.keys(v).length ? ` ${JSON.stringify(v)}` : '');

export function rowsText(doc: AtlasDocument): string {
  const nodes = doc.nodes.map((n) => `node ${n.id} [${n.kind}] ${n.file}:${n.line}${n.roles ? ` roles=${n.roles.join(',')}` : ''}${json(n.attrs)}`);
  const edges = doc.edges.map((e) => `edge ${e.from} -${e.kind}-> ${e.to} ${e.band} ${e.file}:${e.line}${json(e.attrs)}`);
  const u = doc.stats.usages;
  const adapters = Object.entries(doc.stats.adapters).map(([k, a]) => `${k}=${a.detected ?? 'off'}:${a.edges}`);
  return [
    ...nodes, ...edges,
    `usages resolved=${u.resolved} unresolved=${u.unresolved} unknown=${u.unknown} not-vars=${u.notVars} external=${u.external}`,
    `adapters ${adapters.join(' ')}`,
    `files sources=${doc.stats.files.sources} edn=${doc.stats.files.edn} skipped-large=${doc.stats.files.skipped_large} `
      + `syntax-error-files=${doc.stats.syntax_errors.files} dropped-edges=${doc.stats.dropped_edges}`,
    '',
  ].join('\n');
}

export const buildFixture = async (name: string): Promise<AtlasDocument> => buildGraph(fixtureDir(name));

// A fixture built where the TypeScript in use has no compiler API (TypeScript 7 removed it).
export const buildWithoutCompilerApi = async (name: string): Promise<AtlasDocument> =>
  buildGraph(fixtureDir(name), (root, pkgs, files) => readPlaywright(root, pkgs, files, () => ({ version: '7.0.2' }) as never));
