// Scores one MCP answer against a hand-verified answer set: the definitions and namespaces the answer lists in the
// sections that answer the question, compared as sets. A question passes when nothing is missing and nothing extra.
// An absence question has no expected items: the correct answer is that there is none. It passes only when the answer
// states that kind of absence and names nothing.
import type { Graph } from '../src/mcp/graph.ts';
import type { QueryResult } from '../src/mcp/rows.ts';
import { analyzerFor } from '../src/snapshot.ts';

// none: the thing exists and nothing relates to it; not-found: the thing is not in the codebase; capability-off: the
// graph cannot answer, because the extractor for this kind of fact found nothing to extract from
export type Absence = 'none' | 'not-found' | 'capability-off';

export interface Question {
  id: string;
  repo: string;
  question: string;
  tool: string;
  args: Record<string, unknown>;
  expected: string[];
  evidence: Record<string, string>;
  absence?: Absence;
  // the graph capability an absence of kind capability-off is about
  capability?: string;
  // the sections that hold the answer, where the tool's usual ones are not (route_authz: the middleware of a route)
  sections?: string[];
}

// The pseudo-tool of a question about a kind of node no MCP tool lists: it reads the graph, args {kind, attrs}, and
// the answer is the names of the nodes of that kind whose attrs hold every given value.
export const GRAPH_NODES = 'graph_nodes';

export interface Score {
  id: string;
  answered: string[];
  found: string[];
  missing: string[];
  extra: string[];
  // an absence question: whether the answer states that absence
  stated?: boolean;
  // an absence question: the rows the answer sections list, of any kind
  named?: number;
  pass: boolean;
}

// the sections (by short name) that hold each tool's answer
const ANSWER_SECTIONS: Record<string, readonly string[]> = {
  callers: ['callers', 'callers and references'],
  event_flow: ['dispatched by', 'handler'],
  route_authz: ['handler'],
  tests_for: ['clojure.test'],
  key_flow: ['producers', 'consumers', 'removed', 'tests'],
  permission_routes: ['routes'],
};

// The vars and namespaces an answer names; rows of other kinds (an inline handler, a route) are not vars.
export function answerSet(tool: string, result: QueryResult, sections?: readonly string[]): string[] {
  const wanted = sections ?? ANSWER_SECTIONS[tool];
  if (!wanted) throw new Error(`no answer sections known for tool ${tool}`);
  const ids = result.sections.filter((s) => wanted.includes(s.short ?? s.name)).flatMap((s) => s.rows.map((r) => r.id));
  return [...new Set(ids.flatMap((id) => /^(definition|namespace|library_middleware):(.+)$/.exec(id)?.slice(2, 3) ?? []))].sort();
}

const NOT_AVAILABLE = '(absent|unavailable|not used|not listed|not declared|not detected)';

// Every row the answer sections list, of whatever kind: a route or a handler is named too.
const namedRows = (tool: string, result: QueryResult): number =>
  result.sections.filter((s) => (ANSWER_SECTIONS[tool] ?? []).includes(s.short ?? s.name)).reduce((n, s) => n + s.rows.length, 0);

// Whether the answer says what the question's absence kind needs said: not-found, a count of zero, or that the
// capability is not available (named, with a word saying so, in the verdict or a note).
function statesAbsence(q: Question, result: QueryResult): boolean {
  if (q.absence === 'not-found') return !result.found && result.matches.length === 0;
  if (q.absence === 'none') return result.found && /(^|\D)0 /.test(result.verdict);
  const text = [result.verdict, ...result.notes].join('\n');
  const name = q.capability ?? '';
  return new RegExp(`\\b${name}\\b[^\\n]*\\b${NOT_AVAILABLE}\\b|\\b${NOT_AVAILABLE}\\b[^\\n]*\\b${name}\\b`).test(text);
}

const compared = (q: Question, answered: string[]): Score => {
  const found = q.expected.filter((e) => answered.includes(e));
  const missing = q.expected.filter((e) => !answered.includes(e));
  const extra = answered.filter((a) => !q.expected.includes(a));
  return { id: q.id, answered, found, missing, extra, pass: !missing.length && !extra.length };
};

export function scoreNodes(q: Question, g: Graph): Score {
  const attrs = Object.entries((q.args.attrs ?? {}) as Record<string, unknown>);
  const nodes = (g.byKind.get(String(q.args.kind)) ?? []).filter((n) => attrs.every(([k, v]) => n.attrs?.[k] === v));
  return compared(q, [...new Set(nodes.map((n) => n.name))].sort());
}

export function score(q: Question, result: QueryResult): Score {
  const answered = answerSet(q.tool, result, q.sections);
  if (q.absence) {
    const stated = statesAbsence(q, result);
    const named = namedRows(q.tool, result);
    return { id: q.id, answered, found: [], missing: [], extra: answered, stated, named, pass: stated && named === 0 };
  }
  return compared(q, answered);
}

// A graph built by another clojure-atlas version than the code under test says nothing about it: the reason it must
// not be scored, or undefined when the recorded analyzer is this one (the clj-kondo it names is kept).
export function staleGraph(recorded: string | undefined): string | undefined {
  const current = analyzerFor(recorded);
  return recorded !== undefined && recorded === current ? undefined : `graph built by "${recorded ?? 'no analyzer recorded'}", this is "${current || 'clojure-atlas'}": rebuild it with scripts/coverage.ts`;
}
