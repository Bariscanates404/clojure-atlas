# Examples

Prebuilt graphs of six public repos from different stacks, each built by clojure-atlas 0.1.0 at the sha pinned in
[corpus.json](../corpus.json). Serve one without building anything:

```sh
npx clojure-atlas mcp --graph examples/re-frame.json.gz
npx clojure-atlas coverage examples/compojure.json.gz
```

| graph | repo | stack | size |
|---|---|---|---|
| [integrant.json.gz](integrant.json.gz) | [weavejester/integrant](https://github.com/weavejester/integrant) | system library, .cljc | 21 KB |
| [compojure.json.gz](compojure.json.gz) | [weavejester/compojure](https://github.com/weavejester/compojure) | ring routing library | 13 KB |
| [usermanager.json.gz](usermanager.json.gz) | [seancorfield/usermanager-example](https://github.com/seancorfield/usermanager-example) | ring + compojure + component web app | 7 KB |
| [polylith-realworld.json.gz](polylith-realworld.json.gz) | [furkan3ayraktar/clojure-polylith-realworld-example-app](https://github.com/furkan3ayraktar/clojure-polylith-realworld-example-app) | Polylith REST backend | 51 KB |
| [mount.json.gz](mount.json.gz) | [tolitius/mount](https://github.com/tolitius/mount) | mount, with Datomic/datascript example apps | 32 KB |
| [re-frame.json.gz](re-frame.json.gz) | [day8/re-frame](https://github.com/day8/re-frame) | re-frame, ClojureScript | 117 KB |

## Rebuild

One command per graph, from the directory that holds `examples/`:

```sh
git clone https://github.com/weavejester/integrant /tmp/integrant && git -C /tmp/integrant checkout bcad6bcf35b62d3a32a453dc26b6d3a4d659dc01 && npx clojure-atlas build /tmp/integrant -o examples/integrant.json.gz
git clone https://github.com/weavejester/compojure /tmp/compojure && git -C /tmp/compojure checkout 8a4758d28e8fcd28fa7610dca6e2908d039e6a4f && npx clojure-atlas build /tmp/compojure -o examples/compojure.json.gz
git clone https://github.com/seancorfield/usermanager-example /tmp/usermanager && git -C /tmp/usermanager checkout 3554bd6f4e26c9fef0dfd8835cd52c1f95bc3c48 && npx clojure-atlas build /tmp/usermanager -o examples/usermanager.json.gz
git clone https://github.com/furkan3ayraktar/clojure-polylith-realworld-example-app /tmp/polylith-realworld && git -C /tmp/polylith-realworld checkout 492e5eeaa0f0bc3a2dd4a44631287fef72055ee8 && npx clojure-atlas build /tmp/polylith-realworld -o examples/polylith-realworld.json.gz
git clone https://github.com/tolitius/mount /tmp/mount && git -C /tmp/mount checkout ae94e7d85cbf17b17789d2e42df2b39eb2bfc302 && npx clojure-atlas build /tmp/mount -o examples/mount.json.gz
git clone https://github.com/day8/re-frame /tmp/re-frame && git -C /tmp/re-frame checkout 1a1bf1df6570b17a148ebce70d500ec2da393cdc && npx clojure-atlas build /tmp/re-frame -o examples/re-frame.json.gz
```

A rebuilt graph has the same nodes and edges; only the build time stamp differs. mount defines four namespaces in
more than one file (its example apps), so calls into them are HEURISTIC and its answers start with a `DEGRADED`
line.

## Transcripts

Real server output over these graphs, trimmed where marked.

### integrant

`callers {"var": "integrant.core/dependent-keys"}`

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

Why it matters: before changing a function, the agent gets the complete list of call sites with file:line, not
grep hits that mix calls, docstrings and keywords.

`callers {"var": "integrant.core/stop"}`

```
CALLERS integrant.core/stop — no definition matches "integrant.core/stop"
note: use a fully qualified name (ns/name)
searched: names, ids and kind-prefixed ids; check the spelling or pass the fully qualified name
```

Why it matters: integrant has `halt!`, not `stop`. The agent learns the var does not exist instead of getting an
empty caller list it could read as "safe to change".

### compojure

`key_flow {"key": ":compojure/path"}`

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

Why it matters: request keys travel through maps, where no call graph sees them. Renaming or removing the key
breaks exactly these three sites, and no test touches it.

`callers {"var": "compojure.core/routes"}`

```
CALLERS compojure.core/routes — 4 direct caller(s) in 1 component(s)
counts: callers=4 [S4]
note: 3 more definition(s) reference it without calling it (value use, callback, handler, macro, dispatch, rebinding): pass include_references=true to list them
definition (1)
  1. compojure.core/routes  src/compojure/core.clj:187 [S]
callers (4 S4)
  1. compojure.core-test/route-async-test  test/compojure/core_test.clj:368 [S]
  2. compojure.core-test/route-middleware-test  test/compojure/core_test.clj:283 [S]
  3. compojure.core-test/routes-test  test/compojure/core_test.clj:150 [S]
  4. compojure.middleware-test/canonical-redirect-test  test/compojure/middleware_test.clj:11 [S]
next: blast_radius(var="compojure.core/routes", depth=2)  tests_for(symbol="compojure.core/routes")
```

With `include_references: true` the other three appear, at HEURISTIC:

```
  5. compojure.core/context  src/compojure/core.clj:318 [H]  heuristic match
  6. compojure.core/defroutes  src/compojure/core.clj:207 [H]  heuristic match
  7. compojure.core/let-routes  src/compojure/core.clj:327 [H]  heuristic match
```

Why it matters: the macros `defroutes`, `context` and `let-routes` name `routes` inside syntax-quoted code, so
they do not call it themselves; the code they expand into does. The answer keeps the four real calls apart from
the three macro references, and says where to find the rest.

### usermanager

`tests_for {"symbol": "usermanager.model.user-manager/get-user-by-id"}`

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

Why it matters: the agent runs two tests in one namespace after the change instead of the whole suite.

`tests_for {"symbol": "usermanager.main/-main"}`

```
TESTS_FOR usermanager.main/-main — 0 unit test(s) (0 direct, 0 transitive) and 0 browser test(s) reach it
note: static links only: tests reaching the target through multimethods, resolve/apply or HTTP fixtures are not counted; 0 tests means no static link, not untested
note: capability browser_tests is available but not used (nothing in this codebase switches it on): an empty answer is not proof of absence
clojure.test: none (searched: test definitions calling it up to depth 3)
browser tests: none (searched: selectors rendered and routes handled along the same callers)
next: blast_radius(var="usermanager.main/-main", depth=2)
```

Why it matters: "no static link, not untested" tells the agent what zero means, so it checks before claiming the
entry point has no tests.

### polylith-realworld

`context_for_change {"changes": ["components/article/src/clojure/realworld/article/store.clj:60-80"]}`

```
CONTEXT_FOR_CHANGE components/article/src/clojure/realworld/article/store.clj:60-80 — 1 file(s), 3 changed symbol(s), 0 route(s), 0 attribute(s); risk LOW
counts: changed symbols=3 [S3]  callers outside the diff=9 [S9]  tests to run=24 [S24]
note: callers continue beyond depth 3; tests further out are not listed
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
    3. clojure.realworld.article.core/update-article!  components/article/src/clojure/realworld/article/core.clj:63 [S]  fan-in 4
    [... trimmed ...]
tests to run (24 S24)
  components/article: 24
    1. clojure.realworld.article.store-test/delete-article!--test  components/article/test/clojure/realworld/article/store_test.clj:152 [S]
    [... trimmed ...]
tests to add: none (searched: changed definitions with no static test)
```

Why it matters: one call turns a line range into the symbols it changes, who depends on them, grouped by Polylith
component, and which tests to run.

`route_authz {"route": "DELETE /api/articles/:slug"}`

```
ROUTE_AUTHZ DELETE /api/articles/:slug — not provable: route authz not in this graph
counts: route=1 [S1]  handler=1 [S1]  middleware=11 [H11]
note: capability route_authz is absent: an empty answer is not proof of absence
DELETE /api/articles/:slug @clojure.realworld.rest-api.api/private-routes (base clojure.realworld.rest-api.api/private-routes): handler (1)
  1. clojure.realworld.rest-api.handler/delete-article  bases/rest-api/src/clojure/realworld/rest_api/api.clj:33 [S]  entry: route DELETE /api/articles/:slug @clojure.realworld.rest-api.api/private-routes
DELETE /api/articles/:slug @clojure.realworld.rest-api.api/private-routes (base clojure.realworld.rest-api.api/private-routes): middleware (outermost first) (11 H11)
  1. clojure.realworld.rest-api.middleware/wrap-cors  bases/rest-api/src/clojure/realworld/rest_api/api.clj:61 [H]  heuristic match  (#0 wrapper)
  [... trimmed ...]
  9. ring.logger.timbre/wrap-with-logger  bases/rest-api/src/clojure/realworld/rest_api/api.clj:53 [H]  heuristic match  (#8 wrapper)
  10. clojure.realworld.rest-api.middleware/wrap-auth-user  bases/rest-api/src/clojure/realworld/rest_api/api.clj:46 [H]  heuristic match  (#9 wrapper)
  +1 more (next page: offset=10 section="middleware")
DELETE /api/articles/:slug @clojure.realworld.rest-api.api/private-routes (base clojure.realworld.rest-api.api/private-routes): permissions: not extracted (route_authz is absent)
DELETE /api/articles/:slug @clojure.realworld.rest-api.api/private-routes (base clojure.realworld.rest-api.api/private-routes): exempt: not extracted (route_authz is absent)
next: tests_covering(target="DELETE /api/articles/:slug")
```

The next page (`section: "middleware", offset: 10`):

```
  11. clojure.realworld.rest-api.middleware/wrap-authorization  bases/rest-api/src/clojure/realworld/rest_api/api.clj:45 [H]  heuristic match  (#10 wrapper)
```

Why it matters: an agent changing an authenticated endpoint sees the whole chain in order, including
`wrap-auth-user` and `wrap-authorization`, which `app-routes` applies with compojure's `wrap-routes` in a separate
def. The chain is HEURISTIC, so the agent opens the cited lines before relying on it. Permissions say
"not extracted", not "none", because the project declares no authorization model.

### mount

`attribute_usage {"attr": ":order/bid"}`

```
DEGRADED: 4 namespace(s) defined in more than one file (app.conf, app.example, tapp.conf, ...) share one node each, so calls into them are heuristic; an empty or missing answer may be a gap in the graph, not absence
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

Why it matters: a schema change to a persisted attribute needs every writer; these are proven transaction sites,
not keyword matches.

`callers {"var": "mount.core/unpound"}`

```
DEGRADED: 4 namespace(s) defined in more than one file (app.conf, app.example, tapp.conf, ...) share one node each, so calls into them are heuristic; an empty or missing answer may be a gap in the graph, not absence
CALLERS mount.core/unpound — 0 direct caller(s) in 0 component(s)
note: dynamic resolution (requiring-resolve, resolve, ns-resolve) is used at 2 site(s), 1 naming a project var by a literal symbol (HEURISTIC references); a symbol built at runtime is not followed, so a caller reached that way is not listed
definition (1)
  1. mount.core/unpound  src/mount/core.cljc:43 [S]
callers: none (searched: call edges into this definition)
next: blast_radius(var="mount.core/unpound", depth=2)  tests_for(symbol="mount.core/unpound")
```

Why it matters: the definition exists and nothing calls it. That is a different answer from "not found", and the
agent can tell the two apart.

### re-frame

`event_flow {"name": ":todos"}`

```
EVENT_FLOW :todos — :todos: 1 handler(s), 1 input subscription(s), 5 subscriber(s)
counts: handler=1 [S1]  handler reads subscriptions=1 [S1]  subscribed by=5 [S5]
note: events: switched on by re-frame.core
subscription :todos: handler (1)
  1. :todos subscription handler  examples/todomvc/src/todomvc/subs.cljs:60 [S]  entry: event handler
subscription :todos: handler reads subscriptions (1)
  1. :sorted-todos  examples/todomvc/src/todomvc/subs.cljs:69 [S]
subscription :todos: subscribed by (5 S5)
  examples/todomvc: 5
    1. :all-complete? subscription handler  examples/todomvc/src/todomvc/subs.cljs:147 [S]  entry: event handler
    2. :completed-count subscription handler  examples/todomvc/src/todomvc/subs.cljs:153 [S]  entry: event handler
    3. :footer-counts subscription handler  examples/todomvc/src/todomvc/subs.cljs:159 [S]  entry: event handler
    4. :visible-todos subscription handler  examples/todomvc/src/todomvc/subs.cljs:96 [S]  entry: event handler
    5. todomvc.views/todo-app  examples/todomvc/src/todomvc/views.cljs:99 [S]
next: tests_for(symbol=":todos")
```

Why it matters: re-frame wires code together with keywords. The agent sees the subscription's input and its five
subscribers, including the `:<-` chains, before changing the shape of `:todos`.

`key_siblings {"target": "test/re_frame/subs/alpha_test.cljs"}`

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

Why it matters: in a config table, a row without a key its siblings have is a common slip. The band is HEURISTIC
on purpose: here `::map` and `::query-v` are the plain cases without a lifecycle, so the absence looks intended, and
the answer leaves that judgement to the agent.
