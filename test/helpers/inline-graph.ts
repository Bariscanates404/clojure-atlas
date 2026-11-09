// Builds a graph from source files given as text, for tests that pin one behaviour without a whole fixture.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AtlasDocument } from '../../src/build/assemble.ts';
import { buildGraph } from '../../src/build/index.ts';

export async function graphOf(files: Record<string, string>): Promise<AtlasDocument> {
  const root = mkdtempSync(path.join(tmpdir(), 'atlas-inline-'));
  try {
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
      writeFileSync(path.join(root, name), text);
    }
    return await buildGraph(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// "from -kind-> to band" rows of the edges of one kind, sorted, for exact comparison.
export const edgeRows = (doc: AtlasDocument, kind: string): string[] =>
  doc.edges.filter((e) => e.kind === kind).map((e) => `${e.from} -> ${e.to} ${e.band}`).sort();

export const nodeRows = (doc: AtlasDocument, kind: string): string[] => doc.nodes.filter((n) => n.kind === kind).map((n) => n.id).sort();
