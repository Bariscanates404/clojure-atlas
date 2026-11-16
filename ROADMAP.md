# Roadmap

Items left out of 0.1, or planned for later. Nothing here is promised; the order says what comes first if the
project is used. Each item lands with a fixture and the coverage and benchmark tables rerun.

## Not supported yet

- bidi routes.
- compojure-api routes.
- pedestal verbose map routes (table routes are supported).
- pedestal service-map interceptors (`:io.pedestal.http/interceptors`), so pedestal routes get their middleware chain.
- malli registries (schemas held by a def are supported).
- integrant systems without refs.
- a browser test that waits for a request (`page.waitForResponse('**/api/x')`) has no edge to the request or the route.
- selectors built at runtime (`(str "item-" id)`) are not nodes.
- a test-hook class rendered outside `:class` (a custom prop, a string built with `str`, a branch of `if`) is not seen as rendered.
- Windows: a pinned clj-kondo binary exists, but the build and server have not been verified on Windows.
- A release on the npm registry with the compiled CLI. Today the install runs from Git and compiles on the user's
  machine, which fails silently where install scripts are disabled.
- Proxy support for the clj-kondo download. Today, behind a proxy, put clj-kondo on PATH.
- child routes passed to a multi-arity route function, to a destructured parameter, or spread by `apply` into a
  fixed parameter: their path below the call is shown as `{?}`; binding them needs the arity chosen by argument count.
- permission checks outside a route: a call such as `(allowed? :export)` that shows or hides a button has no edge,
  so permission_routes lists the routes that require a permission but not the code that asks for it.
- a permission that reaches the route through project code other than a helper returning the authz map or an entry
  of a constant table (a function that computes it, a table built at runtime): shown as decided at runtime.
- one session across several worktrees: a stdio server answers for one checkout, and the shared server selects the
  repo by URL, so a single session cannot switch checkout per call.
- a short form of the `DEGRADED` line: it is repeated in full on every answer (487 characters on one measured
  codebase), which is deliberate today.

## Known gaps in parameter sets and map keys

Each is stated in the answers or in [the guide](docs/GUIDE.md#limits) today; none is silently "none".

- Path-sensitive key flow: following one map from where it is built to where it is read. Today `key_flow` joins
  every map that uses a keyword, and nested maps contribute keyword occurrences and outer keys.
- Per-platform signatures for a `.cljc` function whose parameters differ through a reader conditional (no signature
  today).
- Binding patterns without `:keys` in binding macros Atlas does not list (clj-kondo's `:locals` analysis could prove
  them, at the price of a larger analysis).
- Pull patterns and schema vectors: a map literal there counts as a map-literal producer.
- The trailing map of a keyword-argument call (Clojure 1.11): shown as UNKNOWN, not checked.
- Parameter reads match `let`, `if`, `->` and friends by name, not by resolution.

## Later, in this order

1. Before/after graph diff for context_for_change.
2. Build and config graph: deps.edn aliases, shadow-cljs builds, bb.edn tasks, Integrant `#ig/ref`.
3. re-frame depth: reg-fx and cofx, `:fx` order, path interceptors.
4. next.jdbc and HoneySQL table and column reads and writes.
5. malli and spec key contracts.
6. Pathom/EQL and Fulcro.
7. Interceptor enter/leave/error order.
8. Incremental build and watch.
9. CI diff report.
10. Editor commands.

Later still: Electric, missionary, ClojureCLR, ClojureDart, jank.
