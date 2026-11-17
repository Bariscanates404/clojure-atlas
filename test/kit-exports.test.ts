// What the review pipeline and the EL server need from this package beyond the CLI: the project's test-hook class prefixes,
// a context-for-change query over paths from a diff, the `declared` band of curated rows, and the package entry points.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { ConfigError, parseConfig } from '../src/build/config.ts';
import { contextForChange } from '../src/mcp/queries.ts';
import { BAND_CODE } from '../src/mcp/render.ts';
import { buildFixture, fixtureDir } from "./helpers/atlas-fixture.ts";
import { GraphBuilder } from './helpers/code-graph-fixture.ts';
import { graphOf } from './helpers/inline-graph.ts';

const renders = (d: Awaited<ReturnType<typeof buildFixture>>) =>
  d.edges.filter((e) => e.kind === 'renders').map((e) => `${e.from.split(':')[1]} -> ${e.to} ${e.band}`).sort();

describe(':selector-prefixes', () => {
  it('reads a vector of class prefixes', () => {
    assert.deepEqual(parseConfig('{:selector-prefixes ["qa-" "e2e_"]}').selectorPrefixes, ['qa-', 'e2e_']);
    assert.deepEqual(parseConfig('{}').selectorPrefixes, []);
  });

  it('names what is wrong', () => {
    for (const src of ['{:selector-prefixes "qa-"}', '{:selector-prefixes ["a b"]}', '{:selector-prefixes [1]}']) {
      assert.throws(() => parseConfig(src), (e: unknown) => e instanceof ConfigError && /selector-prefixes must be a vector of class prefixes/.test((e as Error).message), src);
    }
  });

  it('links a hook class found in a prop or a (str ...) as a heuristic renders edge, and keeps the proven reading', async () => {
    const d = await buildFixture('browser-hooks');
    assert.deepEqual(renders(d), [
      'app.views/badge -> selector:qa-badge heuristic',
      'app.views/card -> selector:card static_proven',
      'app.views/card -> selector:qa-card-title heuristic',
      'app.views/plain -> selector:qa-plain static_proven',
    ]);
  });

  it('without the prefix in the config the literal is not a rendered selector', async () => {
    const dir = fixtureDir('browser-hooks');
    const d = await graphOf({
      'src/app/views.cljs': readFileSync(path.join(dir, 'src/app/views.cljs'), 'utf8'),
      'e2e/models/CardPage.ts': readFileSync(path.join(dir, 'e2e/models/CardPage.ts'), 'utf8'),
      'e2e/tests/card.test.ts': readFileSync(path.join(dir, 'e2e/tests/card.test.ts'), 'utf8'),
      'e2e/package.json': readFileSync(path.join(dir, 'e2e/package.json'), 'utf8'),
      'e2e/tsconfig.json': readFileSync(path.join(dir, 'e2e/tsconfig.json'), 'utf8'),
    });
    assert.deepEqual(renders(d), ['app.views/card -> selector:card static_proven', 'app.views/plain -> selector:qa-plain static_proven']);
  });
});

describe('contextForChange fromDiff', () => {
  const g = () => {
    const b = new GraphBuilder();
    b.def('app.core/f', 'components/app', { file: 'src/app/core.cljc', line: 1, end_line: 9 });
    return b.build();
  };
  it('names an unknown path as missing unless the specs come from a diff', () => {
    assert.match(contextForChange(g(), ['src/app/gone.clj']).verdict, /no such file in the graph: src\/app\/gone\.clj/);
    const r = contextForChange(g(), ['src/app/gone.clj'], { fromDiff: true });
    assert.doesNotMatch(r.verdict, /no such file/);
    assert.doesNotMatch(r.notes.join(' '), /no such file|mistyped/);
  });
});

describe('the `declared` band', () => {
  it('has the code D next to S, H and ?', () => {
    assert.deepEqual([BAND_CODE.static_proven, BAND_CODE.declared, BAND_CODE.heuristic, BAND_CODE.unknown], ['S', 'D', 'H', '?']);
  });
});

describe('package entry points', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as Record<string, unknown>;
  it('exports compiled js with types, keeps the bin, and has no runtime dependency', () => {
    const ex = pkg.exports as Record<string, unknown>;
    for (const k of ['./cli', './build/*', './mcp/*', './version']) assert.ok(k in ex, k);
    assert.deepEqual(ex['./mcp/*'], { types: './dist/mcp/*.d.ts', default: './dist/mcp/*.js' });
    assert.deepEqual(pkg.bin, { 'clojure-atlas': 'dist/cli.js' });
    assert.equal(pkg.dependencies, undefined);
  });
});
