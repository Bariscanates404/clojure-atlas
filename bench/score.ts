// Asks every question of bench/questions.json against the graph `scripts/coverage.ts` wrote for its repo and writes
// docs/BENCHMARK.md. usage: node bench/score.ts <corpus-dir>
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGraph, type Graph } from '../src/mcp/graph.ts';
import { TOOLS } from '../src/mcp/server.ts';
import { score, type Question, type Score } from './scoring.ts';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [corpusDir] = process.argv.slice(2);
if (!corpusDir) throw new Error('usage: node bench/score.ts <corpus-dir>');
const read = (rel: string) => JSON.parse(readFileSync(path.join(repoRoot, rel), 'utf8'));
const questions = read('bench/questions.json') as Question[];
const pinned = new Map((read('corpus.json') as { name: string; sha: string }[]).map((e) => [e.name, e.sha]));

const graphs = new Map<string, Graph>();
const graphOf = (repo: string): Graph => {
  if (!graphs.has(repo)) {
    const g = loadGraph(path.join(corpusDir, '.graphs', `${repo}.json.gz`));
    if (g.doc.source.sha !== pinned.get(repo)) throw new Error(`${repo}: graph is at ${g.doc.source.sha}, corpus.json pins ${pinned.get(repo)}`);
    graphs.set(repo, g);
  }
  return graphs.get(repo) as Graph;
};

const rows: [Question, Score][] = questions.map((q) => {
  const tool = TOOLS.find((t) => t.name === q.tool);
  if (!tool) throw new Error(`${q.id}: no tool ${q.tool}`);
  return [q, score(q, tool.run(graphOf(q.repo), q.args, {}))];
});

const list = (xs: string[]) => xs.map((x) => `\`${x}\``).join(', ') || '-';
const passed = rows.filter(([, s]) => s.pass).length;
const expected = rows.reduce((n, [q]) => n + q.expected.length, 0);
const found = rows.reduce((n, [, s]) => n + s.found.length, 0);
const answered = rows.reduce((n, [, s]) => n + s.answered.length, 0);
const md = `# Benchmark

${questions.length} questions about public corpus repos, each answered by one MCP tool on the graph
\`scripts/coverage.ts\` builds at the sha pinned in [corpus.json](../corpus.json). The expected answers were
verified by hand in the source, without the tool; each one's file:line is in
[bench/questions.json](../bench/questions.json). A question passes when the answer names every expected definition
and nothing else. Measured by \`node bench/score.ts <corpus-dir>\`; every number below comes from that run.

**${passed} of ${questions.length} questions pass.** Expected items found: ${found} of ${expected}; items answered: ${answered}.

The questions were fixed before the first run, which scored 11 of 12: q07 showed that registrations and dispatches
through \`re-frame.alpha\` (re-frame's alpha namespace re-exporting \`re-frame.core\`) were not recognized. The builder
was fixed, with a fixture; the question was kept as it was.

| id | repo | tool | question | expected | found | missing | extra | pass |
|---|---|---|---|---|---|---|---|---|
${rows.map(([q, s]) => `| ${q.id} | ${q.repo} | ${q.tool} | ${q.question} | ${q.expected.length} | ${s.found.length} | ${list(s.missing)} | ${list(s.extra)} | ${s.pass ? 'yes' : 'no'} |`).join('\n')}
`;
writeFileSync(path.join(repoRoot, 'docs', 'BENCHMARK.md'), md);
process.stdout.write(`${passed}/${questions.length} pass; found ${found}/${expected}, answered ${answered}\n`);
