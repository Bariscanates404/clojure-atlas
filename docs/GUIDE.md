# Usage guide and tool reference

[← Back to the overview](../README.md)

Detailed command behavior, project configuration, real MCP transcripts and analysis limits.
For installation and a first query, start with the [quick start](../README.md#quick-start).

[Commands](#commands) · [Configuration](#project-configuration) · [Tools](#tools) ·
[Evidence bands](#bands-and-absence) · [Requirements](#requirements) · [Security](#security) · [Limits](#limits)

## Commands

```
usage:
  clojure-atlas build [dir] [-o .clojure-atlas/graph.json.gz]
  clojure-atlas mcp [--graph .clojure-atlas/graph.json.gz] [--repo <clone>] [--max-distance N]
  clojure-atlas serve [--repo <clone> ...] [--graph <file>] [--port 7979] [--token-file <file>] [--max-distance N]
  clojure-atlas coverage [graph]
  clojure-atlas init [--yes]
```

- `build` analyzes `dir` (default `.`) and writes the graph.
- `mcp` serves a graph. With `--repo`, answers start with a `STALE` line when the working tree is not the one the
  graph was built from, or when the commit the agent passes as `base` is more than `--max-distance` commits
  past the graph's commit (default 20), or the graph's commit is ahead of `base` or diverged from it. The working-tree check
  is repeated at most every 3 seconds, so an edit shows from the first call after that.
- `coverage` prints the coverage row of a graph and its most frequent unresolved names.
- `serve` shares registered graphs between MCP clients over local HTTP and reloads rebuilt graphs on the
  next request. See [shared local HTTP server](#shared-local-http-server).
- `init` adds the server to the project `.mcp.json`.

Rebuild the graph after you change code. Neither transport rebuilds source automatically. Restart `mcp`
(stdio) after rebuilding; `serve` loads a changed graph before answering the next request:

```
STALE: the working tree is not the snapshot this graph describes (2 uncommitted file(s) now, 1 at build); rebuild with clojure-atlas build.
```

The project's own `.clj-kondo` config is honored. An optional `.clojure-atlas.edn` in the project root adds what
the generic adapters cannot guess: `:lint-as` for def-like macros, `:route-macros`, and the route authorization
keys `:route-authz`, `:permission-middleware` and `:permission-fns`.

## Shared local HTTP server

Use this when several agent sessions work on the same codebase. One server process owns one in-memory
snapshot of each registered graph; clients share it. The server reads existing graphs, without running
clj-kondo or starting a build. The stdio `mcp` command and `init` configuration remain available.

```sh
clojure-atlas build /absolute/path/to/project
clojure-atlas serve --repo /absolute/path/to/project
```

`serve` runs in the foreground, so it also fits a terminal, editor task or process supervisor. It binds only
to `127.0.0.1`, on port `7979` by default; `--port 0` chooses a free port and prints it. Stop with Ctrl-C or
SIGTERM. A second server on an occupied port fails instead of silently taking over.

### Connect your agents

The first start creates a random token in the user's cache directory and prints the **file path**, never the
token. Later starts reuse that file. On macOS/Linux the default is
`${XDG_CACHE_HOME:-$HOME/.cache}/clojure-atlas/http-token`; on Windows it is under `%LOCALAPPDATA%`.
`--token-file /absolute/private/path/atlas-token` chooses another file and creates it if missing.
On POSIX systems the file must have mode `600`; symbolic links are refused.

Read the file locally and supply its contents as a bearer token in your client's HTTP configuration:

```json
{
  "mcpServers": {
    "clojure-atlas": {
      "type": "http",
      "url": "http://127.0.0.1:7979/mcp",
      "headers": {
        "Authorization": "Bearer <contents of the private token file>"
      }
    }
  }
}
```

Use your client's private/user-level configuration or secret/environment substitution; do not commit the
token in a project `.mcp.json`. Client configuration formats differ. Use a stable port when configuring a
long-running server. HTTP MCP clients must support setting the Authorization header.

### Several repositories or worktrees

```sh
clojure-atlas serve --repo /work/app --repo /work/app-feature --port 7979
```

Clients select an explicitly registered repository with the `repo` query parameter:

```text
http://127.0.0.1:7979/mcp?repo=/work/app
http://127.0.0.1:7979/mcp?repo=/work/app-feature
```

URL-encode paths containing spaces, `&` or other reserved characters. Without `repo`, `/mcp` selects the graph
only when exactly one is registered. Repo paths are canonicalized, and arbitrary client-supplied paths cannot
load another graph. Each worktree should have its own graph; one branch's graph does not describe another
branch's working tree. Up to 32 repositories can be registered, with graphs loaded only on first use.
Repo paths that differ only in letter case select the same repo where the file system ignores case (macOS and
Windows defaults). A relative `base_graph` is resolved in the selected repo, as an agent working there writes
it, and must still live in that graph's directory.

Authenticated `GET /status` lists the registered paths, the last loaded source metadata, reload generation
and any most recent load error. It does not trigger loading or rebuilding. All registered repos are visible
to clients holding this server's token; this is a single-user local service, not a multi-tenant service.

### Rebuilds and pipelines

```sh
# Start once; the graph may be published later by the build job.
clojure-atlas serve --graph /data/atlas/project.json.gz --repo /work/project

# In the build job on the same machine:
clojure-atlas build /work/project -o /data/atlas/project.json.gz
```

`--graph` accepts a single custom graph file and can be combined with at most one `--repo`. Without `--repo`,
the server uses the graph's metadata and cannot check the working tree. With neither flag, it registers the
current directory's `.clojure-atlas/graph.json.gz`.

`build` writes a unique temporary file beside the destination, then renames it into place. The HTTP server
checks the file's identity, size and modification/change timestamps on each request, loads and validates a
changed file, then switches snapshots. Requests already using the old snapshot keep it. It does not rerun
analysis, reconnect clients or alter their tool list.

If another pipeline downloads a graph from elsewhere, it must also stage the **complete** file beside the
destination and rename it into place. A corrupt, incomplete or missing graph returns `503` until a valid
replacement is available; new requests are never silently answered from the old snapshot. The error is also
visible in `/status`. A source edit alone does not refresh the graph: the existing `STALE` checks still apply.

Clients can connect before the first graph exists: `initialize`, `ping`, `tools/list` and notifications never
read a graph, so sessions start normally and only tool calls return `503` until a valid graph is published.

A newly created graph file is private to your user (mode `600`); rebuilding an existing file keeps its mode.
If another user or container reads the graph, create it once and `chmod` it. A symlinked `-o` destination is
replaced by the new file instead of written through.

### Transport and access boundaries

- Uses Node's `node:http`, with **zero added npm runtime dependencies**.
- Implements stateless Streamable HTTP for MCP `2025-03-26` and `2025-06-18`, using JSON responses to POST.
  Initialization negotiates one of those versions; unsupported version headers return `400`. This release
  does not implement the `2026-07-28` protocol revision. Clients must support negotiating the earlier versions.
- No `Mcp-Session-Id`, server-push streams or legacy HTTP+SSE endpoints. GET and DELETE on `/mcp` return `405`.
  Each POST carries one JSON-RPC message; JSON-RPC batches (allowed by `2025-03-26`, removed in `2025-06-18`)
  return `400`.
- Requires the bearer token on both `/mcp` and `/status`, validates Host and Origin, and sends no CORS allow
  headers. It checks that an Origin, when supplied, names this server's own localhost port.
- Limits request bodies to 1 MiB and headers to 16 KiB, with request/header timeouts. Graph validation and
  file-size limits remain in effect. Queries and graph loading run in one Node process, so an expensive query
  or a large reload can delay other clients; this shares memory, not CPU-parallel workers.
- No remote bind option, hosted service, outbound API call or automatic source upload. What a cloud AI client
  sends to its model provider remains that client's responsibility, as with stdio.

The shared-session and graph-refresh workflow was suggested by Peter (PEZ) Strömberg, whose
[Babashka wrapper](https://github.com/PEZ/my-bbg#clojure-atlas) demonstrated the need.

## Project configuration

A var made by a project macro, and a route written with a project macro, are invisible until the macro is named.
Take a small probe project with this macro and route:

```clojure
;; src/probe/defs.clj
(ns probe.defs)

(defmacro defsetting [name value]
  `(def ~name ~value))

(defsetting timeout-ms 5000)

;; src/probe/core.clj
(ns probe.core
  (:require [probe.defs :as defs]))

(defn deadline [now]
  (+ now defs/timeout-ms))

;; src/probe/web.clj
(ns probe.web
  (:require [compojure.core :as c]))

(defmacro GET* [path args & body]
  `(c/GET ~path ~args ~@body))

(defn hello [_req]
  {:status 200 :body "hello"})

(def app
  (c/routes
    (GET* "/hello" [] hello)))
```

Without configuration, the var is used but has no definition, and the route does not exist:

```
CALLERS probe.defs/timeout-ms — no definition matches "probe.defs/timeout-ms"; used at src/probe/core.clj:5 but no definition was found
[... trimmed ...]
ROUTE_AUTHZ GET /hello — no route matches "GET /hello"
[... trimmed ...]
```

Put this `.clojure-atlas.edn` in the project root and rebuild. Both keys map a fully qualified macro to the
fully qualified form it behaves like:

```clojure
{:lint-as      {probe.defs/defsetting clojure.core/def}
 :route-macros {probe.web/GET* compojure.core/GET}}
```

```
CALLERS probe.defs/timeout-ms — 1 direct caller(s) in 1 component(s)
counts: callers and references=1 [S1]
definition (1)
  1. probe.defs/timeout-ms  src/probe/defs.clj:6 [S]
callers and references (1)
  1. probe.core/deadline  src/probe/core.clj:5 [S]
[... trimmed ...]
```

```
ROUTE_AUTHZ GET /hello — not provable: route authz not in this graph
counts: route=1 [S1]  handler=1 [S1]
[... trimmed ...]
GET /hello @probe.web/app (base probe.web/app): handler (1)
  1. probe.web/hello  src/probe/web.clj:12 [S]  entry: route GET /hello @probe.web/app
[... trimmed ...]
```

(The first answer is `callers` with `include_references: true`, since `timeout-ms` is a value, not a function.)
`:lint-as` can live in the project's `.clj-kondo/config.edn` instead, in clj-kondo's own format, with the same
result; `:route-macros` exists only in `.clojure-atlas.edn`:

```clojure
{:lint-as {probe.defs/defsetting clojure.core/def}}
```

## Tools

Every example below is real output of `clojure-atlas mcp` over a graph in [examples/](../examples/), trimmed only
where marked. mount defines four namespaces in more than one file, so its answers start with a `DEGRADED` line
(see the next section). `[S]`, `[H]` and `[?]` are the bands, explained in the next section.

### graph_info

Which commit the graph describes, what each adapter found, with band counts. Question: what does the integrant
graph know?

```
graph integrant @ master sha bcad6bcf35b62d3a32a453dc26b6d3a4d659dc01 built 2026-11-10T04:47:34.989Z: 296 nodes, 1481 edges
snapshot c90296dac61d6d6d: 0 uncommitted file(s), analyzer clojure-atlas 0.1.0, clj-kondo v2025.10.23
config c77762fd2fd2 from .clj-kondo/config.edn
  definitions: available, 854 edges {"static_proven":854}
  multimethods: available, 52 edges {"static_proven":26,"heuristic":26} (switched on by defmethod)
  events: available, 0 edges {} (not used: nothing in this codebase switches it on)
  system: available, 69 edges {"static_proven":69} (switched on by integrant)
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
dispatch candidates and rebindings. A var named inside a syntax-quoted macro body (compojure's `defroutes` naming
`routes`) is a HEURISTIC reference, not a call.

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
findings: none (searched: arity mismatches, required destructured keys no caller passes, passed keys that look like a misspelling of a key the function reads)
arities (2 S2)
  1. [config]  src/integrant/core.cljc:650 [S]  (27 caller(s))
  2. [config keys]  src/integrant/core.cljc:650 [S]  (11 caller(s))
callers (38 S38)
  1. integrant.core/init: arity 2, arg0 symbol config (keys unknown)  src/integrant/core.cljc:655 [S]  fan-in 8
  2. integrant.core-test/fold-test: arity 1, arg0 symbol config (keys unknown)  test/integrant/core_test.cljc:649 [S]
  [... trimmed ...]
```

In diff mode (`base_graph`, or `added_keys` / `removed_keys` / `arities`) it lists the callers a signature change
affects.

This includes the keys **inside map arguments**: the callee's destructured key set, defaults and supported body
reads, beside each caller's known literal-map keys. See the [parameter-set example](../README.md#provider--parameter-set--consumer)
for a call that passes a key the function never reads, and a hypothetical added key. What is described is static
parameter and key usage, not value types or a schema.

How the answer treats a map parameter, which in Clojure is open:

- **Required key**: destructured, with no `:or` default, and the body neither tests it nor falls back from it. Only a
  required key no caller passes is a `never-passed` finding, and only a new required key makes a caller "affected"
  when two graphs are compared.
- **Optional key**: it has an `:or` default, or the body reads it with a default (`(get m :k d)`, `(:k m d)`), asks
  for it (`(contains? m :k)`), or uses it only where a value is tested or fallen back from (`(or k d)`, `(if k ..)`,
  `(when-let [x k] ..)`, `some->`, a `cond->` test). The arity row lists them as `optional:`. This is read from the
  shape of the body, without following a name that is bound again, so it can call a key optional that is not; it
  never does the reverse.
- **Extra key**: a caller passes a key the function never reads. That breaks nothing, so it is listed under
  `extra keys`, not under findings. It becomes a HEURISTIC finding only when it looks like a slip of a key the
  function does read and that call does not pass (`:usrname` beside `:username`).
- **Reads of a plain parameter** (`[m]`): `(:k m)`, `(get m :k)`, `(get-in m [:k ..])` (outer key), `(m :k)`,
  `(contains? m :k)`, the first keyword step of `(-> m :k ..)`, and a `let` that destructures it, its `:as` alias
  followed. A truthiness test is neither a read nor a hand-on. Any other use (passed to a function, returned, used
  inside a step of a threading form) makes the reads incomplete; the answer then says the keys the parameter never
  reads are not provable instead of listing extra keys.
- **Forms other than defn**: `schema.core/defn` is read with its `:- Schema` annotations skipped. A macro the
  project's clj-kondo config lints as `defn` is read as one, and its findings are HEURISTIC, because the macro may
  add or drop parameters when it expands. A signature is recorded only when clj-kondo counts the same parameters:
  a `.cljc` function whose parameter vector differs per platform through a reader conditional has none.

Nested destructuring and `get-in` contribute their **outer key** to the signature; `key_flow` lists literal key
occurrences deeper in maps and paths, grouped by keyword, not by map identity.

### route_authz

Handler, middleware chain and permission check of a backend route. Question: what serves `POST /api/articles` in
polylith-realworld, and which middleware wraps it?

```
ROUTE_AUTHZ POST /api/articles — not provable: route authz not in this graph
counts: route=1 [S1]  handler=1 [S1]  middleware=11 [H11]
note: capability route_authz is absent: an empty answer is not proof of absence
POST /api/articles @clojure.realworld.rest-api.api/private-routes (base clojure.realworld.rest-api.api/private-routes): handler (1)
  1. clojure.realworld.rest-api.handler/create-article  bases/rest-api/src/clojure/realworld/rest_api/api.clj:31 [S]  entry: route POST /api/articles @clojure.realworld.rest-api.api/private-routes
POST /api/articles @clojure.realworld.rest-api.api/private-routes (base clojure.realworld.rest-api.api/private-routes): middleware (outermost first) (11 H11)
  1. clojure.realworld.rest-api.middleware/wrap-cors  bases/rest-api/src/clojure/realworld/rest_api/api.clj:61 [H]  heuristic match  (#0 wrapper)
  2. ring.middleware.json/wrap-json-response  bases/rest-api/src/clojure/realworld/rest_api/api.clj:60 [H]  heuristic match  (#1 wrapper)
  [... trimmed ...]
  10. clojure.realworld.rest-api.middleware/wrap-auth-user  bases/rest-api/src/clojure/realworld/rest_api/api.clj:46 [H]  heuristic match  (#9 wrapper)
  +1 more (next page: offset=10 section="middleware")
POST /api/articles @clojure.realworld.rest-api.api/private-routes (base clojure.realworld.rest-api.api/private-routes): permissions: not extracted (route_authz is absent)
POST /api/articles @clojure.realworld.rest-api.api/private-routes (base clojure.realworld.rest-api.api/private-routes): exempt: not extracted (route_authz is absent)
next: tests_covering(target="POST /api/articles")
```

The eleventh row, on the next page, is the authorization middleware, applied with compojure's `wrap-routes`:

```
  11. clojure.realworld.rest-api.middleware/wrap-authorization  bases/rest-api/src/clojure/realworld/rest_api/api.clj:45 [H]  heuristic match  (#10 wrapper)
```

When the wrapping of a route cannot be read, the section says so instead of "none" (usermanager, `GET /user/list`):

```
GET /user/list @usermanager.main/my-handler (base usermanager.main/my-handler): middleware: not extracted (UNKNOWN)
```

Middleware wrapped outside the route table is read at HEURISTIC: Ring wraps, `->`, `->>`, nested calls,
`wrap-routes`, and the outer wraps and third-argument `{:middleware [...]}` of reitit's `ring-handler`. A
permission middleware found there counts as a check. Middleware in reitit and pedestal route data
(`:middleware`, `:interceptors`) is read from the route itself. When the wrapping could not be fully read,
route_authz says `no permission check found in what could be read (...); not provable that none exists`. A route
tree that no router reaches shows its middleware as UNKNOWN; today that is every pedestal route, because the
interceptors of a pedestal service map are not read. A handler the graph cannot resolve shows as
`handler: not resolved (UNKNOWN)`. Here the permission verdict is "not provable", because this project declares
no authorization model in `.clojure-atlas.edn`.

When one router defines the same method and path more than once (reitit with `:conflicts nil`, or Compojure's
first match), which definition serves is the router's choice. route_authz then says `not provable: N definitions
share this method and path ...` and lists every permission and exemption declared across them at HEURISTIC; it
never joins two definitions' permissions into one `AND`, and never calls one definition's check the route's.

### permission_routes

Every route that checks a permission. Question: which routes in mount require `:admin`?

```
DEGRADED: 4 namespace(s) defined in more than one file (app.conf, app.example, tapp.conf, ...) share one node each, so calls into them are heuristic; an empty or missing answer may be a gap in the graph, not absence
PERMISSION_ROUTES :admin — no permission matches ":admin"
note: capability route_authz is absent: an empty answer is not proof of absence
note: use the exact permission name, with its namespace if it has one
searched: names, ids and kind-prefixed ids; check the spelling or pass the fully qualified name
```

### attribute_usage

Proven readers and writers of a Datomic, datascript or XTDB attribute. Question: who writes `:order/bid` in mount's
example app?

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

### event_flow

Dispatchers and handler of a re-frame event, or handler, inputs and subscribers of a subscription. A dispatch whose
event is not a literal keyword is listed as UNKNOWN. Question: who dispatches `:delete-todo` in re-frame's todomvc?

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

Browser tests (Playwright page objects and tests, read with TypeScript 5 when it is installed beside clojure-atlas as
the optional peer `typescript`; never the analyzed repo's copy) that reach a file, definition, selector or route. None of the example repos has them, and the answer says so. Question: which browser
tests reach `mount.core/start`?

```
DEGRADED: 4 namespace(s) defined in more than one file (app.conf, app.example, tapp.conf, ...) share one node each, so calls into them are heuristic; an empty or missing answer may be a gap in the graph, not absence
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
When a changed route has no extracted authorization, the risk is UNKNOWN, not LOW. A path that is not in the
graph reads `no such file in the graph` and every section `not checked`; a malformed entry is rejected. Question: what does a change to lines 60-80 of polylith-realworld's article store touch?

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

Every query tool also takes `base` (the commit the agent is looking at), paging (`offset`, `limit`, `section`) and
`group_by` (`component`, `file`, `none`). More transcripts are in [examples/README.md](../examples/README.md).

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
  or was not configured. `capability route_authz is absent: an empty answer is not proof of absence`. A section
  that depends on it reads `not extracted (route_authz is absent)`, never "none". A middleware chain that cannot be
  read reads `not extracted (UNKNOWN)`.

When the graph itself is incomplete, the build log, graph_info and every answer start with a `DEGRADED` line. It
names files clj-kondo could not parse at all, files with syntax errors it recovered from (some forms may be
missing), tracked files that were not read and why (a hidden or build folder, a symlink, a deleted file), files
over 2 MB that were skipped (for an `.edn` file, its data, keys and config are missing), namespaces defined in more than
one file (usages of them are HEURISTIC, via `duplicate-namespace`), and edges dropped because one end was not a
node. A not-found name that probably lives in such a file names it. From shadow-cljs, where one file cannot be
parsed:

```
DEGRADED: 1 file(s) could not be parsed (src/dev/demo/test_fail.cljs), so their definitions and calls are missing; 2 file(s) have syntax errors but were analyzed (src/dev/demo/errors.cljs, src/main/shadow/cljs/devtools/config.clj); some forms in them may be missing; 1 namespace(s) defined in more than one file (demo.http) share one node each, so calls into them are heuristic; an empty or missing answer may be a gap in the graph, not absence
CALLERS demo.test-fail/a-failing-test — no definition matches "demo.test-fail/a-failing-test"
note: demo.test-fail/a-failing-test probably lives in src/dev/demo/test_fail.cljs, which could not be parsed: its definitions are not in the graph, so this is not a spelling problem
note: use a fully qualified name (ns/name)
```

From biff, whose file has syntax errors but was analyzed: the answer points first to a form clj-kondo could not
read in that file, then to a macro, and keeps the spelling hint:

```
DEGRADED: 1 file(s) have syntax errors but were analyzed (libs/sqlite/src/com/biffweb/sqlite/impl/execute.clj); some forms in them may be missing; 1 namespace(s) defined in more than one file (tasks) share one node each, so calls into them are heuristic; an empty or missing answer may be a gap in the graph, not absence
CALLERS com.biffweb.sqlite.impl.execute/execute — no definition matches "com.biffweb.sqlite.impl.execute/execute"; used at libs/sqlite/src/com/biffweb/sqlite.clj:110, libs/sqlite/src/com/biffweb/sqlite.clj:121, libs/sqlite/src/com/biffweb/sqlite/impl/kv.clj:23, libs/sqlite/src/com/biffweb/sqlite/impl/kv.clj:30, libs/sqlite/src/com/biffweb/sqlite/impl/kv.clj:44 but no definition was found
note: com.biffweb.sqlite.impl.execute/execute is used at libs/sqlite/src/com/biffweb/sqlite.clj:110, libs/sqlite/src/com/biffweb/sqlite.clj:121, libs/sqlite/src/com/biffweb/sqlite/impl/kv.clj:23, libs/sqlite/src/com/biffweb/sqlite/impl/kv.clj:30, libs/sqlite/src/com/biffweb/sqlite/impl/kv.clj:44 but no definition was found: probably a form clj-kondo could not read in the file with syntax errors named below, or a macro clj-kondo cannot expand; add :lint-as for the macro in .clj-kondo/config.edn
note: com.biffweb.sqlite.impl.execute/execute may live in libs/sqlite/src/com/biffweb/sqlite/impl/execute.clj, which has syntax errors; some forms may be missing, so besides a spelling problem a form kondo could not read is possible
note: use a fully qualified name (ns/name)
```

A not-found name that probably lives in a file whose clj-kondo run timed out, or in a file git tracks but the
build did not analyze, names that file the same way.

A name that is used but defined nowhere is usually made by a macro clj-kondo cannot expand. The answer says where
it is used and what to add. From next.jdbc:

```
CALLERS next.jdbc.types/as-other — no definition matches "next.jdbc.types/as-other"; used at test/next/jdbc/sql_test.clj:290, test/next/jdbc_test.clj:559 but no definition was found
note: next.jdbc.types/as-other is used at test/next/jdbc/sql_test.clj:290, test/next/jdbc_test.clj:559 but no definition was found: probably defined by a macro clj-kondo cannot expand; add :lint-as for the macro in .clj-kondo/config.edn
note: use a fully qualified name (ns/name)
```

Read a miss as a statement about coverage, not as proof that something does not exist.

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
- Optional: TypeScript 5 (`npm i -D typescript@5` beside clojure-atlas) to read Playwright page objects and tests.
  It is an optional peer dependency. Without it, that reading is off, and graph_info and the browser test answers
  say why for each Playwright project found.
- Platforms with a pinned clj-kondo binary: macOS arm64, macOS x64, Linux x64, Linux arm64, Windows x64. Any other
  platform needs clj-kondo on PATH. This release was developed and measured on macOS arm64. Windows is untested.

## Security

The build reads files. It runs only clj-kondo (the pinned binary, or the one on PATH) and `git ls-files`, and it
never runs code of the analyzed repository with Node, a JVM or a shell. TypeScript is loaded from clojure-atlas's own
install, never from the analyzed repository. clj-kondo applies the project's `.clj-kondo` config; hooks declared
there are interpreted by clj-kondo itself, as in any editor that runs clj-kondo. The MCP server only reads the graph
file and, with `--repo`, runs read-only git commands. Every git call ignores the repository's own settings that run
commands (`core.fsmonitor`, filter drivers, hooks), never prompts, and has a timeout. Each clj-kondo run has a timeout
too: a hook that never returns costs its batch (listed under DEGRADED), not the build. Git never runs inside a
submodule (whose own config clojure-atlas cannot switch off), so a submodule's files always count as changed. Both
programs are started from an absolute path found on PATH, never from the analyzed directory, and the project's
`:output` and `:analysis` clj-kondo settings are replaced by the ones the graph needs.

## Limits

- **Static only.** A var resolved at runtime is not followed. `requiring-resolve`, `resolve` or `ns-resolve` of a
  literal symbol is a HEURISTIC reference; a symbol built at runtime, or a function chosen by data, is not, and
  callers and blast_radius say so when the project resolves vars dynamically. A map key read or written only dynamically is not tracked. Tests that reach code through
  multimethods, `resolve`/`apply` or HTTP fixtures are not counted.
- **Heuristic parts**: multimethod and protocol dispatch (`may_dispatch_to`), some compojure handlers (shown as
  `heuristic match`), compojure and Ring middleware chains, middleware factory calls, reitit frontend route tables
  in namespaces that do not require reitit (read when `reitit.frontend` is used anywhere in the project), vars
  named in syntax-quoted macro bodies, usages inside a project macro clj-kondo cannot expand (via
  `unexpanded-macro`), usages of a namespace defined in more than one file (via `duplicate-namespace`), threaded
  key slots, query literals outside a transact or query call, key_siblings findings.
- **Map keys are keyword occurrences.** `key_flow` joins every map that uses a keyword: it does not follow one map
  from the place that builds it to the place that reads it, and a key nested in another map is listed under its own
  name, not under a path. `signature_impact` records the outer key of nested destructuring and `get-in`. Keys in a
  map held in a local, built with `keyword`, merged or passed on are not visible; the answers say UNKNOWN there.
- **Map literal or binding pattern.** A `{...}` is read as a pattern in the binding vector of `let`, `loop`, `for`,
  `doseq`, `if-let`, `when-let`, `if-some`, `when-some`, `when-first`, `with-open`, `binding`, `go-loop`, `with-let`
  (also through a namespace alias), in the parameters of `fn`, `defn`, `defmethod`, `defmacro`, and wherever
  clj-kondo itself read its `:keys` as destructuring (record and reify methods, `letfn`, `for :let`, macros the
  project's config teaches it). A pattern **without `:keys`** in any other binding macro is read as a map literal:
  its `{x :k}` is not a consumer and its `:as` shows up as a produced key. A map literal inside a pull pattern or a
  schema vector is listed as a map-literal producer of its keys.
- **Project macros**: clj-kondo expands a macro only when the project's `.clj-kondo` config gives it a `:lint-as`
  or a hook (or `.clojure-atlas.edn` names it under `:lint-as`). Add one and rebuild, and the usages inside it are
  STATIC_PROVEN again. See [Project configuration](#project-configuration).
- **Middleware whose wrapping cannot be read** is reported as `middleware: not extracted (UNKNOWN)`, not as
  "none".
- **Unparsable files and files over 2 MB**: their definitions and calls are missing from the graph. Every answer
  then starts with a `DEGRADED` line naming them.
- **Pedestal service-map interceptors** are not read, so the middleware of every pedestal route is UNKNOWN.
- **Child routes passed as arguments** to a reitit route function are served where the function places the
  parameter, when it has one arity and a plain parameter (or rest parameter) takes them. Otherwise, or when the
  function binds that name again (`let`, `fn`) or the parameter never reaches its route tree, their path below the call reads `{?}`: `/api{?}/send`, never `/api/send`.
- **Route authorization** needs `.clojure-atlas.edn`. Without it, route_authz says "not provable" and
  permission_routes reports the capability as absent.
- **Not supported yet**: bidi routes, compojure-api, pedestal verbose map routes, malli registries, integrant
  systems without refs. See [ROADMAP.md](../ROADMAP.md).
- **datascript and day-of-datomic** resolve less (89.9%, 1,255 unknown-namespace usages; and 74.3%, 1 unknown-namespace usage, respectively): datascript defines record constructors through
  a macro clj-kondo does not know; day-of-datomic's tutorials are REPL scripts without an ns form. See
  [Measurements](../README.md#measurements).
- **Unknown-namespace symbols** (locals bound by unknown macros, fields of deftype or proxy) are counted, not
  linked.
- **No incremental build or watch.** Rebuild after a change; the server warns with `STALE` when it can tell.
- **Windows is untested.** Proxies are not supported for the clj-kondo download.
