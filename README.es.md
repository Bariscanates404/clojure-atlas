# clojure-atlas

**For the sake of all Clojurians.**

*Por el bien de todos los Clojurians.*

[English](README.md) | [Türkçe](README.tr.md) | [Deutsch](README.de.md) | Español | [Português (Brasil)](README.pt-BR.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md)

Un mapa estructural de un código base Clojure, ClojureScript o .cljc, servido a agentes de programación con IA como herramientas MCP.
Creado para el desarrollo agéntico. Licencia MIT. Creado por Barış Can Ateş.

## Qué es

Un agente que edita Clojure suele encontrar las relaciones con búsqueda de texto. La búsqueda de texto no distingue una
llamada de un keyword con el mismo nombre, no ve un handler registrado con `reg-event-fx`, una ruta que llega a un var
ni una función pasada a `partial`, y no puede decir "nada llama a esto" con confianza. clojure-atlas ejecuta
[clj-kondo](https://github.com/clj-kondo/clj-kondo) una vez sobre el proyecto, convierte su análisis en un grafo
(definiciones, llamadas, usos de valor, eventos re-frame, rutas, claves de sistema, atributos de datos, claves de mapa, tests)
y responde preguntas sobre él por MCP. Cada fila de una respuesta lleva una banda que indica cómo se probó, y cada
respuesta vacía indica qué se buscó y si el grafo puede saberlo siquiera.

## Inicio rápido

```sh
npm i -D clojure-atlas
npx clojure-atlas build
npx clojure-atlas init
```

`build` escribe `.clojure-atlas/graph.json.gz`. En el repo de integrant imprime:

```
clojure-atlas: 7 files, 138 definitions, 295 nodes, 1473 edges; resolution rate of var usages in recognized project namespaces 100.0% (442 of 442), 0 usages in an unknown namespace; 0.6 s -> .clojure-atlas/graph.json.gz
clojure-atlas: DEGRADED: 8 edge(s) dropped because an end was not a node; an empty or missing answer may be a gap in the graph, not absence
```

`init` muestra el `.mcp.json` del proyecto que escribiría y lo escribe solo con `--yes`:

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

Los demás servidores que ya estén en `.mcp.json` se conservan.

### Claude Code

`npx clojure-atlas init --yes` escribe el `.mcp.json` del proyecto, que Claude Code lee. También se puede añadir el servidor a mano:

```sh
claude mcp add clojure-atlas -- npx clojure-atlas mcp --graph .clojure-atlas/graph.json.gz --repo .
```

### Cualquier otro cliente MCP

El servidor habla MCP por stdio. La mayoría de los clientes aceptan este JSON:

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

### Comandos

```
usage:
  clojure-atlas build [dir] [-o .clojure-atlas/graph.json.gz]
  clojure-atlas mcp [--graph .clojure-atlas/graph.json.gz] [--repo <clone>] [--max-distance N]
  clojure-atlas coverage [graph]
  clojure-atlas init [--yes]
```

- `build` analiza `dir` (por defecto `.`) y escribe el grafo.
- `mcp` sirve un grafo. Con `--repo`, las respuestas empiezan con una línea `STALE` cuando el árbol de trabajo no es
  el mismo con el que se construyó el grafo, o cuando el commit que el agente pasa como `base` está a más de
  `--max-distance` commits de distancia (por defecto 20).
- `coverage` imprime la fila de cobertura de un grafo y sus nombres sin resolver más frecuentes.
- `init` añade el servidor al `.mcp.json` del proyecto.

Reconstruya el grafo después de cambiar el código. Un grafo servido no se actualiza solo:

```
STALE: the working tree is not the snapshot this graph describes (2 uncommitted file(s) now, 1 at build); rebuild with clojure-atlas build.
DEGRADED: 8 edge(s) dropped because an end was not a node; an empty or missing answer may be a gap in the graph, not absence
```

Se respeta la configuración `.clj-kondo` del propio proyecto. Un `.clojure-atlas.edn` opcional en la raíz del proyecto añade lo
que los adaptadores genéricos no pueden adivinar: `:lint-as` para macros que definen vars, `:route-macros`, y las claves de
autorización de rutas `:route-authz`, `:permission-middleware` y `:permission-fns`.

## Herramientas

Cada ejemplo siguiente es salida real de `clojure-atlas mcp` sobre un grafo de [examples/](examples/), recortada solo
donde se indica. Algunos de estos grafos descartaron unas pocas aristas durante el build, así que sus respuestas empiezan
con una línea `DEGRADED` (véase la sección siguiente). `[S]`, `[H]` y `[?]` son las bandas, explicadas en la sección siguiente.

### graph_info

Qué commit describe el grafo y qué encontró cada adaptador, con el número de filas por banda. Pregunta: ¿qué sabe el grafo
de integrant?

```
DEGRADED: 8 edge(s) dropped because an end was not a node; an empty or missing answer may be a gap in the graph, not absence
graph integrant @ master sha bcad6bcf35b62d3a32a453dc26b6d3a4d659dc01 built 2026-11-10T00:19:25.361Z: 295 nodes, 1473 edges
snapshot c90296dac61d6d6d: 0 uncommitted file(s), analyzer clojure-atlas 0.1.0, clj-kondo v2025.10.23
config c77762fd2fd2 from .clj-kondo/config.edn
  definitions: available, 854 edges {"static_proven":854}
  multimethods: available, 52 edges {"static_proven":26,"heuristic":26} (switched on by defmethod)
  events: available, 0 edges {} (not used: nothing in this codebase switches it on)
  system: available, 61 edges {"static_proven":61} (switched on by integrant)
  route_authz: absent (not declared: .clojure-atlas.edn names no route authz key, permission middleware or permission fn)
  [... trimmed ...]
```

### callers

Llamadores directos de una definición. Pregunta: ¿quién llama a `integrant.core/dependent-keys`?

```
DEGRADED: 8 edge(s) dropped because an end was not a node; an empty or missing answer may be a gap in the graph, not absence
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

Con `include_references: true` también lista usos de valor, callbacks, handlers registrados, expansiones de macro,
candidatos de despacho y rebindings. Un var nombrado dentro del cuerpo de una macro con syntax-quote (el `defroutes` de
compojure, que nombra `routes`) es una referencia HEURISTIC, no una llamada.

### blast_radius

Dependientes transitivos de una definición. Pregunta: ¿qué alcanza un cambio en `integrant.core/ref?`?

```
DEGRADED: 8 edge(s) dropped because an end was not a node; an empty or missing answer may be a gap in the graph, not absence
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

Aridades, claves desestructuradas y lo que pasa cada llamador. Pregunta: ¿cómo se llama a `integrant.core/init`?

```
DEGRADED: 8 edge(s) dropped because an end was not a node; an empty or missing answer may be a gap in the graph, not absence
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

En modo diff (`base_graph`, o `added_keys` / `removed_keys` / `arities`) lista los llamadores a los que afecta un cambio
de firma.

### route_authz

Handler, cadena de middleware y comprobación de permisos de una ruta de backend. Pregunta: ¿qué atiende `POST /api/articles` en
polylith-realworld y qué middleware la envuelve?

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

La undécima fila, en la página siguiente, es el middleware de autorización, aplicado con `wrap-routes` de compojure:

```
  11. clojure.realworld.rest-api.middleware/wrap-authorization  bases/rest-api/src/clojure/realworld/rest_api/api.clj:45 [H]  heuristic match  (#10 wrapper)
```

Cuando no se puede leer la envoltura de una ruta, la sección lo dice en lugar de informar "none" (usermanager,
`GET /user/list`):

```
GET /user/list @usermanager.main/my-handler (base usermanager.main/my-handler): middleware: not extracted (UNKNOWN)
```

El middleware de compojure y Ring (`->`, `->>`, llamadas anidadas, `wrap-routes`) se lee como HEURISTIC. El middleware
de los datos de ruta de reitit y pedestal (`:middleware`, `:interceptors`) se lee de la propia ruta. El veredicto de
permisos es "not provable", porque este proyecto no declara ningún modelo de autorización en `.clojure-atlas.edn`.

### permission_routes

Todas las rutas que comprueban un permiso. Pregunta: ¿qué rutas de mount exigen `:admin`?

```
DEGRADED: 1 edge(s) dropped because an end was not a node; an empty or missing answer may be a gap in the graph, not absence
PERMISSION_ROUTES :admin — no permission matches ":admin"
note: capability route_authz is absent: an empty answer is not proof of absence
note: use the exact permission name, with its namespace if it has one
searched: names, ids and kind-prefixed ids; check the spelling or pass the fully qualified name
```

### attribute_usage

Lectores y escritores probados de un atributo de Datomic, datascript o XTDB. Pregunta: ¿quién escribe `:order/bid` en la
aplicación de ejemplo de mount?

```
DEGRADED: 1 edge(s) dropped because an end was not a node; an empty or missing answer may be a gap in the graph, not absence
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

Dispatchers y handler de un evento re-frame, o handler, entradas y suscriptores de una suscripción. Pregunta: ¿quién hace
dispatch de `:delete-todo` en el todomvc de re-frame?

```
DEGRADED: 2 edge(s) dropped because an end was not a node; an empty or missing answer may be a gap in the graph, not absence
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

Tests unitarios que alcanzan una definición, directamente o hasta profundidad 3. Pregunta: ¿qué tests ejercitan
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

Tests de navegador (page objects y tests de Playwright, leídos con el TypeScript del propio proyecto) que alcanzan un archivo,
una definición, un selector o una ruta. Ninguno de los repos de ejemplo los tiene, y la respuesta lo dice. Pregunta: ¿qué tests
de navegador alcanzan `mount.core/start`?

```
DEGRADED: 1 edge(s) dropped because an end was not a node; an empty or missing answer may be a gap in the graph, not absence
TESTS_COVERING mount.core/start — 0 browser test(s) in 0 spec file(s)
note: capability selectors is available but not used (nothing in this codebase switches it on): an empty answer is not proof of absence
note: capability browser_tests is available but not used (nothing in this codebase switches it on): an empty answer is not proof of absence
note: no browser test reaches this target through selectors, page objects or requests
tests: none (searched: selector, page-object and request edges)
```

### key_flow

Productores y consumidores de una clave de mapa. Pregunta: ¿dónde se escribe y se lee la clave de request `:compojure/path` de
compojure?

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

Filas de una tabla literal de mapas que carecen de una clave que tienen la mayoría de las filas hermanas. Pregunta: ¿a alguna fila
de la tabla de `test/re_frame/subs/alpha_test.cljs` de re-frame le falta una clave?

```
DEGRADED: 2 edge(s) dropped because an end was not a node; an empty or missing answer may be a gap in the graph, not absence
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

Que falta la clave está probado; si la fila debería tenerla queda a juicio del lector.

### context_for_change

Una llamada por revisión: símbolos cambiados, llamadores fuera del diff, rutas, atributos, tests a ejecutar y tests a añadir.
Pregunta: ¿qué toca un cambio en las líneas 60-80 del store de artículos de polylith-realworld?

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

Todas las herramientas aceptan también `base` (el commit que el agente está mirando), paginación (`offset`, `limit`, `section`) y
`group_by` (`component`, `file`, `none`). Hay más transcripciones en [examples/README.md](examples/README.md).

## Bandas y ausencia

Cada fila tiene una banda:

- **STATIC_PROVEN** `[S]`: el analizador resolvió ambos extremos (clj-kondo resolvió el var, o la forma literal está en
  el código fuente).
- **HEURISTIC** `[H]`: una coincidencia de nombre, una posición encadenada o un candidato de despacho. Abra la línea citada
  antes de actuar sobre ella. Ejemplos: un defmethod alcanzado desde su defmulti (el valor de despacho elige el método en
  tiempo de ejecución), un hallazgo de tabla de claves.
- **UNKNOWN** `[?]`: no se puede decidir de forma estática, así que se lista como límite y nunca se sigue. Ejemplos:
  rebindings con `binding` y `with-redefs`, un keyword de atributo cuyo rol (lectura o escritura) no está probado, un
  uso de `apply` o `partial` en signature_impact.

Las líneas `counts:` dan los totales por banda, por ejemplo `callers=4 [S4]` o `findings=2 [H2]`.

Una respuesta vacía nunca es una lista vacía sin más. Toma una de estas formas:

- **none**: la cosa existe y nada se relaciona con ella. `callers: none (searched: call edges into this definition)`.
- **not found**: el código base no tiene tal cosa. `no definition matches "integrant.core/stop"`.
- **capability off**: el grafo no puede responder, porque el adaptador para ese tipo de dato no encontró nada que extraer
  o no fue configurado. `capability route_authz is absent: an empty answer is not proof of absence`. Una sección que depende de él dice
  `not extracted (route_authz is absent)`, nunca "none". Una cadena de middleware que no se puede leer dice
  `not extracted (UNKNOWN)`.

Cuando el propio grafo está incompleto, el log del build, graph_info y cada respuesta empiezan con una línea `DEGRADED`:
un archivo que clj-kondo no pudo parsear, o aristas descartadas porque un extremo no era un nodo. Un nombre que
probablemente vive en un archivo sin parsear se informa como tal. De biff, donde un archivo no se puede parsear:

```
DEGRADED: 1 file(s) could not be parsed (libs/sqlite/src/com/biffweb/sqlite/impl/execute.clj), so their definitions and calls are missing; an empty or missing answer may be a gap in the graph, not absence
CALLERS com.biffweb.sqlite.impl.execute/execute — no definition matches "com.biffweb.sqlite.impl.execute/execute"
note: com.biffweb.sqlite.impl.execute/execute probably lives in libs/sqlite/src/com/biffweb/sqlite/impl/execute.clj, which could not be parsed: its definitions are not in the graph, so this is not a spelling problem
note: use a fully qualified name (ns/name)
```

Lea una respuesta vacía como una afirmación sobre la cobertura, no como prueba de que algo no existe.

## Cobertura

[docs/COVERAGE.md](docs/COVERAGE.md) mide 26 repos públicos, cada uno fijado a un sha en
[corpus.json](corpus.json). La métrica principal se llama **resolution rate** (tasa de resolución): de los usos de vars que clj-kondo
atribuye a un namespace del proyecto, la proporción que el grafo enlaza con una definición. Los usos de vars de
bibliotecas no se cuentan. Los símbolos que clj-kondo no puede atribuir a ningún namespace se informan como un conteo bruto,
**unknown namespace** (namespace desconocido), y quedan fuera de la tasa.

24 de 26 repos están en 95% o más. Los dos que quedan por debajo:

| repo | resolved | unresolved | resolution rate | unknown namespace |
|---|---|---|---|---|
| datascript | 4392 | 496 | 89.9% | 1255 |
| day-of-datomic | 84 | 29 | 74.3% | 1 |

El documento los explica como está escrito allí:

> **unresolved**: a var created by a project macro clj-kondo does not know (datascript's record constructors), or
> a name in a REPL script with no ns form that clj-kondo files under a namespace not defining it (day-of-datomic's
> tutorials).

Traducción: **unresolved** es un var creado por una macro del proyecto que clj-kondo no conoce (los constructores de record de datascript), o un nombre en un script de REPL sin forma ns que clj-kondo archiva bajo un namespace que no lo define (los tutoriales de day-of-datomic).

Otros seis repos se listan porque su conteo de unknown namespace supera el 5% de los resueltos: babashka, cider-nrepl,
fulcro, pedestal, shadow-cljs y usermanager. La tabla imprime un decimal, así que 100.0% todavía puede contener algunos
usos sin resolver (metabase 111, penpot 13, xtdb-v1 3). Ambos tipos se reducen cuando un repo incluye una configuración de clj-kondo para
sus macros, o las nombra bajo `:lint-as` en `.clojure-atlas.edn`. El corpus se mide sin añadir ninguna de las dos.

## Benchmark

[docs/BENCHMARK.md](docs/BENCHMARK.md) tiene 20 preguntas sobre repos del corpus. Cada respuesta esperada se comprobó
a mano en el código fuente, sin la herramienta, y su file:line está en [bench/questions.json](bench/questions.json).

- **Preguntas positivas: 14 de 14 aprobadas.** Una pregunta se aprueba cuando la respuesta nombra todas las definiciones esperadas y
  nada más. Elementos esperados encontrados: 40 de 40; elementos respondidos: 40.
- **Preguntas de ausencia: 6 de 6 aprobadas.** La respuesta correcta es que no hay nada (*none*, *not-found* o
  *capability-off*), y la respuesta debe indicar ese tipo de ausencia y no nombrar nada.

Las primeras doce preguntas positivas se fijaron antes de la primera ejecución, que obtuvo 11 de 12. El fallo (registros de re-frame
a través de `re-frame.alpha`) se corrigió en el constructor con un fixture, y la pregunta se mantuvo tal como estaba. Dos preguntas se añadieron después, para la cadena de middleware de compojure (q13) y una
ruta de frontend de reitit (q14).

## Requisitos

- Node.js 22.18 o superior. Sin JVM, sin babashka, sin instalación global.
- En el primer `build`, clj-kondo 2025.10.23 se descarga una vez desde la
  [versión oficial de clj-kondo](https://github.com/clj-kondo/clj-kondo/releases), se comprueba contra un sha256 fijado
  y se guarda en caché en `$XDG_CACHE_HOME/clojure-atlas` (por defecto `~/.cache/clojure-atlas`; `%LOCALAPPDATA%\clojure-atlas` en
  Windows). La primera ejecución imprime:

  ```
  clojure-atlas: downloading clj-kondo 2025.10.23 (macos-aarch64) once, to <cache>/clojure-atlas/clj-kondo-2025.10.23-macos-aarch64/clj-kondo
  ```

- Sin conexión, o detrás de un proxy: ponga `clj-kondo` en su PATH. El `fetch` de Node ignora `HTTPS_PROXY`, así que la descarga
  falla detrás de un proxy, y entonces clojure-atlas usa el clj-kondo del PATH. Una descarga con un sha256 incorrecto es
  rechazada, nunca ejecutada.
- Plataformas con binario de clj-kondo fijado: macOS arm64, macOS x64, Linux x64, Linux arm64, Windows x64. Cualquier otra
  plataforma necesita clj-kondo en el PATH. Esta versión se desarrolló y se midió en macOS arm64. Windows no está probado.

## ¿Por qué TypeScript?

Porque `npx` simplemente funciona: no hay que instalar una JVM ni compilar nada en la máquina del usuario. El análisis de Clojure
lo hace clj-kondo; clojure-atlas lee su salida y las formas del código fuente, y construye el grafo. Las contribuciones de
adaptadores son bienvenidas en cualquiera de los dos lenguajes: un adaptador se define con un pequeño fixture de Clojure y las filas del grafo
esperadas de él, de modo que se puede describir la semántica de una biblioteca en Clojure y alguien puede portarla, o escribir el
TypeScript uno mismo.

## Límites

- **Solo estático.** Un var resuelto en tiempo de ejecución (`resolve`, `requiring-resolve`, una función elegida por datos) no se
  sigue. Una clave de mapa leída o escrita solo de forma dinámica no se rastrea. Los tests que alcanzan código a través de
  multimethods, `resolve`/`apply` o fixtures HTTP no se cuentan.
- **Partes heurísticas**: despacho de multimethods y protocolos (`may_dispatch_to`), algunos handlers de compojure
  (mostrados como `heuristic match`), cadenas de middleware de compojure y Ring, llamadas a fábricas de middleware, tablas
  de rutas de frontend de reitit en namespaces que no requieren reitit (se leen cuando `reitit.frontend` se usa en
  cualquier parte del proyecto), vars nombrados en cuerpos de macros con syntax-quote, posiciones de claves encadenadas,
  literales de consulta fuera de una llamada a transact o query, hallazgos de key_siblings.
- **El middleware cuya envoltura no se puede leer** se informa como `middleware: not extracted (UNKNOWN)`, no como
  "none".
- **Archivos que no se pueden parsear**: sus definiciones y llamadas faltan en el grafo. Cada respuesta empieza entonces
  con una línea `DEGRADED` que los nombra.
- **La autorización de rutas** necesita `.clojure-atlas.edn`. Sin él, route_authz dice "not provable" y
  permission_routes informa la capacidad como ausente.
- **Aún no soportado**: rutas bidi, compojure-api, rutas de mapa verbosas de pedestal, registros de malli, sistemas integrant
  sin refs. Véase [ROADMAP.md](ROADMAP.md).
- **datascript y day-of-datomic** resuelven menos (89.9% y 74.3%): datascript define constructores de record mediante
  una macro que clj-kondo no conoce; los tutoriales de day-of-datomic son scripts de REPL sin forma ns. Véase
  [Cobertura](docs/COVERAGE.md).
- **Los símbolos de unknown namespace** (locales ligados por macros desconocidas, campos de deftype o proxy) se cuentan, no
  se enlazan.
- **Sin build incremental ni watch.** Reconstruya tras un cambio; el servidor avisa con `STALE` cuando puede saberlo.
- **Windows no está probado.** Los proxies no están soportados para la descarga de clj-kondo.

## Contribuir

```sh
npm ci
npm test                                    # all tests
npm run test:coverage                       # the gate: 98% line coverage of src/
npm run typecheck
node scripts/coverage.ts <corpus-dir>       # rebuilds docs/COVERAGE.md from clones at the corpus.json shas
node bench/score.ts <corpus-dir>            # scores the benchmark questions
```

Para añadir o ampliar un adaptador, empiece con un fixture: un pequeño código base Clojure en `test/fixtures/<name>/` y un
`expected.txt` con todas las filas del grafo que debe producir, revisadas a mano contra el código fuente. Añádalo a la lista de
`test/build-fixtures.test.ts`, y luego escriba el adaptador en `src/build/adapters/` hasta que las filas coincidan. Véase
[CONTRIBUTING.md](CONTRIBUTING.md).

## Créditos

- [clj-kondo](https://github.com/clj-kondo/clj-kondo) de Michiel Borkent hace el análisis de Clojure.
- [Model Context Protocol](https://modelcontextprotocol.io) es la forma en que los agentes hablan con el servidor.
- Los repos del corpus y sus autores, cuyo código público sirve de base para medir la cobertura y el benchmark.

## Licencia

MIT. Véase [LICENSE](LICENSE). Creado por Barış Can Ateş.
