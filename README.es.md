# clojure-atlas

**Creado para el desarrollo con agentes. Dé a su agente de IA un mapa de su base de código Clojure.**

Rastree llamadores y proveedores/consumidores de datos, inspeccione contratos de funciones **hasta las claves dentro de los
argumentos map**, siga eventos y rutas de re-frame e identifique las pruebas afectadas por un cambio.
clojure-atlas convierte **código fuente Clojure, ClojureScript y `.cljc`** en un grafo de código local y lo expone como
**13 herramientas MCP** con ubicaciones en el código fuente y niveles de confianza explícitos.

Creado como **herramienta complementaria para agentes de programación**, Atlas aporta el contexto estructural que necesitan antes de
cambiar el código: quién depende de él, qué parámetros y claves de map esperan sus consumidores y qué pruebas se relacionan con él.

![clojure-atlas — provider to map parameter set to consumer; inspect contracts with signature_impact and key_flow](docs/assets/atlas.svg)

[![License: MIT](https://img.shields.io/badge/license-MIT-91d5b6?style=flat-square&labelColor=17252b)](LICENSE)
[![Node.js: 22.18+](https://img.shields.io/badge/Node.js-22.18%2B-91d5b6?style=flat-square&labelColor=17252b)](#requisitos)
[![MCP: stdio](https://img.shields.io/badge/MCP-stdio-91d5b6?style=flat-square&labelColor=17252b)](#inicio-rápido)
[![Required npm runtime dependencies: 0](https://img.shields.io/badge/npm_runtime_dependencies-0-91d5b6?style=flat-square&labelColor=17252b)](#local-por-diseño)

**Cero dependencias de ejecución npm obligatorias. Análisis local. For the sake of all Clojurians. (Por todos los clojuristas.)**

Un proyecto personal de **Barış Can Ateş** · Licencia MIT · Construido sobre [clj-kondo](https://github.com/clj-kondo/clj-kondo).

[English](README.md) | [Türkçe](README.tr.md) | [Deutsch](README.de.md) | Español | [Português (Brasil)](README.pt-BR.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md)

[Capacidades](#qué-puede-hacer) · [Contratos de map](#contratos-hasta-las-claves-de-map) · [Stack compatible](#lenguajes-y-compatibilidad-con-el-ecosistema) · [Ejemplos](#véalo-en-acción) ·
[Inicio rápido](#inicio-rápido) · [Cobertura](#cobertura) · [Cómo se prueba](#cómo-se-prueba-atlas) · [Guía completa](docs/GUIDE.md)

## Qué puede hacer

Úselo al explorar un proyecto desconocido, planificar un refactor o revisar un cambio. Su cliente MCP llama a
las herramientas; Atlas devuelve las relaciones que puede establecer, con citas `file:line`.

| Pregunte a su agente… | Atlas le da… | Herramientas MCP |
|---|---|---|
| “¿Quién llama a esto y qué podría afectar mi cambio?” | Llamadores directos, referencias de valor y dependientes transitivos | `callers`, `blast_radius` |
| “¿Qué conjunto de parámetros aporta cada llamador y qué lee la función?” | Aridades, claves de map desestructuradas, valores por defecto, argumentos keyword y claves aportadas en cada punto de llamada | `signature_impact` |
| “¿Quién proporciona esta clave de map y quién la consume?” | Productores y consumidores de claves, incluidas las claves literales dentro de maps anidados y las rutas de claves | `key_flow` |
| “¿A esta fila de configuración le falta una clave?” | Claves presentes en filas de map hermanas pero ausentes en esta | `key_siblings` |
| “¿Qué maneja este endpoint? ¿Dónde se comprueba el permiso?” | Handlers de ruta, middleware ordenado y comprobaciones de permisos configuradas | `route_authz`, `permission_routes` |
| “¿Qué ocurre cuando se dispara este evento de re-frame?” | Dispatchers, handlers, suscripciones y peticiones HTTP | `event_flow` |
| “¿Quién lee o escribe este atributo de base de datos?” | Lecturas y escrituras demostradas, con las referencias inciertas siempre visibles | `attribute_usage` |
| “¿Qué pruebas se relacionan con este cambio?” | Enlaces estáticos a pruebas unitarias, enlaces a Playwright y un contexto de revisión para archivos o líneas modificados | `tests_for`, `tests_covering`, `context_for_change` |
| “¿Qué sabe realmente este grafo?” | Commit de origen, adaptadores activos, recuentos de evidencia y avisos de cobertura | `graph_info` |

Una llamada, un callback y un keyword con la misma grafía son cosas distintas. Atlas modela esas distinciones,
incluidos los registros y las conexiones dirigidas por datos de Clojure. Da a su agente evidencia que inspeccionar antes de editar.

### Errores que le ayuda a detectar antes de publicar

Cada fila es una respuesta real sobre un proyecto público; siga el enlace para ver la transcripción completa.

| Posible error | Pregunte con | Lo que mostró Atlas (ejemplo real) |
|---|---|---|
| A una fila de configuración o de datos le falta una clave que tienen sus filas hermanas | `key_siblings` | re-frame: 2 filas de una tabla de queries carecen de `:re-frame/lifecycle`, que tienen 3 de 4 filas hermanas ([transcripción](docs/GUIDE.md#key_siblings)) |
| Una nueva clave obligatoria rompe a los llamadores existentes | `signature_impact` con `added_keys` | polylith-realworld: si `login!` necesita `:tenant-id`, 3 llamadores pasan un map literal sin ella y 1 reenvía un map que Atlas no puede ver ([transcripción](#inspeccione-el-contrato-dentro-de-un-argumento-map)) |
| Un llamador pasa la aridad incorrecta, o una clave que la función nunca lee, o le falta una clave que desestructura | `signature_impact` | integrant: `init` comprobado contra 38 llamadores y ambas aridades; “no finding” con las búsquedas indicadas ([transcripción](docs/GUIDE.md#signature_impact)) |
| A un endpoint le falta middleware o una comprobación de permisos | `route_authz`, `permission_routes` | polylith-realworld: `POST /api/articles` con sus 11 envoltorios en orden, `wrap-authorization` al final; permisos honestamente “not extracted” sin un modelo declarado ([transcripción](docs/GUIDE.md#route_authz)) |
| Se lee una clave que nada escribe (a menudo una errata o una clave renombrada) | `key_flow` | compojure: `:compojure/path` tiene 1 productor (`assoc-path`) y 2 consumidores ([transcripción](docs/GUIDE.md#key_flow)) |
| Un escritor inesperado de un atributo de base de datos | `attribute_usage` | mount: `:order/bid` tiene 2 escritores demostrados, uno de ellos en código de pruebas, y ningún lector ([transcripción](docs/GUIDE.md#attribute_usage)) |
| Un evento despachado no tiene handler, o un handler dispara eventos inesperados | `event_flow` | re-frame todomvc: `:delete-todo` se despacha desde 2 puntos, se maneja una vez y no dispara nada ([transcripción](docs/GUIDE.md#event_flow)) |
| Un cambio pequeño se propaga más de lo esperado | `blast_radius` | integrant: un cambio en `ref?` alcanza 31 definiciones a lo largo de 6 niveles ([transcripción](docs/GUIDE.md#blast_radius)) |
| Código modificado al que no llega ninguna prueba | `context_for_change`, `tests_for` | polylith-realworld: las líneas 60-80 del store de article tocan 3 definiciones, 9 llamadores externos y 24 pruebas relacionadas ([transcripción](docs/GUIDE.md#context_for_change)) |

Atlas señala dónde mirar; decidir si es un error queda en sus manos o en las de su agente.

### El flujo de trabajo de un agente

1. **Orientarse:** use `graph_info` para comprobar la instantánea, los adaptadores activos y las lagunas del análisis.
2. **Investigar:** inspeccione llamadores, contratos de parámetros, proveedores/consumidores de claves de map y el impacto potencial de un cambio.
3. **Planificar y verificar:** use `context_for_change` y las herramientas de pruebas para encontrar el código afectado y las pruebas relacionadas;
   inspeccione el código fuente citado, haga el cambio y ejecute las pruebas pertinentes. Reconstruya el grafo y reinicie el servidor MCP para la siguiente pasada.

## Contratos hasta las claves de map

Atlas hace inspeccionable el **contrato de parámetros visible en el código fuente**: qué aporta un llamador, qué
desestructura o lee una función y qué puntos de llamada afecta un cambio propuesto.

| Nivel | Qué puede mostrar Atlas |
|---|---|
| **Conjunto de parámetros** | Aridades aceptadas, parámetros posicionales/rest y argumentos keyword como `& {:keys [verbose]}` |
| **Claves dentro de un argumento map** | `{:keys [email password]}`, valores por defecto `:or`, alias `:as`, claves literales pasadas por los llamadores y lecturas admitidas en el cuerpo de la función |
| **Proveedor / consumidor** | Productores como literales de map, `assoc` y `assoc-in`; consumidores como desestructuración, acceso por keyword, `get` y `get-in` |
| **Cambios de contrato** | Puntos de llamada afectados por claves añadidas/eliminadas o aridades modificadas, usando `signature_impact` con `added_keys`, `removed_keys`, `arities` o `base_graph` |
| **Maps anidados** | Apariciones de claves literales en maps anidados, desestructuración y rutas como `(get-in cart [:meta :count])`, mediante `key_flow` |

El alcance es el **uso estático de claves**, no la validación de valores ni de tipos. `key_flow` agrupa las apariciones por keyword, no por
la identidad de un map concreto. `signature_impact` registra la clave exterior de una desestructuración anidada o de `get-in`,
no un esquema anidado completo. Los maps y claves construidos en tiempo de ejecución pueden quedar desconocidos.

## Lenguajes y compatibilidad con el ecosistema

**Lenguajes principales:** Clojure (`.clj`), ClojureScript (`.cljs`) y código compartido (`.cljc`). Los archivos EDN aportan formas de
configuración y datos admitidas. TypeScript (`.ts`) se lee solo para la integración opcional con Playwright;
no es un analizador general de JavaScript ni de TypeScript.

| Área | Bibliotecas / formas reconocidas | Qué cubre hoy |
|---|---|---|
| Clojure básico | Vars, llamadas, usos de valor, callbacks, multimétodos, protocolos | Definiciones y relaciones de dependencia; los candidatos de despacho son heurísticos |
| Contratos de parámetros y de map | Aridades de `defn`, desestructuración de map, argumentos keyword, literales de map y operaciones sobre claves | Conjuntos de claves aportados por el llamador, claves consumidas, puntos proveedor/consumidor e impacto de cambios de firma |
| Estado del frontend | **re-frame**, incluido `re-frame.alpha` | Registros de eventos/suscripciones, dispatch, entradas de suscripción y suscriptores |
| Enrutamiento del backend | Rutas de tabla de **Compojure**, **Reitit**, **Pedestal** | Rutas, copias de rutas montadas y handlers; los interceptores del service-map de Pedestal no se extraen |
| Middleware | **Ring**, `wrap-routes` de Compojure, datos de ruta de Reitit y `ring-handler` | Cadenas ordenadas, incluidos los envoltorios exteriores; las cadenas inferidas se marcan como heurísticas |
| Autorización de rutas | Claves de permiso, middleware y funciones definidos por el proyecto | Requiere una pequeña declaración en `.clojure-atlas.edn` |
| Enrutamiento del navegador | **Reitit frontend**, **Secretary** | Nodos de ruta de cliente en el grafo; aún no hay una herramienta MCP dedicada para listarlos |
| Peticiones HTTP | **cljs-ajax**, **cljs-http**, `js/fetch`, effect maps de peticiones | Puntos de petición y coincidencias con rutas del backend por método y ruta |
| Datos | **Datomic**, **DataScript**, **XTDB v1 / Crux** | Atributos, escrituras de transacciones, lecturas de query/pull y referencias inciertas |
| Ciclo de vida del sistema | **Integrant**, **Mount**, **Component** | Claves de sistema, registros y aristas de dependencia; la extracción de la configuración de Integrant se basa en refs |
| Esquemas | **clojure.spec / cljs.spec**, **Malli** | Esquemas spec registrados y esquemas Malli almacenados en vars; los registros de Malli no se admiten |
| Pruebas e interfaz | **clojure.test / cljs.test**, **Playwright**, selectores Hiccup literales | Enlaces estáticos a pruebas; los page objects de Playwright y las pruebas `.ts` requieren TypeScript 5 opcional |
| Estructura del proyecto | Estructuras **deps.edn**, **Leiningen**, **shadow-cljs**, **Babashka**, **Boot**, **Polylith** | Descubrimiento de código fuente y agrupación por módulo/componente; los alias de build y la ejecución de tareas no se analizan |

Los adaptadores de framework reconocen formas concretas del código fuente, no todos los usos posibles de una biblioteca. `graph_info` informa
de lo que estaba disponible y se activó en **su** proyecto. Repositorios como Fulcro, Pathom, HoneySQL y next.jdbc están en
el corpus de medición, pero su presencia allí **no** significa que haya un análisis dedicado de framework o de SQL implementado.
Consulte la [hoja de ruta](ROADMAP.md) para esos adaptadores, bidi, compojure-api y otras lagunas.

## Véalo en acción

Estos extractos proceden de los [grafos de ejemplo incluidos en el repositorio](examples/) de proyectos públicos. La invocación es una
llamada a una herramienta MCP, no un comando de shell. `[S]` significa demostrado estáticamente; `[H]` significa heurístico.

### Inspeccione el contrato dentro de un argumento map

En polylith-realworld, `login!` recibe **un solo argumento map** y desestructura **`:email` y `:password`**.
Atlas muestra ese conjunto de claves junto a los argumentos que aportan sus llamadores:

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

El conjunto de claves del map literal es visible; el map pasado como `login-input` sigue siendo desconocido. `[S]` en esa fila demuestra
la relación de llamada, no el contenido del map en tiempo de ejecución.

<details>
<summary><strong>Cambie el contrato de parámetros: ¿y si login! también necesita :tenant-id?</strong></summary>

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

Los tres llamadores con map literal omiten la clave propuesta. El cuarto llamador reenvía `login-input`, así que su impacto
es **UNKNOWN**. Es un cambio de contrato hipotético; la herramienta no modifica el código fuente. “No finding” se refiere
a la firma existente; la sección `affected` describe el cambio propuesto.

</details>

<details>
<summary><strong>Encuentre los proveedores y consumidores de :email en todo el proyecto</strong></summary>

```text
key_flow {"key": ":email", "group_by": "none", "limit": 2}
```

```text
KEY_FLOW :email — 9 producer(s), 5 consumer(s) in 1 component(s); 23 site(s) in tests
counts: producers=9 [S9]  consumers=5 [S5]  tests=23 [S23]
[... trimmed ...]
```

El resultado lista los productores de map literal en `register!` y los consumidores por desestructuración, incluido `login!`, con
ubicaciones en el código fuente. Como `:email` no está calificado, todos los maps que usan ese keyword se agrupan juntos; esto
no demuestra que el map de un productor concreto llegue a un consumidor concreto.

</details>

<details>
<summary><strong>Encuentre los llamadores antes de un refactor</strong></summary>

**Pregunta:** ¿Quién llama a `integrant.core/dependent-keys`?

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
<summary><strong>Rastree un evento de re-frame a través de los puntos de dispatch y su handler</strong></summary>

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

La conexión se hace mediante un keyword de evento, por lo que mirar solo a los llamadores de una función con nombre la habría pasado por alto.

</details>

<details>
<summary><strong>Vea el middleware delante de un endpoint y lo que Atlas no pudo comprobar</strong></summary>

De polylith-realworld, donde las rutas se envuelven con middleware de Ring en una definición aparte:

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

El handler está demostrado; los once envoltorios se encuentran en orden pero se marcan `[H]`, porque la composición del middleware
es código de tiempo de ejecución. El proyecto no declara reglas de permisos, así que Atlas dice **not extracted** en lugar de afirmar
que la ruta no tiene comprobación de permisos.

</details>

<details>
<summary><strong>Un fallo honesto: un nombre que se usa pero nunca se define</strong></summary>

De next.jdbc, donde una macro genera funciones auxiliares que clj-kondo no puede expandir:

```text
callers {"var": "next.jdbc.types/as-other"}
```

```text
CALLERS next.jdbc.types/as-other — no definition matches "next.jdbc.types/as-other"; used at test/next/jdbc/sql_test.clj:290, test/next/jdbc_test.clj:559 but no definition was found
note: next.jdbc.types/as-other is used at test/next/jdbc/sql_test.clj:290, test/next/jdbc_test.clj:559 but no definition was found: probably defined by a macro clj-kondo cannot expand; add :lint-as for the macro in .clj-kondo/config.edn
note: use a fully qualified name (ns/name)
```

En lugar de “no encontrado, revise la ortografía”, la respuesta muestra dónde se usa el nombre y cómo hacerlo visible.
Con una entrada `:lint-as` para la macro, la misma pregunta devuelve una definición demostrada
([configuración del proyecto](docs/GUIDE.md#project-configuration)).

</details>

<details>
<summary><strong>Convierta las líneas modificadas en contexto de revisión y pruebas relacionadas</strong></summary>

De polylith-realworld:

```text
context_for_change {"changes": ["components/article/src/clojure/realworld/article/store.clj:60-80"]}
```

```text
CONTEXT_FOR_CHANGE components/article/src/clojure/realworld/article/store.clj:60-80 — 1 file(s), 3 changed symbol(s), 0 route(s), 0 attribute(s); risk LOW
counts: changed symbols=3 [S3]  callers outside the diff=9 [S9]  tests to run=24 [S24]
[... trimmed ...]
```

La respuesta completa lista las tres definiciones modificadas, nueve llamadores fuera del diff y 24 pruebas relacionadas,
agrupadas por componente. `LOW` describe las comprobaciones que realizó el grafo; no es una garantía de seguridad.

</details>

[Más ejemplos reales](examples/README.md) · [Todas las herramientas y transcripciones completas](docs/GUIDE.md#tools)

## Inicio rápido

**Requisitos previos:** Node.js **22.18+** y Git. No se necesita JVM ni entorno de ejecución de Babashka.

### 1. Instale y construya un grafo

Ejecútelo desde la raíz del **proyecto Clojure que quiere analizar**:

```sh
# Install the reviewed source revision (Git installation builds the CLI).
npm install --save-dev \
  'git+https://github.com/Bariscanates404/clojure-atlas.git#8634d33e3ed59d420eead61a9c596f752d1fe789'

npx clojure-atlas build
```

El paquete no está publicado actualmente en npm; use la instalación desde Git de arriba. Se requiere acceso al repositorio
mientras sea privado. Una instalación desde el código fuente usa TypeScript y las definiciones de tipos de Node para compilar la CLI; son
dependencias de tiempo de compilación, separadas de sus cero dependencias de ejecución npm obligatorias.

El grafo se guarda en `.clojure-atlas/graph.json.gz`. La primera compilación descarga y verifica el binario fijado de clj-kondo;
los análisis posteriores usan el binario en caché. Añada `.clojure-atlas/` al `.gitignore` de su proyecto.

### 2. Conecte su cliente MCP

Para Claude Code, previsualice y después escriba la configuración del proyecto:

```sh
npx clojure-atlas init         # preview .mcp.json
npx clojure-atlas init --yes   # write it; keep existing servers
```

Active el servidor en su cliente y pídale que use `graph_info` y `callers` sobre un `ns/name` totalmente calificado
de su proyecto.

<details>
<summary><strong>Configure otro cliente MCP</strong></summary>

Atlas usa **MCP sobre stdio**. Configure el cliente para que lo inicie desde la raíz de su proyecto:

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

Si el cliente inicia los servidores en otro lugar, use su ajuste de directorio de trabajo o rutas absolutas para la CLI
instalada, el grafo y el repositorio. Los formatos de configuración de los clientes pueden diferir.

</details>

### 3. Reconstruya tras los cambios

```sh
npx clojure-atlas build       # refresh the snapshot
npx clojure-atlas coverage   # inspect resolution counts and unresolved names
```

No hay modo watch. Con `--repo`, las consultas avisan con `STALE` cuando el árbol de trabajo ya no coincide con el
grafo. Reinicie el servidor MCP tras reconstruir para que cargue el nuevo grafo.

**¿Ya tiene configuración de clj-kondo?** Atlas aplica el `.clj-kondo/config.edn` del proyecto, incluidos sus
mapeos de macros y hooks. Un `.clojure-atlas.edn` opcional añade macros de ruta personalizadas y reglas de autorización.
Consulte la [configuración del proyecto](docs/GUIDE.md#project-configuration) y el [fixture de autorización](test/fixtures/authz/.clojure-atlas.edn).

## Cómo leer una respuesta

| Marcador | Significado | Cómo usarlo |
|---|---|---|
| `[S]` — `STATIC_PROVEN` | Resuelto por clj-kondo o establecido a partir de una forma literal del código fuente | Siga la ubicación citada del código fuente |
| `[H]` — `HEURISTIC` | Inferido a partir de un nombre, un envoltorio, una posición en un threading o un candidato de despacho | Verifique la relación en el código fuente |
| `[?]` — `UNKNOWN` | No se puede decidir estáticamente | Trátelo como un límite del análisis |

**Un resultado vacío no es automáticamente una prueba de ausencia.** Atlas distingue entre “no se encontró nada”, “no se encontró la
definición” y “capacidad no disponible”. `DEGRADED` avisa de un análisis incompleto; `STALE` avisa de una
instantánea obsoleta. Un recuento de pruebas de cero significa que no se encontró ningún enlace estático, no que el código no esté probado.

El despacho dinámico, los símbolos creados en tiempo de ejecución y las macros del proyecto pueden limitar lo que ve el grafo. El middleware
ilegible se informa como desconocido. Los permisos de ruta requieren configuración explícita del proyecto.
[Evidencia y ausencia](docs/GUIDE.md#bands-and-absence) · [Límites conocidos](docs/GUIDE.md#limits)

## Local por diseño

La CLI principal **no tiene dependencias de ejecución npm obligatorias**. Usa la biblioteca estándar de Node, clj-kondo para el
análisis de Clojure y Git para los metadatos del repositorio. Construye y consulta el grafo localmente, sin necesidad de cuenta de Atlas,
índice alojado ni servicio en la nube.

### Requisitos

| Componente | Función |
|---|---|
| Node.js 22.18+ | Ejecuta la CLI y el servidor MCP |
| clj-kondo 2025.10.23 | Analizador nativo; se descarga una vez y se guarda en caché, con el SHA-256 del archivo fijado |
| Git | Instalación desde el código fuente, comprobaciones de archivos rastreados e información de instantánea/obsolescencia |
| TypeScript 5 — opcional en tiempo de ejecución | Análisis de page objects y pruebas de Playwright; instálelo con `npm i -D typescript@5` junto a Atlas |

Hay binarios fijados para macOS arm64/x64, Linux arm64/x64 y Windows x64. El desarrollo y las mediciones del corpus
usaron macOS arm64; **Windows no se ha probado**. Si la descarga no está disponible, por ejemplo detrás de un
proxy, Atlas puede recurrir a un `clj-kondo` funcional en el `PATH`. [Detalles de plataforma y caché](docs/GUIDE.md#requirements).

### Seguridad

Una superficie de dependencias pequeña ayuda, pero **cero dependencias npm obligatorias no significa cero riesgo en la cadena de suministro**.

- Los archivos de clj-kondo descargados se comprueban contra un SHA-256 fijado. Una descarga que no coincide se rechaza; un
  ejecutable alternativo del `PATH` se considera de confianza por separado y no se verifica contra ese hash de archivo fijado.
- Atlas no lanza la JVM de la aplicación analizada, ni scripts de shell ni código Node. **Los hooks de clj-kondo del proyecto
  los interpreta clj-kondo**, de modo que su configuración forma parte del código en el que confía al analizar un repositorio.
- El servidor MCP lee el grafo y usa comprobaciones de Git de solo lectura. Los hooks de comandos de Git, los controladores de filtro y fsmonitor
  están desactivados para esas comprobaciones; los subprocesos de Git y clj-kondo tienen tiempos de espera.
- Atlas sirve los resultados localmente por stdio. Cómo gestione esos resultados el cliente de IA/MCP que usted elija es un
  límite de privacidad distinto.

Son propiedades de la implementación, no una certificación de auditoría de seguridad. [Modelo de ejecución detallado](docs/GUIDE.md#security).

## Cobertura

Medido en **26 repositorios públicos**, cada uno fijado a un commit en [corpus.json](corpus.json). El corpus incluye
Babashka, Logseq, Metabase, Penpot, re-frame, Reitit y bibliotecas más pequeñas. Los resultados completos están en
[docs/COVERAGE.md](docs/COVERAGE.md).

**La tasa de resolución mide algo muy concreto:** `resolved / (resolved + unresolved)` para los usos de vars atribuidos
a espacios de nombres de proyecto reconocidos. Los usos de bibliotecas y **los usos de espacios de nombres desconocidos quedan fuera de ese denominador**.
No mide todo el código comprendido, todo el comportamiento de framework extraído ni la corrección en tiempo de ejecución.

| Repositorio | Resolved | Unresolved | Tasa de resolución | Espacio de nombres desconocido (recuento bruto, excluido) |
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
| **Los 26 repositorios** | | | **mediana 100.0%; 24 de 26 con 99.3% o más** | |

† [docs/COVERAGE.md](docs/COVERAGE.md#repos-under-95-resolution-rate-or-with-unknown-namespace-usages-above-5-of-resolved)

Las tasas se redondean a un decimal. Léalas siempre junto con **ambos** recuentos: unresolved y espacio de nombres desconocido.
Los nombres desconocidos pueden incluir locales enlazados por macros poco comunes además de usos de vars omitidos; el analizador no puede
separarlos de forma fiable.

**Los cambios de métrica no son mejoras del analizador.** Las cifras anteriores usaban un denominador distinto. La tasa
más alta que se informa para Babashka refleja en gran medida la exclusión de símbolos de espacios de nombres desconocidos, no código resuelto de nuevo.
Las comparaciones entre esas definiciones no son equivalentes; los recuentos brutos de arriba se mantienen visibles a propósito.

### Mejoras reales de extracción

Son cambios concretos en lo que Atlas puede leer, independientes de la definición de la tasa de resolución:

| Mejora | Resultado observable | Evidencia |
|---|---|---|
| Leer el middleware exterior de Ring/Compojure | polylith-realworld: **0 → 11** entradas de middleware para `POST /api/articles` | [Benchmark q13](docs/BENCHMARK.md#positive-questions), [fixture](test/fixtures/ring-middleware/) |
| Leer tablas de rutas del frontend en otro espacio de nombres | Logseq: **0 → 17** nodos de ruta de cliente | [Cobertura](docs/COVERAGE.md), [benchmark q14](docs/BENCHMARK.md#positive-questions) |
| Reconocer `re-frame.alpha` | Se extraen los registros y dispatches a través del espacio de nombres alpha | [Historial del benchmark](docs/BENCHMARK.md), [fixture](test/fixtures/reframe/src/app/alpha.cljs) |
| Aplicar la configuración de clj-kondo del proyecto | Los mapeos de macros y hooks del proyecto participan en el análisis | [Fixture de configuración](test/fixtures/project-config/), [pruebas](test/config.test.ts) |

### Benchmark

El benchmark registrado supera **14/14 preguntas positivas** y **7/7 preguntas de ausencia**, con respuestas esperadas
verificadas a mano contra el código fuente. Es un pequeño benchmark de regresión, no una estimación general de precisión. Trece
respuestas positivas usan herramientas MCP; la pregunta de rutas de cliente lee los nodos del grafo directamente porque aún ninguna herramienta lista
las rutas de cliente. [Preguntas, resultados y metodología](docs/BENCHMARK.md).

## Cómo se prueba Atlas

Una herramienta en la que confían los agentes no debe inventar relaciones. Antes de esta versión, el código pasó por:

| Comprobación | Resultado |
|---|---|
| Pruebas automatizadas | **831**, todas pasan; cada error corregido tiene una prueba que fallaba antes de la corrección |
| Cobertura de líneas del código fuente | **99.75%**; la CI falla por debajo del 98% |
| Cacerías de errores | Un revisor por módulo buscó respuestas incorrectas con reproducciones ejecutables; se encontraron y corrigieron **85** errores demostrados |
| Revisiones independientes | **Seis** rondas de revisores que no habían escrito el código, puntuando corrección, limpieza, reglas y pruebas por módulo, hasta que cada módulo obtuvo al menos 4 de 5 |
| Repositorios reales | **26** proyectos públicos se construyen sin fallos y con **0** aristas perdidas (antes 690 en seis de ellos) |
| Repositorios no confiables | Fixtures hostiles comprueban que los ajustes de Git, los controladores de filtro, los submódulos, el TypeScript del proyecto, los nombres de archivo extraños y los hooks de clj-kondo que se cuelgan no ejecutan nada ni bloquean nada; la búsqueda de ejecutables omite el directorio del repositorio (probado con pruebas unitarias; Windows en sí no se ha probado) |
| Verdad de referencia | El [benchmark](docs/BENCHMARK.md) de arriba: 14 preguntas positivas y 7 de ausencia, respuestas verificadas a mano |

Las preguntas de ausencia son las más importantes: comprueban que Atlas dice “not found”, “not extracted” o “degraded” cuando
esa es la verdad, en lugar de una lista vacía que parece decir “ninguno”.

## Contribuir

**Let's build our Clojure X-ray tool together! (¡Construyamos juntos nuestra herramienta de rayos X para Clojure!)**

Una contribución útil puede empezar con un pequeño ejemplo de Clojure: “esta biblioteca conecta estas dos cosas, y Atlas
debería verlo”. Añada un fixture y las filas esperadas del grafo, o ayude a implementar su adaptador. Ambas son bienvenidas.

```sh
npm ci
npm test
npm run test:coverage   # 98% source line-coverage gate
npm run typecheck
```

La CLI está escrita en TypeScript para una distribución sencilla con Node; clj-kondo realiza el análisis de Clojure.
[Guía del colaborador](CONTRIBUTING.md) · [Hoja de ruta](ROADMAP.md) · [Referencia de herramientas](docs/GUIDE.md)

## Créditos y licencia

Creado por **Barış Can Ateş**. [Licencia MIT](LICENSE), incluidas la documentación y las ilustraciones originales de este
repositorio. Construido sobre **[clj-kondo](https://github.com/clj-kondo/clj-kondo)** de Michiel Borkent, con
**[MCP](https://modelcontextprotocol.io)** como interfaz con los agentes de programación. Gracias a los autores de los proyectos
públicos usados en el corpus y en los ejemplos. Esos proyectos y dependencias conservan sus propias licencias.

*For the sake of all Clojurians.*
