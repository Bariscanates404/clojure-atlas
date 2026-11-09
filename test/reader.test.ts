import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { flatChildren, formAt, readForms, unwrap, walk, type Form } from '../src/build/reader.ts';

const shape = (f: Form): unknown => ('text' in f ? `${f.t}:${f.text}` : [f.t, ...('tag' in f && f.tag ? [f.tag] : []), ...f.children.map(shape)]);
const read1 = (src: string) => {
  const r = readForms(src);
  assert.equal(r.error, undefined, JSON.stringify(r.error));
  return r.forms;
};

describe('reader', () => {
  it('reads collections, atoms and wrappers with their structure', () => {
    const [f] = read1(`(defn f [{:keys [a]} & xs] #{1} #(inc %) #"re" \\a \\newline 'x @y ~z ~@w #'v ^:m s #inst "2020" ##Inf)`);
    assert.deepEqual(shape(f), [
      'list', 'symbol:defn', 'symbol:f',
      ['vector', ['map', 'keyword::keys', ['vector', 'symbol:a']], 'symbol:&', 'symbol:xs'],
      ['set', 'number:1'], ['fn', 'symbol:inc', 'symbol:%'], 'regex:re', 'char:a', 'char:newline',
      ['quote', 'symbol:x'], ['deref', 'symbol:y'], ['unquote', 'symbol:z'], ['unquote-splicing', 'symbol:w'], ['var', 'symbol:v'],
      ['meta', 'keyword::m', 'symbol:s'], ['tagged', 'inst', 'string:2020'], 'other:##Inf',
    ]);
  });

  it('uses the kondo position convention: 1-based rows and columns, exclusive end column', () => {
    const forms = read1('(ns a)\n\n  (def x\n    {:k "v"})');
    const def = forms[1];
    assert.deepEqual([def.row, def.col, def.endRow, def.endCol], [3, 3, 4, 14]);
    const kw = formAt(forms, 4, 6);
    assert.ok(kw && kw.t === 'keyword' && kw.text === ':k');
    assert.deepEqual([kw.endRow, kw.endCol], [4, 8]);
  });

  it('counts \\r\\n as one line break and skips comments, discards and commas', () => {
    const forms = read1('; c\r\n(a #_ (b) , c) #! shebang\r\n:k');
    assert.deepEqual(forms.map(shape), [['list', 'symbol:a', 'symbol:c'], 'keyword::k']);
    assert.deepEqual([forms[1].row, forms[1].col], [3, 1]);
  });

  it('reads string escapes and a char that is a delimiter', () => {
    const [f] = read1('["a\\"b\\n" \\( \\)]');
    assert.deepEqual(shape(f), ['vector', 'string:a"b\n', 'char:(', 'char:)']);
  });

  it('keeps reader conditionals and flattens both platforms for adapters', () => {
    const [f] = read1('[1 #?(:clj 2 :cljs 3) #?@(:clj [4])]');
    assert.deepEqual(flatChildren(f).map(shape), ['number:1', 'number:2', 'number:3', ['vector', 'number:4']]);
  });

  it('reads a namespaced map with its prefix', () => {
    const [f] = read1('#:user{:name "x"}');
    assert.ok(f.t === 'map' && f.ns === 'user');
  });

  it('reads nil, true and false as literals, not symbols', () => {
    assert.deepEqual(shape(read1('[nil true false nil?]')[0]), ['vector', 'other:nil', 'other:true', 'other:false', 'symbol:nil?']);
  });

  it('reads the legacy #^ metadata like ^, with its target', () => {
    const [f] = read1('#^String s');
    assert.deepEqual(shape(f), ['meta', 'symbol:String', 'symbol:s']);
  });

  it('looks through quote and metadata', () => {
    const [f] = read1("'^:x [:find ?e]");
    assert.equal(unwrap(f).t, 'vector');
  });

  it('stops at a syntax error and reports it without throwing', () => {
    const r = readForms('(a) (b ]');
    assert.equal(r.forms.length, 1);
    assert.match(r.error?.message ?? '', /unexpected \]/);
    assert.match(readForms('"open').error?.message ?? '', /unterminated string/);
  });

  it('walks every nested form', () => {
    assert.equal([...walk(read1('(a [b {:c d}])'))].length, 7);
  });
});
