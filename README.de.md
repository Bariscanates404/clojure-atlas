# clojure-atlas

**Für agentengestütztes Programmieren entwickelt: eine strukturelle Karte deiner Clojure-Codebasis, die deinem KI-Agenten über MCP bereitgestellt wird.**

Bevor ein Agent Clojure-, ClojureScript- oder `.cljc`-Code bearbeitet, sollte er wissen, wer die Funktion aufruft, welchen Parametersatz sie entgegennimmt, welche Map-Schlüssel jeder Aufrufer übergibt und der Funktionsrumpf liest und welche Routen, re-frame-Ereignisse und Tests damit verbunden sind. clojure-atlas erstellt diese Karte auf deinem Rechner mit [clj-kondo](https://github.com/clj-kondo/clj-kondo) und antwortet über **13 MCP-Tools**. Jede Zeile nennt `file:line` und gibt an, ob sie bewiesen, heuristisch oder unbekannt ist.

![clojure-atlas: Erzeuger, Map-Parametersatz, Verbraucher; Aufrufe, Ereignisse, Routen und Tests als lokaler Graph hinter MCP-Tools](docs/assets/atlas.svg)

[![Kontinuierliche Integration](https://github.com/Bariscanates404/clojure-atlas/actions/workflows/ci.yml/badge.svg)](https://github.com/Bariscanates404/clojure-atlas/actions/workflows/ci.yml)
[![Lizenz: MIT](https://img.shields.io/badge/license-MIT-91d5b6?style=flat-square&labelColor=17252b)](LICENSE)
[![Node.js: 22.18+](https://img.shields.io/badge/Node.js-22.18%2B-91d5b6?style=flat-square&labelColor=17252b)](#anforderungen)
[![MCP: stdio](https://img.shields.io/badge/MCP-stdio-91d5b6?style=flat-square&labelColor=17252b)](#schnellstart)
[![Erforderliche npm-Laufzeitabhängigkeiten: 0](https://img.shields.io/badge/npm_runtime_dependencies-0-91d5b6?style=flat-square&labelColor=17252b)](#von-grund-auf-lokal)

**Keine erforderlichen npm-Laufzeitabhängigkeiten. Lokale Analyse.**

Ein persönliches Projekt von **Barış Can Ateş** · MIT-lizenziert · auf clj-kondo aufgebaut.

[Warum](#warum-ein-agent-es-nutzen-sollte) · [Parametersätze und Map-Schlüssel](#erzeuger--parametersatz--verbraucher) ·
[Unterstützter Stack](#unterstützung-für-sprachen-und-frameworks) · [Beispiele](#echte-beispiele-zum-erneuten-ausführen) ·
[Schnellstart](#schnellstart) · [Evidenzklassen](#eine-antwort-lesen) · [Grenzen](#grenzen) ·
[Messungen](#messungen) · [Vollständiger Leitfaden](docs/GUIDE.md)

[English](README.md) | [Türkçe](README.tr.md) | Deutsch | [Español](README.es.md) | [Português (Brasil)](README.pt-BR.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md)

## Warum ein Agent es nutzen sollte

Eine Textsuche findet eine Schreibweise. Sie unterscheidet keinen Aufruf von einem Callback, keinen Map-Schlüssel von einem zufällig gleich geschriebenen Keyword und keinen über ein re-frame-Ereignis erreichten Handler von einem, der nie registriert wird. Ein Agent, der auf Verdacht Änderungen vornimmt, beschädigt einen Aufrufer, den er nie gesehen hat. Atlas liefert ihm vor der Änderung die Beziehungen samt den Belegen für jede einzelne.

| Der Agent fragt | Atlas antwortet mit | MCP-Tools |
|---|---|---|
| Wer ruft das auf, und wohin könnte meine Änderung reichen? | Direkte Aufrufer, Verwendungen als Wert und Callbacks, transitive Abhängige | `callers`, `blast_radius` |
| Welchen Parametersatz nimmt die Funktion entgegen, und was übergibt jeder Aufrufer? | Aritäten, per Destructuring gebundene Schlüssel, `:or`-Standardwerte und optionale Schlüssel, Keyword-Argumente, die an jeder Aufrufstelle übergebenen Schlüssel | `signature_impact` |
| Welche Aufrufer sind betroffen, wenn ich einen Schlüssel hinzufüge, entferne oder verlange? | Aufrufer, die einen neuen erforderlichen Schlüssel nicht übergeben, einen entfernten weiterhin übergeben oder eine weggefallene Arität verwenden | `signature_impact` mit `added_keys`, `removed_keys`, `arities` oder `base_graph` |
| Wer erzeugt diesen Map-Schlüssel und wer verbraucht ihn? | Erzeuger- und Verbraucherstellen des Keywords | `key_flow` |
| Fehlt dieser Konfigurationszeile ein Schlüssel, den ihre Geschwister haben? | Zeilen einer literalen Tabelle, denen ein Schlüssel fehlt, den die meisten Geschwister besitzen | `key_siblings` |
| Was verarbeitet diesen Endpunkt, und wo wird die Berechtigung geprüft? | Handler, Middleware in Reihenfolge, vom Projekt deklarierte Berechtigungsprüfungen | `route_authz`, `permission_routes` |
| Was geschieht, wenn dieses re-frame-Ereignis ausgelöst wird? | Dispatch-Stellen, Handler, Subscriptions, HTTP-Anfragen | `event_flow` |
| Wer liest oder schreibt dieses Datenbankattribut? | Bewiesene Lese- und Schreibzugriffe; unbewiesene Referenzen bleiben sichtbar | `attribute_usage` |
| Welche Tests beziehen sich auf diese Änderung? | Statisch verknüpfte Unit-Tests und Playwright-Tests sowie ein Review-Kontext für geänderte Zeilen | `tests_for`, `tests_covering`, `context_for_change` |
| Was weiß dieser Graph, und was hat er übersehen? | Quell-Commit, aktive Adapter, Evidenzanzahlen, Abdeckungswarnungen | `graph_info` |

Atlas zeigt, wo du nachsehen solltest. Ob es ein Fehler ist, entscheiden weiterhin du und dein Agent.

## Erzeuger → Parametersatz → Verbraucher

Dies ist die Ebene, oberhalb derer die meisten Tools aufhören: nicht nur, *wer `line-total` aufruft*, sondern welche Schlüssel der Aufruf übergibt und welche davon die Funktion liest. Das Beispiel ist eine Fixture in diesem Repository: [test/fixtures/keys/src/cart/core.clj](test/fixtures/keys/src/cart/core.clj).

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

Ein Map-Parameter in Clojure ist offen, und die Antwort ist darauf ausgerichtet:

| Schlüsselart | Bedeutung | So meldet Atlas sie |
|---|---|---|
| **Erforderlich** | Per Destructuring gebunden, ohne `:or`-Standardwert, und der Rumpf prüft ihn weder noch greift er auf einen Ersatzwert zurück | Ein Befund, wenn kein Aufrufer ihn übergibt; ein neuer macht Aufrufer „betroffen“ |
| **Optional** | Hat einen `:or`-Standardwert, wird mit Standardwert gelesen (`(get m :k d)`), wird auf Vorhandensein geprüft (`(contains? m :k)`) oder wird nur dort verwendet, wo ein Wert geprüft oder durch einen Ersatzwert aufgefangen wird (`(or k d)`, `(if k …)`, `(when-let [x k] …)`) | Bei der Arität als `optional:` aufgeführt; bei Fehlen niemals ein Befund |
| **Zusätzlich** | Ein Aufrufer übergibt ihn, die Funktion liest ihn nie | Unter `extra keys` aufgeführt. Er beschädigt nichts. Ein Befund ist er nur, wenn er wie ein Tippfehler eines Schlüssels aussieht, den die Funktion tatsächlich liest und der in diesem Aufruf fehlt (`:usrname` neben `:username`); dann ist er HEURISTIC |
| **Nicht beweisbar** | Die Map wird weitergereicht, in einer lokalen Variablen gehalten oder der Parameter wird an eine andere Funktion übergeben | UNKNOWN, mit Begründung |

Frage vor einer Änderung, was sie bewirken würde:

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

`added_keys` bezeichnet Schlüssel, die durch die Änderung **erforderlich** werden. Werden zwei Graphen mit `base_graph` verglichen, betrifft ein Schlüssel, den der neue Rumpf nur optional liest, keinen Aufrufer.

Und verfolge einen Schlüssel durch das Projekt:

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

**Was diese Ebene ist und was sie nicht ist:**

- Sie zeigt statische, aus dem Quelltext gelesene Schlüsselverwendung. Sie ist weder Typprüfung noch Schemavalidierung; kein Wert wird untersucht.
- `key_flow` arbeitet mit **Keyword-Vorkommen**. Es führt alle Maps zusammen, die `:total` verwenden; es verfolgt keine einzelne Map von ihrer Erzeugung bis zu der Stelle, die sie liest.
- Verschachtelte Maps werden nicht pfadsensitiv behandelt. `{:meta {:count 1}}` erzeugt `:meta` und `:count` als zwei getrennte Schlüssel; `(get-in cart [:meta :count])` verbraucht beide. `signature_impact` erfasst bei verschachteltem Destructuring und bei `get-in` nur den **äußeren Schlüssel**.
- Eine weitergereichte, zusammengeführte, mit `keyword` erzeugte oder in einer lokalen Variablen gehaltene Map ist UNKNOWN, und die Antwort sagt das.

## Unterstützung für Sprachen und Frameworks

**Sprachen:** Clojure (`.clj`), ClojureScript (`.cljs`) und gemeinsam genutzter Code (`.cljc`). EDN-Dateien liefern die unten aufgeführten Konfigurations- und Datenformen. TypeScript (`.ts`) wird nur für die optionale Playwright-Integration gelesen; Atlas ist kein JavaScript- oder TypeScript-Analysator.

| Bereich | Erkannt | Ergebnis | Grenzen |
|---|---|---|---|
| Clojure-Kern | Vars, Aufrufe, Verwendungen als Wert, Callbacks, Multimethoden, Protokolle, Records | Definitionen und Abhängigkeitsbeziehungen | Dispatch-Kandidaten sind heuristisch; zur Laufzeit aufgelöste Vars werden nicht verfolgt |
| Parametersätze | `defn`/`defn-`-Aritäten, Map-Destructuring, `:or`, `:as`, `& {:keys […]}`, `schema.core/defn`, Makros, die deine clj-kondo-Konfiguration als `defn` lintet | Entgegengenommene Schlüssel, optionale Schlüssel, an jeder Aufrufstelle übergebene Schlüssel, Auswirkungen einer Signaturänderung | Bei verschachtelten Mustern nur der äußere Schlüssel; eine `.cljc`-Funktion mit je nach Plattform unterschiedlichen Parametern erhält keine Signatur; Befunde zu einer per Makro definierten Funktion sind heuristisch |
| Map-Schlüssel | Map-Literale, `assoc`, `assoc-in`, `update`, `hash-map`, `dissoc`, Keyword-Zugriff, `get`, `get-in`, `select-keys`, `contains?`, Destructuring | Erzeuger-, Verbraucher- und Entfernungsstellen je Keyword; Lücken in Geschwisterzeilen literaler Tabellen | Keyword-Vorkommen, keine Map-Identität; Positionen in Threading-Formen sind heuristisch; ein Muster ohne `:keys` in einem nicht aufgeführten Bindungsmakro wird als Literal gelesen |
| Makros | `:lint-as` und Hooks aus der `.clj-kondo/config.edn` des Projekts sowie `:lint-as` in `.clojure-atlas.edn` | Verwendungen innerhalb eines clj-kondo beigebrachten Makros sind bewiesen | Verwendungen innerhalb eines nicht beigebrachten Makros sind heuristisch und nennen das Makro |
| Frontend-Zustand | **re-frame**, einschließlich `re-frame.alpha` | Ereignis- und Subscription-Registrierungen, Dispatches, Subscription-Eingaben, Subscriber | Ein Dispatch mit berechneter Ereignis-ID ist UNKNOWN; was `reg-fx`- und cofx-Handler tun und die Reihenfolge von `:fx` werden nicht verfolgt |
| Backend-Routing | Tabellenrouten von **Compojure**, **Reitit**, **Pedestal** | Pfade, eingebundene Routenkopien, Handler | bidi, compojure-api und ausführliche Map-Routen von Pedestal werden nicht gelesen |
| Middleware | **Ring**, Compojure `wrap-routes`, Reitit-Routendaten und `ring-handler` | Geordnete Ketten einschließlich äußerer Wrapper | Ketten sind heuristisch; Interceptoren aus Pedestal-Service-Maps werden nicht gelesen; nicht lesbares Wrapping wird als UNKNOWN gemeldet |
| Routenautorisierung | Vom Projekt deklarierte Berechtigungsschlüssel, Middleware und Funktionen | Welche Routen welche Berechtigung prüfen | Benötigt eine kleine `.clojure-atlas.edn`; ohne sie lautet die Antwort „nicht beweisbar“, niemals „keine“ |
| Browser-Routing | **Reitit frontend**, **Secretary** | Client-Routenknoten im Graphen | Noch kein MCP-Tool listet sie auf |
| HTTP-Anfragen | **cljs-ajax**, **cljs-http**, `js/fetch`, Request-Effect-Maps | Anfragestellen, die anhand von Methode und Pfad mit Backend-Routen verknüpft sind | Eine zur Laufzeit zusammengesetzte URL kann möglicherweise nicht verknüpft werden |
| Daten | **Datomic**, **DataScript**, **XTDB v1 / Crux** | Attribute, Transaktionsschreibzugriffe, Lesezugriffe durch Query und Pull | Unbewiesene Referenzen bleiben als UNKNOWN-Zeilen erhalten; keine SQL-Analyse (next.jdbc, HoneySQL) |
| Systemlebenszyklus | **Integrant**, **Mount**, **Component** | Systemschlüssel, Registrierungen, Abhängigkeitskanten | Integrant-Systeme ohne Referenzen werden nicht gelesen |
| Schemata | **clojure.spec / cljs.spec**, **Malli** | Registrierte Specs, in Vars gehaltene Malli-Schemata | Malli-Registries werden nicht gelesen; Schemata werden nicht gegen Maps geprüft |
| Tests | **clojure.test / cljs.test**, **Playwright**, literale Hiccup-Selektoren | Statische Testverknüpfungen | Playwright benötigt optional TypeScript 5; eine Fixture aus `test.extend` ohne Typargument hat keine Klasse und wird daher nicht verknüpft; Tests, die Code über HTTP oder `resolve` erreichen, werden nicht verknüpft |
| Projektstruktur | **deps.edn**, **Leiningen**, **shadow-cljs**, **Babashka**, **Boot**, **Polylith** | Quellensuche, Gruppierung nach Komponente | Build-Aliase und Tasks werden nicht analysiert |

Ein Adapter erkennt bestimmte Quellformen, nicht jede Verwendung einer Bibliothek. `graph_info` meldet, welche Adapter in **deinem** Projekt aktiviert wurden. Fulcro, Pathom, HoneySQL und next.jdbc sind im Messkorpus enthalten; das bedeutet nicht, dass sie einen eigenen Adapter haben. Die [Roadmap](ROADMAP.md) listet auf, was fehlt.

## Echte Beispiele zum erneuten Ausführen

Die folgenden Auszüge sind echte Serverausgaben auf den [in `examples/` eingecheckten Graphen](examples/), erstellt aus öffentlichen Projekten an den in [corpus.json](corpus.json) festgelegten Commits. `[S]` bedeutet bewiesen, `[H]` heuristisch, `[?]` unbekannt. Die erste Zeile jedes Blocks ist der MCP-Tool-Aufruf deines Agenten. Um einen selbst ohne MCP-Client auszuführen, verwende einen Klon dieses Repositorys:

```sh
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"signature_impact","arguments":{"fn":"clojure.realworld.user.core/login!","group_by":"none"}}}' \
  | node src/cli.ts mcp --graph examples/polylith-realworld.json.gz \
  | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).result.content[0].text'
```

Die obigen `cart`-Antworten stammen aus `node src/cli.ts build test/fixtures/keys -o /tmp/cart.json.gz` und derselben Pipe mit `--graph /tmp/cart.json.gz`.

### Der Parametersatz einer Funktion neben den Übergaben ihrer Aufrufer

In polylith-realworld nimmt `login!` eine Map entgegen und bindet `:email` und `:password` per Destructuring:

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

Ein Map-Literal zeigt seine Schlüssel. Die als `login-input` übergebene Map bleibt unbekannt: `[S]` in dieser Zeile beweist den Aufruf, nicht den Inhalt einer Map zur Laufzeit.

<details>
<summary><strong>Was passiert, wenn <code>login!</code> anfängt, <code>:tenant-id</code> zu verlangen?</strong></summary>

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

Die drei Aufrufer, die ein Map-Literal übergeben, lassen den neuen Schlüssel aus. Der vierte reicht `login-input` weiter, daher ist seine Zeile UNKNOWN. Nichts wird verändert; dies ist eine Frage zu einer Änderung, die du noch nicht vorgenommen hast.

</details>

<details>
<summary><strong>Erzeuger und Verbraucher von <code>:email</code></strong></summary>

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

`:email` ist nicht namespacequalifiziert, daher wird hier jede Map gruppiert, die das Keyword verwendet. Dies beweist nicht, dass die Map eines Erzeugers einen Verbraucher erreicht.

</details>

<details>
<summary><strong>Aufrufer vor einem Refactoring</strong></summary>

Aus integrant:

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
<summary><strong>Ein re-frame-Ereignis: Dispatch-Stellen und Handler</strong></summary>

Aus re-frame:

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

Die Verbindung läuft über ein Ereignis-Keyword; eine Suche nach Aufrufern einer benannten Funktion würde sie daher übersehen.

</details>

<details>
<summary><strong>Die Middleware vor einem Endpunkt und was nicht geprüft werden konnte</strong></summary>

Aus polylith-realworld:

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

Der Handler ist bewiesen. Die Wrapper werden in Reihenfolge gefunden und mit `[H]` markiert, weil Middleware-Komposition Laufzeitcode ist. Das Projekt deklariert keine Berechtigungsregeln, daher lautet die Antwort **nicht extrahiert**, nicht „keine Prüfung“.

</details>

<details>
<summary><strong>Eine offen benannte Lücke: ein Name, der verwendet, aber nie definiert wird</strong></summary>

Aus next.jdbc, wo ein Makro Funktionen erzeugt, die clj-kondo nicht expandieren kann:

```text
callers {"var": "next.jdbc.types/as-other"}
```

```text
CALLERS next.jdbc.types/as-other — no definition matches "next.jdbc.types/as-other"; used at test/next/jdbc/sql_test.clj:290, test/next/jdbc_test.clj:559 but no definition was found
note: next.jdbc.types/as-other is used at test/next/jdbc/sql_test.clj:290, test/next/jdbc_test.clj:559 but no definition was found: probably defined by a macro clj-kondo cannot expand; add :lint-as for the macro in .clj-kondo/config.edn
note: use a fully qualified name (ns/name)
```

Die Antwort zeigt, wo der Name verwendet wird und wie du ihn sichtbar machst. Mit einem `:lint-as`-Eintrag für das Makro liefert dieselbe Frage eine bewiesene Definition ([Projektkonfiguration](docs/GUIDE.md#project-configuration)). next.jdbc gehört zum Korpus, nicht zu den eingecheckten Beispielgraphen.

</details>

<details>
<summary><strong>Geänderte Zeilen als Review-Kontext und zugehörige Tests</strong></summary>

Aus polylith-realworld:

```text
context_for_change {"changes": ["components/article/src/clojure/realworld/article/store.clj:60-80"], "limit": 3}
```

```text
CONTEXT_FOR_CHANGE components/article/src/clojure/realworld/article/store.clj:60-80 — 1 file(s), 3 changed symbol(s), 0 route(s), 0 attribute(s); risk LOW
counts: changed symbols=3 [S3]  callers outside the diff=9 [S9]  tests to run=24 [S24]
[... trimmed ...]
```

Die vollständige Antwort listet die drei geänderten Definitionen, neun Aufrufer außerhalb des Diffs und 24 zugehörige Tests auf ([vollständiges Transkript](docs/GUIDE.md#context_for_change)). `LOW` beschreibt die Prüfungen, die der Graph vornehmen konnte. Es ist keine Sicherheitsgarantie.

</details>

[Weitere Transkripte](examples/README.md) · [Jedes Tool mit vollständiger Antwort](docs/GUIDE.md#tools)

## Schnellstart

**Voraussetzungen:** Node.js **22.18+** und Git. Keine JVM und kein Babashka.

### 1. Installieren und einen Graphen erstellen

Im Stammverzeichnis des **Clojure-Projekts, das du analysieren möchtest**:

```sh
npm install --save-dev 'git+https://github.com/Bariscanates404/clojure-atlas.git'
npx clojure-atlas build
```

Das Paket ist nicht in der npm-Registry; es wird aus Git installiert, und diese Installation kompiliert die CLI. Um die von dir geprüfte Revision festzulegen, hänge `#<commit-sha>` an die URL an. TypeScript und die Node-Typdefinitionen werden nur für diesen Kompilierungsschritt benötigt; die installierte CLI hat keine erforderliche npm-Laufzeitabhängigkeit.

Der Graph wird nach `.clojure-atlas/graph.json.gz` geschrieben. Der erste Build lädt das festgelegte clj-kondo-Binary herunter und prüft dessen SHA-256; spätere Builds nutzen das gecachte Binary. Füge `.clojure-atlas/` zu deiner `.gitignore` hinzu.

### 2. Deinen MCP-Client verbinden

Für Claude Code zunächst die Projektkonfiguration als Vorschau anzeigen und dann schreiben:

```sh
npx clojure-atlas init         # preview .mcp.json
npx clojure-atlas init --yes   # write it; existing servers are kept
```

Bitte den Agenten anschließend, `graph_info` und `callers` für einen voll qualifizierten `ns/name` aus deinem Projekt aufzurufen.

<details>
<summary><strong>Ein anderer MCP-Client</strong></summary>

Atlas spricht **MCP über stdio**. Starte es im Stammverzeichnis deines Projekts:

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

Falls der Client Server anderswo startet, lege sein Arbeitsverzeichnis fest oder verwende absolute Pfade für CLI, Graph und Repository. Die Konfigurationsformate unterscheiden sich je nach Client.

</details>

### 3. Nach Änderungen neu erstellen

```sh
npx clojure-atlas build      # refresh the snapshot
npx clojure-atlas coverage   # resolution counts and unresolved names
```

Es gibt keinen Watch-Modus. Mit `--repo` beginnen Antworten mit `STALE`, sobald der Arbeitsbaum nicht mehr zum Graphen passt. Starte den MCP-Server nach einem erneuten Build neu, damit er den neuen Graphen lädt.

**Makros und deine clj-kondo-Konfiguration.** Atlas wendet die `.clj-kondo/config.edn` des Projekts an, einschließlich `:lint-as` und Hooks. Ein als `defn` gelintetes Makro erhält eine Signatur; ein clj-kondo nicht beigebrachtes Makro macht die Verwendungen in seinem Inneren heuristisch, und die Antwort nennt das Makro. Eine optionale `.clojure-atlas.edn` ergänzt Routenmakros und Autorisierungsregeln: [Projektkonfiguration](docs/GUIDE.md#project-configuration), [Autorisierungs-Fixture](test/fixtures/authz/.clojure-atlas.edn).

## Eine Antwort lesen

| Markierung | Bedeutung | Umgang damit |
|---|---|---|
| `[S]` `STATIC_PROVEN` | Von clj-kondo aufgelöst oder aus einer literalen Quellform gelesen | Folge der angegebenen Stelle `file:line` |
| `[H]` `HEURISTIC` | Aus einem Namen, einem Wrapper, einer Position in einer Threading-Form, einem Dispatch-Kandidaten oder einem für Atlas undurchsichtigen Makro abgeleitet | Öffne die angegebene Zeile, bevor du daraufhin handelst |
| `[?]` `UNKNOWN` | Statisch nicht entscheidbar | Behandle es als Grenze dessen, was der Graph weiß |

**Eine leere Antwort beweist keine Abwesenheit.** Atlas unterscheidet „nichts gefunden“, „Definition nicht gefunden“ und „Fähigkeit nicht in diesem Graphen“. `DEGRADED` warnt vor einem fehlenden Teil der Analyse, `STALE` vor einem alten Snapshot. Null Tests bedeutet, dass keine statische Verknüpfung gefunden wurde, nicht, dass der Code ungetestet ist.
[Klassen und Abwesenheit im Detail](docs/GUIDE.md#bands-and-absence)

## Grenzen

> [!WARNING]
> **Was Atlas übersehen kann. Lies dies, bevor du einer leeren Antwort vertraust.**
>
> - **Definitionen aus einem Makro, das clj-kondo nicht beigebracht wurde.** Ein projektinternes `defthing` oder eine Bibliotheks-DSL ohne mitgelieferte clj-kondo-Konfiguration definiert Vars, die der Graph nicht enthält: Ihre Aufrufer erscheinen als *unaufgelöst*, und Code innerhalb eines solchen Makros ist nur heuristisch. Deshalb erreicht DataScript im Korpus eine Auflösung von 89.9%. Bringe clj-kondo das Makro bei (`:lint-as` oder ein Hook in `.clj-kondo/config.edn`), erstelle den Graphen neu, und sie sind wieder da. Die Antwort nennt das Makro.
> - **Alles, was zur Laufzeit entschieden wird.** Ein mit `resolve` aus einem berechneten Symbol gefundenes Var, eine aus einer Map ausgewählte Funktion, die Argumentanzahl hinter `apply` oder `partial`, ein mit `keyword` erzeugter Schlüssel, eine zusammengeführte oder weitergereichte Map. Diese werden als UNKNOWN gemeldet, niemals geraten.
> - **Dispatch.** Ziele eines Multimethoden- oder Protokollaufrufs sind Kandidaten, kein Beweis.
> - **Skripte ohne `ns`-Form** (REPL-Tutorials): day-of-datomic erreicht eine Auflösung von 74.3%.
> - **Dateien, die clj-kondo nicht parsen kann, und Dateien über 2 MB.** Ihre Definitionen fehlen; jede Antwort beginnt dann mit `DEGRADED` und nennt sie.

- **Nur statisch.** Zur Laufzeit aufgelöste Vars, durch Daten ausgewählte Funktionen und mit `keyword` erzeugte Schlüssel werden nicht verfolgt.
- **Map-Schlüssel sind Keyword-Vorkommen**, und verschachtelte Maps tragen äußere Schlüssel bei, wie [oben](#erzeuger--parametersatz--verbraucher) beschrieben. Es gibt keinen pfadsensitiven Datenfluss.
- **Optionale Schlüssel werden aus der Form des Rumpfs abgelesen.** Ein innerhalb der Funktion erneut gebundener Name wird nicht verfolgt, sodass ein Schlüssel optional genannt werden kann, der es nicht ist. Der umgekehrte Fall tritt nicht auf.
- **Makros.** clj-kondo sieht nur mit einem `:lint-as`-Eintrag oder einem Hook durch ein Makro hindurch. Ein Bindungsmuster ohne `:keys` innerhalb eines von Atlas nicht aufgeführten Bindungsmakros wird als Map-Literal gelesen.
- **Middleware und Berechtigungen.** Ketten sind heuristisch; Routenberechtigungen benötigen `.clojure-atlas.edn`.
- **Kein inkrementeller Build.** Nach Änderungen neu erstellen.
- **Windows ist ungetestet.**

Die vollständige Liste steht im [Leitfaden](docs/GUIDE.md#limits); Geplantes steht in der [Roadmap](ROADMAP.md).

## Von Grund auf lokal

Die Kern-CLI hat **keine erforderlichen npm-Laufzeitabhängigkeiten**. Sie verwendet Nodes Standardbibliothek, clj-kondo für die Analyse und Git für Repository-Metadaten. Der Graph wird auf deinem Rechner erstellt und abgefragt: kein Konto, kein gehosteter Index, keine Telemetrie.

### Anforderungen

| Komponente | Rolle |
|---|---|
| Node.js 22.18+ | Führt die CLI und den MCP-Server aus |
| clj-kondo 2025.10.23 | Nativer Analysator; einmal heruntergeladen und gecacht, SHA-256 des Archivs festgelegt |
| Git | Installation aus Git, Prüfungen versionierter Dateien, Snapshot- und Veraltungsinformationen |
| TypeScript 5, optional | Nur Playwright-Page-Object- und Testanalyse; `npm i -D typescript@5` neben Atlas |

Festgelegte Binaries gibt es für macOS arm64/x64, Linux arm64/x64 und Windows x64. Entwicklung und Korpusmessungen liefen auf macOS arm64. Ist der Download nicht verfügbar, etwa hinter einem Proxy, greift Atlas auf ein `clj-kondo` im `PATH` zurück. [Details zu Plattformen und Cache](docs/GUIDE.md#requirements)

### Sicherheit

Wenige Abhängigkeiten verringern die Angriffsfläche. Sie geben **keine** Lieferkettengarantie.

- Ein heruntergeladenes clj-kondo-Archiv wird gegen eine festgelegte SHA-256 geprüft und bei Abweichung abgelehnt. Ein aus dem `PATH` bezogenes `clj-kondo` wird so als vertrauenswürdig behandelt, wie du es installiert hast; es wird nicht gegen diesen Hash geprüft.
- Atlas startet weder die JVM der analysierten Anwendung noch ihre Shell-Skripte oder ihren Node-Code. **Die clj-kondo-Hooks des Projekts werden von clj-kondo interpretiert**; diese Konfiguration ist also Code, dem du beim Analysieren eines Repositorys vertraust.
- Der MCP-Server liest den Graphen und führt ausschließlich lesende Git-Prüfungen mit Zeitlimits aus, wobei Git-Hooks, Filtertreiber und fsmonitor deaktiviert sind.
- Ergebnisse werden lokal über stdio bereitgestellt. Was dein KI-Client damit macht, ist eine separate Datenschutzgrenze.

Dies sind Eigenschaften der Implementierung, nicht das Ergebnis eines Sicherheitsaudits.
[Ausführungsmodell](docs/GUIDE.md#security)

## Messungen

Gemessen an **26 öffentlichen Repositorys**, jeweils auf einen Commit in [corpus.json](corpus.json) festgelegt. Vollständige Tabelle: [docs/COVERAGE.md](docs/COVERAGE.md).

| Auf einen Blick | |
|---|---|
| Repositorys, die sich in einen Graphen überführen lassen | **26 von 26**, kein Absturz, 0 verworfene Kanten |
| Umfang des Gelesenen | 10,158 Quelldateien, 141,604 Definitionen, 1,927,681 Kanten |
| Mit ihrer Definition verknüpfte Var-Verwendungen in Projekt-Namespaces | **601,991 von 602,877 (99.85%)**; 886 unaufgelöst |
| Pro Repository | Median 100.0%; 24 von 26 bei 99.3% oder mehr; die beiden darunter liegen bei 89.9% und 74.3% |
| Symbole, die clj-kondo keinem Namespace zuordnen konnte | **18,517**, gezählt und angezeigt, nicht verknüpft und nicht in der Rate enthalten |
| Dateien, die clj-kondo nicht vollständig parsen konnte | 24 |
| Benchmark mit von Hand geprüften Antworten | 14 von 14 positiven Fragen, 7 von 7 Abwesenheitsfragen |

Diese Zahlen zeigen, wie viel der *statischen* Codestruktur dieser Projekte den Graphen erreicht. Sie sind kein Versprechen für dein Projekt: Eine Codebasis auf Makros, die clj-kondo nicht beigebracht wurden, liegt bis zur Konfiguration eher bei DataScript als bei Metabase. `npx clojure-atlas coverage` gibt dieselben Anzahlen für dein Projekt aus.

### Auflösungsrate mit den Anzahlen daneben

Die **Auflösungsrate** ist `resolved / (resolved + unresolved)` für Var-Verwendungen, die clj-kondo einem Projekt-Namespace zuordnet. Sie ist nicht die Genauigkeit der Analyse. Bibliotheksverwendungen sind ausgeschlossen, ebenso **Verwendungen mit unbekanntem Namespace**: Symbole, die clj-kondo keinem Namespace zuordnen konnte und die lokale Bindungen eines unbekannten Makros oder vom Graphen übersehene Var-Verwendungen sein können. Statisch lässt sich beides nicht unterscheiden, daher werden sie als Rohanzahl angezeigt und niemals in die Rate eingerechnet.

| Repository | Aufgelöst | Unaufgelöst | Auflösungsrate | Unbekannter Namespace (roh, außerhalb der Rate) |
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
| **Alle 26 Repositorys** | | | **Median 100.0%; 24 von 26 bei 99.3% oder mehr** | **18,517 insgesamt** |

† [erläutert in docs/COVERAGE.md](docs/COVERAGE.md#repos-under-95-resolution-rate-or-with-unknown-namespace-usages-above-5-of-resolved)

**Eine geänderte Definition ist keine Verbesserung.** Der erste Abdeckungsbericht dieses Projekts teilte durch `resolved + unresolved + unknown` und zeigte Babashka mit 87.0%. Die heutigen 99.6% verwenden die obige Definition. Fast der gesamte Unterschied liegt im Nenner: Verwendungen mit unbekanntem Namespace wurden aus der Rate entfernt, nicht aufgelöst, und 2,176 davon stehen weiterhin in der letzten Spalte. Vergleiche keine Raten über diese beiden Definitionen hinweg.

### Was die Extraktion tatsächlich hinzugewonnen hat

Änderungen daran, was Atlas liest, jeweils mit Fixture oder Test, getrennt von der obigen Rate.

| Änderung | Gemessenes Ergebnis | Beleg |
|---|---|---|
| Ein Map-Literal von einem Bindungsmuster unterscheiden | Über die 26 Korpus-Repositorys hinweg: **5,475** Erzeugerstellen hinzugewonnen (Maps in einem zurückgegebenen Vektor, hiccup, Routendaten, `(d/transact conn [{…}])`); **703** Keyword-Werte werden nicht mehr als bewiesene „Destructuring“-Verbraucher aufgeführt; **5,268** `:keys` / `:as` / `:or`-Einträge werden nicht mehr als erzeugte Schlüssel aufgeführt | [Tests](test/keys-adapter.test.ts), Fixtures [authz](test/fixtures/authz/), [Daten](test/fixtures/data/), [reframe](test/fixtures/reframe/) |
| Eine Signatur nur erfassen, wenn clj-kondo dieselben Parameter zählt | **532** Funktionen, die durch eine als `defn` gelintete Form definiert werden, erhielten eine Signatur (216 in Metabase); **22** `.cljc`-Funktionen mit plattformabhängigen Parametern erhalten keine falsche mehr (DataScripts `first-seq` wurde als `[xs xs]` gelesen); `s/defn`-Annotationen werden nicht mehr als Parameter gezählt | [Tests](test/signatures.test.ts) |
| Lesen, wie ein einfacher Parameter verwendet wird | Einfache Parameter mit vollständig bekannten Lesezugriffen: **3,496 → 4,184** (ein `let`, das den Parameter per Destructuring zerlegt, `(-> m :k)`, `contains?`) | [Tests](test/signatures.test.ts) |
| Äußere Ring/Compojure-Middleware lesen | polylith-realworld: **0 → 11** Middleware-Einträge für `POST /api/articles` | [Benchmark q13](docs/BENCHMARK.md#positive-questions), [Fixture](test/fixtures/ring-middleware/) |
| Frontend-Routentabellen in einem anderen Namespace lesen | Logseq: **0 → 17** Client-Routenknoten | [Abdeckung](docs/COVERAGE.md), [Benchmark q14](docs/BENCHMARK.md#positive-questions) |
| `re-frame.alpha` erkennen | Registrierungen und Dispatches über den Alpha-Namespace werden extrahiert | [Fixture](test/fixtures/reframe/src/app/alpha.cljs) |
| Die clj-kondo-Konfiguration des Projekts anwenden | Die `:lint-as`-Einträge und Hooks des Projekts fließen in die Analyse ein | [Fixture](test/fixtures/project-config/), [Tests](test/config.test.ts) |
| Playwright-Fixtures ohne die `node_modules` des Projekts typisieren | Tests, die Page Objects aus `test.extend<…>`-Fixtures beziehen, werden in einem Checkout ohne installiertes `@playwright/test` mit den Page-Object-Membern verknüpft; in der Fixture: **0 → 12** Verknüpfungen | [Tests](test/playwright-fixtures.test.ts), [Fixture](test/fixtures/browser-fixtures/) |

Die ersten drei Zeilen vergleichen Graphen derselben festgelegten Commits vor und nach der Änderung. In diesem Vergleich änderte sich keine Kante eines anderen Typs, und die Anzahlen aufgelöster, unaufgelöster und unbekannten Namespaces zugehöriger Verwendungen sind identisch: Dies sind Änderungen dessen, was über Map-Schlüssel und Parameter gelesen wird, nicht der Auflösungsrate.

### Benchmark

Der aufgezeichnete Benchmark besteht **14 von 14 positiven Fragen** (40 von 40 erwarteten Zeilen gefunden) und **7 von 7 Abwesenheitsfragen**. Es ist ein kleiner Regressionsbenchmark mit von Hand am Quelltext geprüften Antworten, keine Genauigkeitsschätzung für dein Projekt. [Fragen, Ergebnisse und Methode](docs/BENCHMARK.md)

## Wie Atlas getestet wird

Ein Agent vertraut darauf, was er erhält; daher kostet eine falsche Antwort mehr als eine fehlende.

| Prüfung | Stand |
|---|---|
| Automatisierte Tests | **873**, alle erfolgreich (`npm test`); ein behobener Fehler erhält einen Test, der ohne die Korrektur fehlschlägt |
| Quellzeilenabdeckung | **99.79%** (`npm run test:coverage`; die Schranke schlägt unter 98% fehl) |
| Typprüfung | `npm run typecheck` fehlerfrei |
| Kontinuierliche Integration | [GitHub Actions](.github/workflows/ci.yml) führt bei jedem Push nach `main` und jedem Pull Request unter Linux mit Node.js 22 und 24 die Typprüfung und die Abdeckungsschranke aus |
| Fixtures | Kleine Clojure-Codebasen unter [test/fixtures](test/fixtures), bei denen jede erwartete Graphzeile von Hand geprüft wurde |
| Echte Repositorys | 26 öffentliche Projekte lassen sich ohne Absturz und mit 0 verworfenen Kanten erstellen |
| Benchmark | Positive Fragen und Abwesenheitsfragen mit von Hand geprüften Antworten ([docs/BENCHMARK.md](docs/BENCHMARK.md)) |
| Unabhängiges Review | Reviewer, die die Änderung nicht geschrieben haben, suchen mit ausführbaren Reproduktionen nach falschen Antworten; jeder bestätigte Defekt wird mit einem Test behoben |
| Nicht vertrauenswürdige Repositorys | Bösartige Fixtures prüfen, dass Git-Einstellungen, Filtertreiber, Submodule, projektinternes TypeScript, ungewöhnliche Dateinamen und hängende clj-kondo-Hooks nichts ausführen und nichts hängen lassen |

Die Abwesenheitsfragen sind am wichtigsten: Sie prüfen, ob Atlas „nicht gefunden“, „nicht extrahiert“ oder „beeinträchtigt“ sagt, wenn das der Wahrheit entspricht, statt einer leeren Liste, die wie „keine“ wirkt. Eine grüne Testsuite und ein Benchmark liefern Belege für diese Fixtures und diese Repositorys. Sie garantieren keine korrekte Antwort für deines; lies die Klasse jeder Zeile.

## Mitwirken

**Lasst uns unser Clojure-Röntgentool gemeinsam bauen!**

Ein nützlicher Beitrag kann ein winziges Clojure-Beispiel sein: „Diese Bibliothek verbindet diese beiden Dinge, und Atlas sollte das erkennen.“ Füge eine Fixture und die erwarteten Graphzeilen hinzu oder schreibe den Adapter. Beides ist willkommen, ebenso ein Fall, in dem Atlas dir eine falsche oder irreführende Antwort gegeben hat.

```sh
npm ci
npm test
npm run test:coverage   # 98% source line-coverage gate
npm run typecheck
```

Die CLI ist in TypeScript geschrieben, damit sie als reines Node ausgeliefert wird; clj-kondo übernimmt die Clojure-Analyse.
[Leitfaden für Mitwirkende](CONTRIBUTING.md) · [Roadmap](ROADMAP.md) · [Tool-Referenz](docs/GUIDE.md)

## Danksagung und Lizenz

Erstellt von **Barış Can Ateş**. [MIT-lizenziert](LICENSE), einschließlich Dokumentation und Grafiken. Aufgebaut auf **[clj-kondo](https://github.com/clj-kondo/clj-kondo)** von Michiel Borkent, mit **[MCP](https://modelcontextprotocol.io)** als Schnittstelle zu Programmieragenten. Danke an die Autoren der öffentlichen Projekte im Korpus und in den Beispielen; diese Projekte behalten ihre eigenen Lizenzen.

*Für alle Clojure-Entwickler.*
