// Function signatures as the builder records them on definition nodes.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { graphFromJson } from '../src/mcp/graph.ts';
import { signatureImpact } from '../src/mcp/keyflow.ts';
import { graphOf } from './helpers/inline-graph.ts';

interface P { kind?: string; keys?: string[]; defaults?: string[]; optional?: string[]; reads?: string[]; reads_complete?: boolean; escapes?: string[] }

const params = async (src: string): Promise<P[]> => {
  const doc = await graphOf({ 'src/app/other.clj': '(ns app.other)', 'src/app/s.clj': `(ns app.s (:require [app.other :as o]))\n${src}` });
  const sig = doc.nodes.find((n) => n.id === 'definition:app.s/f')?.attrs?.signature as { arities: { params: P[] }[] };
  return sig.arities[0].params;
};
const pick = ({ keys, defaults, reads, reads_complete }: P): P => ({ ...(keys ? { keys } : {}), ...(defaults ? { defaults } : {}), ...(reads ? { reads } : {}), reads_complete });

describe('destructuring', () => {
  it('resolves the alias of ::alias/keys', async () => {
    assert.deepEqual((await params('(defn f [{::o/keys [a b]}] a)')).map(pick), [{ keys: [':app.other/a', ':app.other/b'], reads_complete: true }]);
  });

  it('gives :or defaults the namespace of their keys', async () => {
    assert.deepEqual((await params('(defn f [{:person/keys [name] :or {name ""}}] name)')).map(pick), [{ keys: [':person/name'], defaults: [':person/name'], reads_complete: true }]);
  });

  it('is not complete when :strs or :syms take keys it cannot name', async () => {
    assert.deepEqual((await params('(defn f [{:strs [a]}] a)')).map(pick), [{ keys: [], reads_complete: false }]);
  });

  it('takes the key of a nested destructuring pattern', async () => {
    assert.deepEqual((await params('(defn f [{{:keys [c]} :child}] c)')).map(pick), [{ keys: [':child'], reads_complete: true }]);
  });
});

describe('reads of a parameter alias', () => {
  it('ignores a let that binds the name again', async () => {
    assert.deepEqual((await params('(defn f [{:keys [a] :as m}] (let [m (inc 1)] (:y m)))')).map(pick), [{ keys: [':a'], reads_complete: true }]);
  });

  it('ignores a fn whose parameter hides the name', async () => {
    assert.deepEqual((await params('(defn f [{:keys [a] :as m}] (fn [m] (:z m)))')).map(pick), [{ keys: [':a'], reads_complete: true }]);
  });

  it('hides the name only from the arity of a multi-arity fn that binds it', async () => {
    assert.deepEqual((await params('(defn f [{:keys [a] :as m}] (fn ([m] (:z m)) ([n] (:w m))))')).map(pick), [{ keys: [':a'], reads: [':w'], reads_complete: true }]);
  });

  it('still reads the name where nothing hides it', async () => {
    assert.deepEqual((await params('(defn f [{:keys [a] :as m}] (let [x (:y m)] (fn [n] (:z m))))')).map(pick), [{ keys: [':a'], reads: [':y', ':z'], reads_complete: true }]);
  });
});

const OTHER = { 'src/app/other.clj': '(ns app.other)' };
const signatureIn = async (files: Record<string, string>) => {
  const doc = await graphOf(files);
  const sig = doc.nodes.find((n) => n.id === 'definition:app.s/f')?.attrs?.signature as { arities: { params: P[] }[] } | undefined;
  return { sig, g: graphFromJson(JSON.stringify(doc)) };
};
const findings = (g: ReturnType<typeof graphFromJson>) =>
  signatureImpact(g, 'app.s/f').sections.find((s) => s.name === 'findings')?.rows.map((r) => `${r.finding}: ${r.label}`) ?? [];

describe('forms that define a function without being a plain defn', () => {
  it('skips the schema annotations of s/defn, so a caller with the right argument count is no finding', async () => {
    const { sig, g } = await signatureIn({
      'src/app/s.clj': `(ns app.s (:require [schema.core :as s]))
(s/defn f :- [s/Str] [a :- s/Int {:keys [id]} :- {s/Keyword s/Any}] [(str a id)])
(defn g [] (f 1 {:id 2}))`,
    });
    assert.deepEqual(sig?.arities[0].params.map(({ kind, keys }) => ({ kind, ...(keys ? { keys } : {}) })), [{ kind: 'symbol' }, { kind: 'map', keys: [':id'] }]);
    assert.deepEqual(findings(g), []);
  });

  it('reads a macro the project lints as defn, and says which form the signature came from', async () => {
    const { sig, g } = await signatureIn({
      '.clj-kondo/config.edn': '{:lint-as {app.m/defhandler clojure.core/defn}}',
      'src/app/m.clj': '(ns app.m)\n(defmacro defhandler [name & body] `(defn ~name ~@body))',
      'src/app/s.clj': `(ns app.s (:require [app.m :refer [defhandler]]))
(defhandler f [{:keys [user-id] :as req}] [user-id (:body req)])
(defn g [] (f {:user-id 1 :bdy "typo"}))`,
    });
    assert.deepEqual(sig?.arities[0].params.map(pick), [{ keys: [':user-id'], reads: [':body'], reads_complete: true }]);
    assert.deepEqual(findings(g), ['unread: app.s/g passes :bdy which f never reads']);
    // the macro may add or drop parameters when it expands: nothing it yields is STATIC_PROVEN
    assert.deepEqual(signatureImpact(g, 'app.s/f').sections.find((s) => s.name === 'findings')?.rows.map((r) => r.band), ['heuristic']);
    assert.ok(signatureImpact(g, 'app.s/f').notes.some((n) => /app\.m\/defhandler/.test(n) && /defn/.test(n)), JSON.stringify(signatureImpact(g, 'app.s/f').notes));
  });

  it('records no signature where the platforms of a .cljc file get different parameters', async () => {
    const { sig, g } = await signatureIn({ 'src/app/s.cljc': '(ns app.s)\n(defn f [a #?(:clj b)] a)\n(defn g [] (f 1 #?(:clj 2)))' });
    assert.equal(sig, undefined);
    assert.match(signatureImpact(g, 'app.s/f').verdict, /no signature recorded/);
  });
});

