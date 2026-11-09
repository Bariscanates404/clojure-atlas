// Regression tests from review findings: JSON-RPC notifications and line splitting, base_graph
// containment, loader checks, the per-section budget ladder, the line-boundary cut and route matching.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { gzipSync } from 'node:zlib';
import { graphFromJson, GraphFormatError, loadGraph } from '../src/mcp/graph.ts';
import { findRoutes, routeAuthz, type QueryResult, type Row } from '../src/mcp/queries.ts';
import { CHARS_PER_TOKEN, render } from '../src/mcp/render.ts';
import { lineSplitter } from '../src/mcp/stdio.ts';
import { callTool, handleMessage, MAX_BASE_GRAPHS } from '../src/mcp/server.ts';
import { GraphBuilder } from './helpers/code-graph-fixture.ts';

const tiny = () => {
  const b = new GraphBuilder();
  b.def('core/f', 'components/core', { file: 'components/core/src/f.clj', line: 1, end_line: 3 });
  return b;
};

describe('a notification is never answered', () => {
  const g = tiny().build();
  for (const method of ['initialize', 'tools/list', 'tools/call']) {
    it(method, () => assert.equal(handleMessage(g, { jsonrpc: '2.0', method, params: { name: 'graph_info', arguments: {} } }), null));
  }
  it('a request with id null is still answered', () => assert.notEqual(handleMessage(g, { jsonrpc: '2.0', id: null, method: 'ping' }), null));
});

describe('lines split on \\n only', () => {
  it('U+2028 and U+2029 inside a string stay in one message', () => {
    const got: string[] = [];
    const s = lineSplitter((l) => got.push(l));
    const msg = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: { x: 'a b c' } });
    s.push(`${msg.slice(0, 20)}`);
    s.push(`${msg.slice(20)}\r\n{"id":2`);
    s.end();
    assert.deepEqual(got, [msg, '{"id":2']);
    assert.equal(JSON.parse(got[0]).params.x, 'a b c');
  });
});

describe('base_graph is a graph file next to the served graph, and errors quote no content', () => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-base-'));
  const graphs = join(dir, 'graphs');
  mkdirSync(graphs);
  writeFileSync(join(dir, 'secret.txt'), 'TOP-SECRET line one\n');
  writeFileSync(join(graphs, 'bad.json'), '## TOP-SECRET not json');
  writeFileSync(join(dir, 'outside.json'), JSON.stringify(tiny().doc()));
  const g = tiny().build();
  const ask = (file: string) => callTool(g, 'signature_impact', { fn: 'core/f', base_graph: file }, { graphDir: graphs });
  const asText = (f: () => unknown) => {
    try {
      f();
      return '';
    } catch (e) {
      return (e as Error).message;
    }
  };
  it('a non-graph file name is refused', () => assert.match(asText(() => ask(join(dir, 'secret.txt'))), /^base_graph secret\.txt: not a code-graph file/));
  it('a missing graph names the file only', () => assert.equal(asText(() => ask(join(graphs, 'gone.json'))), 'base_graph gone.json: no such file'));
  it('a graph outside the graph directory is refused', () => assert.match(asText(() => ask(join(dir, 'outside.json'))), /outside the graph directory/));
  it('an unreadable graph names the file only', () => {
    const msg = asText(() => ask(join(graphs, 'bad.json')));
    assert.match(msg, /^base_graph bad\.json: not a readable code-graph$/);
    assert.doesNotMatch(msg, /SECRET|\/graphs\//);
  });
  it('a base graph rewritten in place is read again', () => {
    const sig = (keys: string[]) => ({ arities: [{ params: [{ kind: 'map', keys, reads: keys, reads_complete: true }], variadic: false }] });
    const write = (keys: string[]) => {
      const b = new GraphBuilder();
      b.def('core/f', 'components/core', { file: 'components/core/src/f.clj', line: 1, end_line: 3, attrs: { signature: sig(keys) } });
      writeFileSync(join(graphs, 'base.json'), JSON.stringify(b.doc()));
    };
    const head = new GraphBuilder();
    head.def('core/f', 'components/core', { file: 'components/core/src/f.clj', line: 1, end_line: 3, attrs: { signature: sig([':a', ':b']) } });
    const hg = head.build();
    const summary = () => callTool(hg, 'signature_impact', { fn: 'core/f', base_graph: join(graphs, 'base.json') }, { graphDir: graphs }).text;
    write([':a']);
    assert.match(summary(), /new keys: :b/);
    write([':a', ':b']);
    assert.doesNotMatch(summary(), /new keys/);
  });
  it('the base-graph cache keeps only the most recently used graphs', () => {
    const sig = (key: string) => ({ arities: [{ params: [{ kind: 'map', keys: [key], reads: [key], reads_complete: true }], variadic: false }] });
    const head = new GraphBuilder();
    head.def('core/f', 'components/core', { file: 'components/core/src/f.clj', line: 1, end_line: 3, attrs: { signature: sig(':a') } });
    const hg = head.build();
    const names = Array.from({ length: MAX_BASE_GRAPHS + 1 }, (_, i) => `lru${i}.json`);
    const write = (name: string, key: string, keepStampOf?: string) => {
      const b = new GraphBuilder();
      b.def('core/f', 'components/core', { file: 'components/core/src/f.clj', line: 1, end_line: 3, attrs: { signature: sig(key) } });
      writeFileSync(join(graphs, name), JSON.stringify(b.doc()));
      if (keepStampOf) utimesSync(join(graphs, name), new Date(), new Date(Number(keepStampOf)));
    };
    const servesOldContent = (name: string) => /new keys: :a/.test(callTool(hg, 'signature_impact', { fn: 'core/f', base_graph: join(graphs, name) }, { graphDir: graphs }).text);
    for (const n of names) {
      write(n, ':z');
      utimesSync(join(graphs, n), new Date(1e12), new Date(1e12));
    }
    for (const n of names) assert.equal(servesOldContent(n), true, 'every base read once');
    // rewrite with the same size and mtime: only a graph still in the cache hides the change
    for (const n of names) {
      const mtime = statSync(join(graphs, n)).mtimeMs;
      write(n, ':a', String(mtime));
    }
    assert.equal(servesOldContent(names[0]), false, 'the least recently used graph was dropped and is read again');
    assert.equal(servesOldContent(names[names.length - 1]), true, 'the newest graph is still served from the cache');
  });
  it('the JSON error keeps only the position', () => {
    assert.throws(() => graphFromJson('## TOP-SECRET', 'x'), (e: Error) => e instanceof GraphFormatError && !/SECRET/.test(e.message));
  });
});

