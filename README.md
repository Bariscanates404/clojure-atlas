# clojure-atlas

**Built for agentic coding. Give your AI agent a map of your Clojure codebase.**

Trace callers and data providers/consumers, inspect function contracts **down to the keys inside map arguments**,
follow re-frame events and routes, and identify tests affected by a change.
clojure-atlas turns **Clojure, ClojureScript and `.cljc` source** into a local code graph, then exposes it as
**13 MCP tools** with source locations and explicit confidence levels.

Built as a **companion tool for coding agents**, Atlas supplies the structural context they need before changing
code: who depends on it, which parameters and map keys its consumers expect, and which tests relate to it.

![clojure-atlas — provider to map parameter set to consumer; inspect contracts with signature_impact and key_flow](docs/assets/atlas.svg)

[![License: MIT](https://img.shields.io/badge/license-MIT-91d5b6?style=flat-square&labelColor=17252b)](LICENSE)
[![Node.js: 22.18+](https://img.shields.io/badge/Node.js-22.18%2B-91d5b6?style=flat-square&labelColor=17252b)](#requirements)
[![MCP: stdio](https://img.shields.io/badge/MCP-stdio-91d5b6?style=flat-square&labelColor=17252b)](#quick-start)
[![Required npm runtime dependencies: 0](https://img.shields.io/badge/npm_runtime_dependencies-0-91d5b6?style=flat-square&labelColor=17252b)](#local-by-design)

**Zero required npm runtime dependencies. Local analysis. For the sake of all Clojurians.**

A personal project by **Barış Can Ateş** · MIT licensed · Built on [clj-kondo](https://github.com/clj-kondo/clj-kondo).

English | [Türkçe](README.tr.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Português (Brasil)](README.pt-BR.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md)

[Capabilities](#what-you-can-do) · [Map contracts](#contracts-down-to-map-keys) · [Supported stack](#languages-and-ecosystem-support) · [Examples](#see-it-in-action) ·
[Quick start](#quick-start) · [Coverage](#coverage) · [Full guide](docs/GUIDE.md)

## What you can do

Use it when exploring an unfamiliar project, planning a refactor or reviewing a change. Your MCP client calls
the tools; Atlas returns the relationships it can establish, with `file:line` citations.

| Ask your agent… | Atlas gives it… | MCP tools |
|---|---|---|
| “Who calls this, and what could my change affect?” | Direct callers, value references and transitive dependents | `callers`, `blast_radius` |
| “What parameter set does each caller provide, and what does the function read?” | Arities, destructured map keys, defaults, keyword arguments and keys supplied at each call site | `signature_impact` |
| “Who provides this map key, and who consumes it?” | Key producers and consumers, including literal keys inside nested maps and key paths | `key_flow` |
| “Is this configuration row missing a key?” | Keys present in sibling map rows but absent from this one | `key_siblings` |
| “What handles this endpoint? Where is permission checked?” | Route handlers, ordered middleware and configured permission checks | `route_authz`, `permission_routes` |
| “What happens when this re-frame event fires?” | Dispatchers, handlers, subscriptions and HTTP requests | `event_flow` |
| “Who reads or writes this database attribute?” | Proven reads and writes, with uncertain references kept visible | `attribute_usage` |
| “Which tests relate to this change?” | Static unit-test links, Playwright links and a review context for changed files or lines | `tests_for`, `tests_covering`, `context_for_change` |
| “What does this graph actually know?” | Source commit, active adapters, evidence counts and coverage warnings | `graph_info` |

A call, a callback and a keyword with the same spelling are different things. Atlas models those distinctions,
including Clojure's registrations and data-driven connections. It gives your agent evidence to inspect before editing.

### An agent's workflow

1. **Orient:** use `graph_info` to check the snapshot, active adapters and analysis gaps.
2. **Investigate:** inspect callers, parameter contracts, map-key providers/consumers and the potential impact of a change.
3. **Plan and verify:** use `context_for_change` and the test tools to find affected code and related tests; inspect
   cited source, make the change and run the relevant tests. Rebuild the graph and restart the MCP server for the next pass.

## Contracts, down to map keys

Atlas makes the **source-visible parameter contract** inspectable: what a caller supplies, what a function
destructures or reads, and which call sites a proposed change affects.

| Level | What Atlas can show |
|---|---|
| **Parameter set** | Accepted arities, positional/rest parameters and keyword arguments such as `& {:keys [verbose]}` |
| **Keys inside a map argument** | `{:keys [email password]}`, `:or` defaults, `:as` aliases, literal keys passed by callers and supported reads in the function body |
| **Provider / consumer** | Producers such as map literals, `assoc` and `assoc-in`; consumers such as destructuring, keyword lookup, `get` and `get-in` |
| **Contract changes** | Call sites affected by added/removed keys or changed arities, using `signature_impact` with `added_keys`, `removed_keys`, `arities` or `base_graph` |
| **Nested maps** | Literal key occurrences in nested maps, destructuring and paths such as `(get-in cart [:meta :count])`, through `key_flow` |

The scope is **static key usage**, not value/type validation. `key_flow` groups occurrences by keyword, not by
the identity of a particular map. `signature_impact` records the outer key of nested destructuring or `get-in`,
not a complete nested schema. Runtime-built maps and keys may remain unknown.

## Languages and ecosystem support

**Core languages:** Clojure (`.clj`), ClojureScript (`.cljs`) and shared code (`.cljc`). EDN files contribute
supported configuration and data forms. TypeScript (`.ts`) is read only for the optional Playwright integration;
this is not a general JavaScript or TypeScript analyzer.

| Area | Recognized libraries / forms | What is covered today |
|---|---|---|
| Core Clojure | Vars, calls, value uses, callbacks, multimethods, protocols | Definitions and dependency relations; dispatch candidates are heuristic |
| Parameter and map contracts | `defn` arities, map destructuring, keyword args, map literals and key operations | Caller-supplied key sets, consumed keys, provider/consumer sites and signature-change impact |
| Frontend state | **re-frame**, including `re-frame.alpha` | Event/subscription registrations, dispatch, subscription inputs and subscribers |
| Backend routing | **Compojure**, **Reitit**, **Pedestal** table routes | Paths, mounted route copies and handlers; Pedestal service-map interceptors are not extracted |
| Middleware | **Ring**, Compojure `wrap-routes`, Reitit route data and `ring-handler` | Ordered chains, including outer wrappers; inferred chains are marked heuristic |
| Route authorization | Project-defined permission keys, middleware and functions | Requires a small `.clojure-atlas.edn` declaration |
| Browser routing | **Reitit frontend**, **Secretary** | Client-route nodes in the graph; there is no dedicated MCP tool to list them yet |
| HTTP requests | **cljs-ajax**, **cljs-http**, `js/fetch`, request effect maps | Request sites and matches to backend routes by method and path |
| Data | **Datomic**, **DataScript**, **XTDB v1 / Crux** | Attributes, transaction writes, query/pull reads and uncertain references |
| System lifecycle | **Integrant**, **Mount**, **Component** | System keys, registrations and dependency edges; Integrant config extraction relies on refs |
| Schemas | **clojure.spec / cljs.spec**, **Malli** | Registered spec schemas and Malli schemas held in vars; Malli registries are not supported |
| Tests and UI | **clojure.test / cljs.test**, **Playwright**, literal Hiccup selectors | Static test links; Playwright page objects and `.ts` tests need optional TypeScript 5 |
| Project layout | **deps.edn**, **Leiningen**, **shadow-cljs**, **Babashka**, **Boot**, **Polylith** layouts | Source discovery and grouping by module/component; build aliases and task execution are not analyzed |

Framework adapters recognize specific source forms, not every possible use of a library. `graph_info` reports
what was available and activated in **your** project. Repos such as Fulcro, Pathom, HoneySQL and next.jdbc are in
the measurement corpus, but their presence there does **not** mean dedicated framework or SQL analysis is implemented.
See the [roadmap](ROADMAP.md) for those adapters, bidi, compojure-api and other gaps.

## See it in action

These excerpts come from the [committed example graphs](examples/) of public projects. The invocation is an
MCP tool call, not a shell command. `[S]` means statically proven; `[H]` means heuristic.

### Inspect the contract inside a map argument

In polylith-realworld, `login!` takes **one map argument** and destructures **`:email` and `:password`**.
Atlas shows that key set beside the arguments supplied by its callers:

```text
signature_impact {"fn": "clojure.realworld.user.core/login!", "group_by": "none"}
```

```text
SIGNATURE_IMPACT clojure.realworld.user.core/login! — 4 caller(s) in 1 component(s); arities 1; no finding
counts: arities=1 [S1]  callers=4 [S4]
[... trimmed ...]
arities (1)
  1. [{:keys [email password]}]  components/user/src/clojure/realworld/user/core.clj:50 [S]  (4 caller(s))
callers (4 S4)
  1. clojure.realworld.user.interface/login!: arity 1, arg0 symbol login-input (keys unknown)  components/user/src/clojure/realworld/user/interface.clj:6 [S]
  2. clojure.realworld.user.core-test/login--invalid-password--return-negative-result: arity 1, arg0 {:email :password}  components/user/test/clojure/realworld/user/core_test.clj:34 [S]
[... trimmed ...]
```

The literal map's key set is visible; the map passed as `login-input` remains unknown. `[S]` on that row proves
the call relationship, not the contents of the runtime map.

<details>
<summary><strong>Change the parameter contract: what if login! also needs :tenant-id?</strong></summary>

```text
signature_impact {"fn": "clojure.realworld.user.core/login!", "added_keys": [":tenant-id"], "group_by": "none"}
```

```text
SIGNATURE_IMPACT clojure.realworld.user.core/login! — 3 caller(s) affected by the change (new keys: :tenant-id); 4 caller(s) in 1 component(s); arities 1; no finding
counts: affected=4 [S3 ?1]  arities=1 [S1]  callers=4 [S4]
[... trimmed ...]
  1. clojure.realworld.user.core-test/login--invalid-password--return-negative-result does not pass :tenant-id  components/user/test/clojure/realworld/user/core_test.clj:34 [S]  (argument 0 passes {:email :password})
[... trimmed ...]
```

All three literal-map callers omit the proposed key. The fourth caller forwards `login-input`, so its impact
is **UNKNOWN**. This is a hypothetical contract change; the tool does not modify source. “No finding” refers
to the existing signature; the `affected` section describes the proposed change.

</details>

<details>
<summary><strong>Find the providers and consumers of :email across the project</strong></summary>

```text
key_flow {"key": ":email", "group_by": "none", "limit": 2}
```

```text
KEY_FLOW :email — 9 producer(s), 5 consumer(s) in 1 component(s); 23 site(s) in tests
counts: producers=9 [S9]  consumers=5 [S5]  tests=23 [S23]
[... trimmed ...]
```

The result lists map-literal producers in `register!` and destructuring consumers including `login!`, with
source locations. Because `:email` is unqualified, every map using that keyword is grouped together; this
does not prove that a specific producer's map reaches a specific consumer.

</details>

<details>
<summary><strong>Find the callers before a refactor</strong></summary>

**Question:** Who calls `integrant.core/dependent-keys`?

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
<summary><strong>Trace a re-frame event across dispatch sites and its handler</strong></summary>

```text
event_flow {"name": ":delete-todo"}
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
[... trimmed ...]
```

The connection is through an event keyword, so callers of a named function alone would miss it.

</details>

<details>
<summary><strong>Turn changed lines into review context and related tests</strong></summary>

From polylith-realworld:

```text
context_for_change {"changes": ["components/article/src/clojure/realworld/article/store.clj:60-80"]}
```

```text
CONTEXT_FOR_CHANGE components/article/src/clojure/realworld/article/store.clj:60-80 — 1 file(s), 3 changed symbol(s), 0 route(s), 0 attribute(s); risk LOW
counts: changed symbols=3 [S3]  callers outside the diff=9 [S9]  tests to run=24 [S24]
[... trimmed ...]
```

The full answer lists the three changed definitions, nine callers outside the diff and 24 related tests,
grouped by component. `LOW` describes the checks the graph performed; it is not a safety guarantee.

</details>

[More real examples](examples/README.md) · [All tools and full transcripts](docs/GUIDE.md#tools)

## Quick start

**Prerequisites:** Node.js **22.18+** and Git. No JVM or Babashka runtime is needed.

### 1. Install and build a graph

Run from the root of the **Clojure project you want to analyze**:

```sh
# Install the reviewed source revision (Git installation builds the CLI).
npm install --save-dev \
  'git+https://github.com/Bariscanates404/clojure-atlas.git#8634d33e3ed59d420eead61a9c596f752d1fe789'

npx clojure-atlas build
```

The package is not currently published on npm; use the Git install above. Access to the repository is required
while it is private. A source install uses TypeScript and Node type definitions to compile the CLI; these are
build-time dependencies, separate from its zero required npm runtime dependencies.

The graph is saved to `.clojure-atlas/graph.json.gz`. The first build downloads and verifies the pinned
clj-kondo binary; subsequent analysis uses the cached binary. Add `.clojure-atlas/` to your project's `.gitignore`.

### 2. Connect your MCP client

For Claude Code, preview and then write the project configuration:

```sh
npx clojure-atlas init         # preview .mcp.json
npx clojure-atlas init --yes   # write it; keep existing servers
```

Enable the server in your client, then ask it to use `graph_info` and `callers` on a fully qualified `ns/name`
from your project.

<details>
<summary><strong>Configure another MCP client</strong></summary>

Atlas uses **MCP over stdio**. Configure the client to start it from your project root:

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

If the client starts servers elsewhere, use its working-directory setting or absolute paths for the installed
CLI, graph and repository. Client configuration formats may differ.

</details>

### 3. Rebuild after changes

```sh
npx clojure-atlas build       # refresh the snapshot
npx clojure-atlas coverage   # inspect resolution counts and unresolved names
```

There is no watch mode. With `--repo`, queries warn with `STALE` when the working tree no longer matches the
graph. Restart the MCP server after rebuilding so it loads the new graph.

**Already have clj-kondo configuration?** Atlas applies the project's `.clj-kondo/config.edn`, including its
macro mappings and hooks. An optional `.clojure-atlas.edn` adds custom route macros and authorization rules.
See [project configuration](docs/GUIDE.md#project-configuration) and the [authorization fixture](test/fixtures/authz/.clojure-atlas.edn).

## How to read an answer

| Marker | Meaning | How to use it |
|---|---|---|
| `[S]` — `STATIC_PROVEN` | Resolved by clj-kondo or established from a literal source form | Follow the cited source location |
| `[H]` — `HEURISTIC` | Inferred from a name, wrapper, threaded slot or dispatch candidate | Verify the relationship in source |
| `[?]` — `UNKNOWN` | Cannot be decided statically | Treat it as an analysis boundary |

**An empty result is not automatically proof of absence.** Atlas distinguishes “none found”, “definition not
found” and “capability not available”. `DEGRADED` warns about incomplete analysis; `STALE` warns about an outdated
snapshot. A test count of zero means no static link was found, not that the code is untested.

Dynamic dispatch, runtime-created symbols and project macros can limit what the graph sees. Unreadable
middleware is reported as unknown. Route permissions need explicit project configuration.
[Evidence and absence](docs/GUIDE.md#bands-and-absence) · [Known limits](docs/GUIDE.md#limits)

## Local by design

The core CLI has **no required npm runtime dependencies**. It uses Node's standard library, clj-kondo for
Clojure analysis and Git for repository metadata. It builds and queries the graph locally, with no Atlas account,
hosted index or cloud service required.

### Requirements

| Component | Role |
|---|---|
| Node.js 22.18+ | Runs the CLI and MCP server |
| clj-kondo 2025.10.23 | Native analyzer; downloaded once and cached, with a pinned archive SHA-256 |
| Git | Source installation, tracked-file checks and snapshot/staleness information |
| TypeScript 5 — optional at runtime | Playwright page-object and test analysis; install with `npm i -D typescript@5` beside Atlas |

Pinned binaries are available for macOS arm64/x64, Linux arm64/x64 and Windows x64. Development and corpus
measurements used macOS arm64; **Windows is untested**. If the download is unavailable, including behind a
proxy, Atlas can fall back to a working `clj-kondo` on `PATH`. [Platform and cache details](docs/GUIDE.md#requirements).

### Security

A small dependency surface helps, but **zero required npm dependencies does not mean zero supply-chain risk**.

- Downloaded clj-kondo archives are checked against a pinned SHA-256. A mismatched download is refused; a
  fallback executable from `PATH` is trusted separately and is not verified against that pinned archive hash.
- Atlas does not launch the analyzed application's JVM, shell scripts or Node code. **Project clj-kondo hooks
  are interpreted by clj-kondo**, so its configuration is part of the code you trust when analyzing a repository.
- The MCP server reads the graph and uses read-only Git checks. Git command hooks, filter drivers and fsmonitor
  are disabled for those checks; Git and clj-kondo subprocesses have timeouts.
- Atlas serves results locally over stdio. Your chosen AI/MCP client's handling of those results is a separate
  privacy boundary.

These are implementation properties, not a security-audit certification. [Detailed execution model](docs/GUIDE.md#security).

## Coverage

Measured on **26 public repositories**, each pinned to a commit in [corpus.json](corpus.json). The corpus includes
Babashka, Logseq, Metabase, Penpot, re-frame, Reitit and smaller libraries. The complete results are in
[docs/COVERAGE.md](docs/COVERAGE.md).

**Resolution rate measures one specific thing:** `resolved / (resolved + unresolved)` for var usages attributed
to recognized project namespaces. Library usages and **unknown-namespace usages are outside that denominator**.
It does not measure all code understood, all framework behavior extracted or runtime correctness.

| Repository | Resolved | Unresolved | Resolution rate | Unknown namespace (raw count, excluded) |
|---|---:|---:|---:|---:|
| Integrant | 442 | 0 | 100.0% | 0 |
| Babashka | 15,264 | 61 | 99.6% | 2,176 |
| Metabase | 311,181 | 111 | 100.0% | 9,522 |
| DataScript | 4,392 | 496 | 89.9% | 1,255 |
| day-of-datomic | 84 | 29 | 74.3% | 1 |

Rates are rounded to one decimal. Always read them alongside **both** unresolved and unknown-namespace counts.
Unknown names can include locals bound by unfamiliar macros as well as missed var usages; the analyzer cannot
reliably separate them.

**Metric changes are not analyzer improvements.** Earlier figures used a different denominator. Babashka's
higher reported rate largely reflects the exclusion of unknown-namespace symbols, not newly resolved code.
Comparisons across those definitions are not like-for-like; the raw counts above remain visible on purpose.

### Actual extraction improvements

These are concrete changes in what Atlas can read, separate from the resolution-rate definition:

| Improvement | Observable result | Evidence |
|---|---|---|
| Read outer Ring/Compojure middleware | polylith-realworld: **0 → 11** middleware entries for `POST /api/articles` | [Benchmark q13](docs/BENCHMARK.md#positive-questions), [fixture](test/fixtures/ring-middleware/) |
| Read frontend route tables in another namespace | Logseq: **0 → 17** client-route nodes | [Coverage](docs/COVERAGE.md), [benchmark q14](docs/BENCHMARK.md#positive-questions) |
| Recognize `re-frame.alpha` | Registrations and dispatches through the alpha namespace are extracted | [Benchmark history](docs/BENCHMARK.md), [fixture](test/fixtures/reframe/src/app/alpha.cljs) |
| Apply the project's clj-kondo config | Project macro mappings and hooks participate in analysis | [Configuration fixture](test/fixtures/project-config/), [tests](test/config.test.ts) |

### Benchmark

The recorded benchmark passes **14/14 positive questions** and **7/7 absence questions**, with expected answers
checked by hand against source. It is a small regression benchmark, not a general accuracy estimate. Thirteen
positive answers use MCP tools; the client-route question reads graph nodes directly because no tool lists
client routes yet. [Questions, results and methodology](docs/BENCHMARK.md).

## Contributing

**Let's build our Clojure X-ray tool together!**

A useful contribution can start with a tiny Clojure example: “this library connects these two things, and Atlas
should see it.” Add a fixture and the expected graph rows, or help implement its adapter. Both are welcome.

```sh
npm ci
npm test
npm run test:coverage   # 98% source line-coverage gate
npm run typecheck
```

The CLI is written in TypeScript for straightforward Node distribution; clj-kondo performs the Clojure analysis.
[Contributor guide](CONTRIBUTING.md) · [Roadmap](ROADMAP.md) · [Tool reference](docs/GUIDE.md)

## Credits and license

Created by **Barış Can Ateş**. [MIT licensed](LICENSE), including the documentation and original artwork in this
repository. Built on **[clj-kondo](https://github.com/clj-kondo/clj-kondo)** by Michiel Borkent, with
**[MCP](https://modelcontextprotocol.io)** as the interface to coding agents. Thanks to the authors of the public
projects used in the corpus and examples. Those projects and dependencies retain their own licenses.

*For the sake of all Clojurians.*