describe('destructuring of namespaced names', () => {
  it('gives the :or default of a :keys [ns/name] entry its namespace', async () => {
    assert.deepEqual((await params('(defn f [{:keys [user/id] :or {id 0}}] id)')).map(pick), [{ keys: [':user/id'], defaults: [':user/id'], reads_complete: true }]);
  });
});

describe('the ways a plain parameter is read', () => {
  const reads = async (body: string) => (await params(`(defn f [m] ${body})`)).map(({ reads: r, reads_complete, escapes }) =>
    ({ reads: r ?? [], complete: reads_complete, ...(escapes ? { escapes } : {}) }))[0];

  it('counts a let that destructures it, following the :as alias', async () => {
    assert.deepEqual(await reads('(let [{:keys [id] {:keys [c]} :child :as all} m] [id c (:other all)])'), { reads: [':child', ':id', ':other'], complete: true });
  });

  it('ends the alias where the let binds its name again', async () => {
    assert.deepEqual(await reads('(let [{:keys [a] :as all} m all (inc a)] (:q all))'), { reads: [':a'], complete: true });
  });

  it('reads the :or defaults of the let pattern, where the name still means the parameter', async () => {
    assert.deepEqual(await reads('(let [{:keys [a] {:keys [z] :or {z (:c m)}} :n :or {a (:b m)}} m] [a z])'), { reads: [':a', ':b', ':c', ':n'], complete: true });
    assert.deepEqual(await reads('(let [{:keys [a] :or {a (merge m {})}} m] a)'), { reads: [':a'], complete: false, escapes: ['passed to merge'] });
  });

  it('reads the :or default of a later parameter that looks into an earlier one', async () => {
    assert.deepEqual((await params('(defn f [m {:keys [a] :or {a (:b m)}}] a)')).map(pick)[0], { reads: [':b'], reads_complete: true });
  });

  it('does not count a for or doseq binding, which destructures its elements', async () => {
    assert.deepEqual(await reads('(for [{:keys [id]} m] id)'), { reads: [], complete: false, escapes: ['used as a value'] });
  });

  it('is not complete when the let pattern takes :strs, or its alias escapes', async () => {
    assert.equal((await reads('(let [{:strs [a]} m] a)')).complete, false);
    assert.deepEqual(await reads('(let [{:keys [a] :as all} m] (merge all {:b a}))'), { reads: [':a'], complete: false, escapes: ['passed to merge'] });
  });

  it('counts the first keyword step of -> and some->, a contains? check and the map called as a function', async () => {
    assert.deepEqual(await reads('[(-> m :address :zip) (some-> m :phone str) (contains? m :flag) (m :direct)]'),
      { reads: [':address', ':direct', ':flag', ':phone'], complete: true });
    assert.deepEqual(await reads('(-> m (assoc :x 1) :y)'), { reads: [], complete: false, escapes: ['passed to ->'] });
  });

  it('counts no read inside a step of a threading form, where another value stands before the arguments', async () => {
    const step = { reads: [], complete: false, escapes: ['used in a step of a threading form'] };
    assert.deepEqual(await reads('(fn [evt] (-> evt :type (m :unknown)))'), step);
    assert.deepEqual(await reads('(fn [x] (-> x (:k m)))'), step);
    assert.deepEqual(await reads('(fn [x] (some->> x (get m :k)))'), step);
    assert.deepEqual(await reads('(fn [x] (cond-> x (:flag m) (assoc :a 1)))'), { reads: [':flag'], complete: true });
  });

  it('does not count a truthiness test as an escape, and still counts the value returned from a branch', async () => {
    assert.deepEqual(await reads('(if (and (some? m) (map? m)) (when m (:a m)) 0)'), { reads: [':a'], complete: true });
    assert.deepEqual(await reads('(if-not (nil? m) (when-not (not m) (:a m)) 0)'), { reads: [':a'], complete: true });
    assert.deepEqual(await reads('(if (:a m) m 0)'), { reads: [':a'], complete: false, escapes: ['passed to if'] });
  });

  it('turns a let-destructured parameter into a finding for the caller that passes a key it never reads', async () => {
    const { g } = await signatureIn({ ...OTHER,
      'src/app/s.clj': '(ns app.s)\n(defn f [m] (let [{:keys [id title]} m] (str id title)))\n(defn g [] (f {:id 1 :titel "x"}))' });
    assert.deepEqual(findings(g), ['unread: app.s/g passes :titel which f never reads']);
  });

  it('says so when a caller passes a literal map to a parameter whose reads are not provable', async () => {
    const { g } = await signatureIn({ 'src/app/s.clj': '(ns app.s)\n(defn f [m] (merge m {:z 1}))\n(defn g [] (f {:id 1}))' });
    const res = signatureImpact(g, 'app.s/f');
    assert.deepEqual(findings(g), []);
    assert.ok(res.notes.some((n) => /param 0 of \[m\].*passed to merge.*not provable/.test(n)), JSON.stringify(res.notes));
  });
});

