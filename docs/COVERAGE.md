# Coverage

Measured by `node scripts/coverage.ts <corpus-dir>` over the repos pinned in [corpus.json](../corpus.json), each at
the recorded sha. Every number below comes from that run.

How to read the columns:
- **files expected**: Clojure files git tracks in the repo (.clj, .cljs, .cljc, project.clj excluded).
- **files analyzed**: the ones clj-kondo analyzed (build output, dependencies, hidden directories and files over the
  size limit skipped).
- **syntax-error files**: files clj-kondo could not fully parse.
- **resolved / unresolved**: var usages that name a project namespace. *resolved* found its definition;
  *unresolved* names a project namespace but no definition in it (a var created by a macro clj-kondo does not know,
  or by `intern`). Usages of library vars (clojure.core and dependencies) are not counted, and neither are
  symbols that can never be vars (special forms, auto-gensyms, `&`, clojure.test's `thrown?`).
- **resolution rate**: resolved / (resolved + unresolved): of the usages clj-kondo attributes to a project
  namespace, the share the graph links to a definition. It says nothing about the next column.
- **unknown namespace**: symbols clj-kondo could not attribute to any namespace (mostly bindings of macros it does
  not know). Some are var usages the graph misses, most are locals; nothing static tells which, so they are
  reported as a raw count and kept out of the rate.
- adapter columns: edges each adapter added (0 when its library is not used); key_tables counts tables.
- **unknown edges**: edges in band UNKNOWN (attribute references of unproven role).

| repo | files expected | files analyzed | syntax-error files | definitions | resolved | unresolved | resolution rate | unknown namespace | multimethods | implementations | events | routes | data_attributes | system | schemas | key_flow | key_tables | client_routes | requests | selectors | browser_tests | unknown edges | build | graph |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| babashka | 663 | 656 | 2 | 6464 | 15264 | 61 | 99.6% | 2176 | 448 | 738 | 0 | 0 | 20 | 4 | 384 | 19533 | 221 | 0 | 0 | 0 | 0 | 163 | 4.7 s | 734 KB |
| biff | 163 | 146 | 1 | 1250 | 2449 | 13 | 99.5% | 20 | 23 | 4 | 0 | 8 | 0 | 0 | 6 | 5221 | 30 | 0 | 0 | 0 | 0 | 133 | 1.1 s | 173 KB |
| cider-nrepl | 131 | 130 | 0 | 1149 | 3091 | 22 | 99.3% | 186 | 57 | 55 | 0 | 0 | 0 | 0 | 0 | 5285 | 45 | 0 | 0 | 0 | 0 | 93 | 1.0 s | 159 KB |
| clj-kondo | 461 | 427 | 12 | 2744 | 10743 | 26 | 99.8% | 251 | 116 | 721 | 1 | 2 | 0 | 4 | 8 | 22915 | 99 | 0 | 0 | 0 | 0 | 40 | 2.0 s | 490 KB |
| compojure | 11 | 11 | 0 | 87 | 250 | 0 | 100.0% | 0 | 2 | 36 | 0 | 0 | 0 | 0 | 0 | 209 | 0 | 0 | 0 | 0 | 0 | 0 | 0.2 s | 13 KB |
| datascript | 67 | 67 | 1 | 1018 | 4392 | 496 | 89.9% | 1255 | 15 | 326 | 0 | 0 | 1424 | 0 | 0 | 3844 | 52 | 0 | 0 | 0 | 0 | 135 | 1.6 s | 160 KB |
| day-of-datomic | 43 | 43 | 0 | 127 | 84 | 29 | 74.3% | 1 | 0 | 1 | 0 | 0 | 86 | 0 | 0 | 209 | 0 | 0 | 0 | 0 | 0 | 50 | 0.3 s | 11 KB |
| fulcro | 140 | 140 | 0 | 2699 | 9834 | 16 | 99.8% | 919 | 28 | 89 | 0 | 0 | 0 | 0 | 26 | 11666 | 74 | 0 | 0 | 0 | 0 | 103 | 2.6 s | 379 KB |
| honeysql | 26 | 20 | 0 | 504 | 2578 | 0 | 100.0% | 14 | 0 | 29 | 0 | 0 | 0 | 0 | 0 | 2252 | 3 | 0 | 0 | 0 | 0 | 6 | 0.8 s | 75 KB |
| integrant | 7 | 7 | 0 | 138 | 442 | 0 | 100.0% | 0 | 52 | 12 | 0 | 0 | 0 | 61 | 0 | 494 | 3 | 0 | 0 | 0 | 0 | 0 | 0.3 s | 21 KB |
| logseq | 1094 | 1088 | 0 | 18099 | 69041 | 0 | 100.0% | 162 | 324 | 313 | 0 | 0 | 25169 | 0 | 131 | 86978 | 627 | 17 | 0 | 0 | 0 | 22904 | 8.6 s | 3.4 MB |
| malli | 93 | 93 | 0 | 1372 | 7797 | 52 | 99.3% | 226 | 849 | 2134 | 0 | 0 | 0 | 0 | 93 | 9216 | 77 | 0 | 0 | 0 | 0 | 10 | 2.6 s | 291 KB |
| metabase | 4547 | 4460 | 0 | 68325 | 311181 | 111 | 100.0% | 9522 | 10174 | 3461 | 0 | 15 | 0 | 2 | 543 | 389885 | 6356 | 0 | 0 | 0 | 0 | 4891 | 47.5 s | 13.3 MB |
| mount | 47 | 47 | 0 | 222 | 913 | 0 | 100.0% | 3 | 0 | 9 | 0 | 2 | 30 | 56 | 0 | 288 | 3 | 0 | 0 | 0 | 0 | 0 | 2.2 s | 32 KB |
| next-jdbc | 46 | 38 | 0 | 337 | 2230 | 6 | 99.7% | 1 | 2 | 417 | 0 | 0 | 0 | 0 | 92 | 1179 | 4 | 0 | 0 | 0 | 0 | 4 | 915.3 s | 69 KB |
| pathom3 | 55 | 53 | 0 | 907 | 3815 | 0 | 100.0% | 4 | 8 | 109 | 0 | 0 | 0 | 0 | 27 | 11782 | 368 | 0 | 0 | 0 | 0 | 0 | 1.9 s | 228 KB |
| pedestal | 230 | 230 | 1 | 2083 | 5035 | 22 | 99.6% | 283 | 13 | 598 | 0 | 115 | 0 | 24 | 180 | 5111 | 12 | 0 | 0 | 0 | 0 | 23 | 1.5 s | 265 KB |
| penpot | 1560 | 1558 | 0 | 25341 | 124814 | 13 | 100.0% | 1888 | 1582 | 2629 | 0 | 0 | 0 | 423 | 193 | 149846 | 451 | 0 | 1 | 0 | 0 | 2609 | 16.8 s | 4.7 MB |
| polylith-realworld | 51 | 51 | 0 | 372 | 871 | 0 | 100.0% | 0 | 0 | 0 | 0 | 253 | 0 | 0 | 0 | 1372 | 21 | 0 | 0 | 0 | 0 | 28 | 0.5 s | 50 KB |
| re-frame | 70 | 70 | 0 | 762 | 2629 | 0 | 100.0% | 47 | 6 | 73 | 362 | 0 | 0 | 0 | 7 | 1730 | 4 | 2 | 0 | 0 | 0 | 120 | 0.9 s | 115 KB |
| reagent | 65 | 65 | 0 | 829 | 2841 | 0 | 100.0% | 85 | 5 | 124 | 0 | 0 | 0 | 0 | 0 | 1473 | 2 | 0 | 0 | 0 | 0 | 16 | 0.9 s | 98 KB |
| reitit | 133 | 133 | 0 | 944 | 3654 | 0 | 100.0% | 14 | 30 | 618 | 8 | 557 | 0 | 4 | 146 | 9874 | 111 | 20 | 0 | 0 | 0 | 4 | 1.8 s | 206 KB |
| ring | 72 | 72 | 0 | 634 | 1485 | 0 | 100.0% | 58 | 17 | 353 | 0 | 0 | 0 | 0 | 0 | 2047 | 8 | 0 | 0 | 0 | 0 | 2 | 0.7 s | 86 KB |
| shadow-cljs | 320 | 320 | 3 | 2389 | 5051 | 16 | 99.7% | 909 | 465 | 186 | 0 | 0 | 0 | 0 | 227 | 11958 | 46 | 0 | 0 | 0 | 0 | 11 | 2.4 s | 377 KB |
| usermanager | 11 | 7 | 0 | 49 | 70 | 0 | 100.0% | 10 | 0 | 7 | 0 | 7 | 0 | 4 | 0 | 92 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 s | 7 KB |
| xtdb-v1 | 227 | 226 | 4 | 2759 | 11437 | 3 | 100.0% | 483 | 275 | 2051 | 152 | 0 | 1821 | 13 | 203 | 14346 | 158 | 0 | 0 | 0 | 0 | 482 | 3.1 s | 535 KB |

## Repos under 95% resolution rate, or with unknown-namespace usages above 5% of resolved

What is left in each is one of two kinds, both visible in the names below:
- **unknown**: a symbol bound by a macro clj-kondo does not know, so it cannot tell a local from a var
  (fields of a deftype or proxy, bindings of a test DSL such as fulcro-spec's `=>`, bindings of a project's own
  def-like macro). They are not var usages, but nothing static proves that.
- **unresolved**: a var created by a project macro clj-kondo does not know (datascript's record constructors), or
  a name in a REPL script with no ns form that clj-kondo files under a namespace not defining it (day-of-datomic's
  tutorials).
Both shrink when the repo ships a clj-kondo config for its macros, or when `.clojure-atlas.edn` names them under
`:lint-as`; the corpus is measured without adding either.

- **babashka** resolution rate 99.6%, 2176 usages in an unknown namespace (most: `v` 136, `session` 97, `this` 76, `a` 70, `m` 67); 61 unresolved (most: `babashka.deps/add-deps` 13, `babashka.impl.clojure.spec.gen.alpha/fmap` 9, `babashka.impl.clojure.spec.gen.alpha/return` 8)
- **cider-nrepl** resolution rate 99.3%, 186 usages in an unknown namespace (most: `args` 27, `opts` 20, `instrument-coll` 14, `version` 11, `x` 10); 22 unresolved (most: `cider.test-helpers/clojure.lang.ExceptionInfo` 3, `cider.test-helpers/thrown-with-msg?` 3, `cider.test-helpers/java.util.List` 2)
- **datascript** resolution rate 89.9%, 1255 usages in an unknown namespace (most: `db` 228, `d` 58, `entity` 40, `d1` 34, `d2` 34); 496 unresolved (most: `datascript.parser/->Variable` 132, `datascript.parser/->DefaultSrc` 42, `datascript.parser/->Pattern` 35)
- **day-of-datomic** resolution rate 74.3%, 1 usages in an unknown namespace (most: `.getMessage` 1); 29 unresolved (most: `datomic.samples.repl/email` 5, `datomic.samples.repl/id` 4, `datomic.samples.repl/transact` 4)
- **fulcro** resolution rate 99.8%, 919 usages in an unknown namespace (most: `=1x=>` 75, `=>` 61, `args` 57, `id` 52, `n` 43); 16 unresolved (most: `com.fulcrologic.fulcro.inspect.devtool-api/db-changed` 3, `com.fulcrologic.fulcro.inspect.devtool-api/optimistic-action` 3, `com.fulcrologic.fulcro.inspect.devtool-api/send-failed` 3)
- **pedestal** resolution rate 99.6%, 283 usages in an unknown namespace (most: `request-inspection` 36, `interceptor-1` 28, `interceptor-2` 22, `trailing-slash` 16, `add-user` 13); 22 unresolved (most: `io.pedestal.log/-register` 4, `io.pedestal.http.route.sawtooth.impl/create-matcher-from-routes` 2, `io.pedestal.log/counter` 2)
- **shadow-cljs** resolution rate 99.7%, 909 usages in an unknown namespace (most: `env` 70, `bind` 54, `x` 47, `object` 42, `render` 40); 16 unresolved (most: `shadow.lazy/Loadable.` 3, `demo.browser/bla` 2, `shadow.cljs.ui.components.builds/build-card` 2)
- **usermanager** resolution rate 100.0%, 10 usages in an unknown namespace (most: `database` 3, `db` 2, `user-without-id` 2, `id` 1, `params` 1); 0 unresolved (most: none)

## Per repo

### babashka
- most frequent unresolved: `babashka.deps/add-deps` 13, `babashka.impl.clojure.spec.gen.alpha/fmap` 9, `babashka.impl.clojure.spec.gen.alpha/return` 8, `babashka.impl.clojure.spec.gen.alpha/tuple` 6, `babashka.impl.clojure.spec.gen.alpha/vector` 4, `babashka.impl.clojure.spec.gen.alpha/bind` 3, `babashka.impl.clojure.spec.gen.alpha/one-of` 3, `babashka.impl.clojure.spec.gen.alpha/large-integer*` 2, `babashka.impl.clojure.spec.gen.alpha/sample` 2, `babashka.impl.clojure.spec.gen.alpha/vector-distinct` 2, `babashka.impl.clojure.spec.gen.alpha/choose` 1, `babashka.impl.clojure.spec.gen.alpha/double*` 1, `babashka.impl.clojure.spec.gen.alpha/frequency` 1, `babashka.impl.clojure.spec.gen.alpha/hash-map` 1, `babashka.impl.clojure.spec.gen.alpha/shuffle` 1
- most frequent unknown: `v` 136, `session` 97, `this` 76, `a` 70, `m` 67, `x` 58, `k2` 57, `b` 56, `pred` 54, `k1` 53, `repl-values` 53, `k` 47, `repl-eval` 38, `y` 37, `form` 34
- adapters: multimethods (defmethod) 448 edges, implementations (protocol implementations) 738 edges, events off, routes off, data_attributes (datascript) 20 edges, system (component) 4 edges, schemas (malli, spec) 384 edges, key_flow (keywords in code) 19533 edges, key_tables (map literals in code) 0 edges, client_routes off, requests (ClojureScript sources) 0 edges, selectors off, browser_tests off

### biff
- most frequent unresolved: `com.biffweb.sqlite.impl.execute/execute` 10, `com.biffweb.sqlite.impl.execute/execute-tx` 2, `com.biffweb.sqlite.impl.execute/execute-one` 1
- most frequent unknown: `this` 4, `args` 3, `b` 3, `exists` 2, `_len` 1, `_off` 1, `applyTo` 1, `call` 1, `invoke` 1, `run` 1, `toString` 1, `write` 1
- adapters: multimethods (defmethod) 23 edges, implementations (protocol implementations) 4 edges, events off, routes (reitit) 8 edges, data_attributes (xtdb) 0 edges, system off, schemas (malli) 6 edges, key_flow (keywords in code) 5221 edges, key_tables (map literals in code) 0 edges, client_routes off, requests off, selectors off, browser_tests off

### cider-nrepl
- most frequent unresolved: `cider.test-helpers/clojure.lang.ExceptionInfo` 3, `cider.test-helpers/thrown-with-msg?` 3, `cider.test-helpers/java.util.List` 2, `cider.test-helpers/this` 2, `cider.nrepl.middleware.classpath/java.io.File` 1, `cider.nrepl.middleware.classpath/java.net.URI` 1, `cider.nrepl.middleware.tap/java.net.SocketException` 1, `cider.nrepl.middleware.trace/clojure.lang.ExceptionInfo` 1, `cider.nrepl.middleware.trace/java.net.SocketException` 1, `cider.nrepl.middleware.trace/thrown?` 1, `cider.nrepl/wrap-log` 1, `cider.nrepl/wrap-macroexpand` 1, `cider.nrepl/wrap-tracker` 1, `cider.test-helpers/clojure.lang.Compiler$CompilerException` 1, `cider.test-helpers/if` 1
- most frequent unknown: `args` 27, `opts` 20, `instrument-coll` 14, `version` 11, `x` 10, `len` 5, `off` 5, `srcdeps` 5, `class-dir` 4, `int-or-bytes` 4, `file` 3, `instrument-special-form` 3, `jar` 3, `%&` 2, `_attrs` 2
- adapters: multimethods (defmethod) 57 edges, implementations (protocol implementations) 55 edges, events off, routes off, data_attributes off, system off, schemas (spec) 0 edges, key_flow (keywords in code) 5285 edges, key_tables (map literals in code) 0 edges, client_routes off, requests (ClojureScript sources) 0 edges, selectors off, browser_tests off

### clj-kondo
- most frequent unresolved: `app.core/` 6, `app.api/my-fn` 2, `app.api/renamed-fn` 2, `foo/compile-route` 2, `foo/with-redefs` 2, `a/x` 1, `another-funs/bar` 1, `another-funs/baz` 1, `app.api/my-var` 1, `app.api2/foo` 1, `app.api2/prewalk` 1, `app.api3/my-foo` 1, `bar/weird-macro` 1, `clj-kondo.impl.toolsreader.v1v2v2.clojure.tools.reader.impl.utils/Pattern` 1, `compojure.core/x` 1
- most frequent unknown: `a` 23, `x` 22, `_` 13, `reader` 12, `b` 10, `this` 9, `y` 9, `aliased` 8, `referred` 8, `access` 6, `desc` 5, `z` 5, `n` 4, `node` 4, `with-mixin` 4
- adapters: multimethods (defmethod) 116 edges, implementations (protocol implementations) 721 edges, events (re-frame.core) 1 edges, routes (compojure) 2 edges, data_attributes off, system (integrant) 4 edges, schemas (spec) 8 edges, key_flow (keywords in code) 22915 edges, key_tables (map literals in code) 0 edges, client_routes off, requests (ClojureScript sources) 0 edges, selectors off, browser_tests off

### compojure
- most frequent unresolved: none
- most frequent unknown: none
- adapters: multimethods (defmethod) 2 edges, implementations (protocol implementations) 36 edges, events off, routes (compojure) 0 edges, data_attributes off, system off, schemas off, key_flow (keywords in code) 209 edges, key_tables (map literals in code) 0 edges, client_routes off, requests off, selectors off, browser_tests off

### datascript
- most frequent unresolved: `datascript.parser/->Variable` 132, `datascript.parser/->DefaultSrc` 42, `datascript.parser/->Pattern` 35, `datascript.parser/->Constant` 30, `datascript.parser/->BindScalar` 21, `datascript.parser/->PlainSymbol` 20, `datascript.parser/->Placeholder` 16, `datascript.parser/->RuleVars` 15, `datascript.db/DB` 14, `datascript.parser/->SrcVar` 13, `datascript.parser/->Aggregate` 10, `datascript.parser/->RuleBranch` 8, `datascript.parser/->Or` 7, `datascript.parser/->Rule` 7, `datascript.db/entid` 6
- most frequent unknown: `db` 228, `d` 58, `entity` 40, `d1` 34, `d2` 34, `attr` 33, `eid` 31, `entities` 28, `x` 25, `index` 21, `c0` 20, `c1` 20, `c2` 20, `c3` 20, `v` 20
- adapters: multimethods (defmethod) 15 edges, implementations (protocol implementations) 326 edges, events off, routes off, data_attributes (datascript, datomic) 1424 edges, system off, schemas off, key_flow (keywords in code) 3844 edges, key_tables (map literals in code) 0 edges, client_routes off, requests (ClojureScript sources) 0 edges, selectors off, browser_tests off

### day-of-datomic
- most frequent unresolved: `datomic.samples.repl/email` 5, `datomic.samples.repl/id` 4, `datomic.samples.repl/transact` 4, `datomic.samples.repl/doc` 3, `datomic.samples.repl/pprint` 2, `datomic.samples.repl/user` 2, `datomic.samples.repl/datomic.Datom` 1, `datomic.samples.repl/db` 1, `datomic.samples.repl/do-side-effecty-thing-with-each` 1, `datomic.samples.repl/easy!` 1, `datomic.samples.repl/java.util.ArrayList` 1, `datomic.samples.repl/java.util.Date` 1, `datomic.samples.repl/keys-i-understand` 1, `datomic.samples.repl/some-entity` 1, `datomic.samples.repl/tempid` 1
- most frequent unknown: `.getMessage` 1
- adapters: multimethods off, implementations (protocol implementations) 1 edges, events off, routes off, data_attributes (datomic) 86 edges, system off, schemas off, key_flow (keywords in code) 209 edges, key_tables (map literals in code) 0 edges, client_routes off, requests off, selectors off, browser_tests off

### fulcro
- most frequent unresolved: `com.fulcrologic.fulcro.inspect.devtool-api/db-changed` 3, `com.fulcrologic.fulcro.inspect.devtool-api/optimistic-action` 3, `com.fulcrologic.fulcro.inspect.devtool-api/send-failed` 3, `com.fulcrologic.fulcro.inspect.devtool-api/send-finished` 3, `com.fulcrologic.fulcro.inspect.devtool-api/send-started` 3, `com.fulcrologic.fulcro.inspect.devtool-api/app-started` 1
- most frequent unknown: `=1x=>` 75, `=>` 61, `args` 57, `id` 52, `n` 43, `e` 38, `app` 32, `_` 26, `env` 25, `tm` 22, `a` 20, `k` 20, `params` 19, `remote` 17, `=throws=>` 16
- adapters: multimethods (defmethod) 28 edges, implementations (protocol implementations) 89 edges, events off, routes off, data_attributes off, system off, schemas (spec) 26 edges, key_flow (keywords in code) 11666 edges, key_tables (map literals in code) 0 edges, client_routes off, requests (ClojureScript sources) 0 edges, selectors off, browser_tests off

### honeysql
- most frequent unresolved: none
- most frequent unknown: `String` 7, `Object` 3, `default` 1, `matches-token-spec-for-matching` 1, `matches-token-spec-for-random-string` 1, `string` 1
- adapters: multimethods off, implementations (protocol implementations) 29 edges, events off, routes off, data_attributes off, system off, schemas off, key_flow (keywords in code) 2252 edges, key_tables (map literals in code) 0 edges, client_routes off, requests (ClojureScript sources) 0 edges, selectors off, browser_tests off

### integrant
- most frequent unresolved: none
- most frequent unknown: none
- adapters: multimethods (defmethod) 52 edges, implementations (protocol implementations) 12 edges, events off, routes off, data_attributes off, system (integrant) 61 edges, schemas off, key_flow (keywords in code) 494 edges, key_tables (map literals in code) 0 edges, client_routes off, requests (ClojureScript sources) 0 edges, selectors off, browser_tests off

### logseq
- most frequent unresolved: none
- most frequent unknown: `this` 24, `Object` 17, `object` 15, `state` 10, `ws` 7, `env` 6, `request` 6, `.-stack` 3, `.-write` 3, `.catch` 3, `.finally` 3, `error` 3, `length` 3, `offset` 3, `*key->call-count` 2
- adapters: multimethods (defmethod) 324 edges, implementations (protocol implementations) 313 edges, events off, routes (reitit) 0 edges, data_attributes (datascript) 25169 edges, system off, schemas (malli, spec) 131 edges, key_flow (keywords in code) 86978 edges, key_tables (map literals in code) 0 edges, client_routes (reitit in ClojureScript or secretary) 0 edges, requests (ClojureScript sources) 0 edges, selectors off, browser_tests off

### malli
- most frequent unresolved: `malli.instrument.fn-schemas/power-arg-ns` 8, `malli.instrument.fn-schemas/power-arg-refer` 8, `malli.instrument.fn-schemas/power-full` 8, `malli.instrument.fn-schemas/power-ret-ns` 8, `malli.instrument.fn-schemas/power-ret-refer` 8, `malli.instrument.fn-schemas/str-join-mx2` 8, `malli.instrument.fn-schemas/power-int?` 4
- most frequent unknown: `x` 50, `a` 16, `y` 12, `b` 10, `power` 10, `str-join-mx` 10, `c` 8, `m1` 8, `m2` 8, `args` 6, `description` 6, `destructure` 6, `%` 4, `addition-multiarity` 4, `d` 4
- adapters: multimethods (defmethod) 849 edges, implementations (protocol implementations) 2134 edges, events off, routes off, data_attributes off, system off, schemas (malli, spec) 93 edges, key_flow (keywords in code) 9216 edges, key_tables (map literals in code) 0 edges, client_routes off, requests (ClojureScript sources) 0 edges, selectors off, browser_tests off

### metabase
- most frequent unresolved: `metabase.auth-identity.provider/authenticate` 48, `metabase.auth-identity.provider/login!` 19, `metabase.util.secret/expose` 12, `metabase-enterprise.remote-sync.source.protocol/->ingestable` 7, `metabase.auth-identity.provider/validate` 7, `metabase.models.interface/to-json` 7, `metabase.events.impl/publish-event!` 5, `metabase.test/with-dynamic-redefs` 2, `dev.deps-graph/find-requires` 1, `metabase.actions.actions/perform-action!*` 1, `metabase.lib.field.resolution/options-metadata*` 1, `metabase.search.ingestion/spec-index-query` 1
- most frequent unknown: `_` 430, `_conn` 293, `_model` 276, `card-id` 270, `user-id` 242, `<>` 195, `k` 190, `db-id` 186, `topic` 153, `convo-id` 143, `id` 142, `group-id` 124, `card` 120, `event` 111, `tenant-id` 111
- adapters: multimethods (defmethod) 10174 edges, implementations (protocol implementations) 3461 edges, events off, routes (compojure) 15 edges, data_attributes off, system (integrant) 2 edges, schemas (malli, spec) 543 edges, key_flow (keywords in code) 389885 edges, key_tables (map literals in code) 0 edges, client_routes off, requests (ClojureScript sources) 0 edges, selectors off, browser_tests off

### mount
- most frequent unresolved: none
- most frequent unknown: `RuntimeException` 2, `Throwable` 1
- adapters: multimethods off, implementations (protocol implementations) 9 edges, events off, routes (compojure) 2 edges, data_attributes (datascript, datomic) 30 edges, system (mount) 56 edges, schemas off, key_flow (keywords in code) 288 edges, key_tables (map literals in code) 0 edges, client_routes off, requests (ClojureScript sources) 0 edges, selectors off, browser_tests off

### next-jdbc
- most frequent unresolved: `next.jdbc.types/as-other` 2, `next.jdbc.types/as-varchar` 2, `next.jdbc.types/as-boolean` 1, `next.jdbc.types/as-real` 1
- most frequent unknown: `.setObject` 1
- adapters: multimethods (defmethod) 2 edges, implementations (protocol implementations) 417 edges, events off, routes off, data_attributes off, system off, schemas (spec) 92 edges, key_flow (keywords in code) 1179 edges, key_tables (map literals in code) 0 edges, client_routes off, requests off, selectors off, browser_tests off

### pathom3
- most frequent unresolved: none
- most frequent unknown: `String` 1, `Throwable` 1, `a` 1, `attribute-errors` 1
- adapters: multimethods (defmethod) 8 edges, implementations (protocol implementations) 109 edges, events off, routes off, data_attributes off, system off, schemas (spec) 27 edges, key_flow (keywords in code) 11782 edges, key_tables (map literals in code) 0 edges, client_routes off, requests (ClojureScript sources) 0 edges, selectors off, browser_tests off

### pedestal
- most frequent unresolved: `io.pedestal.log/-register` 4, `io.pedestal.http.route.sawtooth.impl/create-matcher-from-routes` 2, `io.pedestal.log/counter` 2, `io.pedestal.log/log-span` 2, `server-sent-events.server/service-instance` 2, `io.pedestal.http.route.definition/defroutes` 1, `io.pedestal.http.route.sawtooth.impl/report-conflicts` 1, `io.pedestal.log/finish-span` 1, `io.pedestal.log/gauge` 1, `io.pedestal.log/histogram` 1, `io.pedestal.log/meter` 1, `io.pedestal.log/metric-registry` 1, `io.pedestal.log/span` 1, `io.pedestal.log/tag-span` 1, `server-sent-events.server/create-server` 1
- most frequent unknown: `request-inspection` 36, `interceptor-1` 28, `interceptor-2` 22, `trailing-slash` 16, `add-user` 13, `home-page` 13, `base-request` 12, `_request` 11, `list-users` 11, `view-user` 10, `logout` 9, `update-user` 9, `req` 8, `search-form` 8, `search-query` 8
- adapters: multimethods (defmethod) 13 edges, implementations (protocol implementations) 598 edges, events off, routes (pedestal) 115 edges, data_attributes off, system (component) 24 edges, schemas (spec) 180 edges, key_flow (keywords in code) 5111 edges, key_tables (map literals in code) 0 edges, client_routes off, requests (ClojureScript sources) 0 edges, selectors off, browser_tests off

### penpot
- most frequent unresolved: `app.rpc.commands.ldap/sm$login-with-ldap` 4, `app.srepl.main/do` 4, `app.common.test-helpers.files/add-sample-shape` 2, `app.db/with-atomic` 1, `app.main.data.workspace.libraries/add-recent-color` 1, `app.srepl.main/java.util.regex.Pattern` 1
- most frequent unknown: `await` 911, `mock` 210, `http-mock` 110, `audit-mock` 104, `nitrate-mock` 54, `admin-console-mock` 52, `climit` 41, `data` 36, `string` 23, `legacy-mock` 21, `email-mock` 18, `_mock` 17, `batch-mock` 15, `function` 15, `change` 14
- adapters: multimethods (defmethod) 1582 edges, implementations (protocol implementations) 2629 edges, events off, routes (reitit) 0 edges, data_attributes off, system (integrant) 423 edges, schemas (malli, spec) 193 edges, key_flow (keywords in code) 149846 edges, key_tables (map literals in code) 0 edges, client_routes (reitit in ClojureScript or secretary) 0 edges, requests (ClojureScript sources) 1 edges, selectors off, browser_tests off

### polylith-realworld
- most frequent unresolved: none
- most frequent unknown: none
- adapters: multimethods off, implementations off, events off, routes (compojure) 253 edges, data_attributes off, system off, schemas (spec) 0 edges, key_flow (keywords in code) 1372 edges, key_tables (map literals in code) 0 edges, client_routes off, requests off, selectors off, browser_tests off

### re-frame
- most frequent unresolved: none
- most frequent unknown: `->interceptor` 1, `add-post-event-callback` 1, `after` 1, `assemble-epochs` 1, `assoc-coeffect` 1, `assoc-effect` 1, `clear-cofx` 1, `clear-event` 1, `clear-flow` 1, `clear-fx` 1, `clear-global-interceptor` 1, `clear-sub` 1, `clear-subscription-cache!` 1, `console` 1, `debug` 1
- adapters: multimethods (defmethod) 6 edges, implementations (protocol implementations) 73 edges, events (re-frame.core) 362 edges, routes off, data_attributes off, system off, schemas (spec) 7 edges, key_flow (keywords in code) 1730 edges, key_tables (map literals in code) 0 edges, client_routes (reitit in ClojureScript or secretary) 0 edges, requests (ClojureScript sources) 0 edges, selectors off, browser_tests off

### reagent
- most frequent unresolved: none
- most frequent unknown: `clj` 46, `this` 4, `reagent.debug.has-console` 3, `.-destroy` 2, `.-generation` 2, `.-ratomGeneration` 2, `ShadowInput` 2, `ShadowWrapper` 2, `constructor` 2, `extends` 2, `reagent.debug.track-console` 2, `reagent.debug.tracking` 2, `super` 2, `.-displayName` 1, `.-reagent-component` 1
- adapters: multimethods (defmethod) 5 edges, implementations (protocol implementations) 124 edges, events off, routes off, data_attributes off, system off, schemas off, key_flow (keywords in code) 1473 edges, key_tables (map literals in code) 0 edges, client_routes off, requests (ClojureScript sources) 0 edges, selectors off, browser_tests off

### reitit
- most frequent unresolved: none
- most frequent unknown: `String` 6, `function` 3, `.-composedPath` 1, `default` 1, `number` 1, `object` 1, `string` 1
- adapters: multimethods (defmethod) 30 edges, implementations (protocol implementations) 618 edges, events (re-frame.core) 8 edges, routes (compojure, pedestal, reitit) 557 edges, data_attributes off, system (integrant) 4 edges, schemas (malli, spec) 146 edges, key_flow (keywords in code) 9874 edges, key_tables (map literals in code) 0 edges, client_routes (reitit in ClojureScript or secretary) 0 edges, requests (ClojureScript sources) 0 edges, selectors off, browser_tests off

### ring
- most frequent unresolved: none
- most frequent unknown: `request` 13, `response` 13, `_` 7, `base-request` 5, `b` 4, `close` 3, `doHandle` 2, `len` 2, `off` 2, `service` 2, `this` 2, `.stop` 1, `handle` 1, `write` 1
- adapters: multimethods (defmethod) 17 edges, implementations (protocol implementations) 353 edges, events off, routes off, data_attributes off, system off, schemas off, key_flow (keywords in code) 2047 edges, key_tables (map literals in code) 0 edges, client_routes off, requests off, selectors off, browser_tests off

### shadow-cljs
- most frequent unresolved: `shadow.lazy/Loadable.` 3, `demo.browser/bla` 2, `shadow.cljs.ui.components.builds/build-card` 2, `shadow.cljs.ui.components.inspect/ui-page` 2, `shadow.build.output/generate-bundle-info` 1, `shadow.cljs.devtools.api/release-snapshot` 1, `shadow.cljs.ui.components.builds/ui-builds-page` 1, `shadow.cljs.ui.components.inspect/code-input` 1, `shadow.cljs.ui.components.runtimes/ui-page` 1, `shadow.expo/find-entry` 1, `shadow.expo/get-mapped-stack` 1
- most frequent unknown: `env` 70, `bind` 54, `x` 47, `object` 42, `render` 40, `e` 31, `active?` 30, `event` 27, `panel-idx` 20, `runtime-id` 18, `build-id` 17, `result` 16, `oid` 15, `_` 12, `dom-ref` 12
- adapters: multimethods (defmethod) 465 edges, implementations (protocol implementations) 186 edges, events off, routes off, data_attributes off, system off, schemas (spec) 227 edges, key_flow (keywords in code) 11958 edges, key_tables (map literals in code) 0 edges, client_routes off, requests (ClojureScript sources) 0 edges, selectors off, browser_tests off

### usermanager
- most frequent unresolved: none
- most frequent unknown: `database` 3, `db` 2, `user-without-id` 2, `id` 1, `params` 1, `user` 1
- adapters: multimethods off, implementations (protocol implementations) 7 edges, events off, routes (compojure) 7 edges, data_attributes off, system (component) 4 edges, schemas off, key_flow (keywords in code) 92 edges, key_tables (map literals in code) 0 edges, client_routes off, requests off, selectors off, browser_tests off

### xtdb-v1
- most frequent unresolved: `xtdb.soak.config/weather-api-token` 2, `xtdb.api/start-cluster-node` 1
- most frequent unknown: `kv-store` 97, `dir` 55, `db-dir` 38, `node` 38, `cp-dir` 32, `data-dir` 22, `cp-store-dir` 20, `lucene-dir` 17, `node-dir` 10, `idx-dir` 8, `local-dir` 8, `docs` 6, `ctx` 5, `this` 5, `x` 5
- adapters: multimethods (defmethod) 275 edges, implementations (protocol implementations) 2051 edges, events (re-frame.core) 152 edges, routes (reitit) 0 edges, data_attributes (datomic, xtdb) 1821 edges, system (integrant) 13 edges, schemas (spec) 203 edges, key_flow (keywords in code) 14346 edges, key_tables (map literals in code) 0 edges, client_routes (reitit in ClojureScript or secretary) 0 edges, requests (ClojureScript sources) 0 edges, selectors off, browser_tests off
