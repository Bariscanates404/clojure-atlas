// Scores one MCP answer against a hand-verified answer set: the definitions and namespaces the answer lists in the
// sections that answer the question, compared as sets. A question passes when nothing is missing and nothing extra.
import type { QueryResult } from '../src/mcp/rows.ts';

export interface Question {
  id: string;
  repo: string;
  question: string;
  tool: string;
  args: Record<string, unknown>;
  expected: string[];
  evidence: Record<string, string>;
}

export interface Score {
  id: string;
  answered: string[];
  found: string[];
  missing: string[];
  extra: string[];
  pass: boolean;
}

// the sections (by short name) that hold each tool's answer
const ANSWER_SECTIONS: Record<string, readonly string[]> = {
  callers: ['callers', 'callers and references'],
  event_flow: ['dispatched by', 'handler'],
  route_authz: ['handler'],
  tests_for: ['clojure.test'],
  key_flow: ['producers', 'consumers', 'removed', 'tests'],
};

// The vars and namespaces an answer names; rows of other kinds (an inline handler, a route) are not vars.
export function answerSet(tool: string, result: QueryResult): string[] {
  const wanted = ANSWER_SECTIONS[tool];
  if (!wanted) throw new Error(`no answer sections known for tool ${tool}`);
  const ids = result.sections.filter((s) => wanted.includes(s.short ?? s.name)).flatMap((s) => s.rows.map((r) => r.id));
  return [...new Set(ids.flatMap((id) => /^(definition|namespace):(.+)$/.exec(id)?.slice(2, 3) ?? []))].sort();
}

export function score(q: Question, result: QueryResult): Score {
  const answered = answerSet(q.tool, result);
  const found = q.expected.filter((e) => answered.includes(e));
  const missing = q.expected.filter((e) => !answered.includes(e));
  const extra = answered.filter((a) => !q.expected.includes(a));
  return { id: q.id, answered, found, missing, extra, pass: !missing.length && !extra.length };
}
