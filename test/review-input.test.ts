import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { contextForChange, parseChange } from '../src/mcp/queries.ts';
import { callTool } from '../src/mcp/server.ts';
import { GraphBuilder } from './helpers/code-graph-fixture.ts';

const real = 'src/app/core.cljc';

function graphWithFile() {
  const b = new GraphBuilder();
  b.def('app.core/f', 'components/app', { file: real, line: 1, end_line: 9 });
  return b.build();
}

describe('context_for_change: a path the graph does not know', () => {
  const g = graphWithFile();

  it('is reported as no such file, with every section not checked, never none', () => {
    const r = contextForChange(g, ['src/app/util/core.cljc:1-40']);
    assert.equal(r.found, false);
    assert.match(r.verdict, /no such file in the graph: src\/app\/util\/core\.cljc/);
    assert.match(r.verdict, /risk UNKNOWN/);
    assert.ok(r.sections.length > 0);
    for (const s of r.sections) assert.match(s.unextracted ?? '', /^not checked: no such file in the graph/, s.name);
    assert.match(r.notes.join(' '), /no such file in the graph/);
  });

  it('a file that is on disk under the repo is not reported as missing', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'atlas-ctx-'));
    mkdirSync(path.join(dir, 'docs'));
    writeFileSync(path.join(dir, 'docs', 'readme.md'), 'x');
    const r = contextForChange(g, ['docs/readme.md'], { repoDir: dir });
    assert.doesNotMatch(r.verdict, /no such file/);
    assert.match(r.notes.join(' '), /type this graph does not index/);
    assert.match(contextForChange(g, ['docs/other.md'], { repoDir: dir }).verdict, /no such file in the graph/);
  });

  it('an added file is new, not missing', () => {
    assert.doesNotMatch(contextForChange(g, ['src/new.clj'], { added: ['src/new.clj'] }).verdict, /no such file/);
  });

  it('beside a known file, the missing one is named and the risk is never LOW', () => {
    const r = contextForChange(g, [real, 'src/nope.cljc']);
    assert.match(r.verdict, /no such file in the graph: src\/nope\.cljc/);
    assert.doesNotMatch(r.verdict, /risk LOW/);
    assert.match(r.notes.join(' '), /src\/nope\.cljc/);
    assert.equal(r.matches.length, 1);
  });

  it('a known file is unchanged', () => {
    assert.doesNotMatch(contextForChange(g, [`${real}:1-9`]).verdict, /no such file/);
  });
});

describe('context_for_change: malformed specs are bad input', () => {
  const g = graphWithFile();
  for (const spec of ['x:abc', `${real}:12-`, `${real}:1-3,x`, ':5']) {
    it(`rejects ${JSON.stringify(spec)} with the expected format`, () => {
      const out = callTool(g, 'context_for_change', { changes: [spec] });
      assert.equal(out.isError, true);
      assert.match(out.text, /"file", "file:12" or "file:10-20,30-41"/);
    });
  }
  it('names the first bad spec among good ones', () => {
    const out = callTool(g, 'context_for_change', { changes: [real, 'x:abc'] });
    assert.equal(out.isError, true);
    assert.match(out.text, /x:abc/);
  });
  it('still accepts the documented forms', () => {
    for (const spec of [real, `${real}:12`, `${real}:10-20`, `${real}:3-4,9-12`]) assert.equal(callTool(g, 'context_for_change', { changes: [spec] }).isError, false, spec);
    assert.deepEqual(parseChange(`${real}:3-4,9-12`).ranges, [[3, 4], [9, 12]]);
  });
});

describe('a present argument of the wrong type gets the type error, not "missing"', () => {
  const g = graphWithFile();
  for (const [tool, args, want] of [
    ['callers', { var: 123 }, /var must be a string, got number/],
    ['context_for_change', { changes: 5 }, /changes must be a list, got number/],
    ['context_for_change', { changes: ['  ', 3] }, /changes must be a list of string/],
    ['route_authz', { route: true }, /route must be a string, got boolean/],
  ] as [string, Record<string, unknown>, RegExp][]) {
    it(`${tool} ${JSON.stringify(args)}`, () => {
      const out = callTool(g, tool, args);
      assert.equal(out.isError, true);
      assert.match(out.text, want);
      assert.doesNotMatch(out.text, /missing required/);
    });
  }
  it('an absent or blank one is still missing', () => {
    assert.match(callTool(g, 'callers', {}).text, /missing required argument\(s\) var/);
    assert.match(callTool(g, 'callers', { var: '  ' }).text, /missing required argument\(s\) var/);
  });
});
