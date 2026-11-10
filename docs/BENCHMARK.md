# Benchmark

21 questions about public corpus repos, each answered by one MCP tool on the graph
`scripts/coverage.ts` builds at the sha pinned in [corpus.json](../corpus.json). The expected answers were
verified by hand in the source, without the tool; each one's file:line is in
[bench/questions.json](../bench/questions.json). Measured by `node bench/score.ts <corpus-dir>`; every number below
comes from that run, and the run refuses a graph built by another clojure-atlas version than the code it scores.

**Positive questions: 14 of 14 pass.** A question passes when the answer names every
expected definition and nothing else. Expected items found: 40 of 40; items answered: 40.

**Absence questions: 7 of 7 pass.** The correct answer is that there is none. One passes only
when the answer states that kind of absence and names nothing: *none* (the thing exists, nothing relates to it, the
answer says zero), *not-found* (the codebase has no such thing, the answer says so), *used-undefined* (the name is used but no definition was found; the answer says it is probably made by a macro),  *capability-off* (the graph
cannot answer, because the extractor for this kind of fact found nothing to extract from, and the answer says that
instead of reading as plain absence).

The positive questions were fixed before the first run, which scored 11 of 12: q07 showed that registrations and
dispatches through `re-frame.alpha` (re-frame's alpha namespace re-exporting `re-frame.core`) were not recognized.
The builder was fixed, with a fixture; the question was kept as it was.

## Positive questions

| id | repo | tool | question | expected | found | missing | extra | pass |
|---|---|---|---|---|---|---|---|---|
| q01 | integrant | callers | Which definitions call integrant.core/dependent-keys directly? | 4 | 4 | - | - | yes |
| q02 | mount | callers | Which definitions or namespaces call mount.core/stop-except? | 3 | 3 | - | - | yes |
| q03 | ring | callers | Which definitions call ring.util.request/character-encoding (not the :character-encoding request key)? | 3 | 3 | - | - | yes |
| q04 | usermanager | callers | Which definitions call the model function usermanager.model.user-manager/get-users (not the controller of the same name)? | 2 | 2 | - | - | yes |
| q05 | integrant | callers | Which definitions use integrant.core/ref? in any way, including passing it as a predicate value? | 4 | 4 | - | - | yes |
| q06 | honeysql | callers | Which definitions use honey.sql/format-columns in any way, including registering it as a clause formatter value? | 3 | 3 | - | - | yes |
| q07 | re-frame | event_flow | Who dispatches the :delete-todo event, and what named handler handles it? | 1 | 1 | - | - | yes |
| q08 | re-frame | event_flow | Who dispatches the auto-namespaced ::add-item event of the flow demo, and what named handler handles it? | 1 | 1 | - | - | yes |
| q09 | usermanager | route_authz | Which handler var does the route GET /user/list reach? | 1 | 1 | - | - | yes |
| q10 | pedestal | route_authz | Which handler var does the route GET /admin reach? | 1 | 1 | - | - | yes |
| q11 | usermanager | tests_for | Which deftests exercise usermanager.model.user-manager/get-user-by-id? | 2 | 2 | - | - | yes |
| q12 | compojure | key_flow | Which definitions produce or consume the :compojure/path request key? | 3 | 3 | - | - | yes |
| q13 | polylith-realworld | route_authz | Which middleware wraps the route POST /api/articles (compojure wrap-routes and the -> chains around it)? | 11 | 11 | - | - | yes |
| q14 | logseq | graph_nodes | Which client route path is named :settings in the frontend route table? | 1 | 1 | - | - | yes |

## Absence questions

| id | repo | tool | question | correct answer | states it | names nothing | pass |
|---|---|---|---|---|---|---|---|
| a01 | mount | callers | Which definitions call mount.core/unpound? | none | yes | yes | yes |
| a02 | integrant | callers | Which definitions call integrant.core/stop? | not-found | yes | yes | yes |
| a03 | mount | event_flow | Which handlers does the re-frame event :app/start run? | capability-off (events) | yes | yes | yes |
| a04 | mount | permission_routes | Which routes require the :admin permission? | capability-off (route_authz) | yes | yes | yes |
| a05 | usermanager | tests_for | Which tests reach usermanager.main/-main? | none | yes | yes | yes |
| a06 | usermanager | route_authz | Which handler serves the route GET /admin? | not-found | yes | yes | yes |
| a07 | next-jdbc | callers | Which definitions call next.jdbc.types/as-other? | used-undefined | yes | yes | yes |