describe('the loader refuses duplicate ids, fractional lines and oversized gzip', () => {
  const doc = (nodes: unknown[], edges: unknown[] = []) => JSON.stringify({ ...tiny().doc(), nodes, edges });
  it('duplicate node id', () => assert.throws(() => graphFromJson(doc([{ id: 'a', kind: 'k', name: 'a' }, { id: 'a', kind: 'k', name: 'b' }])), /repeats id "a"/));
  it('a line that is not a whole number', () => assert.throws(() => graphFromJson(doc([{ id: 'a', kind: 'k', name: 'a', line: 'x' }])), /not a whole number/));
  it('an edge line that is not a whole number', () => assert.throws(() => graphFromJson(doc([{ id: 'a', kind: 'k', name: 'a' }], [{ from: 'a', to: 'a', kind: 'calls', band: 'static_proven', file: 'f', line: 1.5 }])), /edges\[0\] has a line/));
  it('a gzip that inflates past the limit', () => {
    const f = join(mkdtempSync(join(tmpdir(), 'atlas-gz-')), 'g.json.gz');
    writeFileSync(f, gzipSync(Buffer.from(JSON.stringify(tiny().doc()))));
    assert.equal(loadGraph(f).doc.nodes.length, 1);
    assert.throws(() => loadGraph(f, { file: 1 << 20, inflated: 100 }), (e: Error) => e instanceof GraphFormatError && /100-byte limit/.test(e.message));
    assert.throws(() => loadGraph(f, { file: 10, inflated: 1 << 20 }), (e: Error) => e instanceof GraphFormatError && /10-byte limit for a graph file/.test(e.message));
  });
});

const row = (p: string, i: number, extra: Partial<Row> = {}): Row => ({ label: `${p}${i}`, id: `d:${p}${i}`, file: `components/some/deeply/nested/dir/${p}${i}.clj`, line: i + 1, band: 'static_proven', component: `components/x${i % 3}`, ...extra });
const big = (): QueryResult => ({
  name: 'context_for_change', query: 'q', title: 't', verdict: 'v', found: true, matches: [], notes: [], next: ['a()'],
  sections: [
    { name: 'risk', rows: Array.from({ length: 3 }, (_, i) => row('risk', i)), ordered: true },
    { name: 'callers outside the diff', rows: Array.from({ length: 400 }, (_, i) => row('caller', i)) },
    { name: 'tests', rows: [row('test', 0), row('unk', 1, { band: 'unknown', reason: 'dynamic' })] },
  ],
});

describe('one large section degrades alone; risk and UNKNOWN rows stay', () => {
  it('the big section becomes counts, the small ones keep their rows', () => {
    const text = render(big(), { maxTokens: 400, limit: 40 });
    assert.ok(text.length <= 400 * CHARS_PER_TOKEN);
    assert.match(text, /truncated: rows→counts per group in callers outside the diff \(/);
    assert.match(text, /risk0 /);
    assert.match(text, /test0 /);
    assert.match(text, /components\/x0=134/);
  });
  it('an UNKNOWN row is listed even when its section is counts', () => {
    const r = big();
    r.sections = [{ name: 'callers', rows: [...Array.from({ length: 200 }, (_, i) => row('c', i)), row('unk', 1, { band: 'unknown', reason: 'dynamic' })] }];
    const text = render(r, { maxTokens: 150, limit: 200 });
    assert.match(text, /rows→counts per group/);
    assert.match(text, /unk1/);
  });
});

describe('the last-resort cut ends on a whole line', () => {
  it('never mid-line', () => {
    for (const t of [20, 25, 40]) {
      const text = render(big(), { maxTokens: t, limit: 40 });
      assert.ok(text.length <= t * CHARS_PER_TOKEN, `budget ${t}`);
      const kept = text.split('\n').slice(0, -1);
      for (const l of kept) assert.ok(render(big(), { maxTokens: 100000, limit: 40 }).split('\n').includes(l) || l.startsWith('truncated: '), `partial line ${JSON.stringify(l)}`);
    }
  });
});

describe('route matching is by whole segments and the answer is capped', () => {
  const b = new GraphBuilder();
  for (let i = 0; i < 30; i++) b.route('GET', `/article/${i}/font`);
  const g = b.build();
  it('"/" and a partial segment match nothing', () => {
    assert.equal(findRoutes(g, '/').length, 0);
    assert.equal(findRoutes(g, '/fo').length, 0);
  });
  it('a whole segment still matches', () => assert.equal(findRoutes(g, '/font').length, 30));
  it('many matches: ten answered, the rest counted', () => {
    const r = routeAuthz(g, '/font');
    assert.equal(r.matches.length, 10);
    assert.match(r.verdict, /; \+20 more routes$/);
    assert.ok(r.notes.some((n) => n.startsWith('30 routes match; the first 10 are answered')));
  });
});
