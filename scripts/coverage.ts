// Builds every repo of corpus.json from a corpus directory and writes docs/COVERAGE.md.
// usage: node scripts/coverage.ts <corpus-dir> [repo ...]
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGraph, writeGraph } from '../src/build/index.ts';
import { coverageRow, coverageTable, type CoverageRow } from '../src/coverage.ts';

interface CorpusEntry {
  name: string;
  url: string;
  ref: string;
  sha: string;
}

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [corpusDir, ...only] = process.argv.slice(2);
if (!corpusDir) throw new Error('usage: node scripts/coverage.ts <corpus-dir> [repo ...]');
const corpus = (JSON.parse(readFileSync(path.join(repoRoot, 'corpus.json'), 'utf8')) as CorpusEntry[]).filter((e) => !only.length || only.includes(e.name));
const graphs = path.join(corpusDir, '.graphs');
mkdirSync(graphs, { recursive: true });

const rows: CoverageRow[] = [];
const notes: string[] = [];
const gaps: string[] = [];
const names = (xs: [string, number][], n = 5) => xs.slice(0, n).map(([x, k]) => `\`${x}\` ${k}`).join(', ') || 'none';
for (const entry of corpus) {
  const doc = await buildGraph(path.join(corpusDir, entry.name));
  if (doc.source.sha !== entry.sha) throw new Error(`${entry.name}: checkout is at ${doc.source.sha}, corpus.json pins ${entry.sha}`);
  const out = path.join(graphs, `${entry.name}.json.gz`);
  writeGraph(doc, out);
  const row = coverageRow(doc, statSync(out).size);
  rows.push(row);
  const u = doc.stats.usages;
  notes.push(`### ${entry.name}\n`
    + `- most frequent unresolved: ${u.topUnresolved.map(([n, k]) => `\`${n}\` ${k}`).join(', ') || 'none'}\n`
    + `- most frequent unknown: ${u.topUnknown.map(([n, k]) => `\`${n}\` ${k}`).join(', ') || 'none'}\n`
    + `- adapters: ${Object.entries(doc.stats.adapters).map(([k, a]) => `${k} ${a.detected ? `(${a.detected}) ${a.edges} edges` : 'off'}`).join(', ')}\n`);
  if (row.resolvedPct < 95) {
    gaps.push(`- **${entry.name}** ${row.resolvedPct.toFixed(1)}%: ${u.unknown} unknown (most: ${names(u.topUnknown)}); `
      + `${u.unresolved} unresolved (most: ${names(u.topUnresolved, 3)})`);
  }
  process.stderr.write(`${entry.name}: ${row.resolvedPct.toFixed(1)}% resolved, ${(row.buildMs / 1000).toFixed(1)} s\n`);
}

if (!only.length) {
  const md = `# Coverage

Measured by \`node scripts/coverage.ts <corpus-dir>\` over the repos pinned in [corpus.json](../corpus.json), each at
the recorded sha. Every number below comes from that run.

How to read the columns:
- **files**: Clojure sources analyzed (.clj, .cljs, .cljc; build output, dependencies and hidden directories skipped).
- **syntax-error files**: files clj-kondo could not fully parse.
- **resolved / unresolved / unknown**: var usages that name a project namespace. *resolved* found its definition;
  *unresolved* names a project namespace but no definition in it (a var created by a macro clj-kondo does not know,
  or by \`intern\`); *unknown* is a symbol clj-kondo could not resolve at all (mostly bindings of macros it does not
  know). Usages of library vars (clojure.core and dependencies) are not counted, and neither are symbols that can
  never be vars (special forms, auto-gensyms, \`&\`, clojure.test's \`thrown?\`).
- **resolved %**: resolved / (resolved + unresolved + unknown).
- adapter columns: edges each adapter added (0 when its library is not used); key_tables counts tables.
- **unknown edges**: edges in band UNKNOWN (attribute references of unproven role).

${coverageTable(rows)}

## Repos under 95% resolved

What is left in each is one of two kinds, both visible in the names below:
- **unknown**: a symbol bound by a macro clj-kondo does not know, so it cannot tell a local from a var
  (fields of a deftype or proxy, bindings of a test DSL such as fulcro-spec's \`=>\`, bindings of a project's own
  def-like macro). They are not var usages, but nothing static proves that.
- **unresolved**: a var created by a project macro clj-kondo does not know (datascript's record constructors), or
  a name in a REPL script with no ns form that clj-kondo files under a namespace not defining it (day-of-datomic's
  tutorials).
Both shrink when the repo ships a clj-kondo config for its macros, or when \`.clojure-atlas.edn\` names them under
\`:lint-as\`; the corpus is measured without adding either.

${gaps.join('\n') || 'none'}

## Per repo

${notes.join('\n')}`;
  writeFileSync(path.join(repoRoot, 'docs', 'COVERAGE.md'), md);
}
process.stdout.write(`${coverageTable(rows)}\n`);
