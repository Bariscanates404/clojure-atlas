# clojure-atlas

**Für agentisches Coding entwickelt. Geben Sie Ihrem KI-Agenten eine Karte Ihrer Clojure-Codebasis.**

Verfolgen Sie Aufrufer sowie Datenlieferanten und -verbraucher, prüfen Sie Funktionsverträge **bis hinunter zu den Schlüsseln
innerhalb von Map-Argumenten**, folgen Sie re-frame-Events und Routen und erkennen Sie die von einer Änderung betroffenen Tests.
clojure-atlas verwandelt **Clojure-, ClojureScript- und `.cljc`-Quellcode** in einen lokalen Code-Graphen und stellt ihn
als **13 MCP-Tools** mit Quellpositionen und expliziten Konfidenzstufen bereit.

Als **Begleitwerkzeug für Coding-Agenten** gebaut: Atlas liefert den strukturellen Kontext, den sie brauchen, bevor sie Code
ändern: wer davon abhängt, welche Parameter und Map-Schlüssel seine Verbraucher erwarten und welche Tests dazu gehören.

![clojure-atlas — provider to map parameter set to consumer; inspect contracts with signature_impact and key_flow](docs/assets/atlas.svg)

[![License: MIT](https://img.shields.io/badge/license-MIT-91d5b6?style=flat-square&labelColor=17252b)](LICENSE)
[![Node.js: 22.18+](https://img.shields.io/badge/Node.js-22.18%2B-91d5b6?style=flat-square&labelColor=17252b)](#anforderungen)
[![MCP: stdio](https://img.shields.io/badge/MCP-stdio-91d5b6?style=flat-square&labelColor=17252b)](#schnellstart)
[![Required npm runtime dependencies: 0](https://img.shields.io/badge/npm_runtime_dependencies-0-91d5b6?style=flat-square&labelColor=17252b)](#lokal-von-grund-auf)

**Keine erforderlichen npm-Laufzeitabhängigkeiten. Lokale Analyse. For the sake of all Clojurians. (Für alle Clojure-Entwickler.)**

Ein persönliches Projekt von **Barış Can Ateş** · MIT-lizenziert · Gebaut auf [clj-kondo](https://github.com/clj-kondo/clj-kondo).

[English](README.md) | [Türkçe](README.tr.md) | Deutsch | [Español](README.es.md) | [Português (Brasil)](README.pt-BR.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md)

[Fähigkeiten](#was-sie-damit-tun-können) · [Map-Verträge](#verträge-bis-zu-den-map-schlüsseln) · [Unterstützter Stack](#sprachen-und-ökosystem-unterstützung) · [Beispiele](#in-aktion) ·
[Schnellstart](#schnellstart) · [Abdeckung](#abdeckung) · [Wie getestet wird](#wie-atlas-getestet-wird) · [Vollständiger Leitfaden](docs/GUIDE.md)

## Was Sie damit tun können

Nutzen Sie es, wenn Sie ein unbekanntes Projekt erkunden, ein Refactoring planen oder eine Änderung prüfen. Ihr MCP-Client ruft
die Tools auf; Atlas liefert die Beziehungen, die es feststellen kann, mit `file:line`-Belegen.

| Fragen Sie Ihren Agenten … | Atlas liefert ihm … | MCP-Tools |
|---|---|---|
| „Wer ruft das auf, und was könnte meine Änderung betreffen?“ | Direkte Aufrufer, Wertreferenzen und transitive Abhängige | `callers`, `blast_radius` |
| „Welche Parametermenge liefert jeder Aufrufer, und was liest die Funktion?“ | Stelligkeiten, destrukturierte Map-Schlüssel, Defaults, Keyword-Argumente und an jeder Aufrufstelle übergebene Schlüssel | `signature_impact` |
| „Wer liefert diesen Map-Schlüssel, und wer verbraucht ihn?“ | Schlüssel-Produzenten und -Konsumenten, einschließlich literaler Schlüssel in verschachtelten Maps und Schlüsselpfaden | `key_flow` |
| „Fehlt in dieser Konfigurationszeile ein Schlüssel?“ | Schlüssel, die in benachbarten Map-Zeilen vorkommen, in dieser aber fehlen | `key_siblings` |
| „Was behandelt diesen Endpoint? Wo wird die Berechtigung geprüft?“ | Route-Handler, geordnete Middleware und konfigurierte Berechtigungsprüfungen | `route_authz`, `permission_routes` |
| „Was passiert, wenn dieses re-frame-Event ausgelöst wird?“ | Dispatcher, Handler, Subscriptions und HTTP-Requests | `event_flow` |
| „Wer liest oder schreibt dieses Datenbank-Attribut?“ | Belegte Lese- und Schreibzugriffe, unsichere Referenzen bleiben sichtbar | `attribute_usage` |
| „Welche Tests gehören zu dieser Änderung?“ | Statische Unit-Test-Verknüpfungen, Playwright-Verknüpfungen und ein Review-Kontext für geänderte Dateien oder Zeilen | `tests_for`, `tests_covering`, `context_for_change` |
| „Was weiß dieser Graph tatsächlich?“ | Quell-Commit, aktive Adapter, Belegzahlen und Abdeckungswarnungen | `graph_info` |

Ein Aufruf, ein Callback und ein Keyword mit gleicher Schreibweise sind verschiedene Dinge. Atlas bildet diese Unterschiede ab,
einschließlich der Registrierungen und datengetriebenen Verbindungen von Clojure. Es gibt Ihrem Agenten Belege zum Prüfen, bevor er etwas ändert.

### Fehler, die es Ihnen hilft, vor der Auslieferung zu finden

Jede Zeile ist eine echte Antwort auf einem öffentlichen Projekt; folgen Sie dem Link für das vollständige Transkript.

| Möglicher Fehler | Fragen mit | Was Atlas zeigte (echtes Beispiel) |
|---|---|---|
| In einer Konfigurations- oder Datenzeile fehlt ein Schlüssel, den ihre Nachbarzeilen haben | `key_siblings` | re-frame: 2 Zeilen einer Query-Tabelle haben `:re-frame/lifecycle` nicht, das 3 von 4 Nachbarzeilen haben ([Transkript](docs/GUIDE.md#key_siblings)) |
| Ein neuer Pflichtschlüssel bricht bestehende Aufrufer | `signature_impact` mit `added_keys` | polylith-realworld: Wenn `login!` `:tenant-id` braucht, übergeben 3 Aufrufer eine literale Map ohne ihn und 1 reicht eine Map weiter, die Atlas nicht sehen kann ([Transkript](#den-vertrag-innerhalb-eines-map-arguments-prüfen)) |
| Ein Aufrufer übergibt die falsche Stelligkeit oder einen Schlüssel, den die Funktion nie liest, oder lässt einen Schlüssel aus, den sie destrukturiert | `signature_impact` | integrant: `init` geprüft gegen 38 Aufrufer und beide Stelligkeiten; „no finding“ mit benannten Suchen ([Transkript](docs/GUIDE.md#signature_impact)) |
| Einem Endpoint fehlt Middleware oder eine Berechtigungsprüfung | `route_authz`, `permission_routes` | polylith-realworld: `POST /api/articles` mit seinen 11 Wrappern der Reihe nach, `wrap-authorization` zuletzt; Berechtigungen ehrlich „not extracted“ ohne deklariertes Modell ([Transkript](docs/GUIDE.md#route_authz)) |
| Ein Schlüssel wird gelesen, den nichts schreibt (oft ein Tippfehler oder ein umbenannter Schlüssel) | `key_flow` | compojure: `:compojure/path` hat 1 Produzenten (`assoc-path`) und 2 Konsumenten ([Transkript](docs/GUIDE.md#key_flow)) |
| Ein unerwarteter Schreiber eines Datenbank-Attributs | `attribute_usage` | mount: `:order/bid` hat 2 belegte Schreiber, einen davon im Testcode, und keine Leser ([Transkript](docs/GUIDE.md#attribute_usage)) |
| Ein gesendetes Event hat keinen Handler, oder ein Handler löst unerwartete Events aus | `event_flow` | re-frame todomvc: `:delete-todo` wird von 2 Stellen gesendet, einmal behandelt und löst nichts aus ([Transkript](docs/GUIDE.md#event_flow)) |
| Eine kleine Änderung zieht weitere Kreise als erwartet | `blast_radius` | integrant: Eine Änderung an `ref?` erreicht 31 Definitionen über 6 Ebenen ([Transkript](docs/GUIDE.md#blast_radius)) |
| Geänderter Code, den kein Test erreicht | `context_for_change`, `tests_for` | polylith-realworld: Die Zeilen 60-80 des Article-Stores berühren 3 Definitionen, 9 externe Aufrufer und 24 zugehörige Tests ([Transkript](docs/GUIDE.md#context_for_change)) |

Atlas zeigt auf die Stelle, die man sich ansehen sollte; ob es ein Fehler ist, entscheiden Sie oder Ihr Agent.

### Der Arbeitsablauf eines Agenten

1. **Orientieren:** Prüfen Sie mit `graph_info` den Snapshot, die aktiven Adapter und Analyselücken.
2. **Untersuchen:** Betrachten Sie Aufrufer, Parameterverträge, Anbieter/Verbraucher von Map-Schlüsseln und die mögliche Auswirkung einer Änderung.
3. **Planen und verifizieren:** Finden Sie mit `context_for_change` und den Test-Tools betroffenen Code und zugehörige Tests;
   prüfen Sie den zitierten Quellcode, nehmen Sie die Änderung vor und führen Sie die relevanten Tests aus. Bauen Sie den Graphen für den nächsten Durchgang neu und starten Sie den MCP-Server neu.

## Verträge bis zu den Map-Schlüsseln

Atlas macht den **im Quellcode sichtbaren Parametervertrag** prüfbar: was ein Aufrufer übergibt, was eine Funktion
destrukturiert oder liest und welche Aufrufstellen eine geplante Änderung betrifft.

| Ebene | Was Atlas zeigen kann |
|---|---|
| **Parametermenge** | Akzeptierte Stelligkeiten, positionale/Rest-Parameter und Keyword-Argumente wie `& {:keys [verbose]}` |
| **Schlüssel innerhalb eines Map-Arguments** | `{:keys [email password]}`, `:or`-Defaults, `:as`-Aliase, von Aufrufern übergebene literale Schlüssel und unterstützte Lesezugriffe im Funktionsrumpf |
| **Anbieter / Verbraucher** | Produzenten wie Map-Literale, `assoc` und `assoc-in`; Konsumenten wie Destrukturierung, Keyword-Zugriff, `get` und `get-in` |
| **Vertragsänderungen** | Von hinzugefügten/entfernten Schlüsseln oder geänderten Stelligkeiten betroffene Aufrufstellen, mit `signature_impact` und `added_keys`, `removed_keys`, `arities` oder `base_graph` |
| **Verschachtelte Maps** | Literale Schlüsselvorkommen in verschachtelten Maps, Destrukturierung und Pfade wie `(get-in cart [:meta :count])`, über `key_flow` |

Der Umfang ist die **statische Schlüsselnutzung**, keine Wert- oder Typvalidierung. `key_flow` gruppiert Vorkommen nach Keyword,
nicht nach der Identität einer bestimmten Map. `signature_impact` erfasst den äußeren Schlüssel einer verschachtelten Destrukturierung
oder eines `get-in`, kein vollständiges verschachteltes Schema. Zur Laufzeit erzeugte Maps und Schlüssel können unbekannt bleiben.

## Sprachen und Ökosystem-Unterstützung

**Kernsprachen:** Clojure (`.clj`), ClojureScript (`.cljs`) und gemeinsamer Code (`.cljc`). EDN-Dateien tragen unterstützte
Konfigurations- und Datenformen bei. TypeScript (`.ts`) wird nur für die optionale Playwright-Integration gelesen;
es ist kein allgemeiner JavaScript- oder TypeScript-Analysator.

| Bereich | Erkannte Bibliotheken / Formen | Was heute abgedeckt ist |
|---|---|---|
| Kern-Clojure | Vars, Aufrufe, Wertverwendungen, Callbacks, Multimethods, Protokolle | Definitionen und Abhängigkeitsbeziehungen; Dispatch-Kandidaten sind heuristisch |
| Parameter- und Map-Verträge | `defn`-Stelligkeiten, Map-Destrukturierung, Keyword-Argumente, Map-Literale und Schlüsseloperationen | Von Aufrufern übergebene Schlüsselmengen, verbrauchte Schlüssel, Anbieter-/Verbraucherstellen und Auswirkung von Signaturänderungen |
| Frontend-Zustand | **re-frame**, einschließlich `re-frame.alpha` | Event-/Subscription-Registrierungen, Dispatch, Subscription-Eingaben und Subscriber |
| Backend-Routing | **Compojure**, **Reitit**, **Pedestal**-Tabellenrouten | Pfade, eingehängte Routenkopien und Handler; Interceptors in Pedestal-Service-Maps werden nicht extrahiert |
| Middleware | **Ring**, Compojure `wrap-routes`, Reitit-Routendaten und `ring-handler` | Geordnete Ketten, einschließlich äußerer Wrapper; abgeleitete Ketten sind als heuristisch markiert |
| Routen-Autorisierung | Projektdefinierte Berechtigungsschlüssel, Middleware und Funktionen | Erfordert eine kleine `.clojure-atlas.edn`-Deklaration |
| Browser-Routing | **Reitit frontend**, **Secretary** | Client-Routenknoten im Graphen; ein eigenes MCP-Tool zum Auflisten gibt es noch nicht |
| HTTP-Requests | **cljs-ajax**, **cljs-http**, `js/fetch`, Request-Effect-Maps | Request-Stellen und Zuordnung zu Backend-Routen nach Methode und Pfad |
| Daten | **Datomic**, **DataScript**, **XTDB v1 / Crux** | Attribute, Transaktionsschreibzugriffe, Query-/Pull-Lesezugriffe und unsichere Referenzen |
| System-Lebenszyklus | **Integrant**, **Mount**, **Component** | System-Schlüssel, Registrierungen und Abhängigkeitskanten; die Integrant-Konfigurationsextraktion stützt sich auf Refs |
| Schemas | **clojure.spec / cljs.spec**, **Malli** | Registrierte Spec-Schemas und in Vars gehaltene Malli-Schemas; Malli-Registries werden nicht unterstützt |
| Tests und UI | **clojure.test / cljs.test**, **Playwright**, literale Hiccup-Selektoren | Statische Test-Verknüpfungen; Playwright-Page-Objects und `.ts`-Tests benötigen optional TypeScript 5 |
| Projektstruktur | **deps.edn**, **Leiningen**, **shadow-cljs**, **Babashka**, **Boot**, **Polylith**-Layouts | Quellenerkennung und Gruppierung nach Modul/Komponente; Build-Aliase und Task-Ausführung werden nicht analysiert |

Framework-Adapter erkennen bestimmte Quellformen, nicht jede mögliche Verwendung einer Bibliothek. `graph_info` meldet,
was in **Ihrem** Projekt verfügbar war und aktiviert wurde. Repositories wie Fulcro, Pathom, HoneySQL und next.jdbc gehören
zum Messkorpus, aber ihre Anwesenheit dort bedeutet **nicht**, dass eine eigene Framework- oder SQL-Analyse implementiert ist.
Siehe die [Roadmap](ROADMAP.md) für diese Adapter, bidi, compojure-api und weitere Lücken.

## In Aktion

Diese Auszüge stammen aus den [eingecheckten Beispiel-Graphen](examples/) öffentlicher Projekte. Der Aufruf ist ein
MCP-Tool-Aufruf, kein Shell-Befehl. `[S]` bedeutet statisch bewiesen; `[H]` bedeutet heuristisch.

### Den Vertrag innerhalb eines Map-Arguments prüfen

In polylith-realworld nimmt `login!` **ein Map-Argument** entgegen und destrukturiert **`:email` und `:password`**.
Atlas zeigt diese Schlüsselmenge neben den Argumenten, die seine Aufrufer übergeben:

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

Die Schlüsselmenge der literalen Map ist sichtbar; die als `login-input` übergebene Map bleibt unbekannt. `[S]` in dieser Zeile belegt
die Aufrufbeziehung, nicht den Inhalt der Map zur Laufzeit.

<details>
<summary><strong>Den Parametervertrag ändern: Was, wenn login! auch :tenant-id braucht?</strong></summary>

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

Alle drei Aufrufer mit literaler Map lassen den vorgeschlagenen Schlüssel aus. Der vierte Aufrufer reicht `login-input` weiter, daher ist
seine Auswirkung **UNKNOWN**. Dies ist eine hypothetische Vertragsänderung; das Tool verändert keinen Quellcode. „No finding“
bezieht sich auf die bestehende Signatur; der Abschnitt `affected` beschreibt die vorgeschlagene Änderung.

</details>

<details>
<summary><strong>Die Anbieter und Verbraucher von :email im ganzen Projekt finden</strong></summary>

```text
key_flow {"key": ":email", "group_by": "none", "limit": 2}
```

```text
KEY_FLOW :email — 9 producer(s), 5 consumer(s) in 1 component(s); 23 site(s) in tests
counts: producers=9 [S9]  consumers=5 [S5]  tests=23 [S23]
[... trimmed ...]
```

Das Ergebnis listet Produzenten mit Map-Literalen in `register!` und destrukturierende Konsumenten, darunter `login!`, mit
Quellpositionen auf. Da `:email` nicht qualifiziert ist, wird jede Map mit diesem Keyword gemeinsam gruppiert; das
beweist nicht, dass die Map eines bestimmten Produzenten bei einem bestimmten Konsumenten ankommt.

</details>

<details>
<summary><strong>Die Aufrufer vor einem Refactoring finden</strong></summary>

**Frage:** Wer ruft `integrant.core/dependent-keys` auf?

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
<summary><strong>Ein re-frame-Event über Dispatch-Stellen und seinen Handler verfolgen</strong></summary>

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

Die Verbindung läuft über ein Event-Keyword; die Aufrufer einer benannten Funktion allein würden sie daher übersehen.

</details>

<details>
<summary><strong>Die Middleware vor einem Endpoint sehen und was Atlas nicht prüfen konnte</strong></summary>

Aus polylith-realworld, wo die Routen in einer separaten Definition von Ring-Middleware umhüllt werden:

```text
route_authz {"route": "POST /api/articles"}
```

```text
ROUTE_AUTHZ POST /api/articles — not provable: route authz not in this graph
counts: route=1 [S1]  handler=1 [S1]  middleware=11 [H11]
note: capability route_authz is absent: an empty answer is not proof of absence
[... trimmed ...]
  1. clojure.realworld.rest-api.handler/create-article  bases/rest-api/src/clojure/realworld/rest_api/api.clj:31 [S]  entry: route POST /api/articles @clojure.realworld.rest-api.api/private-routes
POST /api/articles @clojure.realworld.rest-api.api/private-routes (base clojure.realworld.rest-api.api/private-routes): middleware (outermost first) (11 H11)
  1. clojure.realworld.rest-api.middleware/wrap-cors  bases/rest-api/src/clojure/realworld/rest_api/api.clj:61 [H]  heuristic match  (#0 wrapper)
  2. ring.middleware.json/wrap-json-response  bases/rest-api/src/clojure/realworld/rest_api/api.clj:60 [H]  heuristic match  (#1 wrapper)
[... trimmed ...]
  10. clojure.realworld.rest-api.middleware/wrap-auth-user  bases/rest-api/src/clojure/realworld/rest_api/api.clj:46 [H]  heuristic match  (#9 wrapper)
  +1 more (next page: offset=10 section="middleware")
POST /api/articles @clojure.realworld.rest-api.api/private-routes (base clojure.realworld.rest-api.api/private-routes): permissions: not extracted (route_authz is absent)
```

Der Handler ist bewiesen; die elf Wrapper werden der Reihe nach gefunden, aber mit `[H]` markiert, weil die Middleware-Komposition
Laufzeitcode ist. Das Projekt deklariert keine Berechtigungsregeln, daher sagt Atlas **not extracted**, statt zu behaupten,
die Route habe keine Berechtigungsprüfung.

</details>

<details>
<summary><strong>Ein ehrlicher Fehlschlag: ein Name, der verwendet, aber nie definiert wird</strong></summary>

Aus next.jdbc, wo ein Makro Hilfsfunktionen erzeugt, die clj-kondo nicht expandieren kann:

```text
callers {"var": "next.jdbc.types/as-other"}
```

```text
CALLERS next.jdbc.types/as-other — no definition matches "next.jdbc.types/as-other"; used at test/next/jdbc/sql_test.clj:290, test/next/jdbc_test.clj:559 but no definition was found
note: next.jdbc.types/as-other is used at test/next/jdbc/sql_test.clj:290, test/next/jdbc_test.clj:559 but no definition was found: probably defined by a macro clj-kondo cannot expand; add :lint-as for the macro in .clj-kondo/config.edn
note: use a fully qualified name (ns/name)
```

Statt „nicht gefunden, prüfen Sie die Schreibweise“ zeigt die Antwort, wo der Name verwendet wird und wie man ihn sichtbar macht.
Mit einem `:lint-as`-Eintrag für das Makro liefert dieselbe Frage eine bewiesene Definition
([Projektkonfiguration](docs/GUIDE.md#project-configuration)).

</details>

<details>
<summary><strong>Geänderte Zeilen in Review-Kontext und zugehörige Tests verwandeln</strong></summary>

Aus polylith-realworld:

```text
context_for_change {"changes": ["components/article/src/clojure/realworld/article/store.clj:60-80"]}
```

```text
CONTEXT_FOR_CHANGE components/article/src/clojure/realworld/article/store.clj:60-80 — 1 file(s), 3 changed symbol(s), 0 route(s), 0 attribute(s); risk LOW
counts: changed symbols=3 [S3]  callers outside the diff=9 [S9]  tests to run=24 [S24]
[... trimmed ...]
```

Die vollständige Antwort listet die drei geänderten Definitionen, neun Aufrufer außerhalb des Diffs und 24 zugehörige Tests auf,
gruppiert nach Komponente. `LOW` beschreibt die Prüfungen, die der Graph durchgeführt hat; es ist keine Sicherheitsgarantie.

</details>

[Weitere echte Beispiele](examples/README.md) · [Alle Tools und vollständige Transkripte](docs/GUIDE.md#tools)

## Schnellstart

**Voraussetzungen:** Node.js **22.18+** und Git. Es wird weder eine JVM noch eine Babashka-Laufzeit benötigt.

### 1. Installieren und einen Graphen bauen

Im Stammverzeichnis des **Clojure-Projekts ausführen, das Sie analysieren möchten**:

```sh
# Install the reviewed source revision (Git installation builds the CLI).
npm install --save-dev \
  'git+https://github.com/Bariscanates404/clojure-atlas.git#8634d33e3ed59d420eead61a9c596f752d1fe789'

npx clojure-atlas build
```

Das Paket ist derzeit nicht auf npm veröffentlicht; nutzen Sie die obige Git-Installation. Solange das Repository privat ist,
wird Zugriff darauf benötigt. Eine Quellinstallation verwendet TypeScript und Node-Typdefinitionen, um die CLI zu kompilieren; das sind
Build-Zeit-Abhängigkeiten, getrennt von den null erforderlichen npm-Laufzeitabhängigkeiten.

Der Graph wird unter `.clojure-atlas/graph.json.gz` gespeichert. Der erste Build lädt die festgelegte clj-kondo-Binärdatei herunter und verifiziert sie;
spätere Analysen nutzen die zwischengespeicherte Binärdatei. Fügen Sie `.clojure-atlas/` der `.gitignore` Ihres Projekts hinzu.

### 2. Den MCP-Client verbinden

Für Claude Code zuerst die Projektkonfiguration in der Vorschau ansehen und dann schreiben:

```sh
npx clojure-atlas init         # preview .mcp.json
npx clojure-atlas init --yes   # write it; keep existing servers
```

Aktivieren Sie den Server in Ihrem Client und bitten Sie ihn dann, `graph_info` und `callers` auf einen voll qualifizierten `ns/name`
aus Ihrem Projekt anzuwenden.

<details>
<summary><strong>Einen anderen MCP-Client konfigurieren</strong></summary>

Atlas nutzt **MCP über stdio**. Konfigurieren Sie den Client so, dass er es aus Ihrem Projektstamm startet:

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

Startet der Client Server an anderer Stelle, verwenden Sie dessen Einstellung für das Arbeitsverzeichnis oder absolute Pfade für die installierte
CLI, den Graphen und das Repository. Die Konfigurationsformate der Clients können sich unterscheiden.

</details>

### 3. Nach Änderungen neu bauen

```sh
npx clojure-atlas build       # refresh the snapshot
npx clojure-atlas coverage   # inspect resolution counts and unresolved names
```

Es gibt keinen Watch-Modus. Mit `--repo` warnen Abfragen mit `STALE`, wenn der Arbeitsbaum nicht mehr zum
Graphen passt. Starten Sie den MCP-Server nach dem Neubau neu, damit er den neuen Graphen lädt.

**Sie haben bereits eine clj-kondo-Konfiguration?** Atlas wendet die `.clj-kondo/config.edn` des Projekts an, einschließlich ihrer
Makro-Zuordnungen und Hooks. Eine optionale `.clojure-atlas.edn` fügt eigene Route-Makros und Autorisierungsregeln hinzu.
Siehe [Projektkonfiguration](docs/GUIDE.md#project-configuration) und das [Autorisierungs-Fixture](test/fixtures/authz/.clojure-atlas.edn).

## Wie man eine Antwort liest

| Markierung | Bedeutung | Wie man sie nutzt |
|---|---|---|
| `[S]` — `STATIC_PROVEN` | Von clj-kondo aufgelöst oder aus einer literalen Quellform ermittelt | Folgen Sie der zitierten Quellposition |
| `[H]` — `HEURISTIC` | Aus einem Namen, Wrapper, Threading-Slot oder Dispatch-Kandidaten abgeleitet | Prüfen Sie die Beziehung im Quellcode |
| `[?]` — `UNKNOWN` | Lässt sich statisch nicht entscheiden | Behandeln Sie es als Analysegrenze |

**Ein leeres Ergebnis ist nicht automatisch ein Beweis der Abwesenheit.** Atlas unterscheidet „nichts gefunden“, „Definition nicht
gefunden“ und „Fähigkeit nicht verfügbar“. `DEGRADED` warnt vor unvollständiger Analyse; `STALE` warnt vor einem veralteten
Snapshot. Eine Testanzahl von null bedeutet, dass keine statische Verknüpfung gefunden wurde, nicht dass der Code ungetestet ist.

Dynamischer Dispatch, zur Laufzeit erzeugte Symbole und Projekt-Makros können begrenzen, was der Graph sieht. Nicht lesbare
Middleware wird als unbekannt gemeldet. Routenberechtigungen brauchen eine explizite Projektkonfiguration.
[Belege und Abwesenheit](docs/GUIDE.md#bands-and-absence) · [Bekannte Grenzen](docs/GUIDE.md#limits)

## Lokal von Grund auf

Die Kern-CLI hat **keine erforderlichen npm-Laufzeitabhängigkeiten**. Sie nutzt die Standardbibliothek von Node, clj-kondo für die
Clojure-Analyse und Git für Repository-Metadaten. Sie baut und befragt den Graphen lokal, ohne Atlas-Konto,
gehosteten Index oder Cloud-Dienst.

### Anforderungen

| Komponente | Rolle |
|---|---|
| Node.js 22.18+ | Führt die CLI und den MCP-Server aus |
| clj-kondo 2025.10.23 | Nativer Analysator; einmal heruntergeladen und zwischengespeichert, mit festgelegtem Archiv-SHA-256 |
| Git | Quellinstallation, Prüfungen versionierter Dateien und Snapshot-/Veralterungsinformationen |
| TypeScript 5 — zur Laufzeit optional | Analyse von Playwright-Page-Objects und Tests; mit `npm i -D typescript@5` neben Atlas installieren |

Festgelegte Binärdateien gibt es für macOS arm64/x64, Linux arm64/x64 und Windows x64. Entwicklung und Korpus-Messungen
nutzten macOS arm64; **Windows ist ungetestet**. Ist der Download nicht verfügbar, auch hinter einem
Proxy, kann Atlas auf ein funktionierendes `clj-kondo` im `PATH` zurückfallen. [Plattform- und Cache-Details](docs/GUIDE.md#requirements).

### Sicherheit

Eine kleine Abhängigkeitsfläche hilft, aber **null erforderliche npm-Abhängigkeiten bedeuten nicht null Lieferkettenrisiko**.

- Heruntergeladene clj-kondo-Archive werden gegen ein festgelegtes SHA-256 geprüft. Ein abweichender Download wird abgelehnt; eine
  Ausweich-Binärdatei aus dem `PATH` wird separat als vertrauenswürdig behandelt und nicht gegen diesen festgelegten Archiv-Hash verifiziert.
- Atlas startet weder die JVM der analysierten Anwendung noch Shell-Skripte oder Node-Code. **Projekt-Hooks von clj-kondo
  werden von clj-kondo interpretiert**, daher gehört dessen Konfiguration zum Code, dem Sie beim Analysieren eines Repositorys vertrauen.
- Der MCP-Server liest den Graphen und nutzt schreibgeschützte Git-Prüfungen. Git-Command-Hooks, Filter-Treiber und fsmonitor
  sind für diese Prüfungen deaktiviert; Git- und clj-kondo-Subprozesse haben Timeouts.
- Atlas liefert Ergebnisse lokal über stdio aus. Wie der von Ihnen gewählte KI-/MCP-Client diese Ergebnisse behandelt, ist eine
  eigene Datenschutzgrenze.

Das sind Implementierungseigenschaften, keine Sicherheitsaudit-Zertifizierung. [Detailliertes Ausführungsmodell](docs/GUIDE.md#security).

## Abdeckung

Gemessen an **26 öffentlichen Repositories**, jedes auf einen Commit in [corpus.json](corpus.json) festgelegt. Der Korpus umfasst
Babashka, Logseq, Metabase, Penpot, re-frame, Reitit und kleinere Bibliotheken. Die vollständigen Ergebnisse stehen in
[docs/COVERAGE.md](docs/COVERAGE.md).

**Die Auflösungsrate misst eine ganz bestimmte Sache:** `resolved / (resolved + unresolved)` für Var-Verwendungen,
die erkannten Projekt-Namespaces zugeordnet sind. Bibliotheksverwendungen und **Verwendungen unbekannter Namespaces liegen außerhalb dieses Nenners**.
Sie misst weder den gesamten verstandenen Code noch das gesamte extrahierte Framework-Verhalten noch die Laufzeitkorrektheit.

| Repository | Resolved | Unresolved | Auflösungsrate | Unbekannter Namespace (Rohzahl, ausgeschlossen) |
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
| **Alle 26 Repos** | | | **Median 100.0%; 24 von 26 bei 99.3% oder mehr** | |

† [docs/COVERAGE.md](docs/COVERAGE.md#repos-under-95-resolution-rate-or-with-unknown-namespace-usages-above-5-of-resolved)

Raten sind auf eine Nachkommastelle gerundet. Lesen Sie sie immer zusammen mit **beiden** Zahlen: Unresolved und unbekannter Namespace.
Unbekannte Namen können durch unbekannte Makros gebundene lokale Variablen ebenso enthalten wie übersehene Var-Verwendungen; der Analysator kann
sie nicht zuverlässig trennen.

**Metrikänderungen sind keine Analysator-Verbesserungen.** Frühere Zahlen verwendeten einen anderen Nenner. Die
höhere gemeldete Rate von Babashka spiegelt weitgehend den Ausschluss von Symbolen unbekannter Namespaces wider, nicht neu aufgelösten Code.
Vergleiche über diese Definitionen hinweg sind nicht gleichwertig; die obigen Rohzahlen bleiben absichtlich sichtbar.

### Tatsächliche Extraktionsverbesserungen

Dies sind konkrete Änderungen dessen, was Atlas lesen kann, getrennt von der Definition der Auflösungsrate:

| Verbesserung | Beobachtbares Ergebnis | Beleg |
|---|---|---|
| Äußere Ring-/Compojure-Middleware lesen | polylith-realworld: **0 → 11** Middleware-Einträge für `POST /api/articles` | [Benchmark q13](docs/BENCHMARK.md#positive-questions), [Fixture](test/fixtures/ring-middleware/) |
| Frontend-Routentabellen in einem anderen Namespace lesen | Logseq: **0 → 17** Client-Routenknoten | [Abdeckung](docs/COVERAGE.md), [Benchmark q14](docs/BENCHMARK.md#positive-questions) |
| `re-frame.alpha` erkennen | Registrierungen und Dispatches über den Alpha-Namespace werden extrahiert | [Benchmark-Verlauf](docs/BENCHMARK.md), [Fixture](test/fixtures/reframe/src/app/alpha.cljs) |
| Die clj-kondo-Konfiguration des Projekts anwenden | Makro-Zuordnungen und Hooks des Projekts fließen in die Analyse ein | [Konfigurations-Fixture](test/fixtures/project-config/), [Tests](test/config.test.ts) |

### Benchmark

Der aufgezeichnete Benchmark besteht **14/14 positive Fragen** und **7/7 Abwesenheitsfragen**, mit erwarteten Antworten, die von Hand
gegen den Quellcode geprüft wurden. Er ist ein kleiner Regressions-Benchmark, keine allgemeine Genauigkeitsschätzung. Dreizehn
positive Antworten nutzen MCP-Tools; die Client-Routen-Frage liest Graphknoten direkt, da noch kein Tool
Client-Routen auflistet. [Fragen, Ergebnisse und Methodik](docs/BENCHMARK.md).

## Wie Atlas getestet wird

Ein Werkzeug, dem Agenten vertrauen, darf keine Beziehungen erfinden. Vor diesem Release durchlief der Code:

| Prüfung | Ergebnis |
|---|---|
| Automatisierte Tests | **831**, alle bestanden; jeder behobene Fehler hat einen Test, der vor der Korrektur fehlschlug |
| Quellcode-Zeilenabdeckung | **99.75%**; CI schlägt unter 98% fehl |
| Fehlerjagden | Ein Reviewer pro Modul suchte mit lauffähigen Reproduktionen nach falschen Antworten; **85** bewiesene Fehler gefunden und behoben |
| Unabhängige Reviews | **Sechs** Runden durch Reviewer, die den Code nicht geschrieben hatten, mit Bewertung von Korrektheit, Sauberkeit, Regeln und Tests pro Modul, bis jedes Modul mindestens 4 von 5 erreichte |
| Echte Repositories | **26** öffentliche Projekte bauen ohne Absturz und mit **0** verlorenen Kanten (zuvor 690 bei sechs davon) |
| Nicht vertrauenswürdige Repositories | Feindliche Fixtures prüfen, dass Git-Einstellungen, Filter-Treiber, Submodule, Projekt-TypeScript, ungewöhnliche Dateinamen und hängende clj-kondo-Hooks nichts ausführen und nichts blockieren; die Suche nach ausführbaren Dateien überspringt das Repository-Verzeichnis (unit-getestet; Windows selbst ist ungetestet) |
| Referenzwahrheit | Der [Benchmark](docs/BENCHMARK.md) oben: 14 positive und 7 Abwesenheitsfragen, Antworten von Hand geprüft |

Die Abwesenheitsfragen sind am wichtigsten: Sie prüfen, dass Atlas „not found“, „not extracted“ oder „degraded“ sagt, wo das
der Wahrheit entspricht, statt einer leeren Liste, die wie „keine“ wirkt.

## Mitwirken

**Let's build our Clojure X-ray tool together! (Lasst uns gemeinsam unser Clojure-Röntgenwerkzeug bauen!)**

Ein nützlicher Beitrag kann mit einem winzigen Clojure-Beispiel beginnen: „Diese Bibliothek verbindet diese beiden Dinge, und Atlas
sollte das sehen.“ Fügen Sie ein Fixture und die erwarteten Graph-Zeilen hinzu oder helfen Sie, den Adapter zu implementieren. Beides ist willkommen.

```sh
npm ci
npm test
npm run test:coverage   # 98% source line-coverage gate
npm run typecheck
```

Die CLI ist für eine unkomplizierte Node-Verteilung in TypeScript geschrieben; clj-kondo führt die Clojure-Analyse durch.
[Leitfaden für Mitwirkende](CONTRIBUTING.md) · [Roadmap](ROADMAP.md) · [Tool-Referenz](docs/GUIDE.md)

## Danksagung und Lizenz

Erstellt von **Barış Can Ateş**. [MIT-lizenziert](LICENSE), einschließlich der Dokumentation und der originalen Grafiken in diesem
Repository. Gebaut auf **[clj-kondo](https://github.com/clj-kondo/clj-kondo)** von Michiel Borkent, mit
**[MCP](https://modelcontextprotocol.io)** als Schnittstelle zu Coding-Agenten. Dank an die Autoren der öffentlichen
Projekte, die im Korpus und in den Beispielen verwendet werden. Diese Projekte und Abhängigkeiten behalten ihre eigenen Lizenzen.

*For the sake of all Clojurians.*
