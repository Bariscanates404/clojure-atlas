# clojure-atlas

**Built for agentic coding: a structural map of your Clojure codebase, served to your AI agent over MCP.**

Before an agent edits Clojure, ClojureScript or `.cljc` code it should know who calls the function, which
parameter set the function takes, which map keys each caller passes and the body reads, and which routes,
re-frame events and tests are connected to it. clojure-atlas builds that map on your machine with
[clj-kondo](https://github.com/clj-kondo/clj-kondo) and answers through **13 MCP tools**. Every row cites
`file:line` and says whether it is proven, heuristic or unknown.

![clojure-atlas: provider, map parameter set, consumer; calls, events, routes and tests as a local graph behind MCP tools](docs/assets/atlas.svg)

[![CI](https://github.com/Bariscanates404/clojure-atlas/actions/workflows/ci.yml/badge.svg)](https://github.com/Bariscanates404/clojure-atlas/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-91d5b6?style=flat-square&labelColor=17252b)](LICENSE)
[![Node.js: 22.18+](https://img.shields.io/badge/Node.js-22.18%2B-91d5b6?style=flat-square&labelColor=17252b)](#requirements)
[![MCP: stdio](https://img.shields.io/badge/MCP-stdio-91d5b6?style=flat-square&labelColor=17252b)](#quick-start)
[![Required npm runtime dependencies: 0](https://img.shields.io/badge/npm_runtime_dependencies-0-91d5b6?style=flat-square&labelColor=17252b)](#local-by-design)

**Zero required npm runtime dependencies. Local analysis.**

A personal project by **Barış Can Ateş** · MIT licensed · built on clj-kondo.

[Why](#why-an-agent-should-use-it) · [Parameter sets and map keys](#provider--parameter-set--consumer) ·
[Supported stack](#languages-and-framework-support) · [Examples](#real-examples-you-can-re-run) ·
[Quick start](#quick-start) · [Evidence bands](#reading-an-answer) · [Limits](#limits) ·
[Measurements](#measurements) · [Full guide](docs/GUIDE.md)

Translations of an earlier revision of this page (this English page is the current one):
[Türkçe](README.tr.md) · [Deutsch](README.de.md) · [Español](README.es.md) · [Português (Brasil)](README.pt-BR.md) ·
[日本語](README.ja.md) · [简体中文](README.zh-CN.md)

## Why an agent should use it

A text search finds a spelling. It does not tell a call from a callback, a map key from a keyword that happens
to be spelled the same, or a handler reached through a re-frame event from one that is never registered. An
agent that edits on a guess breaks a caller it never saw. Atlas gives it the relationships, with the evidence
for each, before the edit.

| The agent asks | Atlas answers with | MCP tools |
|---|---|---|
| Who calls this, and what could my change reach? | Direct callers, value uses and callbacks, transitive dependents | `callers`, `blast_radius` |
| Which parameter set does the function take, and what does each caller pass? | Arities, destructured keys, `:or` defaults and optional keys, keyword arguments, the keys each call site passes | `signature_impact` |
| If I add, remove or require a key, which callers are affected? | Callers that do not pass a new required key, still pass a removed one, or use an arity that is gone | `signature_impact` with `added_keys`, `removed_keys`, `arities` or `base_graph` |
| Who produces this map key and who consumes it? | Producer and consumer sites of the keyword | `key_flow` |
| Is this config row missing a key its siblings have? | Rows of a literal table that lack a key most siblings carry | `key_siblings` |
| What handles this endpoint, and where is permission checked? | Handler, middleware in order, permission checks the project declares | `route_authz`, `permission_routes` |
| What happens when this re-frame event fires? | Dispatch sites, handler, subscriptions, HTTP requests | `event_flow` |
| Who reads or writes this database attribute? | Proven reads and writes; unproven references kept visible | `attribute_usage` |
| Which tests relate to this change? | Unit tests and Playwright tests linked statically, and a review context for changed lines | `tests_for`, `tests_covering`, `context_for_change` |
| What does this graph know, and what did it miss? | Source commit, active adapters, evidence counts, coverage warnings | `graph_info` |

Atlas points at the place to look. Whether it is a bug stays with you and your agent.

## Provider → parameter set → consumer

This is the level most tools stop above: not only *who calls `line-total`*, but which keys the call hands over
and which of them the function reads. The example is a fixture in this repository,
[test/fixtures/keys/src/cart/core.clj](test/fixtures/keys/src/cart/core.clj).

```text
 PROVIDER (a call site)            PARAMETER SET (the function head)     CONSUMER (the body)
 cart.core/summary, line 23        cart.core/line-total, line 8          line 9

 (line-total {:price 1             [{:keys [price qty]                   (* price qty
              :qty 2        ──►      :or   {qty 1}               ──►        (get item :discount 1))
              :coupon "x"})          :as   item}]

 passes  :price :qty :coupon       takes :price :qty (:qty optional)     reads :price :qty :discount

                 └─ :coupon is passed and never read: listed as an extra key, not as a finding
```

```text
signature_impact {"fn": "cart.core/line-total"}
```

```text
SIGNATURE_IMPACT cart.core/line-total — 2 caller(s) in 1 component(s), 1 UNKNOWN (1 via apply/partial/value); arities 1; no finding; 1 call(s) pass an extra key the function never reads (no finding: a map is open)
counts: extra=1 [S1]  arities=1 [S1]  callers=2 [S1 ?1]
note: 1 use(s) through apply, partial or as a value: their arity and keys are not provable
findings: none (searched: arity mismatches, required destructured keys no caller passes, passed keys that look like a misspelling of a key the function reads)
extra keys (1)
  1. cart.core/summary passes :coupon which line-total never reads  src/cart/core.clj:23 [S]
arities (1)
  1. [{:keys [price qty] :as item}]  src/cart/core.clj:8 [S]  (1 caller(s); optional: :qty)
callers (2 S1 ?1)
  1. cart.core/summary: arity 1, arg0 {:price :qty :coupon}  src/cart/core.clj:23 [S]
  UNKNOWN: cart.core/checkout uses line-total via map at src/cart/core.clj:16 (arity and arguments decided at runtime) — not provable; evidence at src/cart/core.clj:16
next: blast_radius(var="cart.core/line-total", depth=2)
```

A map parameter in Clojure is open, and the answer is built around that:

| Kind of key | What it means | How Atlas reports it |
|---|---|---|
| **Required** | Destructured, no `:or` default, and the body neither tests it nor falls back from it | A finding when no caller passes it; a new one makes callers "affected" |
| **Optional** | Has an `:or` default, is read with a default (`(get m :k d)`), is asked for (`(contains? m :k)`), or is used only where a value is tested or fallen back from (`(or k d)`, `(if k …)`, `(when-let [x k] …)`) | Listed as `optional:` on the arity; never a finding when it is missing |
| **Extra** | A caller passes it, the function never reads it | Listed under `extra keys`. It breaks nothing. It is a finding only when it looks like a slip of a key the function does read and that call lacks (`:usrname` beside `:username`), and then it is HEURISTIC |
| **Not provable** | The map is forwarded, held in a local, or the parameter is handed to another function | UNKNOWN, with the reason |

Ask what a change would do before making it:

```text
signature_impact {"fn": "cart.core/line-total", "added_keys": [":currency"]}
```

```text
SIGNATURE_IMPACT cart.core/line-total — 1 caller(s) affected by the change (new keys: :currency); 2 caller(s) in 1 component(s), 1 UNKNOWN (1 via apply/partial/value); arities 1; no finding; 1 call(s) pass an extra key the function never reads (no finding: a map is open)
[... trimmed ...]
affected by the change (1)
  1. cart.core/summary does not pass :currency  src/cart/core.clj:23 [S]  (argument 0 passes {:price :qty :coupon})
[... trimmed ...]
```

`added_keys` means keys the change starts to **require**. When two graphs are compared with `base_graph`, a key
the new body only reads optionally affects no caller.

And follow one key across the project:

```text
key_flow {"key": ":total"}
```

```text
KEY_FLOW :total — 2 producer(s), 1 consumer(s) in 1 component(s); 0 site(s) in tests
counts: producers=2 [S1 H1]  consumers=1 [S1]
note: key_flow: switched on by keywords in code
note: a key read or written only dynamically (held in a local, built with keyword, merged from another map) is not tracked
note: :total is unqualified: every map using that name is joined here
producers (2 S1 H1)
  1. cart.core/summary (map-literal)  src/cart/core.clj:21 [S]
  2. cart.core/checkout (assoc)  src/cart/core.clj:16 [H]  heuristic match
consumers (1)
  1. cart.core/summary (keyword-fn)  src/cart/core.clj:21 [S]
in tests: none
```

**What this level is, and is not:**

- It is static key usage read from source. It is not type checking and not schema validation; no value is
  inspected.
- `key_flow` works on **keyword occurrences**. It joins every map that uses `:total`; it does not follow one map
  from the place that builds it to the place that reads it.
- Nested maps are not path-sensitive. `{:meta {:count 1}}` produces `:meta` and `:count` as two separate keys;
  `(get-in cart [:meta :count])` consumes both. `signature_impact` records only the **outer key** of nested
  destructuring and of `get-in`.
- A map that is forwarded, merged, built with `keyword` or held in a local is UNKNOWN, and the answer says so.

## Languages and framework support

**Languages:** Clojure (`.clj`), ClojureScript (`.cljs`) and shared code (`.cljc`). EDN files contribute the
configuration and data forms listed below. TypeScript (`.ts`) is read only for the optional Playwright
integration; Atlas is not a JavaScript or TypeScript analyzer.

| Area | Recognized | What you get | Limits |
|---|---|---|---|
| Core Clojure | Vars, calls, value uses, callbacks, multimethods, protocols, records | Definitions and dependency relations | Dispatch candidates are heuristic; vars resolved at runtime are not followed |
| Parameter sets | `defn`/`defn-` arities, map destructuring, `:or`, `:as`, `& {:keys […]}`, `schema.core/defn`, macros your clj-kondo config lints as `defn` | Keys taken, optional keys, keys each call site passes, impact of a signature change | Outer key only for nested patterns; a `.cljc` function whose parameters differ per platform gets no signature; findings on a macro-defined function are heuristic |
| Map keys | Map literals, `assoc`, `assoc-in`, `update`, `hash-map`, `dissoc`, keyword lookup, `get`, `get-in`, `select-keys`, `contains?`, destructuring | Producer, consumer and remover sites per keyword; sibling-row gaps in literal tables | Keyword occurrences, not map identity; threaded slots are heuristic; a pattern without `:keys` in an unlisted binding macro is read as a literal |
| Macros | The project's `.clj-kondo/config.edn` `:lint-as` and hooks, plus `:lint-as` in `.clojure-atlas.edn` | Usages inside a macro clj-kondo is taught are proven | Usages inside a macro it is not taught are heuristic and say which macro |
| Frontend state | **re-frame**, including `re-frame.alpha` | Event and subscription registrations, dispatches, subscription inputs, subscribers | A dispatch whose event id is computed is UNKNOWN; what `reg-fx` and cofx handlers do, and `:fx` order, are not followed |
| Backend routing | **Compojure**, **Reitit**, **Pedestal** table routes | Paths, mounted route copies, handlers | bidi, compojure-api and Pedestal verbose map routes are not read |
| Middleware | **Ring**, Compojure `wrap-routes`, Reitit route data and `ring-handler` | Ordered chains, outer wrappers included | Chains are heuristic; Pedestal service-map interceptors are not read; unreadable wrapping is reported as UNKNOWN |
| Route authorization | Permission keys, middleware and functions your project declares | Which routes check which permission | Needs a small `.clojure-atlas.edn`; without it the answer is "not provable", never "none" |
| Browser routing | **Reitit frontend**, **Secretary** | Client-route nodes in the graph | No MCP tool lists them yet |
| HTTP requests | **cljs-ajax**, **cljs-http**, `js/fetch`, request effect maps | Request sites joined to backend routes by method and path | A URL assembled at runtime may not be joined |
| Data | **Datomic**, **DataScript**, **XTDB v1 / Crux** | Attributes, transaction writes, query and pull reads | Unproven references are kept as UNKNOWN rows; no SQL (next.jdbc, HoneySQL) analysis |
| System lifecycle | **Integrant**, **Mount**, **Component** | System keys, registrations, dependency edges | Integrant systems without refs are not read |
| Schemas | **clojure.spec / cljs.spec**, **Malli** | Registered specs, Malli schemas held in vars | Malli registries are not read; schemas are not checked against maps |
| Tests | **clojure.test / cljs.test**, **Playwright**, literal Hiccup selectors | Static test links | Playwright needs optional TypeScript 5; a fixture from `test.extend` without a type argument has no class, so it is not linked; tests reaching code through HTTP or `resolve` are not linked |
| Project layout | **deps.edn**, **Leiningen**, **shadow-cljs**, **Babashka**, **Boot**, **Polylith** | Source discovery, grouping by component | Build aliases and tasks are not analyzed |

An adapter recognizes specific source forms, not every use of a library. `graph_info` reports which adapters
switched on in **your** project. Fulcro, Pathom, HoneySQL and next.jdbc are in the measurement corpus, which does
not mean they have a dedicated adapter. The [roadmap](ROADMAP.md) lists what is missing.

## Real examples you can re-run

The excerpts below are real server output over the [graphs committed in `examples/`](examples/), built from public
projects at the commits pinned in [corpus.json](corpus.json). `[S]` is proven, `[H]` heuristic, `[?]` unknown.
The first line of each block is the MCP tool call your agent makes. To run one yourself without an MCP client,
from a clone of this repository:

```sh
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"signature_impact","arguments":{"fn":"clojure.realworld.user.core/login!","group_by":"none"}}}' \
  | node src/cli.ts mcp --graph examples/polylith-realworld.json.gz \
  | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).result.content[0].text'
```

The `cart` answers above come from `node src/cli.ts build test/fixtures/keys -o /tmp/cart.json.gz` and the same
pipe with `--graph /tmp/cart.json.gz`.

### The parameter set of a function, beside what its callers pass

In polylith-realworld, `login!` takes one map and destructures `:email` and `:password`:

```text
signature_impact {"fn": "clojure.realworld.user.core/login!", "group_by": "none", "limit": 3}
```

```text
SIGNATURE_IMPACT clojure.realworld.user.core/login! — 4 caller(s) in 1 component(s); arities 1; no finding
counts: arities=1 [S1]  callers=4 [S4]
findings: none (searched: arity mismatches, required destructured keys no caller passes, passed keys that look like a misspelling of a key the function reads)
arities (1)
  1. [{:keys [email password]}]  components/user/src/clojure/realworld/user/core.clj:50 [S]  (4 caller(s))
callers (4 S4)
  1. clojure.realworld.user.interface/login!: arity 1, arg0 symbol login-input (keys unknown)  components/user/src/clojure/realworld/user/interface.clj:6 [S]
  2. clojure.realworld.user.core-test/login--invalid-password--return-negative-result: arity 1, arg0 {:email :password}  components/user/test/clojure/realworld/user/core_test.clj:34 [S]
  3. clojure.realworld.user.core-test/login--user-not-found--return-negative-result: arity 1, arg0 {:email :password}  components/user/test/clojure/realworld/user/core_test.clj:27 [S]
  +1 more (next page: offset=3 section="callers")
next: blast_radius(var="clojure.realworld.user.core/login!", depth=2)
```

A literal map shows its keys. The map passed as `login-input` stays unknown: `[S]` on that row proves the call,
not the contents of a runtime map.

<details>
<summary><strong>What if <code>login!</code> starts to require <code>:tenant-id</code>?</strong></summary>

```text
signature_impact {"fn": "clojure.realworld.user.core/login!", "added_keys": [": tenant-id"], "group_by": "none", "limit": 4}
```

```text
SIGNATURE_IMPACT clojure.realworld.user.core/login! — 3 caller(s) affected by the change (new keys: :tenant-id); 4 caller(s) in 1 component(s); arities 1; no finding
counts: affected=4 [S3 ?1]  arities=1 [S1]  callers=4 [S4]
affected by the change (4 S3 ?1)
  1. clojure.realworld.user.core-test/login--invalid-password--return-negative-result does not pass :tenant-id  components/user/test/clojure/realworld/user/core_test.clj:34 [S]  (argument 0 passes {:email :password})
  2. clojure.realworld.user.core-test/login--user-not-found--return-negative-result does not pass :tenant-id  components/user/test/clojure/realworld/user/core_test.clj:27 [S]  (argument 0 passes {:email :password})
  3. clojure.realworld.user.core-test/login--valid-input--return-positive-result does not pass :tenant-id  components/user/test/clojure/realworld/user/core_test.clj:42 [S]  (argument 0 passes {:email :password})
  UNKNOWN: clojure.realworld.user.interface/login! may not pass :tenant-id at components/user/src/clojure/realworld/user/interface.clj:6 (argument 0 is not a literal map; its keys are not provable) — not provable; evidence at components/user/src/clojure/realworld/user/interface.clj:6
findings: none (searched: arity mismatches, required destructured keys no caller passes, passed keys that look like a misspelling of a key the function reads)
arities (1)
  1. [{:keys [email password]}]  components/user/src/clojure/realworld/user/core.clj:50 [S]  (4 caller(s))
callers (4 S4)
  1. clojure.realworld.user.interface/login!: arity 1, arg0 symbol login-input (keys unknown)  components/user/src/clojure/realworld/user/interface.clj:6 [S]
  2. clojure.realworld.user.core-test/login--invalid-password--return-negative-result: arity 1, arg0 {:email :password}  components/user/test/clojure/realworld/user/core_test.clj:34 [S]
  3. clojure.realworld.user.core-test/login--user-not-found--return-negative-result: arity 1, arg0 {:email :password}  components/user/test/clojure/realworld/user/core_test.clj:27 [S]
  4. clojure.realworld.user.core-test/login--valid-input--return-positive-result: arity 1, arg0 {:email :password}  components/user/test/clojure/realworld/user/core_test.clj:42 [S]
next: blast_radius(var="clojure.realworld.user.core/login!", depth=2)
```

The three callers that pass a literal map omit the new key. The fourth forwards `login-input`, so its row is
UNKNOWN. Nothing is modified; this is a question about a change you have not made yet.

</details>

<details>
<summary><strong>Producers and consumers of <code>:email</code></strong></summary>

```text
key_flow {"key": ": email", "group_by": "none", "limit": 3}
```

```text
KEY_FLOW :email — 9 producer(s), 5 consumer(s) in 1 component(s); 23 site(s) in tests
counts: producers=9 [S9]  consumers=5 [S5]  tests=23 [S23]
note: key_flow: switched on by keywords in code
note: UNKNOWN: 3 other use(s) of :email as a value or an argument — not provable as produce or consume; evidence: textual occurrences of :email
note: a key read or written only dynamically (held in a local, built with keyword, merged from another map) is not tracked
note: :email is unqualified: every map using that name is joined here
producers (9 S9)
  1. clojure.realworld.user.core/register! (map-literal)  components/user/src/clojure/realworld/user/core.clj:60 [S]  fan-in 5
  2. clojure.realworld.user.core/register! (map-literal)  components/user/src/clojure/realworld/user/core.clj:64 [S]  fan-in 5
  3. clojure.realworld.user.core/login! (map-literal)  components/user/src/clojure/realworld/user/core.clj:56 [S]  fan-in 4
  +6 more (next page: offset=3 section="producers")
consumers (5 S5)
  1. clojure.realworld.user.core/register! (destructure)  components/user/src/clojure/realworld/user/core.clj:58 [S]  fan-in 5
  2. clojure.realworld.user.core/login! (destructure)  components/user/src/clojure/realworld/user/core.clj:50 [S]  fan-in 4
  3. clojure.realworld.user.core/update-user! (destructure)  components/user/src/clojure/realworld/user/core.clj:80 [S]  fan-in 4
  +2 more (next page: offset=3 section="consumers")
in tests (23 S23)
  1. clojure.realworld.user.core-test/login--invalid-password--return-negative-result (map-literal) produces  components/user/test/clojure/realworld/user/core_test.clj:32 [S]
  2. clojure.realworld.user.core-test/login--invalid-password--return-negative-result (map-literal) produces  components/user/test/clojure/realworld/user/core_test.clj:34 [S]
  3. clojure.realworld.user.core-test/login--user-not-found--return-negative-result (map-literal) produces  components/user/test/clojure/realworld/user/core_test.clj:27 [S]
  +20 more (next page: offset=3 section="tests")
```

`:email` is unqualified, so every map that uses the keyword is grouped here. This does not prove that one
producer's map reaches one consumer.

</details>

<details>
<summary><strong>Callers before a refactor</strong></summary>

From integrant:

```text
callers {"var": "integrant.core/dependent-keys"}
```

```text
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

</details>

<details>
<summary><strong>A re-frame event: dispatch sites and handler</strong></summary>

From re-frame:

```text
event_flow {"name": ": delete-todo"}
```

```text
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

The connection runs through an event keyword, so looking for callers of a named function would miss it.

</details>

<details>
<summary><strong>The middleware in front of an endpoint, and what could not be checked</strong></summary>

From polylith-realworld:

```text
route_authz {"route": "POST /api/articles", "limit": 3}
```

```text
ROUTE_AUTHZ POST /api/articles — not provable: route authz not in this graph
counts: route=1 [S1]  handler=1 [S1]  middleware=11 [H11]
note: capability route_authz is absent: an empty answer is not proof of absence
note: POST /api/articles @clojure.realworld.rest-api.api/private-routes: 11 sibling route(s) in bases/rest-api/src/clojure/realworld/rest_api/api.clj: 0 check a permission, 0 exempt, 0 neither, 11 unknown (not provable from this graph)
POST /api/articles @clojure.realworld.rest-api.api/private-routes (base clojure.realworld.rest-api.api/private-routes): verdict not provable: route authz not in this graph (1)
  1. POST /api/articles @clojure.realworld.rest-api.api/private-routes  bases/rest-api/src/clojure/realworld/rest_api/api.clj:31 [S]
POST /api/articles @clojure.realworld.rest-api.api/private-routes (base clojure.realworld.rest-api.api/private-routes): handler (1)
  1. clojure.realworld.rest-api.handler/create-article  bases/rest-api/src/clojure/realworld/rest_api/api.clj:31 [S]  entry: route POST /api/articles @clojure.realworld.rest-api.api/private-routes
POST /api/articles @clojure.realworld.rest-api.api/private-routes (base clojure.realworld.rest-api.api/private-routes): middleware (outermost first) (11 H11)
  1. clojure.realworld.rest-api.middleware/wrap-cors  bases/rest-api/src/clojure/realworld/rest_api/api.clj:61 [H]  heuristic match  (#0 wrapper)
  2. ring.middleware.json/wrap-json-response  bases/rest-api/src/clojure/realworld/rest_api/api.clj:60 [H]  heuristic match  (#1 wrapper)
  3. clojure.realworld.rest-api.middleware/wrap-exceptions  bases/rest-api/src/clojure/realworld/rest_api/api.clj:59 [H]  heuristic match  (#2 wrapper)
  +8 more (next page: offset=3 section="middleware")
POST /api/articles @clojure.realworld.rest-api.api/private-routes (base clojure.realworld.rest-api.api/private-routes): permissions: not extracted (route_authz is absent)
POST /api/articles @clojure.realworld.rest-api.api/private-routes (base clojure.realworld.rest-api.api/private-routes): exempt: not extracted (route_authz is absent)
next: tests_covering(target="POST /api/articles")
```

The handler is proven. The wrappers are found in order and marked `[H]`, because middleware composition is
runtime code. The project declares no permission rules, so the answer is **not extracted**, not "no check".

</details>

<details>
<summary><strong>An honest miss: a name that is used and never defined</strong></summary>

From next.jdbc, where a macro generates functions clj-kondo cannot expand:

```text
callers {"var": "next.jdbc.types/as-other"}
```

```text
CALLERS next.jdbc.types/as-other — no definition matches "next.jdbc.types/as-other"; used at test/next/jdbc/sql_test.clj:290, test/next/jdbc_test.clj:559 but no definition was found
note: next.jdbc.types/as-other is used at test/next/jdbc/sql_test.clj:290, test/next/jdbc_test.clj:559 but no definition was found: probably defined by a macro clj-kondo cannot expand; add :lint-as for the macro in .clj-kondo/config.edn
note: use a fully qualified name (ns/name)
```

The answer shows where the name is used and how to make it visible. With a `:lint-as` entry for the macro the
same question returns a proven definition ([project configuration](docs/GUIDE.md#project-configuration)).
next.jdbc is in the corpus, not among the committed example graphs.

</details>

<details>
<summary><strong>Changed lines turned into review context and related tests</strong></summary>

From polylith-realworld:

```text
context_for_change {"changes": ["components/article/src/clojure/realworld/article/store.clj:60-80"], "limit": 3}
```

```text
CONTEXT_FOR_CHANGE components/article/src/clojure/realworld/article/store.clj:60-80 — 1 file(s), 3 changed symbol(s), 0 route(s), 0 attribute(s); risk LOW
counts: changed symbols=3 [S3]  callers outside the diff=9 [S9]  tests to run=24 [S24]
[... trimmed ...]
```

The full answer lists the three changed definitions, nine callers outside the diff and 24 related tests
([complete transcript](docs/GUIDE.md#context_for_change)). `LOW` describes the checks the graph could make. It is
not a safety guarantee.

</details>

[More transcripts](examples/README.md) · [Every tool with a full answer](docs/GUIDE.md#tools)

## Quick start

**Prerequisites:** Node.js **22.18+** and Git. No JVM and no Babashka.

### 1. Install and build a graph

From the root of the **Clojure project you want to analyze**:

```sh
npm install --save-dev 'git+https://github.com/Bariscanates404/clojure-atlas.git'
npx clojure-atlas build
```

The package is not on the npm registry; it installs from Git, and that install compiles the CLI. To pin the
revision you reviewed, append `#<commit-sha>` to the URL. TypeScript and the Node type definitions are needed
for that compile step only; the installed CLI has no required npm runtime dependency.

The graph is written to `.clojure-atlas/graph.json.gz`. The first build downloads the pinned clj-kondo binary
and checks its SHA-256; later builds use the cached binary. Add `.clojure-atlas/` to your `.gitignore`.

### 2. Connect your MCP client

For Claude Code, preview and then write the project configuration:

```sh
npx clojure-atlas init         # preview .mcp.json
npx clojure-atlas init --yes   # write it; existing servers are kept
```

Then ask the agent to call `graph_info`, and `callers` on a fully qualified `ns/name` from your project.

<details>
<summary><strong>Another MCP client</strong></summary>

Atlas speaks **MCP over stdio**. Start it from your project root:

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

If the client starts servers somewhere else, set its working directory or use absolute paths for the CLI, the
graph and the repository. Configuration formats differ between clients.

</details>

### 3. Rebuild after changes

```sh
npx clojure-atlas build      # refresh the snapshot
npx clojure-atlas coverage   # resolution counts and unresolved names
```

There is no watch mode. With `--repo`, answers start with `STALE` when the working tree no longer matches the
graph. Restart the MCP server after a rebuild so it loads the new graph.

**Macros and your clj-kondo config.** Atlas applies the project's `.clj-kondo/config.edn`, `:lint-as` and hooks
included. A macro linted as `defn` gets a signature; a macro clj-kondo is not taught makes the usages inside it
heuristic, and the answer names the macro. An optional `.clojure-atlas.edn` adds route macros and authorization
rules: [project configuration](docs/GUIDE.md#project-configuration),
[authorization fixture](test/fixtures/authz/.clojure-atlas.edn).

## Reading an answer

| Marker | Meaning | What to do with it |
|---|---|---|
| `[S]` `STATIC_PROVEN` | Resolved by clj-kondo, or read from a literal source form | Follow the cited `file:line` |
| `[H]` `HEURISTIC` | Inferred from a name, a wrapper, a threaded slot, a dispatch candidate, a macro Atlas cannot see through | Open the cited line before acting on it |
| `[?]` `UNKNOWN` | Cannot be decided statically | Treat it as the edge of what the graph knows |

**An empty answer is not proof of absence.** Atlas keeps "none found", "definition not found" and "capability
not in this graph" apart. `DEGRADED` warns that part of the analysis is missing; `STALE` that the snapshot is
old. Zero tests means no static link was found, not that the code is untested.
[Bands and absence in detail](docs/GUIDE.md#bands-and-absence)

## Limits

> [!WARNING]
> **What Atlas can miss. Read this before you trust an empty answer.**
>
> - **Definitions created by a macro clj-kondo is not taught.** A project `defthing`, or a library DSL that ships
>   no clj-kondo config, defines vars the graph does not contain: their callers show up as *unresolved*, and code
>   inside such a macro is only heuristic. This is why DataScript resolves 89.9% in the corpus. Teach clj-kondo the
>   macro (`:lint-as` or a hook in `.clj-kondo/config.edn`), rebuild, and they are back. The answer names the macro.
> - **Anything decided at runtime.** A var found with `resolve` from a computed symbol, a function picked out of a
>   map, the argument count behind `apply` or `partial`, a key built with `keyword`, a map that is merged or
>   forwarded. These are reported as UNKNOWN, never guessed.
> - **Dispatch.** The targets of a multimethod or protocol call are candidates, not proof.
> - **Scripts without an `ns` form** (REPL tutorials): day-of-datomic resolves 74.3%.
> - **Files clj-kondo cannot parse, and files over 2 MB.** Their definitions are missing; every answer then starts
>   with `DEGRADED` and names them.

- **Static only.** Vars resolved at runtime, functions chosen by data and keys built with `keyword` are not
  followed.
- **Map keys are keyword occurrences**, and nested maps contribute outer keys, as described
  [above](#provider--parameter-set--consumer). There is no path-sensitive data flow.
- **Optional keys are read from the shape of the body.** A name bound again inside the function is not tracked,
  so a key can be called optional that is not. The reverse does not happen.
- **Macros.** clj-kondo sees through a macro only with a `:lint-as` entry or a hook. A binding pattern without
  `:keys` inside a binding macro Atlas does not list is read as a map literal.
- **Middleware and permissions.** Chains are heuristic; route permissions need `.clojure-atlas.edn`.
- **No incremental build.** Rebuild after changes.
- **Windows is untested.**

The full list is in [the guide](docs/GUIDE.md#limits); what is planned is in the [roadmap](ROADMAP.md).

## Local by design

The core CLI has **no required npm runtime dependencies**. It uses Node's standard library, clj-kondo for the
analysis and Git for repository metadata. The graph is built and queried on your machine: no account, no hosted
index, no telemetry.

### Requirements

| Component | Role |
|---|---|
| Node.js 22.18+ | Runs the CLI and the MCP server |
| clj-kondo 2025.10.23 | Native analyzer; downloaded once and cached, archive SHA-256 pinned |
| Git | Git installation, tracked-file checks, snapshot and staleness information |
| TypeScript 5, optional | Playwright page-object and test analysis only; `npm i -D typescript@5` beside Atlas |

Pinned binaries exist for macOS arm64/x64, Linux arm64/x64 and Windows x64. Development and the corpus
measurements ran on macOS arm64. If the download is unavailable, for example behind a proxy, Atlas falls back to
a `clj-kondo` on `PATH`. [Platform and cache details](docs/GUIDE.md#requirements)

### Security

Few dependencies reduce the surface. They do **not** make a supply-chain guarantee.

- A downloaded clj-kondo archive is checked against a pinned SHA-256 and refused on a mismatch. A `clj-kondo`
  taken from `PATH` is trusted as you installed it; it is not checked against that hash.
- Atlas does not start the analyzed application's JVM, its shell scripts or its Node code. **The project's
  clj-kondo hooks are interpreted by clj-kondo**, so that configuration is code you trust when you analyze a
  repository.
- The MCP server reads the graph and runs read-only Git checks, with Git hooks, filter drivers and fsmonitor
  disabled and with timeouts.
- Results are served locally over stdio. What your AI client does with them is a separate privacy boundary.

These are properties of the implementation, not the result of a security audit.
[Execution model](docs/GUIDE.md#security)

## Measurements

Measured on **26 public repositories**, each pinned to a commit in [corpus.json](corpus.json). Full table:
[docs/COVERAGE.md](docs/COVERAGE.md).

| At a glance | |
|---|---|
| Repositories that build into a graph | **26 of 26**, no crash, 0 dropped edges |
| Size of what was read | 10,158 source files, 141,604 definitions, 1,927,681 edges |
| Var usages in project namespaces linked to their definition | **601,991 of 602,877 (99.85%)**; 886 unresolved |
| Per repository | median 100.0%; 24 of 26 at 99.3% or more; the two below are 89.9% and 74.3% |
| Symbols clj-kondo could not attribute to any namespace | **18,517**, counted and shown, not linked and not in the rate |
| Files clj-kondo could not fully parse | 24 |
| Benchmark with hand-checked answers | 14 of 14 positive questions, 7 of 7 absence questions |

These numbers say how much of the code's *static* structure reaches the graph on these projects. They are not a
promise about yours: a codebase built on macros clj-kondo is not taught will sit nearer DataScript than Metabase
until it is configured. `npx clojure-atlas coverage` prints the same counts for your project.

### Resolution rate, with the counts beside it

**Resolution rate** is `resolved / (resolved + unresolved)` for var usages clj-kondo attributes to a project
namespace. It is not the accuracy of the analysis. Library usages are outside it, and so are **unknown-namespace
usages**: symbols clj-kondo could not attribute to any namespace, which may be locals bound by a macro it does
not know or var usages the graph misses. Nothing static tells the two apart, so they are shown as a raw count
and never folded into the rate.

| Repository | Resolved | Unresolved | Resolution rate | Unknown namespace (raw, outside the rate) |
|---|---:|---:|---:|---:|
| Metabase | 311,181 | 111 | 100.0% | 9,522 |
| Penpot | 124,814 | 13 | 100.0% | 1,888 |
| Logseq | 69,041 | 0 | 100.0% | 162 |
| Babashka | 15,264 | 61 | 99.6% | 2,176 |
| XTDB v1 | 11,437 | 3 | 100.0% | 483 |
| shadow-cljs | 5,051 | 16 | 99.7% | 909 |
| Reitit | 3,654 | 0 | 100.0% | 14 |
| re-frame | 2,629 | 0 | 100.0% | 47 |
| polylith-realworld | 871 | 0 | 100.0% | 0 |
| Integrant | 442 | 0 | 100.0% | 0 |
| DataScript † | 4,392 | 496 | 89.9% | 1,255 |
| day-of-datomic † | 84 | 29 | 74.3% | 1 |
| **All 26 repos** | | | **median 100.0%; 24 of 26 at 99.3% or more** | **18,517 in total** |

† [explained in docs/COVERAGE.md](docs/COVERAGE.md#repos-under-95-resolution-rate-or-with-unknown-namespace-usages-above-5-of-resolved)

**A changed definition is not an improvement.** The first coverage report of this project divided by
`resolved + unresolved + unknown` and showed Babashka at 87.0%. Today's 99.6% uses the definition above. Almost
all of that difference is the denominator: the unknown-namespace usages left the rate, they did not become
resolved, and 2,176 of them are still in the last column. Do not compare rates across the two definitions.

### What extraction actually gained

Changes in what Atlas reads, each with a fixture or test, kept apart from the rate above.

| Change | Measured result | Evidence |
|---|---|---|
| Tell a map literal from a binding pattern | Over the 26 corpus repos: **5,475** producer sites gained (maps in a returned vector, hiccup, route data, `(d/transact conn [{…}])`); **703** keyword values no longer listed as proven "destructure" consumers; **5,268** `:keys` / `:as` / `:or` entries no longer listed as produced keys | [tests](test/keys-adapter.test.ts), fixtures [authz](test/fixtures/authz/), [data](test/fixtures/data/), [reframe](test/fixtures/reframe/) |
| Record a signature only where clj-kondo counts the same parameters | **532** functions defined through a form linted as `defn` gained a signature (216 in Metabase); **22** `.cljc` functions whose parameters differ per platform no longer get a wrong one (DataScript's `first-seq` was read as `[xs xs]`); `s/defn` annotations are no longer counted as parameters | [tests](test/signatures.test.ts) |
| Read how a plain parameter is used | Plain parameters whose reads are fully known: **3,496 → 4,184** (a `let` that destructures the parameter, `(-> m :k)`, `contains?`) | [tests](test/signatures.test.ts) |
| Read outer Ring/Compojure middleware | polylith-realworld: **0 → 11** middleware entries for `POST /api/articles` | [benchmark q13](docs/BENCHMARK.md#positive-questions), [fixture](test/fixtures/ring-middleware/) |
| Read frontend route tables in another namespace | Logseq: **0 → 17** client-route nodes | [coverage](docs/COVERAGE.md), [benchmark q14](docs/BENCHMARK.md#positive-questions) |
| Recognize `re-frame.alpha` | Registrations and dispatches through the alpha namespace are extracted | [fixture](test/fixtures/reframe/src/app/alpha.cljs) |
| Apply the project's clj-kondo config | Project `:lint-as` entries and hooks take part in the analysis | [fixture](test/fixtures/project-config/), [tests](test/config.test.ts) |
| Type Playwright fixtures without the project's `node_modules` | Tests that get page objects from `test.extend<…>` fixtures are linked to the page-object members in a checkout where `@playwright/test` is not installed; in the fixture: **0 → 12** links | [tests](test/playwright-fixtures.test.ts), [fixture](test/fixtures/browser-fixtures/) |

The first three rows compare graphs of the same pinned commits before and after the change. In that comparison no
edge of any other kind changed, and resolved, unresolved and unknown-namespace counts are identical: these are
changes in what is read about map keys and parameters, not in the resolution rate.

### Benchmark

The recorded benchmark passes **14 of 14 positive questions** (40 of 40 expected rows found) and **7 of 7
absence questions**.
It is a small regression benchmark with answers checked by hand against source, not an accuracy estimate for
your project. [Questions, results and method](docs/BENCHMARK.md)

## How Atlas is tested

An agent trusts what it is handed, so a wrong answer costs more than a missing one.

| Check | State |
|---|---|
| Automated tests | **873**, all passing (`npm test`); a fixed bug gets a test that fails without the fix |
| Source line coverage | **99.79%** (`npm run test:coverage`; the gate fails under 98%) |
| Type check | `npm run typecheck` clean |
| CI | [GitHub Actions](.github/workflows/ci.yml) runs the type check and the coverage gate on Node.js 22 and 24, on Linux, for every push to `main` and every pull request |
| Fixtures | Small Clojure codebases under [test/fixtures](test/fixtures) with every expected graph row checked by hand |
| Real repositories | 26 public projects build without a crash and with 0 dropped edges |
| Benchmark | Positive and absence questions with answers checked by hand ([docs/BENCHMARK.md](docs/BENCHMARK.md)) |
| Independent review | Reviewers who did not write the change hunt for wrong answers with runnable reproductions; each confirmed defect is fixed with a test |
| Untrusted repositories | Hostile fixtures check that Git settings, filter drivers, submodules, project TypeScript, odd file names and hanging clj-kondo hooks run nothing and hang nothing |

The absence questions matter most: they check that Atlas says "not found", "not extracted" or "degraded" where
that is the truth, instead of an empty list that reads like "none". A green suite and a benchmark are evidence
about these fixtures and these repositories. They do not guarantee a correct answer on yours; read the band on
every row.

## Contributing

**Let's build our Clojure X-ray tool together!**

A useful contribution can be a tiny Clojure example: "this library connects these two things, and Atlas should
see it." Add a fixture and the graph rows you expect, or write the adapter. Both are welcome, and so is a case
where Atlas gave you a wrong or misleading answer.

```sh
npm ci
npm test
npm run test:coverage   # 98% source line-coverage gate
npm run typecheck
```

The CLI is TypeScript so that it ships as plain Node; clj-kondo does the Clojure analysis.
[Contributor guide](CONTRIBUTING.md) · [Roadmap](ROADMAP.md) · [Tool reference](docs/GUIDE.md)

## Credits and license

Created by **Barış Can Ateş**. [MIT licensed](LICENSE), documentation and artwork included. Built on
**[clj-kondo](https://github.com/clj-kondo/clj-kondo)** by Michiel Borkent, with
**[MCP](https://modelcontextprotocol.io)** as the interface to coding agents. Thanks to the authors of the public
projects in the corpus and the examples; those projects keep their own licenses.

*For the sake of all Clojurians.*
