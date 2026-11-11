# clojure-atlas

**Diseñado para programar con agentes: un mapa estructural de tu base de código Clojure, servido a tu agente de IA a través de MCP.**

Antes de que un agente edite código Clojure, ClojureScript o `.cljc`, debería saber quién llama a la función, qué conjunto de parámetros acepta, qué claves de mapa pasa cada llamador y cuáles lee el cuerpo, y qué rutas, eventos de re-frame y pruebas están conectados con ella. clojure-atlas construye ese mapa en tu máquina con [clj-kondo](https://github.com/clj-kondo/clj-kondo) y responde mediante **13 herramientas MCP**. Cada fila cita `file:line` e indica si está demostrada, es heurística o es desconocida.

![clojure-atlas: proveedor, conjunto de parámetros de mapa, consumidor; llamadas, eventos, rutas y pruebas como grafo local detrás de las herramientas MCP](docs/assets/atlas.svg)

[![Integración continua](https://github.com/Bariscanates404/clojure-atlas/actions/workflows/ci.yml/badge.svg)](https://github.com/Bariscanates404/clojure-atlas/actions/workflows/ci.yml)
[![Licencia: MIT](https://img.shields.io/badge/license-MIT-91d5b6?style=flat-square&labelColor=17252b)](LICENSE)
[![Node.js: 22.18+](https://img.shields.io/badge/Node.js-22.18%2B-91d5b6?style=flat-square&labelColor=17252b)](#requisitos)
[![MCP: stdio](https://img.shields.io/badge/MCP-stdio-91d5b6?style=flat-square&labelColor=17252b)](#inicio-rápido)
[![Dependencias npm obligatorias en tiempo de ejecución: 0](https://img.shields.io/badge/npm_runtime_dependencies-0-91d5b6?style=flat-square&labelColor=17252b)](#local-por-diseño)

**Cero dependencias npm obligatorias en tiempo de ejecución. Análisis local.**

Un proyecto personal de **Barış Can Ateş** · con licencia MIT · construido sobre clj-kondo.

[Por qué](#por-qué-debería-usarlo-un-agente) · [Conjuntos de parámetros y claves de mapa](#proveedor--conjunto-de-parámetros--consumidor) ·
[Tecnologías compatibles](#compatibilidad-con-lenguajes-y-frameworks) · [Ejemplos](#ejemplos-reales-que-puedes-volver-a-ejecutar) ·
[Inicio rápido](#inicio-rápido) · [Categorías de evidencia](#cómo-leer-una-respuesta) · [Límites](#límites) ·
[Mediciones](#mediciones) · [Guía completa](docs/GUIDE.md)

[English](README.md) | [Türkçe](README.tr.md) | [Deutsch](README.de.md) | Español | [Português (Brasil)](README.pt-BR.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md)

## Por qué debería usarlo un agente

Una búsqueda de texto encuentra una grafía. No distingue una llamada de un callback, una clave de mapa de una keyword que casualmente se escribe igual, ni un handler al que se llega mediante un evento de re-frame de otro que nunca se registra. Un agente que edita basándose en suposiciones rompe un llamador que nunca vio. Atlas le proporciona las relaciones, con la evidencia de cada una, antes de la edición.

| El agente pregunta | Atlas responde con | Herramientas MCP |
|---|---|---|
| ¿Quién llama a esto y hasta dónde podría llegar mi cambio? | Llamadores directos, usos como valor y callbacks, dependientes transitivos | `callers`, `blast_radius` |
| ¿Qué conjunto de parámetros acepta la función y qué pasa cada llamador? | Aridades, claves extraídas mediante destructuring, valores predeterminados de `:or` y claves opcionales, argumentos keyword, claves que pasa cada punto de llamada | `signature_impact` |
| Si añado, elimino o exijo una clave, ¿qué llamadores se ven afectados? | Llamadores que no pasan una nueva clave obligatoria, siguen pasando una eliminada o usan una aridad que ya no existe | `signature_impact` con `added_keys`, `removed_keys`, `arities` o `base_graph` |
| ¿Quién produce esta clave de mapa y quién la consume? | Puntos productores y consumidores de la keyword | `key_flow` |
| ¿Le falta a esta fila de configuración una clave que tienen sus filas hermanas? | Filas de una tabla literal que carecen de una clave que tiene la mayoría de sus hermanas | `key_siblings` |
| ¿Qué procesa este endpoint y dónde se comprueba el permiso? | Handler, middleware en orden, comprobaciones de permisos declaradas por el proyecto | `route_authz`, `permission_routes` |
| ¿Qué ocurre cuando se dispara este evento de re-frame? | Puntos de dispatch, handler, suscripciones, solicitudes HTTP | `event_flow` |
| ¿Quién lee o escribe este atributo de base de datos? | Lecturas y escrituras demostradas; las referencias no demostradas permanecen visibles | `attribute_usage` |
| ¿Qué pruebas están relacionadas con este cambio? | Pruebas unitarias y de Playwright vinculadas estáticamente, y un contexto de revisión para las líneas modificadas | `tests_for`, `tests_covering`, `context_for_change` |
| ¿Qué sabe este grafo y qué se le escapó? | Commit de origen, adaptadores activos, recuentos de evidencia, advertencias de cobertura | `graph_info` |

Atlas señala dónde mirar. Decidir si es un error sigue siendo cosa tuya y de tu agente.

## Proveedor → conjunto de parámetros → consumidor

Este es el nivel al que la mayoría de las herramientas no llega: no solo *quién llama a `line-total`*, sino qué claves entrega la llamada y cuáles lee la función. El ejemplo es una fixture de este repositorio: [test/fixtures/keys/src/cart/core.clj](test/fixtures/keys/src/cart/core.clj).

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

Un parámetro de mapa en Clojure es abierto, y la respuesta se construye en torno a ello:

| Tipo de clave | Qué significa | Cómo la informa Atlas |
|---|---|---|
| **Obligatoria** | Extraída mediante destructuring, sin valor predeterminado de `:or`, y el cuerpo ni la comprueba ni recurre a un valor alternativo | Un hallazgo cuando ningún llamador la pasa; una nueva hace que los llamadores estén «afectados» |
| **Opcional** | Tiene un valor predeterminado de `:or`, se lee con un valor predeterminado (`(get m :k d)`), se consulta su presencia (`(contains? m :k)`) o se usa solo donde se comprueba un valor o se recurre a uno alternativo (`(or k d)`, `(if k …)`, `(when-let [x k] …)`) | Se lista como `optional:` en la aridad; su ausencia nunca es un hallazgo |
| **Adicional** | Un llamador la pasa, la función nunca la lee | Se lista en `extra keys`. No rompe nada. Solo es un hallazgo cuando parece un error al escribir una clave que la función sí lee y que falta en esa llamada (`:usrname` junto a `:username`), y entonces es HEURISTIC |
| **No demostrable** | El mapa se reenvía, se guarda en una variable local o el parámetro se entrega a otra función | UNKNOWN, con el motivo |

Pregunta qué haría un cambio antes de realizarlo:

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

`added_keys` significa las claves que el cambio empieza a **exigir**. Cuando se comparan dos grafos con `base_graph`, una clave que el nuevo cuerpo solo lee de forma opcional no afecta a ningún llamador.

Y sigue una clave por todo el proyecto:

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

**Qué es y qué no es este nivel:**

- Es el uso estático de claves leído del código fuente. No es comprobación de tipos ni validación de esquemas; no se inspecciona ningún valor.
- `key_flow` trabaja con **apariciones de keywords**. Agrupa todos los mapas que usan `:total`; no sigue un mapa desde donde se construye hasta donde se lee.
- Los mapas anidados no se distinguen por su ruta. `{:meta {:count 1}}` produce `:meta` y `:count` como dos claves separadas; `(get-in cart [:meta :count])` consume ambas. `signature_impact` registra solo la **clave exterior** del destructuring anidado y de `get-in`.
- Un mapa reenviado, fusionado, construido con `keyword` o guardado en una variable local es UNKNOWN, y la respuesta lo indica.

## Compatibilidad con lenguajes y frameworks

**Lenguajes:** Clojure (`.clj`), ClojureScript (`.cljs`) y código compartido (`.cljc`). Los archivos EDN aportan las formas de configuración y datos enumeradas a continuación. TypeScript (`.ts`) solo se lee para la integración opcional con Playwright; Atlas no es un analizador de JavaScript ni de TypeScript.

| Área | Qué reconoce | Qué obtienes | Límites |
|---|---|---|---|
| Núcleo de Clojure | Vars, llamadas, usos como valor, callbacks, multimétodos, protocolos, records | Definiciones y relaciones de dependencia | Los candidatos de dispatch son heurísticos; no se siguen las vars resueltas en tiempo de ejecución |
| Conjuntos de parámetros | Aridades de `defn`/`defn-`, destructuring de mapas, `:or`, `:as`, `& {:keys […]}`, `schema.core/defn`, macros que tu configuración de clj-kondo analiza como `defn` | Claves aceptadas, claves opcionales, claves que pasa cada punto de llamada, impacto de un cambio de firma | Solo la clave exterior en patrones anidados; una función `.cljc` cuyos parámetros difieren por plataforma no recibe firma; los hallazgos sobre una función definida con macros son heurísticos |
| Claves de mapa | Mapas literales, `assoc`, `assoc-in`, `update`, `hash-map`, `dissoc`, acceso mediante keyword, `get`, `get-in`, `select-keys`, `contains?`, destructuring | Puntos productores, consumidores y de eliminación por keyword; huecos en filas hermanas de tablas literales | Apariciones de keywords, no identidad de mapas; las posiciones en formas de threading son heurísticas; un patrón sin `:keys` en una macro de binding no enumerada se lee como literal |
| Macros | `:lint-as` y hooks de `.clj-kondo/config.edn` del proyecto, además de `:lint-as` en `.clojure-atlas.edn` | Los usos dentro de una macro enseñada a clj-kondo están demostrados | Los usos dentro de una macro no enseñada son heurísticos e indican qué macro es |
| Estado del frontend | **re-frame**, incluido `re-frame.alpha` | Registros de eventos y suscripciones, dispatches, entradas de suscripciones, suscriptores | Un dispatch cuyo identificador de evento se calcula es UNKNOWN; no se sigue lo que hacen los handlers de `reg-fx` y cofx, ni el orden de `:fx` |
| Enrutamiento del backend | Rutas de tabla de **Compojure**, **Reitit**, **Pedestal** | Rutas, copias de rutas montadas, handlers | No se leen bidi, compojure-api ni las rutas de mapa detalladas de Pedestal |
| Middleware | **Ring**, `wrap-routes` de Compojure, datos de ruta de Reitit y `ring-handler` | Cadenas ordenadas, incluidos los wrappers exteriores | Las cadenas son heurísticas; no se leen los interceptores del service-map de Pedestal; los wrappers que no se pueden leer se informan como UNKNOWN |
| Autorización de rutas | Claves de permisos, middleware y funciones que declara tu proyecto | Qué rutas comprueban qué permiso | Necesita un pequeño `.clojure-atlas.edn`; sin él, la respuesta es «no demostrable», nunca «ninguno» |
| Enrutamiento del navegador | **Reitit frontend**, **Secretary** | Nodos de rutas de cliente en el grafo | Ninguna herramienta MCP los lista todavía |
| Solicitudes HTTP | **cljs-ajax**, **cljs-http**, `js/fetch`, mapas de efectos de solicitud | Puntos de solicitud vinculados a rutas del backend por método y ruta | Una URL ensamblada en tiempo de ejecución puede no vincularse |
| Datos | **Datomic**, **DataScript**, **XTDB v1 / Crux** | Atributos, escrituras de transacciones, lecturas mediante consultas y pull | Las referencias no demostradas se mantienen como filas UNKNOWN; no hay análisis SQL (next.jdbc, HoneySQL) |
| Ciclo de vida del sistema | **Integrant**, **Mount**, **Component** | Claves del sistema, registros, aristas de dependencia | No se leen sistemas Integrant sin referencias |
| Esquemas | **clojure.spec / cljs.spec**, **Malli** | Specs registrados, esquemas Malli guardados en vars | No se leen los registros de Malli; no se contrastan los esquemas con los mapas |
| Pruebas | **clojure.test / cljs.test**, **Playwright**, selectores Hiccup literales | Vínculos estáticos de pruebas | Playwright necesita TypeScript 5 opcional; un fixture de `test.extend` sin argumento de tipo no tiene clase, así que no se vincula; no se vinculan las pruebas que llegan al código mediante HTTP o `resolve` |
| Estructura del proyecto | **deps.edn**, **Leiningen**, **shadow-cljs**, **Babashka**, **Boot**, **Polylith** | Descubrimiento de fuentes, agrupación por componente | No se analizan los alias de compilación ni las tareas |

Un adaptador reconoce formas concretas del código fuente, no todos los usos de una biblioteca. `graph_info` informa qué adaptadores se activaron en **tu** proyecto. Fulcro, Pathom, HoneySQL y next.jdbc están en el corpus de medición, lo que no significa que tengan un adaptador específico. La [hoja de ruta](ROADMAP.md) enumera lo que falta.

## Ejemplos reales que puedes volver a ejecutar

Los extractos siguientes son salidas reales del servidor sobre los [grafos incluidos en `examples/`](examples/), construidos a partir de proyectos públicos en los commits fijados en [corpus.json](corpus.json). `[S]` significa demostrado, `[H]` heurístico y `[?]` desconocido. La primera línea de cada bloque es la llamada a la herramienta MCP que hace tu agente. Para ejecutar una por tu cuenta sin un cliente MCP, desde un clon de este repositorio:

```sh
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"signature_impact","arguments":{"fn":"clojure.realworld.user.core/login!","group_by":"none"}}}' \
  | node src/cli.ts mcp --graph examples/polylith-realworld.json.gz \
  | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).result.content[0].text'
```

Las respuestas de `cart` anteriores proceden de `node src/cli.ts build test/fixtures/keys -o /tmp/cart.json.gz` y de la misma tubería con `--graph /tmp/cart.json.gz`.

### El conjunto de parámetros de una función junto a lo que pasan sus llamadores

En polylith-realworld, `login!` acepta un mapa y extrae `:email` y `:password` mediante destructuring:

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

Un mapa literal muestra sus claves. El mapa pasado como `login-input` sigue siendo desconocido: `[S]` en esa fila demuestra la llamada, no el contenido de un mapa en tiempo de ejecución.

<details>
<summary><strong>¿Qué pasa si <code>login!</code> empieza a exigir <code>:tenant-id</code>?</strong></summary>

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

Los tres llamadores que pasan un mapa literal omiten la nueva clave. El cuarto reenvía `login-input`, por lo que su fila es UNKNOWN. No se modifica nada; esta es una pregunta sobre un cambio que aún no has realizado.

</details>

<details>
<summary><strong>Productores y consumidores de <code>:email</code></strong></summary>

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

`:email` no está cualificada con un namespace, así que aquí se agrupan todos los mapas que usan la keyword. Esto no demuestra que el mapa de un productor llegue a un consumidor.

</details>

<details>
<summary><strong>Llamadores antes de una refactorización</strong></summary>

De integrant:

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
<summary><strong>Un evento de re-frame: puntos de dispatch y handler</strong></summary>

De re-frame:

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

La conexión pasa por una keyword de evento, así que buscar llamadores de una función con nombre no la encontraría.

</details>

<details>
<summary><strong>El middleware que precede a un endpoint y lo que no se pudo comprobar</strong></summary>

De polylith-realworld:

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

El handler está demostrado. Los wrappers se encuentran en orden y se marcan con `[H]`, porque la composición de middleware es código de tiempo de ejecución. El proyecto no declara reglas de permisos, así que la respuesta es **no extraído**, no «sin comprobación».

</details>

<details>
<summary><strong>Una omisión reconocida: un nombre que se usa y nunca se define</strong></summary>

De next.jdbc, donde una macro genera funciones que clj-kondo no puede expandir:

```text
callers {"var": "next.jdbc.types/as-other"}
```

```text
CALLERS next.jdbc.types/as-other — no definition matches "next.jdbc.types/as-other"; used at test/next/jdbc/sql_test.clj:290, test/next/jdbc_test.clj:559 but no definition was found
note: next.jdbc.types/as-other is used at test/next/jdbc/sql_test.clj:290, test/next/jdbc_test.clj:559 but no definition was found: probably defined by a macro clj-kondo cannot expand; add :lint-as for the macro in .clj-kondo/config.edn
note: use a fully qualified name (ns/name)
```

La respuesta muestra dónde se usa el nombre y cómo hacerlo visible. Con una entrada `:lint-as` para la macro, la misma pregunta devuelve una definición demostrada ([configuración del proyecto](docs/GUIDE.md#project-configuration)). next.jdbc está en el corpus, no entre los grafos de ejemplo incluidos en el repositorio.

</details>

<details>
<summary><strong>Líneas modificadas convertidas en contexto de revisión y pruebas relacionadas</strong></summary>

De polylith-realworld:

```text
context_for_change {"changes": ["components/article/src/clojure/realworld/article/store.clj:60-80"], "limit": 3}
```

```text
CONTEXT_FOR_CHANGE components/article/src/clojure/realworld/article/store.clj:60-80 — 1 file(s), 3 changed symbol(s), 0 route(s), 0 attribute(s); risk LOW
counts: changed symbols=3 [S3]  callers outside the diff=9 [S9]  tests to run=24 [S24]
[... trimmed ...]
```

La respuesta completa enumera las tres definiciones modificadas, nueve llamadores fuera del diff y 24 pruebas relacionadas ([transcripción completa](docs/GUIDE.md#context_for_change)). `LOW` describe las comprobaciones que pudo hacer el grafo. No es una garantía de seguridad.

</details>

[Más transcripciones](examples/README.md) · [Cada herramienta con una respuesta completa](docs/GUIDE.md#tools)

## Inicio rápido

**Requisitos previos:** Node.js **22.18+** y Git. Sin JVM ni Babashka.

### 1. Instala y construye un grafo

Desde la raíz del **proyecto Clojure que quieres analizar**:

```sh
npm install --save-dev 'git+https://github.com/Bariscanates404/clojure-atlas.git'
npx clojure-atlas build
```

El paquete no está en el registro de npm; se instala desde Git y esa instalación compila la CLI. Para fijar la revisión que has examinado, añade `#<commit-sha>` a la URL. TypeScript y las definiciones de tipos de Node solo se necesitan para ese paso de compilación; la CLI instalada no tiene dependencias npm obligatorias en tiempo de ejecución.

El grafo se escribe en `.clojure-atlas/graph.json.gz`. La primera compilación descarga el binario fijado de clj-kondo y comprueba su SHA-256; las posteriores usan el binario en caché. Añade `.clojure-atlas/` a tu `.gitignore`.

### 2. Conecta tu cliente MCP

Para Claude Code, previsualiza y luego escribe la configuración del proyecto:

```sh
npx clojure-atlas init         # preview .mcp.json
npx clojure-atlas init --yes   # write it; existing servers are kept
```

Después pide al agente que llame a `graph_info` y a `callers` con un `ns/name` totalmente cualificado de tu proyecto.

<details>
<summary><strong>Otro cliente MCP</strong></summary>

Atlas habla **MCP sobre stdio**. Inícialo desde la raíz de tu proyecto:

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

Si el cliente inicia los servidores en otro lugar, establece su directorio de trabajo o usa rutas absolutas para la CLI, el grafo y el repositorio. Los formatos de configuración varían entre clientes.

</details>

### 3. Reconstruye después de los cambios

```sh
npx clojure-atlas build      # refresh the snapshot
npx clojure-atlas coverage   # resolution counts and unresolved names
```

No hay modo de vigilancia. Con `--repo`, las respuestas empiezan por `STALE` cuando el árbol de trabajo ya no coincide con el grafo. Reinicia el servidor MCP después de reconstruir para que cargue el nuevo grafo.

**Macros y tu configuración de clj-kondo.** Atlas aplica `.clj-kondo/config.edn` del proyecto, incluidos `:lint-as` y los hooks. Una macro analizada como `defn` recibe una firma; una macro no enseñada a clj-kondo hace que los usos en su interior sean heurísticos, y la respuesta nombra la macro. Un `.clojure-atlas.edn` opcional añade macros de rutas y reglas de autorización: [configuración del proyecto](docs/GUIDE.md#project-configuration), [fixture de autorización](test/fixtures/authz/.clojure-atlas.edn).

## Cómo leer una respuesta

| Marcador | Significado | Qué hacer con él |
|---|---|---|
| `[S]` `STATIC_PROVEN` | Resuelto por clj-kondo o leído de una forma literal del código fuente | Sigue la referencia `file:line` citada |
| `[H]` `HEURISTIC` | Inferido de un nombre, un wrapper, una posición en una forma de threading, un candidato de dispatch o una macro cuyo interior Atlas no puede ver | Abre la línea citada antes de actuar basándote en ella |
| `[?]` `UNKNOWN` | No se puede decidir estáticamente | Trátalo como el límite de lo que sabe el grafo |

**Una respuesta vacía no demuestra ausencia.** Atlas distingue «no se encontró ninguno», «definición no encontrada» y «capacidad no incluida en este grafo». `DEGRADED` advierte que falta parte del análisis; `STALE`, que la instantánea es antigua. Cero pruebas significa que no se encontró un vínculo estático, no que el código no esté probado.
[Categorías y ausencia en detalle](docs/GUIDE.md#bands-and-absence)

## Límites

> [!WARNING]
> **Lo que Atlas puede pasar por alto. Lee esto antes de confiar en una respuesta vacía.**
>
> - **Definiciones creadas por una macro no enseñada a clj-kondo.** Un `defthing` del proyecto o un DSL de biblioteca que no incluye configuración de clj-kondo define vars que el grafo no contiene: sus llamadores aparecen como *no resueltos* y el código dentro de esa macro es solo heurístico. Por eso DataScript resuelve el 89.9% en el corpus. Enseña la macro a clj-kondo (`:lint-as` o un hook en `.clj-kondo/config.edn`), reconstruye y volverán a aparecer. La respuesta nombra la macro.
> - **Cualquier cosa decidida en tiempo de ejecución.** Una var encontrada con `resolve` a partir de un símbolo calculado, una función elegida de un mapa, la cantidad de argumentos detrás de `apply` o `partial`, una clave construida con `keyword`, un mapa fusionado o reenviado. Se informan como UNKNOWN, nunca se adivinan.
> - **Dispatch.** Los destinos de una llamada a un multimétodo o protocolo son candidatos, no pruebas.
> - **Scripts sin una forma `ns`** (tutoriales de REPL): day-of-datomic resuelve el 74.3%.
> - **Archivos que clj-kondo no puede analizar y archivos de más de 2 MB.** Faltan sus definiciones; cada respuesta empieza entonces por `DEGRADED` y los nombra.

- **Solo estático.** No se siguen las vars resueltas en tiempo de ejecución, las funciones elegidas mediante datos ni las claves construidas con `keyword`.
- **Las claves de mapa son apariciones de keywords**, y los mapas anidados aportan claves exteriores, como se describe [arriba](#proveedor--conjunto-de-parámetros--consumidor). No hay flujo de datos sensible a las rutas.
- **Las claves opcionales se leen a partir de la forma del cuerpo.** Un nombre enlazado de nuevo dentro de la función no se sigue, así que una clave puede considerarse opcional sin serlo. No ocurre lo contrario.
- **Macros.** clj-kondo solo puede ver el interior de una macro con una entrada `:lint-as` o un hook. Un patrón de binding sin `:keys` dentro de una macro de binding que Atlas no enumera se lee como mapa literal.
- **Middleware y permisos.** Las cadenas son heurísticas; los permisos de rutas necesitan `.clojure-atlas.edn`.
- **Sin compilación incremental.** Reconstruye después de los cambios.
- **Windows no está probado.**

La lista completa está en [la guía](docs/GUIDE.md#limits); lo previsto está en la [hoja de ruta](ROADMAP.md).

## Local por diseño

La CLI principal **no tiene dependencias npm obligatorias en tiempo de ejecución**. Usa la biblioteca estándar de Node, clj-kondo para el análisis y Git para los metadatos del repositorio. El grafo se construye y se consulta en tu máquina: sin cuenta, sin índice alojado, sin telemetría.

### Requisitos

| Componente | Función |
|---|---|
| Node.js 22.18+ | Ejecuta la CLI y el servidor MCP |
| clj-kondo 2025.10.23 | Analizador nativo; se descarga una vez y se guarda en caché, SHA-256 del archivo fijado |
| Git | Instalación desde Git, comprobaciones de archivos bajo seguimiento, información de instantáneas y desactualización |
| TypeScript 5, opcional | Solo análisis de page objects y pruebas de Playwright; `npm i -D typescript@5` junto a Atlas |

Hay binarios fijados para macOS arm64/x64, Linux arm64/x64 y Windows x64. El desarrollo y las mediciones del corpus se realizaron en macOS arm64. Si la descarga no está disponible, por ejemplo detrás de un proxy, Atlas recurre a un `clj-kondo` en `PATH`. [Detalles de plataformas y caché](docs/GUIDE.md#requirements)

### Seguridad

Pocas dependencias reducen la superficie de ataque. **No** constituyen una garantía de la cadena de suministro.

- Un archivo de clj-kondo descargado se comprueba con un SHA-256 fijado y se rechaza si no coincide. Se confía en un `clj-kondo` tomado de `PATH` tal como lo instalaste; no se compara con ese hash.
- Atlas no inicia la JVM de la aplicación analizada, sus scripts de shell ni su código Node. **Los hooks de clj-kondo del proyecto son interpretados por clj-kondo**, así que esa configuración es código en el que confías al analizar un repositorio.
- El servidor MCP lee el grafo y ejecuta comprobaciones de Git de solo lectura, con los hooks de Git, los controladores de filtros y fsmonitor desactivados y con tiempos de espera máximos.
- Los resultados se sirven localmente por stdio. Lo que tu cliente de IA haga con ellos constituye un límite de privacidad independiente.

Estas son propiedades de la implementación, no el resultado de una auditoría de seguridad.
[Modelo de ejecución](docs/GUIDE.md#security)

## Mediciones

Medido en **26 repositorios públicos**, cada uno fijado a un commit en [corpus.json](corpus.json). Tabla completa: [docs/COVERAGE.md](docs/COVERAGE.md).

| De un vistazo | |
|---|---|
| Repositorios que se construyen como grafo | **26 de 26**, sin cierres inesperados, 0 aristas descartadas |
| Tamaño de lo leído | 10,158 archivos fuente, 141,604 definiciones, 1,927,681 aristas |
| Usos de vars en namespaces del proyecto vinculados a su definición | **601,991 de 602,877 (99.85%)**; 886 no resueltos |
| Por repositorio | mediana 100.0%; 24 de 26 en 99.3% o más; los dos por debajo están en 89.9% y 74.3% |
| Símbolos que clj-kondo no pudo atribuir a ningún namespace | **18,517**, contados y mostrados, no vinculados ni incluidos en la tasa |
| Archivos que clj-kondo no pudo analizar por completo | 24 |
| Benchmark con respuestas comprobadas a mano | 14 de 14 preguntas positivas, 7 de 7 preguntas de ausencia |

Estas cifras indican cuánto de la estructura *estática* del código llega al grafo en estos proyectos. No son una promesa sobre el tuyo: una base de código construida sobre macros no enseñadas a clj-kondo estará más cerca de DataScript que de Metabase hasta que se configure. `npx clojure-atlas coverage` imprime los mismos recuentos para tu proyecto.

### Tasa de resolución con los recuentos al lado

La **tasa de resolución** es `resolved / (resolved + unresolved)` para los usos de vars que clj-kondo atribuye a un namespace del proyecto. No es la precisión del análisis. Quedan fuera los usos de bibliotecas y los **usos con namespace desconocido**: símbolos que clj-kondo no pudo atribuir a ningún namespace, que pueden ser variables locales enlazadas por una macro que no conoce o usos de vars que el grafo omite. Nada estático distingue ambos casos, así que se muestran como un recuento bruto y nunca se incorporan a la tasa.

| Repositorio | Resueltos | No resueltos | Tasa de resolución | Namespace desconocido (bruto, fuera de la tasa) |
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
| **Los 26 repositorios** | | | **mediana 100.0%; 24 de 26 en 99.3% o más** | **18,517 en total** |

† [explicado en docs/COVERAGE.md](docs/COVERAGE.md#repos-under-95-resolution-rate-or-with-unknown-namespace-usages-above-5-of-resolved)

**Un cambio de definición no es una mejora.** El primer informe de cobertura de este proyecto dividía entre `resolved + unresolved + unknown` y mostraba Babashka en 87.0%. El 99.6% actual usa la definición anterior. Casi toda esa diferencia está en el denominador: los usos con namespace desconocido salieron de la tasa, no pasaron a estar resueltos, y 2,176 de ellos siguen en la última columna. No compares tasas entre ambas definiciones.

### Lo que realmente ganó la extracción

Cambios en lo que Atlas lee, cada uno con una fixture o prueba, separados de la tasa anterior.

| Cambio | Resultado medido | Evidencia |
|---|---|---|
| Distinguir un mapa literal de un patrón de binding | En los 26 repositorios del corpus: **5,475** puntos productores añadidos (mapas en un vector devuelto, hiccup, datos de ruta, `(d/transact conn [{…}])`); **703** valores keyword ya no se listan como consumidores de «destructuring» demostrados; **5,268** entradas `:keys` / `:as` / `:or` ya no se listan como claves producidas | [pruebas](test/keys-adapter.test.ts), fixtures [authz](test/fixtures/authz/), [datos](test/fixtures/data/), [reframe](test/fixtures/reframe/) |
| Registrar una firma solo donde clj-kondo cuenta los mismos parámetros | **532** funciones definidas mediante una forma analizada como `defn` obtuvieron una firma (216 en Metabase); **22** funciones `.cljc` cuyos parámetros difieren por plataforma ya no reciben una incorrecta (`first-seq` de DataScript se leía como `[xs xs]`); las anotaciones de `s/defn` ya no se cuentan como parámetros | [pruebas](test/signatures.test.ts) |
| Leer cómo se usa un parámetro simple | Parámetros simples cuyas lecturas se conocen por completo: **3,496 → 4,184** (un `let` que aplica destructuring al parámetro, `(-> m :k)`, `contains?`) | [pruebas](test/signatures.test.ts) |
| Leer el middleware exterior de Ring/Compojure | polylith-realworld: **0 → 11** entradas de middleware para `POST /api/articles` | [benchmark q13](docs/BENCHMARK.md#positive-questions), [fixture](test/fixtures/ring-middleware/) |
| Leer tablas de rutas del frontend en otro namespace | Logseq: **0 → 17** nodos de rutas de cliente | [cobertura](docs/COVERAGE.md), [benchmark q14](docs/BENCHMARK.md#positive-questions) |
| Reconocer `re-frame.alpha` | Se extraen los registros y dispatches a través del namespace alpha | [fixture](test/fixtures/reframe/src/app/alpha.cljs) |
| Aplicar la configuración de clj-kondo del proyecto | Las entradas `:lint-as` y los hooks del proyecto participan en el análisis | [fixture](test/fixtures/project-config/), [pruebas](test/config.test.ts) |
| Tipar los fixtures de Playwright sin los `node_modules` del proyecto | Las pruebas que obtienen page objects de fixtures `test.extend<…>` se vinculan con los miembros del page object en un checkout donde `@playwright/test` no está instalado; en el fixture: **0 → 12** vínculos | [pruebas](test/playwright-fixtures.test.ts), [fixture](test/fixtures/browser-fixtures/) |

Las tres primeras filas comparan grafos de los mismos commits fijados antes y después del cambio. En esa comparación no cambió ninguna arista de otro tipo, y los recuentos de resueltos, no resueltos y namespace desconocido son idénticos: son cambios en lo que se lee sobre claves de mapa y parámetros, no en la tasa de resolución.

### Benchmark

El benchmark registrado supera **14 de 14 preguntas positivas** (40 de 40 filas esperadas encontradas) y **7 de 7 preguntas de ausencia**. Es un pequeño benchmark de regresión con respuestas comprobadas a mano contra el código fuente, no una estimación de precisión para tu proyecto. [Preguntas, resultados y método](docs/BENCHMARK.md)

## Cómo se prueba Atlas

Un agente confía en lo que recibe, así que una respuesta incorrecta cuesta más que una ausente.

| Comprobación | Estado |
|---|---|
| Pruebas automatizadas | **873**, todas pasan (`npm test`); cada error corregido recibe una prueba que falla sin la corrección |
| Cobertura de líneas fuente | **99.79%** (`npm run test:coverage`; el control falla por debajo del 98%) |
| Comprobación de tipos | `npm run typecheck` sin errores |
| Integración continua | [GitHub Actions](.github/workflows/ci.yml) ejecuta la comprobación de tipos y el control de cobertura en Node.js 22 y 24, en Linux, para cada push a `main` y cada pull request |
| Fixtures | Pequeñas bases de código Clojure en [test/fixtures](test/fixtures), con cada fila esperada del grafo comprobada a mano |
| Repositorios reales | 26 proyectos públicos se construyen sin cierres inesperados y con 0 aristas descartadas |
| Benchmark | Preguntas positivas y de ausencia con respuestas comprobadas a mano ([docs/BENCHMARK.md](docs/BENCHMARK.md)) |
| Revisión independiente | Revisores que no escribieron el cambio buscan respuestas incorrectas con reproducciones ejecutables; cada defecto confirmado se corrige con una prueba |
| Repositorios no confiables | Fixtures hostiles comprueban que la configuración de Git, los controladores de filtros, los submódulos, el TypeScript del proyecto, los nombres de archivo extraños y los hooks de clj-kondo que se bloquean no ejecuten nada ni dejen nada bloqueado |

Las preguntas de ausencia son las más importantes: comprueban que Atlas diga «no encontrado», «no extraído» o «degradado» cuando esa sea la verdad, en lugar de una lista vacía que parezca decir «ninguno». Una suite en verde y un benchmark son evidencia sobre estas fixtures y estos repositorios. No garantizan una respuesta correcta en el tuyo; lee la categoría de cada fila.

## Contribuir

**¡Construyamos juntos nuestra herramienta de rayos X para Clojure!**

Una contribución útil puede ser un ejemplo diminuto de Clojure: «esta biblioteca conecta estas dos cosas y Atlas debería verlo». Añade una fixture y las filas del grafo que esperas, o escribe el adaptador. Ambas cosas son bienvenidas, al igual que un caso en el que Atlas te haya dado una respuesta incorrecta o engañosa.

```sh
npm ci
npm test
npm run test:coverage   # 98% source line-coverage gate
npm run typecheck
```

La CLI está en TypeScript para distribuirse como Node puro; clj-kondo hace el análisis de Clojure.
[Guía para contribuir](CONTRIBUTING.md) · [Hoja de ruta](ROADMAP.md) · [Referencia de herramientas](docs/GUIDE.md)

## Créditos y licencia

Creado por **Barış Can Ateş**. [Con licencia MIT](LICENSE), incluidas la documentación y las ilustraciones. Construido sobre **[clj-kondo](https://github.com/clj-kondo/clj-kondo)** de Michiel Borkent, con **[MCP](https://modelcontextprotocol.io)** como interfaz para los agentes de programación. Gracias a los autores de los proyectos públicos del corpus y los ejemplos; esos proyectos conservan sus propias licencias.

*Por el bien de toda la comunidad de Clojure.*
