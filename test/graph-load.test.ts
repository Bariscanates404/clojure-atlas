import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { gzipSync } from 'node:zlib';
import {
  BANDS, GraphFormatError, graphFromJson, inEdges, loadGraph, outEdges, parseDocument, weakest,
} from '../src/mcp/graph.ts';
import { GraphBuilder } from './helpers/code-graph-fixture.ts';

const valid = () => new GraphBuilder().doc();
const withDoc = (f: (d: Record<string, unknown>) => void) => {
  const d = JSON.parse(JSON.stringify(valid())) as Record<string, unknown>;
  f(d);
  return d;
};

describe('graph loading: rejects what is not a version-1 code-graph', () => {
  const b = new GraphBuilder();
  const a = b.def('a/f');
  b.edge(a, 'calls', b.def('a/g'));
  const base = b.doc();
  const cases: [string, unknown, RegExp][] = [
    ['null', null, /not a JSON object/],
    ['an array', [], /not a JSON object/],
    ['a string', 'x', /not a JSON object/],
    ['another format', { ...base, format: 'other' }, /format is "other", expected "code-graph"/],
    ['no format', { ...base, format: undefined }, /format is undefined/],
    ['no version', { ...base, version: undefined }, /no numeric version/],
    ['a string version', { ...base, version: '1' }, /no numeric version/],
    ['version 0 (old)', { ...base, version: 0 }, /version 0 is not supported .*rebuild/],
    ['version 3 (newer)', { ...base, version: 3 }, /version 3 is not supported/],
    ['no source', { ...base, source: undefined }, /source.sha missing/],
    ['no sha', { ...base, source: { repo_name: 'x' } }, /source.sha missing/],
    ['nodes not an array', { ...base, nodes: {} }, /nodes is not an array/],
    ['edges not an array', { ...base, edges: null }, /edges is not an array/],
    ['node without id', { ...base, nodes: [{ kind: 'definition', name: 'x' }] }, /nodes\[0\] needs string id/],
    ['node without name', { ...base, nodes: [{ id: 'definition:x', kind: 'definition' }] }, /nodes\[0\]/],
    ['edge without file', { ...base, edges: [{ ...base.edges[0], file: undefined }] }, /edges\[0\] needs string from, to, kind and file/],
    ['edge without band', { ...base, edges: [{ ...base.edges[0], band: undefined }] }, /edges\[0\] has band undefined/],
    ['edge with an upper-case band', { ...base, edges: [{ ...base.edges[0], band: 'STATIC_PROVEN' }] }, /has band "STATIC_PROVEN"/],
  ];
  for (const [name, doc, re] of cases) {
    it(`rejects ${name}`, () => {
      assert.throws(() => parseDocument(doc, 'g.json'), (err: unknown) => err instanceof GraphFormatError && re.test((err as Error).message));
    });
  }

  it('accepts a valid document and defaults missing capabilities to []', () => {
    const d = withDoc((x) => delete x.capabilities);
    assert.deepEqual(parseDocument(d).capabilities, []);
  });

  it('names the origin in every error', () => {
    assert.throws(() => parseDocument({}, 'my/graph.json'), /^GraphFormatError: my\/graph.json:|my\/graph.json:/);
  });

  it('rejects malformed JSON text with a clear error', () => {
    assert.throws(() => graphFromJson('{"format":', 'x.json'), /x.json: not valid JSON/);
  });

  it('every band is accepted', () => {
    for (const band of BANDS) {
      const d = withDoc((x) => ((x.edges as Record<string, unknown>[])[0] = { from: 'a', to: 'b', kind: 'calls', file: 'f', band }));
      assert.equal(parseDocument(d).edges[0].band, band);
    }
  });
});

describe('graph loading: files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'code-graph-'));
  const b = new GraphBuilder();
  b.edge(b.def('a/f'), 'calls', b.def('a/g'));
  const text = JSON.stringify(b.doc());

  it('loads plain json', () => {
    const p = join(dir, 'g.json');
    writeFileSync(p, text);
    assert.equal(loadGraph(p).doc.edges.length, 1);
  });

  it('loads gzip by its magic bytes, whatever the extension', () => {
    for (const name of ['g.json.gz', 'g2.json']) {
      const p = join(dir, name);
      writeFileSync(p, gzipSync(text));
      assert.equal(loadGraph(p).doc.nodes.length, 2);
    }
  });

  it('rejects an old-version file with the path in the message', () => {
    const p = join(dir, 'old.json');
    writeFileSync(p, JSON.stringify({ ...b.doc(), version: 0 }));
    assert.throws(() => loadGraph(p), new RegExp(`${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: version 0`));
  });

  it('a missing file throws', () => {
    assert.throws(() => loadGraph(join(dir, 'missing.json')), /ENOENT/);
  });
});

describe('graph indexes', () => {
  const b = new GraphBuilder();
  const f = b.def('a/f');
  const g1 = b.def('a/g');
  const h = b.def('a/h');
  b.edge(f, 'calls', g1).edge(h, 'calls', g1).edge(f, 'references', h);
  const g = b.build();

  it('byId, byKind and byName', () => {
    assert.equal(g.byId.get(f)?.name, 'a/f');
    assert.equal(g.byKind.get('definition')?.length, 3);
    assert.deepEqual(g.byName.get('a/h')?.map((n) => n.id), [h]);
  });

  it('in and out edges, filtered by kind', () => {
    assert.equal(inEdges(g, g1).length, 2);
    assert.equal(outEdges(g, f).length, 2);
    assert.equal(outEdges(g, f, ['calls']).length, 1);
    assert.deepEqual(inEdges(g, 'definition:none'), []);
  });

  const order: [string, string, string][] = [];
  for (const a of BANDS) for (const c of BANDS) order.push([a, c, BANDS.indexOf(a) >= BANDS.indexOf(c) ? a : c]);
  for (const [a, c, w] of order) {
    it(`weakest(${a}, ${c}) = ${w}`, () => assert.equal(weakest(a as never, c as never), w));
  }
});
