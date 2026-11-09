# clojure-atlas

**For the sake of all Clojurians.**

English | [Türkçe](README.tr.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Português (Brasil)](README.pt-BR.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md)

A structural map of a Clojure, ClojureScript or .cljc codebase, served to AI coding agents as MCP tools.
Built for agentic development. MIT licensed. Created by Barış Can Ateş.

## What it is

An agent that edits Clojure usually finds relations with text search. Text search cannot tell a call from a
keyword of the same name, cannot see a handler registered with `reg-event-fx`, a route that reaches a var, or a
function passed to `partial`, and it cannot say "nothing calls this" with any confidence. clojure-atlas runs
[clj-kondo](https://github.com/clj-kondo/clj-kondo) over the project once, turns its analysis into a graph
(definitions, calls, value uses, re-frame events, routes, system keys, data attributes, map keys, tests), and
answers questions about it over MCP. Every answer row carries a band that says how it was proven, and every empty
answer says what was searched and whether the graph can know at all.

## Quick start

```sh
npm i -D clojure-atlas
npx clojure-atlas build
npx clojure-atlas init
```

`build` writes `.clojure-atlas/graph.json.gz`. On the integrant repo it prints:

```
clojure-atlas: 7 files, 138 definitions, 295 nodes, 1473 edges; resolution rate of var usages in recognized project namespaces 100.0% (442 of 442), 0 usages in an unknown namespace; 1.1 s -> .clojure-atlas/graph.json.gz
```

`init` shows the project `.mcp.json` it would write and writes it only with `--yes`:

```
.mcp.json would become:
{
  "mcpServers": {
    "clojure-atlas": {
      "command": "npx",
      "args": [
        "clojure-atlas",
        "mcp",
        "--graph",
        ".clojure-atlas/graph.json.gz",
        "--repo",
        "."
      ]
    }
  }
}

run `clojure-atlas init --yes` to write it, then `clojure-atlas build`
```

Other servers already in `.mcp.json` are kept.

### Claude Code

`npx clojure-atlas init --yes` writes the project `.mcp.json`, which Claude Code reads. Or add the server by hand:

```sh
claude mcp add clojure-atlas -- npx clojure-atlas mcp --graph .clojure-atlas/graph.json.gz --repo .
```

### Any other MCP client

The server speaks MCP over stdio. Most clients take this JSON:

```json
{
  "mcpServers": {
    "clojure-atlas": {
      "command": "npx",
      "args": ["clojure-atlas", "mcp", "--graph", ".clojure-atlas/graph.json.gz", "--repo", "."]
    }
  }
}
```

### Commands

```
usage:
  clojure-atlas build [dir] [-o .clojure-atlas/graph.json.gz]
  clojure-atlas mcp [--graph .clojure-atlas/graph.json.gz] [--repo <clone>] [--max-distance N]
  clojure-atlas coverage [graph]
  clojure-atlas init [--yes]
```

- `build` analyzes `dir` (default `.`) and writes the graph.
- `mcp` serves a graph. With `--repo`, answers start with a `STALE` line when the working tree is not the one the
  graph was built from, or when the commit the agent passes as `base` is more than `--max-distance` commits
  away (default 20).
- `coverage` prints the coverage row of a graph and its most frequent unresolved names.
- `init` adds the server to the project `.mcp.json`.

Rebuild the graph after you change code. A served graph does not update itself:

```
STALE: the working tree is not the snapshot this graph describes (2 uncommitted file(s) now, 1 at build); rebuild with clojure-atlas build.
```

The project's own `.clj-kondo` config is honored. An optional `.clojure-atlas.edn` in the project root adds what
the generic adapters cannot guess: `:lint-as` for def-like macros, `:route-macros`, and the route authorization
keys `:route-authz`, `:permission-middleware` and `:permission-fns`.

## Tools

Every example below is real output of `clojure-atlas mcp` over a graph in [examples/](examples/), trimmed only
where marked. `[S]`, `[H]` and `[?]` are the bands, explained in the next section.

### graph_info

Which commit the graph describes, what each adapter found, with band counts. Question: what does the integrant
graph know?

```
graph integrant @ master sha bcad6bcf35b62d3a32a453dc26b6d3a4d659dc01 built 2026-11-09T23:22:16.599Z: 295 nodes, 1473 edges
snapshot c90296dac61d6d6d: 0 uncommitted file(s), analyzer clojure-atlas 0.1.0, clj-kondo v2025.10.23
config c77762fd2fd2 from .clj-kondo/config.edn
  definitions: available, 854 edges {"static_proven":854}
  multimethods: available, 52 edges {"static_proven":26,"heuristic":26} (switched on by defmethod)
  events: available, 0 edges {} (not used: nothing in this codebase switches it on)
  system: available, 61 edges {"static_proven":61} (switched on by integrant)
  route_authz: absent (not declared: .clojure-atlas.edn names no route authz key, permission middleware or permission fn)
  [... trimmed ...]
```

### callers

Direct callers of a definition. Question: who calls `integrant.core/dependent-keys`?

```
CALLERS integrant.core/dependent-keys — 4 direct caller(s) in 1 component(s)
counts: callers=4 [S4]
definition (1)
  1. integrant.core/dependent-keys  src/integrant/core.cljc:211 [S]
callers (4 S4)
  1. integrant.core/build  src/integrant/core.cljc:442 [S]  fan-in 4
  2. integrant.core/load-namespaces  src/integrant/core.cljc:260 [S]
  3. integrant.core/halt-missing-keys!  src/integrant/core.cljc:673 [S]
  4. integrant.core/run!  src/integrant/core.cljc:389 [S]
next: blast_radius(var="integrant.core/dependent-keys", depth=2)  tests_for(symbol="integrant.core/dependent-keys")
```

With `include_references: true` it also lists value uses, callbacks, registered handlers, macro expansions,
dispatch candidates and rebindings.

### blast_radius

Transitive dependents of a definition. Question: what can a change to `integrant.core/ref?` reach?

```
BLAST_RADIUS integrant.core/ref? — 31 caller(s) over 6 depth(s) in 1 component(s)
counts: affected=6 [S6]  deeper=25 [S25]
note: by depth: 1=4 2=2 3=8 4=11 5=3 6=3
note: potential impact over known dependency relations (calls, value uses, callbacks, registered handlers, macro expansions, dispatch candidates, rebindings): a path here may never run
affected (6 S6)
  1. integrant.core/ambiguous-refs  src/integrant/core.cljc:323 [S]
    └─ called by integrant.core/build  src/integrant/core.cljc:446 [S] d2  fan-in 4
  3. integrant.core/find-derived-refs  src/integrant/core.cljc:178 [S]
    └─ called by integrant.core/dependency-graph  src/integrant/core.cljc:192 [S] d2  fan-in 6
  5. integrant.core/missing-refs  src/integrant/core.cljc:328 [S]
  6. integrant.core-test/ref-test  test/integrant/core_test.cljc:80 [S]
deeper (25 S25)
  1. integrant.core/init  src/integrant/core.cljc:658 [S] d3  fan-in 8
  [... trimmed ...]
```

### signature_impact

Arities, destructured keys and what each caller passes. Question: how is `integrant.core/init` called?

```
SIGNATURE_IMPACT integrant.core/init — 38 caller(s) in 1 component(s); arities 1, 2; no finding
counts: arities=2 [S2]  callers=38 [S38]
findings: none (searched: arity mismatches, destructured keys no caller passes, passed keys the function never reads)
arities (2 S2)
  1. [config]  src/integrant/core.cljc:650 [S]  (27 caller(s); passes a map parameter on)
  2. [config keys]  src/integrant/core.cljc:650 [S]  (11 caller(s); passes a map parameter on)
callers (38 S38)
  1. integrant.core/init: arity 2, arg0 symbol config (keys unknown)  src/integrant/core.cljc:655 [S]  fan-in 8
  2. integrant.core-test/fold-test: arity 1, arg0 symbol config (keys unknown)  test/integrant/core_test.cljc:649 [S]
  [... trimmed ...]
```

In diff mode (`base_graph`, or `added_keys` / `removed_keys` / `arities`) it lists the callers a signature change
affects.

### route_authz

Handler, middleware chain and permission check of a backend route. Question: what serves `GET /user/list` in
usermanager?

```
ROUTE_AUTHZ GET /user/list — not provable: route authz not in this graph
counts: route=1 [S1]  handler=1 [H1]
note: capability route_authz is absent: an empty answer is not proof of absence
GET /user/list @usermanager.main/my-handler (base usermanager.main/my-handler): handler (1)
  1. usermanager.controllers.user/get-users  src/usermanager/main.clj:132 [H]  entry: route GET /user/list @usermanager.main/my-handler, heuristic match
GET /user/list @usermanager.main/my-handler (base usermanager.main/my-handler): middleware (outermost first): none (searched: guarded_by edges)
GET /user/list @usermanager.main/my-handler (base usermanager.main/my-handler): permissions: none (searched: requires_permission edges)
[... trimmed ...]
```

The handler is found, but only as a heuristic match. The permission verdict is "not provable", because this
project declares no authorization model in `.clojure-atlas.edn`.

### permission_routes

Every route that checks a permission. Question: which routes in mount require `:admin`?

```
PERMISSION_ROUTES :admin — no permission matches ":admin"
note: capability route_authz is absent: an empty answer is not proof of absence
note: use the exact permission name, with its namespace if it has one
searched: names, ids and kind-prefixed ids; check the spelling or pass the fully qualified name
```

### attribute_usage

Proven readers and writers of a Datomic, datascript or XTDB attribute. Question: who writes `:order/bid` in mount's
example app?

```
ATTRIBUTE_USAGE :order/bid — 2 proven writer(s), 0 uncertain; 0 proven reader(s), 0 uncertain
counts: writers=2 [S2]
note: data_attributes: switched on by datascript, datomic
definition (1)
  1. :order/bid  dev/clj/app/db.clj:33 [S]
writers (2 S2)
  1. app.nyse/add-order  dev/clj/app/nyse.clj:8 [S]
  2. tapp.example/add-order  test/clj/tapp/example.clj:51 [S]
readers: none (searched: proven read edges and unproven references)
next: tests_for(symbol=":order/bid")  blast_radius(var="app.nyse/add-order")
```

### event_flow

Dispatchers and handler of a re-frame event, or handler, inputs and subscribers of a subscription. Question: who
dispatches `:delete-todo` in re-frame's todomvc?

```
EVENT_FLOW :delete-todo — :delete-todo: dispatched from 2 site(s), 1 handler(s), fires 0 event(s) and 0 request(s)
counts: dispatched by=2 [S2]  handler=1 [S1]
note: events: switched on by re-frame.core
event :delete-todo: dispatched by (2 S2)
  examples/todomvc: 2
    1. todomvc.views/todo-item  examples/todomvc/src/todomvc/views.cljs:40 [S]
    2. todomvc.views/todo-item  examples/todomvc/src/todomvc/views.cljs:47 [S]
event :delete-todo: handler (1)
  1. :delete-todo event handler  examples/todomvc/src/todomvc/events.cljs:188 [S]  entry: event handler
event :delete-todo: handler dispatches: none (searched: dispatches edges out of the handler)
event :delete-todo: handler requests: none (searched: issues_request edges out of the handler)
next: tests_for(symbol=":delete-todo")
```

### tests_for

Unit tests that reach a definition, directly or up to depth 3. Question: which tests exercise
`usermanager.model.user-manager/get-user-by-id`?

```
TESTS_FOR usermanager.model.user-manager/get-user-by-id — 2 unit test(s) (2 direct, 0 transitive) and 0 browser test(s) reach it
counts: clojure.test=2 [S2]
note: static links only: tests reaching the target through multimethods, resolve/apply or HTTP fixtures are not counted; 0 tests means no static link, not untested
note: capability browser_tests is available but not used (nothing in this codebase switches it on): an empty answer is not proof of absence
note: callers continue beyond depth 3; tests further out are not listed
note: run in (no component): usermanager.model.user-manager-test
clojure.test (2 S2)
  1. usermanager.model.user-manager-test/save-test  test/usermanager/model/user_manager_test.clj:49 [S]
  2. usermanager.model.user-manager-test/user-test  test/usermanager/model/user_manager_test.clj:38 [S]
browser tests: none (searched: selectors rendered and routes handled along the same callers)
next: blast_radius(var="usermanager.model.user-manager/get-user-by-id", depth=2)
```

### tests_covering

Browser tests (Playwright page objects and tests, read with the project's own TypeScript) that reach a file,
definition, selector or route. None of the example repos has them, and the answer says so. Question: which browser
tests reach `mount.core/start`?

```
TESTS_COVERING mount.core/start — 0 browser test(s) in 0 spec file(s)
note: capability selectors is available but not used (nothing in this codebase switches it on): an empty answer is not proof of absence
note: capability browser_tests is available but not used (nothing in this codebase switches it on): an empty answer is not proof of absence
note: no browser test reaches this target through selectors, page objects or requests
tests: none (searched: selector, page-object and request edges)
```

### key_flow

Producers and consumers of one map key. Question: where is compojure's `:compojure/path` request key written and
read?

```
KEY_FLOW :compojure/path — 1 producer(s), 2 consumer(s) in 1 component(s); 0 site(s) in tests
counts: producers=1 [S1]  consumers=2 [S2]
note: key_flow: switched on by keywords in code
note: a key read or written only dynamically (held in a local, built with keyword, merged from another map) is not tracked
producers (1)
  1. compojure.middleware/assoc-path (assoc)  src/compojure/middleware.clj:20 [S]
consumers (2 S2)
  1. compojure.core/route-matches (keyword-fn)  src/compojure/core.clj:45 [S]
  2. compojure.middleware/redirect-to-canonical (keyword-fn)  src/compojure/middleware.clj:15 [S]
in tests: none
```

### key_siblings

Rows of a literal map table that lack a key most sibling rows have. Question: is a row in re-frame's
`test/re_frame/subs/alpha_test.cljs` table missing a key?

```
KEY_SIBLINGS test/re_frame/subs/alpha_test.cljs — 2 row(s) lack a key their siblings have, in 1 table(s) with 5 map rows
counts: findings=2 [H2]  tables=1 [S1]
note: key_tables: switched on by map literals in code
findings (2 H2)
  1. queries: row :re-frame/q :re-frame.subs.alpha-test/map lacks :re-frame/lifecycle  test/re_frame/subs/alpha_test.cljs:21 [H]  heuristic match  (:re-frame/lifecycle: 3 of 4 sibling rows have it; the literal row lacks the key (proven); whether it should have it is a judgement)
  2. queries: row :re-frame/query-v [:re-frame.subs.alpha-test/query-v _ _ _] lacks :re-frame/lifecycle  test/re_frame/subs/alpha_test.cljs:32 [H]  heuristic match  (:re-frame/lifecycle: 3 of 4 sibling rows have it; the literal row lacks the key (proven); whether it should have it is a judgement)
tables (1)
  1. queries  test/re_frame/subs/alpha_test.cljs:20 [S]  (5 map rows; :re-frame/q 5/5, :re-frame/lifecycle 3/5, :re-frame/query-v 1/5)
next: key_flow(key=":re-frame/lifecycle")  callers(var="re-frame.subs.alpha-test/queries")
```

The missing key is proven; whether the row should have it is left to the reader.

### context_for_change

One call per review: changed symbols, callers outside the diff, routes, attributes, tests to run and tests to add.
Question: what does a change to lines 60-80 of polylith-realworld's article store touch?

```
CONTEXT_FOR_CHANGE components/article/src/clojure/realworld/article/store.clj:60-80 — 1 file(s), 3 changed symbol(s), 0 route(s), 0 attribute(s); risk LOW
counts: changed symbols=3 [S3]  callers outside the diff=9 [S9]  tests to run=24 [S24]
risk: none (searched: routes without a check, writes to read attributes, entry points in other components)
changed symbols (3 S3)
  components/article: 3
    1. clojure.realworld.article.store/delete-article!  components/article/src/clojure/realworld/article/store.clj:71 [S]
    2. clojure.realworld.article.store/favorites-count  components/article/src/clojure/realworld/article/store.clj:58 [S]
    3. clojure.realworld.article.store/update-article!  components/article/src/clojure/realworld/article/store.clj:65 [S]
callers outside the diff (9 S9)
  components/article: 9
    1. clojure.realworld.article.core/article->visible-article  components/article/src/clojure/realworld/article/core.clj:13 [S]  fan-in 7
    2. clojure.realworld.article.core/delete-article!  components/article/src/clojure/realworld/article/core.clj:73 [S]  fan-in 4
    [... trimmed ...]
tests to run (24 S24)
  components/article: 24
    1. clojure.realworld.article.store-test/delete-article!--test  components/article/test/clojure/realworld/article/store_test.clj:152 [S]
    [... trimmed ...]
tests to add: none (searched: changed definitions with no static test)
```

Every tool also takes `base` (the commit the agent is looking at), paging (`offset`, `limit`, `section`) and
`group_by` (`component`, `file`, `none`). More transcripts are in [examples/README.md](examples/README.md).

## Bands and absence

Every row has one band:

- **STATIC_PROVEN** `[S]`: the analyzer resolved both ends (clj-kondo resolved the var, or the literal form is in
  the source).
- **HEURISTIC** `[H]`: a name match, a threaded slot or a dispatch candidate. Open the cited line before acting on
  it. Examples: a defmethod reached from its defmulti (the dispatch value picks the method at runtime), a key table
  finding.
- **UNKNOWN** `[?]`: cannot be decided statically, so it is listed as the boundary and never followed. Examples:
  `binding` and `with-redefs` rebindings, an attribute keyword whose role (read or write) is unproven, an
  `apply` or `partial` use in signature_impact.

`counts:` lines give the band totals, for example `callers=4 [S4]` or `findings=2 [H2]`.

An empty answer is never a bare empty list. It takes one of these forms:

- **none**: the thing exists and nothing relates to it. `callers: none (searched: call edges into this definition)`.
- **not found**: the codebase has no such thing. `no definition matches "integrant.core/stop"`.
- **capability off**: the graph cannot answer, because the adapter for that kind of fact found nothing to extract
  or was not configured. `capability route_authz is absent: an empty answer is not proof of absence`.

Read a miss as a statement about coverage, not as proof that something does not exist.

## Coverage

[docs/COVERAGE.md](docs/COVERAGE.md) measures 26 public repos, each pinned to a sha in
[corpus.json](corpus.json). The headline metric is named **resolution rate**: of the var usages clj-kondo
attributes to a project namespace, the share the graph links to a definition. Usages of library vars are not
counted. Symbols clj-kondo cannot attribute to any namespace are reported as a raw count, **unknown namespace**,
and kept out of the rate.

24 of 26 repos are at or above 95%. The two below:

| repo | resolved | unresolved | resolution rate | unknown namespace |
|---|---|---|---|---|
| datascript | 4392 | 496 | 89.9% | 1255 |
| day-of-datomic | 84 | 29 | 74.3% | 1 |

The doc explains them as written there:

> **unresolved**: a var created by a project macro clj-kondo does not know (datascript's record constructors), or
> a name in a REPL script with no ns form that clj-kondo files under a namespace not defining it (day-of-datomic's
> tutorials).

Six more repos are listed because their unknown-namespace count is above 5% of resolved: babashka, cider-nrepl,
fulcro, pedestal, shadow-cljs and usermanager. The table prints one decimal, so 100.0% can still hold a few
unresolved usages (metabase 111, penpot 13, xtdb-v1 3). Both kinds shrink when a repo ships a clj-kondo config for
its macros, or names them under `:lint-as` in `.clojure-atlas.edn`. The corpus is measured without adding either.

## Benchmark

[docs/BENCHMARK.md](docs/BENCHMARK.md) has 18 questions about corpus repos. Each expected answer was checked by
hand in the source, without the tool, and its file:line is in [bench/questions.json](bench/questions.json).

- **Positive questions: 12 of 12 pass.** A question passes when the answer names every expected definition and
  nothing else. Expected items found: 28 of 28; items answered: 28.
- **Absence questions: 6 of 6 pass.** The correct answer is that there is none (*none*, *not-found* or
  *capability-off*), and the answer must state that kind of absence and name nothing.

The positive questions were fixed before the first run, which scored 11 of 12. The miss (re-frame registrations
through `re-frame.alpha`) was fixed in the builder with a fixture, and the question was kept as it was.

## Requirements

- Node.js 22.18 or newer. No JVM, no babashka, no global install.
- On the first `build`, clj-kondo 2025.10.23 is downloaded once from the
  [official clj-kondo release](https://github.com/clj-kondo/clj-kondo/releases), checked against a pinned sha256,
  and cached in `$XDG_CACHE_HOME/clojure-atlas` (default `~/.cache/clojure-atlas`; `%LOCALAPPDATA%\clojure-atlas` on
  Windows). The first run prints:

  ```
  clojure-atlas: downloading clj-kondo 2025.10.23 (macos-aarch64) once, to <cache>/clojure-atlas/clj-kondo-2025.10.23-macos-aarch64/clj-kondo
  ```

- Offline, or behind a proxy: put `clj-kondo` on your PATH. Node's `fetch` ignores `HTTPS_PROXY`, so the download
  fails behind a proxy, and clojure-atlas then uses the clj-kondo on PATH. A download with a wrong sha256 is
  refused, never run.
- Platforms with a pinned clj-kondo binary: macOS arm64, macOS x64, Linux x64, Linux arm64, Windows x64. Any other
  platform needs clj-kondo on PATH. This release was developed and measured on macOS arm64. Windows is untested.

## Why TypeScript?

Because `npx` just works: no JVM to install and nothing to compile on the user's machine. The Clojure analysis
itself is done by clj-kondo; clojure-atlas reads its output and the source forms, and builds the graph. Adapter
contributions are welcome in either language: an adapter is defined by a small Clojure fixture and the graph rows
expected from it, so you can describe a library's semantics in Clojure and someone can port it, or write the
TypeScript yourself.

## Limits

- **Static only.** A var resolved at runtime (`resolve`, `requiring-resolve`, a function chosen by data) is not
  followed. A map key read or written only dynamically is not tracked. Tests that reach code through
  multimethods, `resolve`/`apply` or HTTP fixtures are not counted.
- **Heuristic parts**: multimethod and protocol dispatch (`may_dispatch_to`), some compojure handlers (shown as `heuristic match`),
  threaded key slots, query literals outside a transact or query call, middleware factory calls, key_siblings
  findings.
- **Compojure middleware applied by wrapping** (`wrap-routes`, `->` over a routes var) is not attached to the
  routes, so route_authz reports `middleware (outermost first): none` for them. Middleware chains are read from
  reitit and pedestal route data (`:middleware`, `:interceptors`).
- **Route authorization** needs `.clojure-atlas.edn`. Without it, route_authz says "not provable" and
  permission_routes reports the capability as absent.
- **Not supported yet**: bidi routes, compojure-api, pedestal verbose map routes, malli registries, integrant
  systems without refs. See [ROADMAP.md](ROADMAP.md).
- **datascript and day-of-datomic** resolve less (89.9% and 74.3%): datascript defines record constructors through
  a macro clj-kondo does not know; day-of-datomic's tutorials are REPL scripts without an ns form. See
  [Coverage](#coverage).
- **Unknown-namespace symbols** (locals bound by unknown macros, fields of deftype or proxy) are counted, not
  linked.
- **No incremental build or watch.** Rebuild after a change; the server warns with `STALE` when it can tell.
- **Windows is untested.** Proxies are not supported for the clj-kondo download.

## Contributing

```sh
npm ci
npm test                                    # all tests
npm run test:coverage                       # the gate: 98% line coverage of src/
npm run typecheck
node scripts/coverage.ts <corpus-dir>       # rebuilds docs/COVERAGE.md from clones at the corpus.json shas
node bench/score.ts <corpus-dir>            # scores the benchmark questions
```

To add or extend an adapter, start with a fixture: a small Clojure codebase under `test/fixtures/<name>/` and an
`expected.txt` with every graph row it must produce, reviewed against the source by hand. List it in
`test/build-fixtures.test.ts`, then write the adapter in `src/build/adapters/` until the rows match. See
[CONTRIBUTING.md](CONTRIBUTING.md).

## Credits

- [clj-kondo](https://github.com/clj-kondo/clj-kondo) by Michiel Borkent does the Clojure analysis.
- [Model Context Protocol](https://modelcontextprotocol.io) is how agents talk to the server.
- The corpus repos and their authors, whose public code the coverage and benchmark are measured on.

## License

MIT. See [LICENSE](LICENSE). Created by Barış Can Ateş.
