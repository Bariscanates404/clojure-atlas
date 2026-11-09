# Coverage

Measured by `node scripts/coverage.ts <corpus-dir>` over the repos pinned in [corpus.json](../corpus.json), each at
the recorded sha. Every number below comes from that run.

How to read the columns:
- **files**: Clojure sources analyzed (.clj, .cljs, .cljc; build output, dependencies and hidden directories skipped).
- **syntax-error files**: files clj-kondo could not fully parse.
- **resolved / unresolved / unknown**: var usages that name a project namespace. *resolved* found its definition;
  *unresolved* names a project namespace but no definition in it (a var created by a macro clj-kondo does not know,
  or by `intern`); *unknown* is a symbol clj-kondo could not resolve at all (mostly bindings of macros it does not
  know). Usages of library vars (clojure.core and dependencies) are not counted, and neither are symbols that can
  never be vars (special forms, auto-gensyms, `&`, clojure.test's `thrown?`).
- **resolved %**: resolved / (resolved + unresolved + unknown).
- adapter columns: edges each adapter added (0 when its library is not used); key_tables counts tables.
- **unknown edges**: edges in band UNKNOWN (attribute references of unproven role).

| repo | files | syntax-error files | definitions | resolved | unresolved | unknown | resolved % | multimethods | implementations | events | routes | data_attributes | system | schemas | key_flow | key_tables | client_routes | requests | selectors | browser_tests | unknown edges | build | graph |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| babashka | 656 | 2 | 6478 | 15481 | 61 | 2261 | 87.0% | 448 | 738 | 0 | 0 | 21 | 4 | 384 | 19507 | 221 | 0 | 0 | 0 | 0 | 10 | 11.9 s | 734 KB |
| biff | 146 | 1 | 1250 | 2449 | 13 | 20 | 98.7% | 23 | 4 | 0 | 8 | 0 | 0 | 6 | 5185 | 30 | 0 | 0 | 0 | 0 | 0 | 4.5 s | 171 KB |
| cider-nrepl | 130 | 0 | 1149 | 3093 | 22 | 187 | 93.7% | 57 | 55 | 0 | 0 | 0 | 0 | 0 | 5254 | 45 | 0 | 0 | 0 | 0 | 0 | 3.8 s | 160 KB |
| clj-kondo | 427 | 12 | 2750 | 10800 | 26 | 251 | 97.5% | 116 | 721 | 1 | 0 | 0 | 1 | 8 | 22862 | 99 | 0 | 0 | 0 | 0 | 0 | 6.7 s | 490 KB |
| compojure | 11 | 0 | 87 | 250 | 0 | 6 | 97.7% | 2 | 36 | 0 | 0 | 0 | 0 | 0 | 208 | 0 | 0 | 0 | 0 | 0 | 0 | 1.6 s | 13 KB |
| datascript | 67 | 1 | 1024 | 4471 | 496 | 1339 | 70.9% | 15 | 326 | 0 | 0 | 1463 | 0 | 0 | 3834 | 52 | 0 | 0 | 0 | 0 | 126 | 4.3 s | 160 KB |
| day-of-datomic | 43 | 0 | 127 | 84 | 29 | 1 | 73.7% | 0 | 1 | 0 | 0 | 86 | 0 | 0 | 209 | 0 | 0 | 0 | 0 | 0 | 50 | 1.5 s | 11 KB |
| fulcro | 140 | 0 | 2725 | 9996 | 16 | 945 | 91.2% | 28 | 89 | 0 | 0 | 0 | 0 | 26 | 11453 | 74 | 0 | 0 | 0 | 0 | 0 | 4.8 s | 375 KB |
| honeysql | 20 | 0 | 506 | 2776 | 0 | 15 | 99.5% | 0 | 29 | 0 | 0 | 0 | 0 | 0 | 2471 | 3 | 0 | 0 | 0 | 0 | 0 | 2.1 s | 77 KB |
| integrant | 7 | 0 | 138 | 442 | 0 | 4 | 99.1% | 52 | 12 | 0 | 0 | 0 | 61 | 0 | 492 | 3 | 0 | 0 | 0 | 0 | 0 | 1.5 s | 20 KB |
| logseq | 1088 | 0 | 18099 | 69041 | 0 | 256 | 99.6% | 324 | 313 | 0 | 0 | 24772 | 0 | 131 | 86131 | 627 | 0 | 0 | 0 | 0 | 20271 | 20.2 s | 3.4 MB |
| malli | 93 | 0 | 1372 | 7960 | 53 | 366 | 95.0% | 849 | 2134 | 0 | 0 | 0 | 0 | 85 | 9095 | 77 | 0 | 0 | 0 | 0 | 0 | 6.6 s | 288 KB |
| metabase | 4460 | 0 | 68435 | 312308 | 811 | 9801 | 96.7% | 10174 | 3461 | 0 | 13 | 0 | 2 | 526 | 386443 | 6356 | 0 | 0 | 0 | 0 | 0 | 84.6 s | 13.2 MB |
| mount | 47 | 0 | 222 | 913 | 0 | 8 | 99.1% | 0 | 9 | 0 | 1 | 28 | 56 | 0 | 284 | 3 | 0 | 0 | 0 | 0 | 0 | 1.4 s | 31 KB |
| next-jdbc | 38 | 0 | 342 | 2277 | 6 | 48 | 97.7% | 2 | 417 | 0 | 0 | 0 | 0 | 94 | 1221 | 4 | 0 | 0 | 0 | 0 | 0 | 1.7 s | 70 KB |
| pathom3 | 53 | 0 | 907 | 3815 | 0 | 17 | 99.6% | 8 | 109 | 0 | 0 | 0 | 0 | 27 | 11682 | 368 | 0 | 0 | 0 | 0 | 0 | 4.0 s | 226 KB |
| pedestal | 230 | 1 | 2092 | 5154 | 22 | 420 | 92.1% | 13 | 598 | 0 | 111 | 0 | 24 | 180 | 5146 | 12 | 0 | 0 | 0 | 0 | 0 | 3.5 s | 266 KB |
| penpot | 1558 | 0 | 25429 | 125583 | 13 | 2154 | 98.3% | 1758 | 2629 | 0 | 0 | 0 | 423 | 190 | 150057 | 451 | 0 | 1 | 0 | 0 | 0 | 25.6 s | 4.7 MB |
| polylith-realworld | 51 | 0 | 384 | 894 | 0 | 0 | 100.0% | 0 | 0 | 0 | 22 | 0 | 0 | 0 | 1391 | 21 | 0 | 0 | 0 | 0 | 0 | 1.6 s | 49 KB |
| re-frame | 70 | 0 | 762 | 2629 | 0 | 77 | 97.2% | 6 | 73 | 287 | 0 | 0 | 0 | 7 | 1728 | 4 | 2 | 0 | 0 | 0 | 0 | 2.4 s | 111 KB |
| reagent | 65 | 0 | 829 | 2842 | 0 | 102 | 96.5% | 5 | 124 | 0 | 0 | 0 | 0 | 0 | 1470 | 2 | 0 | 0 | 0 | 0 | 0 | 2.0 s | 98 KB |
| reitit | 133 | 0 | 962 | 3860 | 4 | 119 | 96.9% | 30 | 618 | 8 | 369 | 0 | 4 | 151 | 9868 | 111 | 18 | 0 | 0 | 0 | 0 | 3.8 s | 205 KB |
| ring | 72 | 0 | 634 | 1495 | 0 | 101 | 93.7% | 17 | 353 | 0 | 0 | 0 | 0 | 0 | 2046 | 8 | 0 | 0 | 0 | 0 | 0 | 2.8 s | 86 KB |
| shadow-cljs | 320 | 3 | 2498 | 5347 | 29 | 972 | 84.2% | 465 | 189 | 0 | 0 | 0 | 0 | 234 | 12549 | 46 | 0 | 0 | 0 | 0 | 0 | 7.3 s | 391 KB |
| usermanager | 7 | 0 | 50 | 73 | 0 | 10 | 88.0% | 0 | 7 | 0 | 7 | 0 | 4 | 0 | 99 | 0 | 0 | 0 | 0 | 0 | 0 | 2.4 s | 7 KB |
| xtdb-v1 | 226 | 4 | 2773 | 11681 | 8 | 799 | 93.5% | 275 | 2051 | 146 | 0 | 1838 | 13 | 203 | 14366 | 158 | 0 | 0 | 0 | 0 | 354 | 8.0 s | 535 KB |

## Repos under 95% resolved

What is left in each is one of two kinds, both visible in the names below:
- **unknown**: a symbol bound by a macro clj-kondo does not know, so it cannot tell a local from a var
  (fields of a deftype or proxy, bindings of a test DSL such as fulcro-spec's `=>`, bindings of a project's own
  def-like macro). They are not var usages, but nothing static proves that.
- **unresolved**: a var created by a project macro clj-kondo does not know (datascript's record constructors), or
  a name in a REPL script with no ns form that clj-kondo files under a namespace not defining it (day-of-datomic's
  tutorials).
Both shrink when the repo ships a clj-kondo config for its macros, or when `.clojure-atlas.edn` names them under
`:lint-as`; the corpus is measured without adding either.

- **babashka** 87.0%: 2261 unknown (most: `v` 136, `session` 97, `this` 85, `a` 71, `m` 67); 61 unresolved (most: `babashka.deps/add-deps` 13, `babashka.impl.clojure.spec.gen.alpha/fmap` 9, `babashka.impl.clojure.spec.gen.alpha/return` 8)
- **cider-nrepl** 93.7%: 187 unknown (most: `args` 27, `opts` 20, `instrument-coll` 14, `version` 11, `x` 10); 22 unresolved (most: `cider.test-helpers/clojure.lang.ExceptionInfo` 3, `cider.test-helpers/thrown-with-msg?` 3, `cider.test-helpers/java.util.List` 2)
- **datascript** 70.9%: 1339 unknown (most: `db` 234, `d` 58, `entity` 40, `_` 35, `attr` 34); 496 unresolved (most: `datascript.parser/->Variable` 132, `datascript.parser/->DefaultSrc` 42, `datascript.parser/->Pattern` 35)
- **day-of-datomic** 73.7%: 1 unknown (most: `.getMessage` 1); 29 unresolved (most: `datomic.samples.repl/email` 5, `datomic.samples.repl/id` 4, `datomic.samples.repl/transact` 4)
- **fulcro** 91.2%: 945 unknown (most: `=1x=>` 75, `=>` 61, `args` 57, `id` 57, `n` 43); 16 unresolved (most: `com.fulcrologic.fulcro.inspect.devtool-api/db-changed` 3, `com.fulcrologic.fulcro.inspect.devtool-api/optimistic-action` 3, `com.fulcrologic.fulcro.inspect.devtool-api/send-failed` 3)
- **malli** 95.0%: 366 unknown (most: `this` 54, `x` 50, `a` 16, `y` 12, `b` 10); 53 unresolved (most: `malli.instrument.fn-schemas/power-arg-ns` 8, `malli.instrument.fn-schemas/power-arg-refer` 8, `malli.instrument.fn-schemas/power-full` 8)
- **pedestal** 92.1%: 420 unknown (most: `request-inspection` 36, `interceptor-1` 28, `interceptor-2` 22, `t` 18, `this` 18); 22 unresolved (most: `io.pedestal.log/-register` 4, `io.pedestal.http.route.sawtooth.impl/create-matcher-from-routes` 2, `io.pedestal.log/counter` 2)
- **ring** 93.7%: 101 unknown (most: `response` 15, `request` 13, `socket` 12, `_` 7, `listener` 6); 0 unresolved (most: none)
- **shadow-cljs** 84.2%: 972 unknown (most: `env` 70, `bind` 54, `x` 50, `object` 42, `render` 40); 29 unresolved (most: `shadow.lazy/Loadable.` 3, `demo.browser/bla` 2, `shadow.build.api/has-tests?` 2)
- **usermanager** 88.0%: 10 unknown (most: `database` 3, `db` 2, `user-without-id` 2, `id` 1, `params` 1); 0 unresolved (most: none)
- **xtdb-v1** 93.5%: 799 unknown (most: `kv-store` 97, `this` 79, `node` 73, `dir` 59, `db-dir` 38); 8 unresolved (most: `user/xtdb-node` 4, `xtdb.soak.config/weather-api-token` 2, `xtdb.api/start-cluster-node` 1)

## Per repo

### babashka
- most frequent unresolved: `babashka.deps/add-deps` 13, `babashka.impl.clojure.spec.gen.alpha/fmap` 9, `babashka.impl.clojure.spec.gen.alpha/return` 8, `babashka.impl.clojure.spec.gen.alpha/tuple` 6, `babashka.impl.clojure.spec.gen.alpha/vector` 4, `babashka.impl.clojure.spec.gen.alpha/bind` 3, `babashka.impl.clojure.spec.gen.alpha/one-of` 3, `babashka.impl.clojure.spec.gen.alpha/large-integer*` 2, `babashka.impl.clojure.spec.gen.alpha/sample` 2, `babashka.impl.clojure.spec.gen.alpha/vector-distinct` 2, `babashka.impl.clojure.spec.gen.alpha/choose` 1, `babashka.impl.clojure.spec.gen.alpha/double*` 1, `babashka.impl.clojure.spec.gen.alpha/frequency` 1, `babashka.impl.clojure.spec.gen.alpha/hash-map` 1, `babashka.impl.clojure.spec.gen.alpha/shuffle` 1
- most frequent unknown: `v` 136, `session` 97, `this` 85, `a` 71, `m` 67, `x` 66, `b` 58, `k2` 57, `pred` 54, `k1` 53, `repl-values` 53, `k` 47, `y` 39, `repl-eval` 38, `form` 34
- adapters: multimethods (defmethod) 448 edges, implementations (protocol implementations) 738 edges, events off, routes off, data_attributes (datascript) 21 edges, system (component) 4 edges, schemas (malli, spec) 384 edges, key_flow (keywords in code) 19507 edges, key_tables (map literals in code) 0 edges, client_routes off, requests (ClojureScript sources) 0 edges, selectors off, browser_tests off

### biff
- most frequent unresolved: `com.biffweb.sqlite.impl.execute/execute` 10, `com.biffweb.sqlite.impl.execute/execute-tx` 2, `com.biffweb.sqlite.impl.execute/execute-one` 1
- most frequent unknown: `this` 4, `args` 3, `b` 3, `exists` 2, `_len` 1, `_off` 1, `applyTo` 1, `call` 1, `invoke` 1, `run` 1, `toString` 1, `write` 1
- adapters: multimethods (defmethod) 23 edges, implementations (protocol implementations) 4 edges, events off, routes (reitit) 8 edges, data_attributes (xtdb) 0 edges, system off, schemas (malli) 6 edges, key_flow (keywords in code) 5185 edges, key_tables (map literals in code) 0 edges, client_routes off, requests off, selectors off, browser_tests off

### cider-nrepl
- most frequent unresolved: `cider.test-helpers/clojure.lang.ExceptionInfo` 3, `cider.test-helpers/thrown-with-msg?` 3, `cider.test-helpers/java.util.List` 2, `cider.test-helpers/this` 2, `cider.nrepl.middleware.classpath/java.io.File` 1, `cider.nrepl.middleware.classpath/java.net.URI` 1, `cider.nrepl.middleware.tap/java.net.SocketException` 1, `cider.nrepl.middleware.trace/clojure.lang.ExceptionInfo` 1, `cider.nrepl.middleware.trace/java.net.SocketException` 1, `cider.nrepl.middleware.trace/thrown?` 1, `cider.nrepl/wrap-log` 1, `cider.nrepl/wrap-macroexpand` 1, `cider.nrepl/wrap-tracker` 1, `cider.test-helpers/clojure.lang.Compiler$CompilerException` 1, `cider.test-helpers/if` 1
- most frequent unknown: `args` 27, `opts` 20, `instrument-coll` 14, `version` 11, `x` 10, `len` 5, `off` 5, `srcdeps` 5, `class-dir` 4, `int-or-bytes` 4, `file` 3, `instrument-special-form` 3, `jar` 3, `%&` 2, `_attrs` 2
- adapters: multimethods (defmethod) 57 edges, implementations (protocol implementations) 55 edges, events off, routes off, data_attributes off, system off, schemas (spec) 0 edges, key_flow (keywords in code) 5254 edges, key_tables (map literals in code) 0 edges, client_routes off, requests (ClojureScript sources) 0 edges, selectors off, browser_tests off

### clj-kondo
- most frequent unresolved: `app.core/` 6, `app.api/my-fn` 2, `app.api/renamed-fn` 2, `foo/compile-route` 2, `foo/with-redefs` 2, `a/x` 1, `another-funs/bar` 1, `another-funs/baz` 1, `app.api/my-var` 1, `app.api2/foo` 1, `app.api2/prewalk` 1, `app.api3/my-foo` 1, `bar/weird-macro` 1, `clj-kondo.impl.toolsreader.v1v2v2.clojure.tools.reader.impl.utils/Pattern` 1, `compojure.core/x` 1
- most frequent unknown: `a` 23, `x` 22, `_` 13, `reader` 12, `b` 10, `this` 9, `y` 9, `aliased` 8, `referred` 8, `access` 6, `desc` 5, `z` 5, `n` 4, `node` 4, `with-mixin` 4
- adapters: multimethods (defmethod) 116 edges, implementations (protocol implementations) 721 edges, events (re-frame.core) 1 edges, routes (compojure) 0 edges, data_attributes off, system (integrant) 1 edges, schemas (spec) 8 edges, key_flow (keywords in code) 22862 edges, key_tables (map literals in code) 0 edges, client_routes off, requests (ClojureScript sources) 0 edges, selectors off, browser_tests off

### compojure
- most frequent unresolved: none
- most frequent unknown: `request` 2, `x` 2, `raise` 1, `respond` 1
- adapters: multimethods (defmethod) 2 edges, implementations (protocol implementations) 36 edges, events off, routes (compojure) 0 edges, data_attributes off, system off, schemas off, key_flow (keywords in code) 208 edges, key_tables (map literals in code) 0 edges, client_routes off, requests off, selectors off, browser_tests off

### datascript
- most frequent unresolved: `datascript.parser/->Variable` 132, `datascript.parser/->DefaultSrc` 42, `datascript.parser/->Pattern` 35, `datascript.parser/->Constant` 30, `datascript.parser/->BindScalar` 21, `datascript.parser/->PlainSymbol` 20, `datascript.parser/->Placeholder` 16, `datascript.parser/->RuleVars` 15, `datascript.db/DB` 14, `datascript.parser/->SrcVar` 13, `datascript.parser/->Aggregate` 10, `datascript.parser/->RuleBranch` 8, `datascript.parser/->Or` 7, `datascript.parser/->Rule` 7, `datascript.db/entid` 6
- most frequent unknown: `db` 234, `d` 58, `entity` 40, `_` 35, `attr` 34, `d1` 34, `d2` 34, `eid` 31, `entities` 28, `x` 25, `index` 24, `c0` 23, `c1` 23, `c2` 23, `c3` 23
- adapters: multimethods (defmethod) 15 edges, implementations (protocol implementations) 326 edges, events off, routes off, data_attributes (datascript, datomic) 1463 edges, system off, schemas off, key_flow (keywords in code) 3834 edges, key_tables (map literals in code) 0 edges, client_routes off, requests (ClojureScript sources) 0 edges, selectors off, browser_tests off

### day-of-datomic
- most frequent unresolved: `datomic.samples.repl/email` 5, `datomic.samples.repl/id` 4, `datomic.samples.repl/transact` 4, `datomic.samples.repl/doc` 3, `datomic.samples.repl/pprint` 2, `datomic.samples.repl/user` 2, `datomic.samples.repl/datomic.Datom` 1, `datomic.samples.repl/db` 1, `datomic.samples.repl/do-side-effecty-thing-with-each` 1, `datomic.samples.repl/easy!` 1, `datomic.samples.repl/java.util.ArrayList` 1, `datomic.samples.repl/java.util.Date` 1, `datomic.samples.repl/keys-i-understand` 1, `datomic.samples.repl/some-entity` 1, `datomic.samples.repl/tempid` 1
- most frequent unknown: `.getMessage` 1
- adapters: multimethods off, implementations (protocol implementations) 1 edges, events off, routes off, data_attributes (datomic) 86 edges, system off, schemas off, key_flow (keywords in code) 209 edges, key_tables (map literals in code) 0 edges, client_routes off, requests off, selectors off, browser_tests off

### fulcro
- most frequent unresolved: `com.fulcrologic.fulcro.inspect.devtool-api/db-changed` 3, `com.fulcrologic.fulcro.inspect.devtool-api/optimistic-action` 3, `com.fulcrologic.fulcro.inspect.devtool-api/send-failed` 3, `com.fulcrologic.fulcro.inspect.devtool-api/send-finished` 3, `com.fulcrologic.fulcro.inspect.devtool-api/send-started` 3, `com.fulcrologic.fulcro.inspect.devtool-api/app-started` 1
- most frequent unknown: `=1x=>` 75, `=>` 61, `args` 57, `id` 57, `n` 43, `e` 38, `app` 32, `_` 26, `env` 25, `tm` 22, `a` 20, `k` 20, `params` 19, `remote` 18, `=throws=>` 16
- adapters: multimethods (defmethod) 28 edges, implementations (protocol implementations) 89 edges, events off, routes off, data_attributes off, system off, schemas (spec) 26 edges, key_flow (keywords in code) 11453 edges, key_tables (map literals in code) 0 edges, client_routes off, requests (ClojureScript sources) 0 edges, selectors off, browser_tests off

### honeysql
- most frequent unresolved: none
- most frequent unknown: `String` 7, `Object` 3, `default` 1, `matches-token-spec-for-matching` 1, `matches-token-spec-for-random-string` 1, `string` 1, `this` 1
- adapters: multimethods off, implementations (protocol implementations) 29 edges, events off, routes off, data_attributes off, system off, schemas off, key_flow (keywords in code) 2471 edges, key_tables (map literals in code) 0 edges, client_routes off, requests (ClojureScript sources) 0 edges, selectors off, browser_tests off

### integrant
- most frequent unresolved: none
- most frequent unknown: `r` 2, `config` 1, `resolvef` 1
- adapters: multimethods (defmethod) 52 edges, implementations (protocol implementations) 12 edges, events off, routes off, data_attributes off, system (integrant) 61 edges, schemas off, key_flow (keywords in code) 492 edges, key_tables (map literals in code) 0 edges, client_routes off, requests (ClojureScript sources) 0 edges, selectors off, browser_tests off

### logseq
- most frequent unresolved: none
- most frequent unknown: `this` 60, `Object` 17, `object` 15, `dir` 11, `repo` 10, `state` 10, `opts` 8, `ws` 7, `env` 6, `request` 6, `content` 5, `path` 5, `config` 4, `.-stack` 3, `.-write` 3
- adapters: multimethods (defmethod) 324 edges, implementations (protocol implementations) 313 edges, events off, routes (reitit) 0 edges, data_attributes (datascript) 24772 edges, system off, schemas (malli, spec) 131 edges, key_flow (keywords in code) 86131 edges, key_tables (map literals in code) 0 edges, client_routes (reitit in ClojureScript or secretary) 0 edges, requests (ClojureScript sources) 0 edges, selectors off, browser_tests off

### malli
- most frequent unresolved: `malli.instrument.fn-schemas/power-arg-ns` 8, `malli.instrument.fn-schemas/power-arg-refer` 8, `malli.instrument.fn-schemas/power-full` 8, `malli.instrument.fn-schemas/power-ret-ns` 8, `malli.instrument.fn-schemas/power-ret-refer` 8, `malli.instrument.fn-schemas/str-join-mx2` 8, `malli.instrument.fn-schemas/power-int?` 4, `malli.core/function` 1
- most frequent unknown: `this` 54, `x` 50, `a` 16, `y` 12, `b` 10, `power` 10, `str-join-mx` 10, `pos` 9, `c` 8, `m1` 8, `m2` 8, `self` 8, `regs` 7, `simple-benchmark` 7, `args` 6
- adapters: multimethods (defmethod) 849 edges, implementations (protocol implementations) 2134 edges, events off, routes off, data_attributes off, system off, schemas (malli, spec) 85 edges, key_flow (keywords in code) 9095 edges, key_tables (map literals in code) 0 edges, client_routes off, requests (ClojureScript sources) 0 edges, selectors off, browser_tests off

### metabase
- most frequent unresolved: `metabase.test-runner.assert-exprs.approximately-equal/keep-me` 81, `metabase.auth-identity.provider/authenticate` 48, `metabase.auth-identity.provider/login!` 19, `metabase.util.secret/expose` 12, `metabase.types.core/keep-me` 10, `metabase-enterprise.remote-sync.source.protocol/->ingestable` 7, `metabase.auth-identity.provider/validate` 7, `metabase.lib.schema/keep-me` 7, `metabase.models.interface/to-json` 7, `metabase.audit-app.events.audit-log/keep-me` 6, `metabase.driver.h2/keep-me` 6, `metabase.lib.core/keep-me` 6, `metabase.events.impl/publish-event!` 5, `metabase.driver.postgres/keep-me` 4, `metabase.mcp.v2.tools.content/keep-me` 4
- most frequent unknown: `_` 432, `_conn` 293, `_model` 276, `card-id` 270, `user-id` 242, `<>` 195, `db-id` 193, `k` 192, `topic` 153, `convo-id` 143, `id` 142, `group-id` 124, `card` 120, `this` 117, `model` 112
- adapters: multimethods (defmethod) 10174 edges, implementations (protocol implementations) 3461 edges, events off, routes (compojure) 13 edges, data_attributes off, system (integrant) 2 edges, schemas (malli, spec) 526 edges, key_flow (keywords in code) 386443 edges, key_tables (map literals in code) 0 edges, client_routes off, requests (ClojureScript sources) 0 edges, selectors off, browser_tests off

### mount
- most frequent unresolved: none
- most frequent unknown: `RuntimeException` 2, `this` 2, `Throwable` 1, `k` 1, `ks` 1, `watcher` 1
- adapters: multimethods off, implementations (protocol implementations) 9 edges, events off, routes (compojure) 1 edges, data_attributes (datascript, datomic) 28 edges, system (mount) 56 edges, schemas off, key_flow (keywords in code) 284 edges, key_tables (map literals in code) 0 edges, client_routes off, requests (ClojureScript sources) 0 edges, selectors off, browser_tests off

### next-jdbc
- most frequent unresolved: `next.jdbc.types/as-other` 2, `next.jdbc.types/as-varchar` 2, `next.jdbc.types/as-boolean` 1, `next.jdbc.types/as-real` 1
- most frequent unknown: `this` 12, `_` 8, `opts` 7, `row` 4, `sql-params` 4, `rs` 2, `.setObject` 1, `body-fn` 1, `col` 1, `connectable` 1, `i` 1, `idx` 1, `ix` 1, `label` 1, `rsmeta` 1
- adapters: multimethods (defmethod) 2 edges, implementations (protocol implementations) 417 edges, events off, routes off, data_attributes off, system (component) 0 edges, schemas (spec) 94 edges, key_flow (keywords in code) 1221 edges, key_tables (map literals in code) 0 edges, client_routes off, requests off, selectors off, browser_tests off

### pathom3
- most frequent unresolved: none
- most frequent unknown: `this` 6, `cache-key` 2, `env` 2, `String` 1, `Throwable` 1, `a` 1, `attribute-errors` 1, `f` 1, `input` 1, `params` 1
- adapters: multimethods (defmethod) 8 edges, implementations (protocol implementations) 109 edges, events off, routes off, data_attributes off, system off, schemas (spec) 27 edges, key_flow (keywords in code) 11682 edges, key_tables (map literals in code) 0 edges, client_routes off, requests (ClojureScript sources) 0 edges, selectors off, browser_tests off

### pedestal
- most frequent unresolved: `io.pedestal.log/-register` 4, `io.pedestal.http.route.sawtooth.impl/create-matcher-from-routes` 2, `io.pedestal.log/counter` 2, `io.pedestal.log/log-span` 2, `server-sent-events.server/service-instance` 2, `io.pedestal.http.route.definition/defroutes` 1, `io.pedestal.http.route.sawtooth.impl/report-conflicts` 1, `io.pedestal.log/finish-span` 1, `io.pedestal.log/gauge` 1, `io.pedestal.log/histogram` 1, `io.pedestal.log/meter` 1, `io.pedestal.log/metric-registry` 1, `io.pedestal.log/span` 1, `io.pedestal.log/tag-span` 1, `server-sent-events.server/create-server` 1
- most frequent unknown: `request-inspection` 36, `interceptor-1` 28, `interceptor-2` 22, `t` 18, `this` 18, `body` 16, `trailing-slash` 16, `add-user` 13, `home-page` 13, `base-request` 12, `_request` 11, `list-users` 11, `view-user` 10, `logout` 9, `update-user` 9
- adapters: multimethods (defmethod) 13 edges, implementations (protocol implementations) 598 edges, events off, routes (pedestal) 111 edges, data_attributes off, system (component) 24 edges, schemas (spec) 180 edges, key_flow (keywords in code) 5146 edges, key_tables (map literals in code) 0 edges, client_routes off, requests (ClojureScript sources) 0 edges, selectors off, browser_tests off

### penpot
- most frequent unresolved: `app.rpc.commands.ldap/sm$login-with-ldap` 4, `app.srepl.main/do` 4, `app.common.test-helpers.files/add-sample-shape` 2, `app.db/with-atomic` 1, `app.main.data.workspace.libraries/add-recent-color` 1, `app.srepl.main/java.util.regex.Pattern` 1
- most frequent unknown: `await` 911, `mock` 210, `_` 143, `http-mock` 110, `audit-mock` 104, `nitrate-mock` 54, `admin-console-mock` 52, `climit` 41, `data` 36, `string` 23, `legacy-mock` 21, `email-mock` 18, `_mock` 17, `batch-mock` 15, `function` 15
- adapters: multimethods (defmethod) 1758 edges, implementations (protocol implementations) 2629 edges, events off, routes (reitit) 0 edges, data_attributes off, system (integrant) 423 edges, schemas (malli, spec) 190 edges, key_flow (keywords in code) 150057 edges, key_tables (map literals in code) 0 edges, client_routes (reitit in ClojureScript or secretary) 0 edges, requests (ClojureScript sources) 1 edges, selectors off, browser_tests off

### polylith-realworld
- most frequent unresolved: none
- most frequent unknown: none
- adapters: multimethods off, implementations off, events off, routes (compojure) 22 edges, data_attributes off, system off, schemas (spec) 0 edges, key_flow (keywords in code) 1391 edges, key_tables (map literals in code) 0 edges, client_routes off, requests off, selectors off, browser_tests off

### re-frame
- most frequent unresolved: none
- most frequent unknown: `this` 13, `_` 5, `event` 3, `id` 2, `->interceptor` 1, `add-post-event-callback` 1, `after` 1, `arg` 1, `assemble-epochs` 1, `assoc-coeffect` 1, `assoc-effect` 1, `callback-fn` 1, `clear-cofx` 1, `clear-event` 1, `clear-flow` 1
- adapters: multimethods (defmethod) 6 edges, implementations (protocol implementations) 73 edges, events (re-frame.core) 287 edges, routes off, data_attributes off, system off, schemas (spec) 7 edges, key_flow (keywords in code) 1728 edges, key_tables (map literals in code) 0 edges, client_routes (reitit in ClojureScript or secretary) 0 edges, requests (ClojureScript sources) 0 edges, selectors off, browser_tests off

### reagent
- most frequent unresolved: none
- most frequent unknown: `clj` 46, `this` 11, `reagent.debug.has-console` 3, `.-destroy` 2, `.-generation` 2, `.-ratomGeneration` 2, `ShadowInput` 2, `ShadowWrapper` 2, `constructor` 2, `extends` 2, `p` 2, `reagent.debug.track-console` 2, `reagent.debug.tracking` 2, `super` 2, `.-displayName` 1
- adapters: multimethods (defmethod) 5 edges, implementations (protocol implementations) 124 edges, events off, routes off, data_attributes off, system off, schemas off, key_flow (keywords in code) 1470 edges, key_tables (map literals in code) 0 edges, client_routes off, requests (ClojureScript sources) 0 edges, selectors off, browser_tests off

### reitit
- most frequent unresolved: `reitit.coercion.spec/string-conforming` 2, `reitit.ring.coercion/request-coercers` 1, `reitit.ring.coercion/wrap-coerce-response` 1
- most frequent unknown: `this` 54, `String` 6, `model` 6, `data` 5, `path` 5, `interceptors` 4, `matcher` 4, `opts` 4, `value` 4, `function` 3, `options` 2, `params` 2, `path-params` 2, `request` 2, `specification` 2
- adapters: multimethods (defmethod) 30 edges, implementations (protocol implementations) 618 edges, events (re-frame.core) 8 edges, routes (compojure, pedestal, reitit) 369 edges, data_attributes off, system (integrant) 4 edges, schemas (malli, spec) 151 edges, key_flow (keywords in code) 9868 edges, key_tables (map literals in code) 0 edges, client_routes (reitit in ClojureScript or secretary) 0 edges, requests (ClojureScript sources) 0 edges, selectors off, browser_tests off

### ring
- most frequent unresolved: none
- most frequent unknown: `response` 15, `request` 13, `socket` 12, `_` 7, `listener` 6, `base-request` 5, `data` 5, `b` 4, `this` 4, `close` 3, `message` 3, `store` 3, `body` 2, `code` 2, `doHandle` 2
- adapters: multimethods (defmethod) 17 edges, implementations (protocol implementations) 353 edges, events off, routes off, data_attributes off, system off, schemas off, key_flow (keywords in code) 2046 edges, key_tables (map literals in code) 0 edges, client_routes off, requests off, selectors off, browser_tests off

### shadow-cljs
- most frequent unresolved: `shadow.lazy/Loadable.` 3, `demo.browser/bla` 2, `shadow.build.api/has-tests?` 2, `shadow.build.node/execute-affected-tests!` 2, `shadow.cljs.ui.components.builds/build-card` 2, `shadow.cljs.ui.components.inspect/ui-page` 2, `shadow.build.api/find-dependents-for-names` 1, `shadow.build.api/ns->cljs-file` 1, `shadow.build.api/prepare-compile` 1, `shadow.build.api/prepare-modules` 1, `shadow.build.api/watch-and-repeat!` 1, `shadow.build.node/execute-all-tests!` 1, `shadow.build.output/generate-bundle-info` 1, `shadow.cljs.devtools.api/release-snapshot` 1, `shadow.cljs.devtools.api/test-affected` 1
- most frequent unknown: `env` 70, `bind` 54, `x` 50, `object` 42, `render` 40, `e` 34, `active?` 30, `event` 27, `panel-idx` 20, `runtime-id` 18, `build-id` 17, `result` 16, `oid` 15, `_` 12, `dom-ref` 12
- adapters: multimethods (defmethod) 465 edges, implementations (protocol implementations) 189 edges, events off, routes off, data_attributes off, system off, schemas (spec) 234 edges, key_flow (keywords in code) 12549 edges, key_tables (map literals in code) 0 edges, client_routes off, requests (ClojureScript sources) 0 edges, selectors off, browser_tests off

### usermanager
- most frequent unresolved: none
- most frequent unknown: `database` 3, `db` 2, `user-without-id` 2, `id` 1, `params` 1, `user` 1
- adapters: multimethods off, implementations (protocol implementations) 7 edges, events off, routes (compojure) 7 edges, data_attributes off, system (component) 4 edges, schemas off, key_flow (keywords in code) 99 edges, key_tables (map literals in code) 0 edges, client_routes off, requests off, selectors off, browser_tests off

### xtdb-v1
- most frequent unresolved: `user/xtdb-node` 4, `xtdb.soak.config/weather-api-token` 2, `xtdb.api/start-cluster-node` 1, `xtdb.lucene/write-docs!` 1
- most frequent unknown: `kv-store` 97, `this` 79, `node` 73, `dir` 59, `db-dir` 38, `cp-dir` 32, `data-dir` 22, `cp-store-dir` 20, `lucene-dir` 17, `_` 16, `opts` 13, `docs` 12, `tx` 11, `eid` 10, `node-dir` 10
- adapters: multimethods (defmethod) 275 edges, implementations (protocol implementations) 2051 edges, events (re-frame.core) 146 edges, routes (reitit) 0 edges, data_attributes (datomic, xtdb) 1838 edges, system (integrant) 13 edges, schemas (spec) 203 edges, key_flow (keywords in code) 14366 edges, key_tables (map literals in code) 0 edges, client_routes (reitit in ClojureScript or secretary) 0 edges, requests (ClojureScript sources) 0 edges, selectors off, browser_tests off
