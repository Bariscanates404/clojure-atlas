# clojure-atlas

**For the sake of all Clojurians.**

*Für alle Clojure-Entwickler.*

[English](README.md) | [Türkçe](README.tr.md) | Deutsch | [Español](README.es.md) | [Português (Brasil)](README.pt-BR.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md)

Eine strukturelle Karte einer Clojure-, ClojureScript- oder .cljc-Codebasis, die KI-Coding-Agenten als MCP-Tools bereitgestellt wird.
Gebaut für agentische Entwicklung. MIT-lizenziert. Erstellt von Barış Can Ateş.

## Was es ist

Ein Agent, der Clojure bearbeitet, findet Beziehungen meist mit Textsuche. Die Textsuche kann einen Aufruf nicht von
einem gleichnamigen Keyword unterscheiden. Sie sieht keinen Handler, der mit `reg-event-fx` registriert wurde, keine
Route, die eine Var erreicht, und keine Funktion, die an `partial` übergeben wird. Sie kann auch nicht mit Sicherheit
sagen, dass niemand etwas aufruft. clojure-atlas lässt einmal [clj-kondo](https://github.com/clj-kondo/clj-kondo) über
das Projekt laufen, macht aus dessen Analyse einen Graphen (Definitionen, Aufrufe, Wertverwendungen, re-frame-Events,
Routen, Systemschlüssel, Datenattribute, Map-Schlüssel, Tests) und beantwortet Fragen dazu über MCP. Jede Antwortzeile
trägt ein Band, das angibt, wie sie bewiesen wurde. Jede leere Antwort nennt, was durchsucht wurde und ob der Graph es
überhaupt wissen kann.

## Schnellstart

```sh
npm i -D clojure-atlas
npx clojure-atlas build
npx clojure-atlas init
```

`build` schreibt `.clojure-atlas/graph.json.gz`. Im integrant-Repository gibt es Folgendes aus:

```
clojure-atlas: 7 files, 138 definitions, 296 nodes, 1481 edges; resolution rate of var usages in recognized project namespaces 100.0% (442 of 442), 0 usages in an unknown namespace; 0.7 s -> .clojure-atlas/graph.json.gz
```

`init` zeigt die projektspezifische `.mcp.json`, die es schreiben würde, und schreibt sie nur mit `--yes`:

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

Andere Server, die bereits in `.mcp.json` stehen, bleiben erhalten.

### Claude Code

`npx clojure-atlas init --yes` schreibt die projektspezifische `.mcp.json`, die Claude Code liest. Der Server lässt sich auch von Hand hinzufügen:

```sh
claude mcp add clojure-atlas -- npx clojure-atlas mcp --graph .clojure-atlas/graph.json.gz --repo .
```

### Jeder andere MCP-Client

Der Server spricht MCP über stdio. Die meisten Clients akzeptieren dieses JSON:

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

### Befehle

```
usage:
  clojure-atlas build [dir] [-o .clojure-atlas/graph.json.gz]
  clojure-atlas mcp [--graph .clojure-atlas/graph.json.gz] [--repo <clone>] [--max-distance N]
  clojure-atlas coverage [graph]
  clojure-atlas init [--yes]
```

- `build` analysiert `dir` (Standard `.`) und schreibt den Graphen.
- `mcp` stellt einen Graphen bereit. Mit `--repo` beginnen Antworten mit einer `STALE`-Zeile, wenn der Arbeitsbaum
  nicht der ist, aus dem der Graph gebaut wurde, oder wenn der Commit, den der Agent als `base` übergibt, mehr als
  `--max-distance` Commits hinter dem Commit des Graphen liegt (Standard 20) oder der Commit des Graphen dem `base` voraus
  ist oder von ihm abweicht. Die Arbeitsbaum-Prüfung wird höchstens alle 3 Sekunden wiederholt, eine Änderung zeigt sich
  also ab dem ersten Aufruf danach.
- `coverage` gibt die Coverage-Zeile eines Graphen und seine häufigsten ungelösten Namen aus.
- `init` trägt den Server in die `.mcp.json` des Projekts ein.

Bauen Sie den Graphen nach Codeänderungen neu. Ein bereitgestellter Graph aktualisiert sich nicht selbst:

```
STALE: the working tree is not the snapshot this graph describes (2 uncommitted file(s) now, 1 at build); rebuild with clojure-atlas build.
```

Die projekteigene `.clj-kondo`-Konfiguration wird beachtet. Eine optionale `.clojure-atlas.edn` im Projektstamm ergänzt,
was die generischen Adapter nicht erraten können: `:lint-as` für def-ähnliche Makros, `:route-macros` sowie die
Schlüssel für die Routenautorisierung `:route-authz`, `:permission-middleware` und `:permission-fns`.

## Tools

Jedes Beispiel unten ist echte Ausgabe von `clojure-atlas mcp` über einen Graphen in [examples/](examples/), nur dort
gekürzt, wo es markiert ist. mount definiert vier Namespaces in mehr als einer Datei, seine Antworten beginnen
daher mit einer `DEGRADED`-Zeile (siehe nächster Abschnitt). `[S]`, `[H]` und `[?]` sind die Bänder (bands), die im nächsten Abschnitt erklärt werden.

### graph_info

Welchen Commit der Graph beschreibt, was jeder Adapter gefunden hat, mit Band-Zählungen. Frage: Was weiß der
integrant-Graph?

```
graph integrant @ master sha bcad6bcf35b62d3a32a453dc26b6d3a4d659dc01 built 2026-11-10T02:17:12.010Z: 296 nodes, 1481 edges
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

Direkte Aufrufer einer Definition. Frage: Wer ruft `integrant.core/dependent-keys` auf?

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

Mit `include_references: true` listet es zusätzlich Wertverwendungen, Callbacks, registrierte Handler,
Makro-Expansionen, Dispatch-Kandidaten und Rebindings auf. Ein Var, der im Rumpf eines syntax-quoted Makros genannt wird
(compojures `defroutes`, das `routes` nennt), ist eine HEURISTIC-Referenz, kein Aufruf.

### blast_radius

Transitive Abhängige einer Definition. Frage: Was kann eine Änderung an `integrant.core/ref?` erreichen?

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

Arities, destrukturierte Schlüssel und was jeder Aufrufer übergibt. Frage: Wie wird `integrant.core/init` aufgerufen?

```
SIGNATURE_IMPACT integrant.core/init — 38 caller(s) in 1 component(s); arities 1, 2; no finding
counts: arities=2 [S2]  callers=38 [S38]
findings: none (searched: arity mismatches, destructured keys no caller passes, passed keys the function never reads)
arities (2 S2)
  1. [config]  src/integrant/core.cljc:650 [S]  (27 caller(s))
  2. [config keys]  src/integrant/core.cljc:650 [S]  (11 caller(s))
callers (38 S38)
  1. integrant.core/init: arity 2, arg0 symbol config (keys unknown)  src/integrant/core.cljc:655 [S]  fan-in 8
  2. integrant.core-test/fold-test: arity 1, arg0 symbol config (keys unknown)  test/integrant/core_test.cljc:649 [S]
  [... trimmed ...]
```

Im Diff-Modus (`base_graph` oder `added_keys` / `removed_keys` / `arities`) listet es die Aufrufer auf, die von einer
Signaturänderung betroffen sind.

### route_authz

Handler, Middleware-Kette und Berechtigungsprüfung einer Backend-Route. Frage: Was bedient `POST /api/articles` in
polylith-realworld, und welche Middleware umhüllt sie?

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

Die elfte Zeile, auf der nächsten Seite, ist die Autorisierungs-Middleware, angewandt mit compojures `wrap-routes`:

```
  11. clojure.realworld.rest-api.middleware/wrap-authorization  bases/rest-api/src/clojure/realworld/rest_api/api.clj:45 [H]  heuristic match  (#10 wrapper)
```

Wenn die Umhüllung einer Route nicht gelesen werden kann, sagt der Abschnitt das, statt "none" zu melden (usermanager,
`GET /user/list`):

```
GET /user/list @usermanager.main/my-handler (base usermanager.main/my-handler): middleware: not extracted (UNKNOWN)
```

Middleware, die außerhalb der Routentabelle umgehüllt wird, wird als HEURISTIC gelesen: Ring-Wraps, `->`, `->>`,
verschachtelte Aufrufe, `wrap-routes` sowie die äußeren Wraps und das `{:middleware [...]}` als drittes Argument von
reitits `ring-handler`. Eine dort gefundene Berechtigungs-Middleware zählt als Prüfung. Middleware in den Routendaten
von reitit und pedestal (`:middleware`, `:interceptors`) wird aus der Route selbst gelesen. Wenn die Umhüllung nicht
vollständig gelesen werden konnte, sagt route_authz `no permission check found in what could be read (...); not
provable that none exists`. Ein Routenbaum, den kein Router erreicht, zeigt seine Middleware als UNKNOWN; heute ist
das jede pedestal-Route, weil die Interceptors einer pedestal-Service-Map nicht gelesen werden. Ein Handler, den der
Graph nicht auflösen kann, erscheint als `handler: not resolved (UNKNOWN)`. Das Berechtigungsurteil lautet hier "not
provable" (nicht beweisbar), weil dieses Projekt in `.clojure-atlas.edn` kein Autorisierungsmodell deklariert.

### permission_routes

Jede Route, die eine Berechtigung prüft. Frage: Welche Routen in mount verlangen `:admin`?

```
DEGRADED: 4 namespace(s) defined in more than one file (app.conf, app.example, tapp.conf, ...) share one node each, so calls into them are heuristic; an empty or missing answer may be a gap in the graph, not absence
PERMISSION_ROUTES :admin — no permission matches ":admin"
note: capability route_authz is absent: an empty answer is not proof of absence
note: use the exact permission name, with its namespace if it has one
searched: names, ids and kind-prefixed ids; check the spelling or pass the fully qualified name
```

### attribute_usage

Bewiesene Leser und Schreiber eines Datomic-, datascript- oder XTDB-Attributs. Frage: Wer schreibt `:order/bid` in der
Beispielanwendung von mount?

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

Dispatcher und Handler eines re-frame-Events oder Handler, Eingaben und Subscriber einer Subscription. Ein Dispatch, dessen
Event kein literales Keyword ist, wird als UNKNOWN aufgelistet. Frage: Wer
dispatcht `:delete-todo` in todomvc von re-frame?

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

Unit-Tests, die eine Definition direkt oder bis zur Tiefe 3 erreichen. Frage: Welche Tests führen
`usermanager.model.user-manager/get-user-by-id` aus?

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

Browser-Tests (Playwright-Page-Objects und -Tests, gelesen mit TypeScript 5, wenn es neben clojure-atlas als
optionaler Peer `typescript` installiert ist, nie mit der Kopie des analysierten Repositorys), die eine Datei,
Definition, einen Selektor oder eine Route erreichen. Keines der Beispiel-Repositories hat solche Tests, und die
Antwort sagt das. Frage: Welche Browser-Tests erreichen `mount.core/start`?

```
DEGRADED: 4 namespace(s) defined in more than one file (app.conf, app.example, tapp.conf, ...) share one node each, so calls into them are heuristic; an empty or missing answer may be a gap in the graph, not absence
TESTS_COVERING mount.core/start — 0 browser test(s) in 0 spec file(s)
note: capability selectors is available but not used (nothing in this codebase switches it on): an empty answer is not proof of absence
note: capability browser_tests is available but not used (nothing in this codebase switches it on): an empty answer is not proof of absence
note: no browser test reaches this target through selectors, page objects or requests
tests: none (searched: selector, page-object and request edges)
```

### key_flow

Produzenten und Konsumenten eines Map-Schlüssels. Frage: Wo wird der Request-Schlüssel `:compojure/path` von compojure
geschrieben und gelesen?

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

Zeilen einer literalen Map-Tabelle, denen ein Schlüssel fehlt, den die meisten Geschwisterzeilen haben. Frage: Fehlt
in der Tabelle `test/re_frame/subs/alpha_test.cljs` von re-frame in einer Zeile ein Schlüssel?

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

Der fehlende Schlüssel ist bewiesen. Ob die Zeile ihn haben sollte, bleibt dem Leser überlassen.

### context_for_change

Ein Aufruf pro Review: geänderte Symbole, Aufrufer außerhalb des Diffs, Routen, Attribute, auszuführende Tests und
hinzuzufügende Tests. Hat eine geänderte Route keine extrahierte Autorisierung, ist das Risiko UNKNOWN, nicht LOW. Frage: Was berührt eine Änderung an den Zeilen 60-80 des Article-Stores von polylith-realworld?

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

Jedes Tool akzeptiert außerdem `base` (den Commit, den der Agent ansieht), Paging (`offset`, `limit`, `section`) und
`group_by` (`component`, `file`, `none`). Weitere Transkripte stehen in [examples/README.md](examples/README.md).

## Bänder und Abwesenheit

Jede Zeile hat genau ein Band:

- **STATIC_PROVEN** `[S]`: Der Analyzer hat beide Enden aufgelöst (clj-kondo hat die Var aufgelöst, oder die literale
  Form steht im Quelltext).
- **HEURISTIC** `[H]`: ein Namensabgleich, ein durchgereichter Slot oder ein Dispatch-Kandidat. Öffnen Sie die
  genannte Zeile, bevor Sie darauf handeln. Beispiele: ein defmethod, der von seinem defmulti aus erreicht wird (der
  Dispatch-Wert wählt die Methode zur Laufzeit), ein Befund einer Key-Tabelle.
- **UNKNOWN** `[?]`: statisch nicht entscheidbar, deshalb als Grenze aufgelistet und nie weiterverfolgt. Beispiele:
  Rebindings mit `binding` und `with-redefs`, ein Attribut-Keyword, dessen Rolle (Lesen oder Schreiben) unbewiesen
  ist, eine Verwendung von `apply` oder `partial` in signature_impact.

Die `counts:`-Zeilen geben die Band-Summen an, zum Beispiel `callers=4 [S4]` oder `findings=2 [H2]`.

Eine leere Antwort ist nie eine bloße leere Liste. Sie hat eine dieser Formen:

- **none**: Die Sache existiert, und nichts steht mit ihr in Beziehung. `callers: none (searched: call edges into this definition)`.
- **not found**: Die Codebasis hat so etwas nicht. `no definition matches "integrant.core/stop"`.
- **capability off**: Der Graph kann nicht antworten, weil der Adapter für diese Art von Fakten nichts zu extrahieren
  fand oder nicht konfiguriert wurde. `capability route_authz is absent: an empty answer is not proof of absence`. Ein Abschnitt, der davon abhängt, lautet
  `not extracted (route_authz is absent)`, nie "none". Eine nicht lesbare Middleware-Kette lautet
  `not extracted (UNKNOWN)`.

Ist der Graph selbst unvollständig, beginnen das Build-Log, graph_info und jede Antwort mit einer `DEGRADED`-Zeile. Sie
nennt Dateien, die clj-kondo gar nicht parsen konnte, Dateien mit Syntaxfehlern, von denen es sich erholt hat (einige
Formen können fehlen), verfolgte Dateien, die nicht gelesen wurden, samt Grund (ein versteckter oder Build-Ordner, ein
Symlink, eine gelöschte Datei), übersprungene Dateien über 2 MB (bei einer `.edn`-Datei fehlen ihre Daten, Schlüssel und
Konfiguration), Namespaces, die in mehr als einer Datei definiert sind (ihre Verwendungen sind HEURISTIC, über
`duplicate-namespace`), und Kanten, die verworfen wurden, weil ein Ende kein Knoten war. Ein nicht gefundener Name, der
wahrscheinlich in einer solchen Datei liegt, nennt sie. Aus shadow-cljs, wo eine Datei nicht geparst werden kann:

```
DEGRADED: 1 file(s) could not be parsed (src/dev/demo/test_fail.cljs), so their definitions and calls are missing; 2 file(s) have syntax errors but were analyzed (src/dev/demo/errors.cljs, src/main/shadow/cljs/devtools/config.clj); some forms in them may be missing; 1 namespace(s) defined in more than one file (demo.http) share one node each, so calls into them are heuristic; an empty or missing answer may be a gap in the graph, not absence
CALLERS demo.test-fail/a-failing-test — no definition matches "demo.test-fail/a-failing-test"
note: demo.test-fail/a-failing-test probably lives in src/dev/demo/test_fail.cljs, which could not be parsed: its definitions are not in the graph, so this is not a spelling problem
note: use a fully qualified name (ns/name)
```

Aus biff, dessen Datei Syntaxfehler hat, aber analysiert wurde: Die Antwort verweist zuerst auf eine Form, die
clj-kondo in dieser Datei nicht lesen konnte, dann auf ein Makro, und behält den Schreibweisen-Hinweis:

```
DEGRADED: 1 file(s) have syntax errors but were analyzed (libs/sqlite/src/com/biffweb/sqlite/impl/execute.clj); some forms in them may be missing; 1 namespace(s) defined in more than one file (tasks) share one node each, so calls into them are heuristic; an empty or missing answer may be a gap in the graph, not absence
CALLERS com.biffweb.sqlite.impl.execute/execute — no definition matches "com.biffweb.sqlite.impl.execute/execute"; used at libs/sqlite/src/com/biffweb/sqlite.clj:110, libs/sqlite/src/com/biffweb/sqlite.clj:121, libs/sqlite/src/com/biffweb/sqlite/impl/kv.clj:23, libs/sqlite/src/com/biffweb/sqlite/impl/kv.clj:30, libs/sqlite/src/com/biffweb/sqlite/impl/kv.clj:44 but no definition was found
note: com.biffweb.sqlite.impl.execute/execute is used at libs/sqlite/src/com/biffweb/sqlite.clj:110, libs/sqlite/src/com/biffweb/sqlite.clj:121, libs/sqlite/src/com/biffweb/sqlite/impl/kv.clj:23, libs/sqlite/src/com/biffweb/sqlite/impl/kv.clj:30, libs/sqlite/src/com/biffweb/sqlite/impl/kv.clj:44 but no definition was found: probably a form clj-kondo could not read in the file with syntax errors named below, or a macro clj-kondo cannot expand; add :lint-as for the macro in .clj-kondo/config.edn
note: com.biffweb.sqlite.impl.execute/execute may live in libs/sqlite/src/com/biffweb/sqlite/impl/execute.clj, which has syntax errors; some forms may be missing, so besides a spelling problem a form kondo could not read is possible
note: use a fully qualified name (ns/name)
```

Ein nicht gefundener Name, der wahrscheinlich in einer Datei liegt, deren clj-kondo-Lauf ein Zeitlimit überschritt,
oder in einer Datei, die git verfolgt, die der Build aber nicht analysiert hat, nennt diese Datei auf dieselbe Weise.

Ein Name, der verwendet, aber nirgends definiert wird, stammt meist aus einem Makro, das clj-kondo nicht expandieren
kann. Die Antwort sagt, wo er verwendet wird und was hinzuzufügen ist. Aus next.jdbc:

```
CALLERS next.jdbc.types/as-other — no definition matches "next.jdbc.types/as-other"; used at test/next/jdbc/sql_test.clj:290, test/next/jdbc_test.clj:559 but no definition was found
note: next.jdbc.types/as-other is used at test/next/jdbc/sql_test.clj:290, test/next/jdbc_test.clj:559 but no definition was found: probably defined by a macro clj-kondo cannot expand; add :lint-as for the macro in .clj-kondo/config.edn
note: use a fully qualified name (ns/name)
```

Lesen Sie einen Fehlschlag als Aussage über die Abdeckung, nicht als Beweis, dass etwas nicht existiert.

## Abdeckung

[docs/COVERAGE.md](docs/COVERAGE.md) misst 26 öffentliche Repositories, jedes auf einen sha in
[corpus.json](corpus.json) festgelegt. Die Hauptmetrik heißt **resolution rate** (Auflösungsrate): Von den
Var-Verwendungen, die clj-kondo einem Projekt-Namespace zuordnet, ist es der Anteil, den der Graph mit einer Definition
verknüpft. Verwendungen von Bibliotheks-Vars werden nicht gezählt. Symbole, die clj-kondo keinem Namespace zuordnen
kann, werden als Rohzahl, **unknown namespace**, ausgewiesen und aus der Rate herausgehalten.

24 von 26 Repositories liegen bei 95% oder darüber. Die beiden darunter:

| Repo | aufgelöst | ungelöst | resolution rate | unknown namespace |
|---|---|---|---|---|
| datascript | 4392 | 496 | 89.9% | 1255 |
| day-of-datomic | 84 | 29 | 74.3% | 1 |

Das Dokument erklärt sie so, wie dort geschrieben:

> **unresolved**: a var created by a project macro clj-kondo does not know (datascript's record constructors), or
> a name in a REPL script with no ns form that clj-kondo files under a namespace not defining it (day-of-datomic's
> tutorials).

Übersetzung: **unresolved** (ungelöst) ist eine Var, die von einem Projektmakro erzeugt wird, das clj-kondo nicht
kennt (die Record-Konstruktoren von datascript), oder ein Name in einem REPL-Skript ohne ns-Form, den clj-kondo unter
einem Namespace ablegt, der ihn nicht definiert (die Tutorials von day-of-datomic).

Sechs weitere Repositories sind aufgeführt, weil ihre unknown-namespace-Zahl über 5% der aufgelösten liegt: babashka,
cider-nrepl, fulcro, pedestal, shadow-cljs und usermanager. Die Tabelle gibt eine Nachkommastelle aus, daher kann 100.0%
noch einige ungelöste Verwendungen enthalten (metabase 111, penpot 13, xtdb-v1 3). Beide Arten schrumpfen, wenn ein
Repository eine clj-kondo-Konfiguration für seine Makros mitliefert oder sie in `.clojure-atlas.edn` unter `:lint-as`
benennt. Der Korpus wird ohne beides gemessen.

## Benchmark

[docs/BENCHMARK.md](docs/BENCHMARK.md) enthält 21 Fragen zu Korpus-Repositories. Jede erwartete Antwort wurde von Hand
im Quelltext geprüft, ohne das Tool, und ihr file:line steht in [bench/questions.json](bench/questions.json).

- **Positive Fragen: 14 von 14 bestanden.** Eine Frage gilt als bestanden, wenn die Antwort jede erwartete Definition
  nennt und sonst nichts. Erwartete Einträge gefunden: 40 von 40; beantwortete Einträge: 40.
- **Absence-Fragen: 7 von 7 bestanden.** Die richtige Antwort ist, dass es nichts gibt (*none*, *not-found*,
  *used-undefined* oder *capability-off*), und die Antwort muss diese Art von Abwesenheit nennen und nichts benennen.

Die ersten zwölf positiven Fragen wurden vor dem ersten Lauf festgelegt, der 11 von 12 erreichte. Der Fehlschlag (re-frame-
Registrierungen über `re-frame.alpha`) wurde im Builder mit einer Fixture behoben, und die Frage blieb unverändert. Zwei Fragen kamen später hinzu, für die compojure-Middleware-Kette (q13) und eine
reitit-Frontend-Route (q14).

## Voraussetzungen

- Node.js 22.18 oder neuer. Keine JVM, kein babashka, keine globale Installation.
- Beim ersten `build` wird clj-kondo 2025.10.23 einmal heruntergeladen, gegen ein festgelegtes sha256 geprüft und in
  `$XDG_CACHE_HOME/clojure-atlas` zwischengespeichert (Standard `~/.cache/clojure-atlas`; `%LOCALAPPDATA%\clojure-atlas`
  unter Windows). Quelle: das
  [offizielle clj-kondo-Release](https://github.com/clj-kondo/clj-kondo/releases). Der erste Lauf gibt aus:

  ```
  clojure-atlas: downloading clj-kondo 2025.10.23 (macos-aarch64) once, to <cache>/clojure-atlas/clj-kondo-2025.10.23-macos-aarch64/clj-kondo
  ```

- Offline oder hinter einem Proxy: Legen Sie `clj-kondo` in den PATH. Das `fetch` von Node ignoriert `HTTPS_PROXY`,
  daher schlägt der Download hinter einem Proxy fehl, und clojure-atlas verwendet dann das clj-kondo aus dem PATH. Ein
  Download mit falschem sha256 wird abgelehnt und nie ausgeführt.
- Optional: TypeScript 5 (`npm i -D typescript@5` neben clojure-atlas), um Playwright-Page-Objects und -Tests zu lesen.
  Es ist eine optionale Peer-Abhängigkeit. Ohne sie ist dieses Lesen aus, und graph_info und die Browser-Test-Antworten
  nennen den Grund für jedes gefundene Playwright-Projekt.
- Plattformen mit festgelegtem clj-kondo-Binary: macOS arm64, macOS x64, Linux x64, Linux arm64, Windows x64. Jede
  andere Plattform braucht clj-kondo im PATH. Dieses Release wurde auf macOS arm64 entwickelt und gemessen. Windows
  ist ungetestet.

## Sicherheit

Der Build liest Dateien. Er führt nur clj-kondo (das festgelegte Binary oder das aus dem PATH) und `git ls-files` aus und
führt nie Code des analysierten Repositorys mit Node, einer JVM oder einer Shell aus. TypeScript wird aus der eigenen
Installation von clojure-atlas geladen, nie aus dem analysierten Repository. clj-kondo wendet die `.clj-kondo`-Config
des Projekts an; dort deklarierte Hooks interpretiert clj-kondo selbst, wie in jedem Editor, der clj-kondo ausführt. Der
MCP-Server liest nur die Graph-Datei und führt mit `--repo` schreibgeschützte git-Befehle aus. Jeder git-Aufruf
ignoriert die eigenen Einstellungen des Repositorys, die Befehle ausführen (`core.fsmonitor`, Filter-Treiber, Hooks),
fragt nie nach und hat ein Zeitlimit. Auch jeder clj-kondo-Lauf hat ein Zeitlimit: Ein Hook, der nie zurückkehrt,
kostet seinen Batch (unter DEGRADED aufgeführt), nicht den Build. Git läuft nie innerhalb eines Submodules (dessen eigene Konfiguration clojure-atlas nicht abschalten kann), daher
gelten die Dateien eines Submodules immer als geändert. Beide Programme werden von einem absoluten Pfad aus gestartet, der
in PATH gefunden wird, nie aus dem analysierten Verzeichnis, und die `:output`- und `:analysis`-Einstellungen von
clj-kondo des Projekts werden durch die ersetzt, die der Graph braucht.

## Warum TypeScript?

Weil `npx` einfach funktioniert: keine JVM zu installieren und nichts auf dem Rechner des Benutzers zu kompilieren. Die
Clojure-Analyse selbst erledigt clj-kondo. clojure-atlas liest dessen Ausgabe und die Quellformen und baut den Graphen.
Beiträge von Adaptern sind in beiden Sprachen willkommen: Ein Adapter wird durch eine kleine Clojure-Fixture und die
daraus erwarteten Graphzeilen definiert. So können Sie die Semantik einer Bibliothek in Clojure beschreiben und jemand
kann sie portieren, oder Sie schreiben das TypeScript selbst.

## Grenzen

- **Nur statisch.** Eine Var, die zur Laufzeit aufgelöst wird, wird nicht verfolgt. `requiring-resolve`, `resolve` oder
  `ns-resolve` mit einem literalen Symbol ist eine HEURISTIC-Referenz; ein zur Laufzeit gebautes Symbol oder eine durch
  Daten gewählte Funktion ist es nicht, und callers und blast_radius sagen das, wenn das Projekt Vars dynamisch auflöst.
  Ein Map-Schlüssel, der nur dynamisch gelesen oder geschrieben wird, wird nicht erfasst. Tests, die Code über
  Multimethods, `resolve`/`apply` oder HTTP-Fixtures erreichen, werden nicht gezählt.
- **Heuristische Teile**: Multimethod- und Protocol-Dispatch (`may_dispatch_to`), einige compojure-Handler (angezeigt
  als `heuristic match`), compojure- und Ring-Middleware-Ketten, Aufrufe von Middleware-Factories, reitit-Frontend-
  Routentabellen in Namespaces, die reitit nicht requiren (gelesen, wenn `reitit.frontend` irgendwo im Projekt verwendet
  wird), Vars, die in Rümpfen von syntax-quoted Makros genannt werden, Verwendungen innerhalb eines Projekt-Makros, das clj-kondo nicht expandieren kann (über
  `unexpanded-macro`), Verwendungen eines Namespace, der in mehr als einer Datei definiert ist (über
  `duplicate-namespace`), durchgereichte Schlüssel-Slots, Query-Literale außerhalb eines transact- oder query-Aufrufs,
  key_siblings-Befunde.
- **Projekt-Makros**: clj-kondo expandiert ein Makro nur, wenn die `.clj-kondo`-Config des Projekts ihm ein `:lint-as`
  oder einen Hook gibt (oder `.clojure-atlas.edn` es unter `:lint-as` nennt). Fügen Sie eines hinzu und bauen Sie neu,
  sind die Verwendungen darin wieder STATIC_PROVEN.
- **Middleware, deren Umhüllung nicht gelesen werden kann**, wird als `middleware: not extracted (UNKNOWN)` gemeldet,
  nicht als "none".
- **Nicht parsbare Dateien und Dateien über 2 MB**: Ihre Definitionen und Aufrufe fehlen im Graphen. Jede Antwort beginnt dann mit einer
  `DEGRADED`-Zeile, die sie nennt.
- **Interceptors einer pedestal-Service-Map** werden nicht gelesen, daher ist die Middleware jeder pedestal-Route UNKNOWN.
- **Routenautorisierung** braucht `.clojure-atlas.edn`. Ohne diese Datei sagt route_authz "not provable" und
  permission_routes meldet die Capability als absent.
- **Noch nicht unterstützt**: bidi-Routen, compojure-api, ausführliche Map-Routen von pedestal, malli-Registries,
  integrant-Systeme ohne Refs. Siehe [ROADMAP.md](ROADMAP.md).
- **datascript und day-of-datomic** lösen weniger auf (89.9% und 74.3%): datascript definiert Record-Konstruktoren
  über ein Makro, das clj-kondo nicht kennt. Die Tutorials von day-of-datomic sind REPL-Skripte ohne ns-Form. Siehe
  [Abdeckung](docs/COVERAGE.md).
- **Unknown-namespace-Symbole** (Locals, die von unbekannten Makros gebunden werden, Felder von deftype oder proxy)
  werden gezählt, nicht verknüpft.
- **Kein inkrementeller Build und kein Watch.** Bauen Sie nach einer Änderung neu. Der Server warnt mit `STALE`, wenn
  er es erkennen kann.
- **Windows ist ungetestet.** Proxys werden für den clj-kondo-Download nicht unterstützt.

## Mitwirken

```sh
npm ci
npm test                                    # all tests
npm run test:coverage                       # the gate: 98% line coverage of src/
npm run typecheck
node scripts/coverage.ts <corpus-dir>       # rebuilds docs/COVERAGE.md from clones at the corpus.json shas
node bench/score.ts <corpus-dir>            # scores the benchmark questions
```

Um einen Adapter hinzuzufügen oder zu erweitern, beginnen Sie mit einer Fixture: einer kleinen Clojure-Codebasis unter
`test/fixtures/<name>/` und einer `expected.txt` mit jeder Graphzeile, die sie erzeugen muss, von Hand gegen den
Quelltext geprüft. Tragen Sie sie in `test/build-fixtures.test.ts` ein und schreiben Sie dann den Adapter in
`src/build/adapters/`, bis die Zeilen übereinstimmen. Siehe [CONTRIBUTING.md](CONTRIBUTING.md).

## Danksagung

- [clj-kondo](https://github.com/clj-kondo/clj-kondo) von Michiel Borkent übernimmt die Clojure-Analyse.
- Das [Model Context Protocol](https://modelcontextprotocol.io) ist der Weg, auf dem Agenten mit dem Server sprechen.
- Die Korpus-Repositories und ihre Autoren, auf deren öffentlichem Code Coverage und Benchmark gemessen werden.

## Lizenz

MIT. Siehe [LICENSE](LICENSE). Erstellt von Barış Can Ateş.