describe('a map parameter is open: optional keys and extra keys', () => {
  const optional = async (body: string) => (await params(`(defn f [{:keys [id tenant-id] :as m}] ${body})`))[0].optional ?? [];
  const impact = async (callee: string, call: string, base?: string) => {
    const build = async (src: string) => graphFromJson(JSON.stringify(await graphOf({ 'src/app/s.clj': `(ns app.s)\n${src}\n(defn g [] ${call})` })));
    return signatureImpact(await build(callee), 'app.s/f', base ? { base: await build(base) } : {});
  };
  const rowsOf = (res: Awaited<ReturnType<typeof impact>>, section: string) =>
    res.sections.find((s) => s.name === section)?.rows.map((r) => `${r.finding ?? r.band}: ${r.label}`) ?? [];

  it('calls a key optional where the body falls back from it, tests it or reads it with a default', async () => {
    for (const body of ['(str id (or tenant-id "none"))', '(if tenant-id id 0)', '(when-let [t tenant-id] [id t])', '(some-> tenant-id (str id))',
      '(cond-> {:id id} tenant-id (assoc :t tenant-id))', '(get m :tenant-id id)', '(:tenant-id m id)', '(when (contains? m :tenant-id) id)']) {
      assert.deepEqual(await optional(body), [':tenant-id'], body);
    }
  });

  it('does not call a key optional that is only used', async () => {
    assert.deepEqual(await optional('(str id tenant-id (or id 0))'), [':id']);
    assert.deepEqual(await optional('(str id tenant-id (get m :tenant-id))'), []);
  });

  it('does not report an optional key no caller passes, and still reports a required one', async () => {
    assert.deepEqual(rowsOf(await impact('(defn f [{:keys [id tenant-id]}] (str id (or tenant-id "none")))', '(f {:id 1})'), 'findings'), []);
    assert.deepEqual(rowsOf(await impact('(defn f [{:keys [id tenant-id]}] (str id tenant-id))', '(f {:id 1})'), 'findings'),
      ['never-passed: f destructures :tenant-id (param 0) but no caller passes it']);
  });

  it('lists an extra key apart from the findings: passing :tenant-id to a function that never reads it breaks nothing', async () => {
    const res = await impact('(defn f [{:keys [id username]}] [id username])', '(f {:id 1 :username "u" :tenant-id 7})');
    assert.deepEqual(rowsOf(res, 'findings'), []);
    assert.deepEqual(rowsOf(res, 'extra keys'), ['unread: app.s/g passes :tenant-id which f never reads']);
    assert.match(res.verdict, /no finding; 1 call\(s\) pass an extra key the function never reads \(no finding: a map is open\)/);
  });

  it('keeps an extra key a finding only where it looks like a slip of a key the function reads and the call lacks', async () => {
    const res = await impact('(defn f [{:keys [id username]}] [id username])', '(f {:id 1 :usrname "u" :tenant-id 7})');
    assert.deepEqual(rowsOf(res, 'findings'), ['never-passed: f destructures :username (param 0) but no caller passes it',
      'unread: app.s/g passes :usrname which f never reads']);
    assert.deepEqual(rowsOf(res, 'extra keys'), ['unread: app.s/g passes :tenant-id which f never reads']);
  });

  it('a change that starts reading an optional key affects no caller; one that requires it affects those that do not pass it', async () => {
    const base = '(defn f [{:keys [id]}] id)';
    const eased = await impact('(defn f [{:keys [id tenant-id]}] [id (or tenant-id 0)])', '(f {:id 1})', base);
    assert.deepEqual(rowsOf(eased, 'affected by the change'), []);
    assert.match(eased.verdict, /0 caller\(s\) affected by the change \(new optional keys .*: :tenant-id\)/);
    const required = await impact('(defn f [{:keys [id tenant-id]}] [id tenant-id])', '(f {:id 1})', base);
    assert.deepEqual(rowsOf(required, 'affected by the change'), ['static_proven: app.s/g does not pass :tenant-id']);
  });
});
