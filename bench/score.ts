// Asks every question of bench/questions.json against the graph `scripts/coverage.ts` wrote for its repo and writes
// docs/BENCHMARK.md. usage: node bench/score.ts <corpus-dir>
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGraph, type Graph } from '../src/mcp/graph.ts';
import { TOOLS } from '../src/mcp/server.ts';
import { GRAPH_NODES, score, scoreNodes, staleGraph, type Question, type Score } from './scoring.ts';

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
    const stale = staleGraph(g.doc.source.analyzer);
    if (stale) throw new Error(`${repo}: ${stale}`);
    graphs.set(repo, g);
  }
  return graphs.get(repo) as Graph;
};

const rows: [Question, Score][] = questions.map((q) => {
  if (q.tool === GRAPH_NODES) return [q, scoreNodes(q, graphOf(q.repo))];
  const tool = TOOLS.find((t) => t.name === q.tool);
  if (!tool) throw new Error(`${q.id}: no tool ${q.tool}`);
  return [q, score(q, tool.run(graphOf(q.repo), q.args, {}))];
});

const list = (xs: string[]) => xs.map((x) => `\`${x}\``).join(', ') || '-';
const positive = rows.filter(([q]) => !q.absence);
const absence = rows.filter(([q]) => q.absence);
const passes = (rs: [Question, Score][]) => rs.filter(([, s]) => s.pass).length;
const expected = positive.reduce((n, [q]) => n + q.expected.length, 0);
const found = positive.reduce((n, [, s]) => n + s.found.length, 0);
const answered = positive.reduce((n, [, s]) => n + s.answered.length, 0);
const md = `# Benchmark

${questions.length} questions about public corpus repos, each answered by one MCP tool on the graph
\`scripts/coverage.ts\` builds at the sha pinned in [corpus.json](../corpus.json). The expected answers were
verified by hand in the source, without the tool; each one's file:line is in
[bench/questions.json](../bench/questions.json). Measured by \`node bench/score.ts <corpus-dir>\`; every number below
comes from that run, and the run refuses a graph built by another clojure-atlas version than the code it scores.

**Positive questions: ${passes(positive)} of ${positive.length} pass.** A question passes when the answer names every
expected definition and nothing else. Expected items found: ${found} of ${expected}; items answered: ${answered}.

**Absence questions: ${passes(absence)} of ${absence.length} pass.** The correct answer is that there is none. One passes only
when the answer states that kind of absence and names nothing: *none* (the thing exists, nothing relates to it, the
answer says zero), *not-found* (the codebase has no such thing, the answer says so), *used-undefined* (the name is used but no definition was found; the answer says it is probably made by a macro),  *capability-off* (the graph
cannot answer, because the extractor for this kind of fact found nothing to extract from, and the answer says that
instead of reading as plain absence).

The positive questions were fixed before the first run, which scored 11 of 12: q07 showed that registrations and
dispatches through \`re-frame.alpha\` (re-frame's alpha namespace re-exporting \`re-frame.core\`) were not recognized.
The builder was fixed, with a fixture; the question was kept as it was.

## Positive questions

| id | repo | tool | question | expected | found | missing | extra | pass |
|---|---|---|---|---|---|---|---|---|
${positive.map(([q, s]) => `| ${q.id} | ${q.repo} | ${q.tool} | ${q.question} | ${q.expected.length} | ${s.found.length} | ${list(s.missing)} | ${list(s.extra)} | ${s.pass ? 'yes' : 'no'} |`).join('\n')}

## Absence questions

| id | repo | tool | question | correct answer | states it | names nothing | pass |
|---|---|---|---|---|---|---|---|
${absence.map(([q, s]) => `| ${q.id} | ${q.repo} | ${q.tool} | ${q.question} | ${q.absence}${q.capability ? ` (${q.capability})` : ''} | ${s.stated ? 'yes' : 'no'} | ${s.named ? 'no' : 'yes'} | ${s.pass ? 'yes' : 'no'} |`).join('\n')}
`;
writeFileSync(path.join(repoRoot, 'docs', 'BENCHMARK.md'), md);
process.stdout.write(`positive ${passes(positive)}/${positive.length} pass; found ${found}/${expected}, answered ${answered}; absence ${passes(absence)}/${absence.length} pass\n`);
