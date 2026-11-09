# Benchmark

12 questions about public corpus repos, each answered by one MCP tool on the graph
`scripts/coverage.ts` builds at the sha pinned in [corpus.json](../corpus.json). The expected answers were
verified by hand in the source, without the tool; each one's file:line is in
[bench/questions.json](../bench/questions.json). A question passes when the answer names every expected definition
and nothing else. Measured by `node bench/score.ts <corpus-dir>`; every number below comes from that run.

**12 of 12 questions pass.** Expected items found: 28 of 28; items answered: 28.

The questions were fixed before the first run, which scored 11 of 12: q07 showed that registrations and dispatches
through `re-frame.alpha` (re-frame's alpha namespace re-exporting `re-frame.core`) were not recognized. The builder
was fixed, with a fixture; the question was kept as it was.

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
