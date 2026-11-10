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
- Windows: a pinned clj-kondo binary exists, but the build and server have not been verified on Windows.
- Proxy support for the clj-kondo download. Today, behind a proxy, put clj-kondo on PATH.

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
