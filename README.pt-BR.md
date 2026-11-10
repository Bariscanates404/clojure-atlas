# clojure-atlas

**For the sake of all Clojurians.**

*Pelo bem de todos os Clojurians.*

[English](README.md) | [Türkçe](README.tr.md) | [Deutsch](README.de.md) | [Español](README.es.md) | Português (Brasil) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md)

Um mapa estrutural de uma base de código Clojure, ClojureScript ou .cljc, servido a agentes de programação com IA como ferramentas MCP.
Feito para o desenvolvimento agêntico. Licença MIT. Criado por Barış Can Ateş.

## O que é

Um agente que edita Clojure costuma achar relações com busca de texto. A busca de texto não distingue uma chamada
de um keyword com o mesmo nome, não enxerga um handler registrado com `reg-event-fx`, uma rota que chega a um var
nem uma função passada a `partial`, e não consegue dizer "nada chama isto" com confiança. O clojure-atlas roda o
[clj-kondo](https://github.com/clj-kondo/clj-kondo) uma vez sobre o projeto, transforma a análise dele em um grafo
(definições, chamadas, usos de valor, eventos re-frame, rotas, chaves de sistema, atributos de dados, chaves de mapa, testes)
e responde perguntas sobre ele por MCP. Cada linha de uma resposta traz uma banda que diz como foi provada, e cada
resposta vazia diz o que foi buscado e se o grafo tem como saber.

## Início rápido

```sh
npm i -D clojure-atlas
npx clojure-atlas build
npx clojure-atlas init
```

`build` escreve `.clojure-atlas/graph.json.gz`. No repo do integrant ele imprime:

```
clojure-atlas: 7 files, 138 definitions, 296 nodes, 1481 edges; resolution rate of var usages in recognized project namespaces 100.0% (442 of 442), 0 usages in an unknown namespace; 0.7 s -> .clojure-atlas/graph.json.gz
```

`init` mostra o `.mcp.json` do projeto que escreveria e só o escreve com `--yes`:

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

Os outros servidores que já estão no `.mcp.json` são mantidos.

### Claude Code

`npx clojure-atlas init --yes` escreve o `.mcp.json` do projeto, que o Claude Code lê. Ou adicione o servidor manualmente:

```sh
claude mcp add clojure-atlas -- npx clojure-atlas mcp --graph .clojure-atlas/graph.json.gz --repo .
```

### Qualquer outro cliente MCP

O servidor fala MCP por stdio. A maioria dos clientes aceita este JSON:

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

- `build` analisa `dir` (padrão `.`) e escreve o grafo.
- `mcp` serve um grafo. Com `--repo`, as respostas começam com uma linha `STALE` quando a árvore de trabalho não é
  aquela a partir da qual o grafo foi construído, ou quando o commit que o agente passa como `base` está a mais de
  `--max-distance` commits além do commit do grafo (padrão 20), ou o commit do grafo está à frente de `base` ou divergiu
  dele. A verificação da árvore de trabalho é repetida no máximo a cada 3 segundos, então uma edição aparece a partir
  da primeira chamada depois disso.
- `coverage` imprime a linha de cobertura de um grafo e seus nomes não resolvidos mais frequentes.
- `init` adiciona o servidor ao `.mcp.json` do projeto.

Reconstrua o grafo depois de mudar o código. Um grafo servido não se atualiza sozinho:

```
STALE: the working tree is not the snapshot this graph describes (2 uncommitted file(s) now, 1 at build); rebuild with clojure-atlas build.
```

A configuração `.clj-kondo` do próprio projeto é respeitada. Um `.clojure-atlas.edn` opcional na raiz do projeto acrescenta o que
os adaptadores genéricos não conseguem adivinhar: `:lint-as` para macros que definem vars, `:route-macros`, e as chaves de
autorização de rotas `:route-authz`, `:permission-middleware` e `:permission-fns`.

<a id="project-configuration"></a>
### Configuração do projeto

Uma var criada por uma macro do projeto, e uma rota escrita com uma macro do projeto, ficam invisíveis até que a macro seja nomeada.
Tome um pequeno projeto de teste com esta macro e esta rota:

```clojure
;; src/probe/defs.clj
(ns probe.defs)

(defmacro defsetting [name value]
  `(def ~name ~value))

(defsetting timeout-ms 5000)

;; src/probe/core.clj
(ns probe.core
  (:require [probe.defs :as defs]))

(defn deadline [now]
  (+ now defs/timeout-ms))

;; src/probe/web.clj
(ns probe.web
  (:require [compojure.core :as c]))

(defmacro GET* [path args & body]
  `(c/GET ~path ~args ~@body))

(defn hello [_req]
  {:status 200 :body "hello"})

(def app
  (c/routes
    (GET* "/hello" [] hello)))
```

Sem configuração, a var é usada mas não tem definição, e a rota não existe:

```
CALLERS probe.defs/timeout-ms — no definition matches "probe.defs/timeout-ms"; used at src/probe/core.clj:5 but no definition was found
[... trimmed ...]
ROUTE_AUTHZ GET /hello — no route matches "GET /hello"
[... trimmed ...]
```

Coloque este `.clojure-atlas.edn` na raiz do projeto e reconstrua. As duas chaves mapeiam uma macro totalmente qualificada
para a forma totalmente qualificada com a qual ela se comporta:

```clojure
{:lint-as      {probe.defs/defsetting clojure.core/def}
 :route-macros {probe.web/GET* compojure.core/GET}}
```

```
CALLERS probe.defs/timeout-ms — 1 direct caller(s) in 1 component(s)
counts: callers and references=1 [S1]
definition (1)
  1. probe.defs/timeout-ms  src/probe/defs.clj:6 [S]
callers and references (1)
  1. probe.core/deadline  src/probe/core.clj:5 [S]
[... trimmed ...]
```

```
ROUTE_AUTHZ GET /hello — not provable: route authz not in this graph
counts: route=1 [S1]  handler=1 [S1]
[... trimmed ...]
GET /hello @probe.web/app (base probe.web/app): handler (1)
  1. probe.web/hello  src/probe/web.clj:12 [S]  entry: route GET /hello @probe.web/app
[... trimmed ...]
```

(A primeira resposta é `callers` com `include_references: true`, porque `timeout-ms` é um valor, não uma função.)
O `:lint-as` pode ficar no `.clj-kondo/config.edn` do projeto, no formato próprio do clj-kondo, com o mesmo
resultado; `:route-macros` existe apenas no `.clojure-atlas.edn`:

```clojure
{:lint-as {probe.defs/defsetting clojure.core/def}}
```

## Ferramentas

Cada exemplo abaixo é saída real de `clojure-atlas mcp` sobre um grafo de [examples/](examples/), cortada apenas
onde indicado. O mount define quatro namespaces em mais de um arquivo, então suas respostas começam com uma
linha `DEGRADED` (veja a próxima seção). `[S]`, `[H]` e `[?]` são as bandas, explicadas na próxima seção.

### graph_info

Qual commit o grafo descreve e o que cada adaptador encontrou, com a contagem de linhas por banda. Pergunta: o que o grafo
do integrant sabe?

```
graph integrant @ master sha bcad6bcf35b62d3a32a453dc26b6d3a4d659dc01 built 2026-11-10T04:47:34.989Z: 296 nodes, 1481 edges
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

Chamadores diretos de uma definição. Pergunta: quem chama `integrant.core/dependent-keys`?

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

Com `include_references: true` ele também lista usos de valor, callbacks, handlers registrados, expansões de macro,
candidatos de despacho e rebindings. Um var nomeado dentro do corpo de uma macro com syntax-quote (o `defroutes` do
compojure nomeando `routes`) é uma referência HEURISTIC, não uma chamada.

### blast_radius

Dependentes transitivos de uma definição. Pergunta: o que uma mudança em `integrant.core/ref?` pode alcançar?

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

Aridades, chaves desestruturadas e o que cada chamador passa. Pergunta: como `integrant.core/init` é chamado?

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

No modo diff (`base_graph`, ou `added_keys` / `removed_keys` / `arities`) ele lista os chamadores que uma mudança de
assinatura afeta.

### route_authz

Handler, cadeia de middleware e verificação de permissão de uma rota de backend. Pergunta: o que atende `POST /api/articles` no polylith-realworld, e qual middleware o envolve?

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

A décima primeira linha, na próxima página, é o middleware de autorização, aplicado com o `wrap-routes` do compojure:

```
  11. clojure.realworld.rest-api.middleware/wrap-authorization  bases/rest-api/src/clojure/realworld/rest_api/api.clj:45 [H]  heuristic match  (#10 wrapper)
```

Quando o envolvimento de uma rota não pode ser lido, a seção diz isso em vez de "none" (usermanager, `GET /user/list`):

```
GET /user/list @usermanager.main/my-handler (base usermanager.main/my-handler): middleware: not extracted (UNKNOWN)
```

O middleware aplicado fora da tabela de rotas é lido como HEURISTIC: wraps do Ring, `->`, `->>`, chamadas aninhadas,
`wrap-routes`, e os wraps externos e o `{:middleware [...]}` do terceiro argumento do `ring-handler` do reitit. Um
middleware de permissão encontrado aí conta como verificação. O middleware nos dados de rota do reitit e do pedestal
(`:middleware`, `:interceptors`) é lido da própria rota. Quando o wrapping não pôde ser lido por completo, o
route_authz diz `no permission check found in what could be read (...); not provable that none exists`. Uma árvore de
rotas que nenhum roteador alcança mostra seu middleware como UNKNOWN; hoje isso vale para toda rota do pedestal, porque
os interceptors de um service map do pedestal não são lidos. Um handler que o grafo não consegue resolver aparece como
`handler: not resolved (UNKNOWN)`. Aqui o veredito de permissão é "not provable", porque este projeto não declara
nenhum modelo de autorização no `.clojure-atlas.edn`.
### permission_routes

Toda rota que verifica uma permissão. Pergunta: quais rotas do mount exigem `:admin`?

```
DEGRADED: 4 namespace(s) defined in more than one file (app.conf, app.example, tapp.conf, ...) share one node each, so calls into them are heuristic; an empty or missing answer may be a gap in the graph, not absence
PERMISSION_ROUTES :admin — no permission matches ":admin"
note: capability route_authz is absent: an empty answer is not proof of absence
note: use the exact permission name, with its namespace if it has one
searched: names, ids and kind-prefixed ids; check the spelling or pass the fully qualified name
```

### attribute_usage

Leitores e escritores comprovados de um atributo de Datomic, datascript ou XTDB. Pergunta: quem escreve `:order/bid` no
app de exemplo do mount?

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

Dispatchers e handler de um evento re-frame, ou handler, entradas e assinantes de uma subscription. Um dispatch cujo
evento não é uma keyword literal é listado como UNKNOWN. Pergunta: quem faz
dispatch de `:delete-todo` no todomvc do re-frame?

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

Testes unitários que alcançam uma definição, diretamente ou até a profundidade 3. Pergunta: quais testes exercitam
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

Testes de navegador (page objects e testes do Playwright, lidos com o TypeScript 5 quando ele está instalado ao lado do clojure-atlas como o peer opcional `typescript`; nunca a
cópia do repositório analisado) que alcançam um arquivo,
uma definição, um seletor ou uma rota. Nenhum dos repos de exemplo os tem, e a resposta diz isso. Pergunta: quais testes de
navegador alcançam `mount.core/start`?

```
DEGRADED: 4 namespace(s) defined in more than one file (app.conf, app.example, tapp.conf, ...) share one node each, so calls into them are heuristic; an empty or missing answer may be a gap in the graph, not absence
TESTS_COVERING mount.core/start — 0 browser test(s) in 0 spec file(s)
note: capability selectors is available but not used (nothing in this codebase switches it on): an empty answer is not proof of absence
note: capability browser_tests is available but not used (nothing in this codebase switches it on): an empty answer is not proof of absence
note: no browser test reaches this target through selectors, page objects or requests
tests: none (searched: selector, page-object and request edges)
```

### key_flow

Produtores e consumidores de uma chave de mapa. Pergunta: onde a chave de request `:compojure/path` do compojure é escrita e
lida?

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

Linhas de uma tabela literal de mapas que não têm uma chave que a maioria das linhas irmãs tem. Pergunta: alguma linha da
tabela em `test/re_frame/subs/alpha_test.cljs` do re-frame está sem uma chave?

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

A ausência da chave é comprovada; se a linha deveria tê-la fica a critério do leitor.

### context_for_change

Uma chamada por revisão: símbolos alterados, chamadores fora do diff, rotas, atributos, testes a rodar e testes a adicionar.
Quando uma rota alterada não tem autorização extraída, o risco é UNKNOWN, não LOW.
Um caminho que não está no grafo aparece como `no such file in the graph` e todas as seções como `not checked`; uma entrada malformada é rejeitada. Pergunta: o que uma mudança nas linhas 60-80 do store de artigos do polylith-realworld afeta?

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

Toda ferramenta também aceita `base` (o commit que o agente está olhando), paginação (`offset`, `limit`, `section`) e
`group_by` (`component`, `file`, `none`). Há mais transcrições em [examples/README.md](examples/README.md).

## Bandas e ausência

Cada linha tem uma banda:

- **STATIC_PROVEN** `[S]`: o analisador resolveu as duas pontas (o clj-kondo resolveu o var, ou a forma literal está no
  código-fonte).
- **HEURISTIC** `[H]`: uma correspondência de nome, uma posição encadeada ou um candidato de despacho. Abra a linha citada
  antes de agir com base nela. Exemplos: um defmethod alcançado a partir do seu defmulti (o valor de despacho escolhe o método em
  tempo de execução), um achado de tabela de chaves.
- **UNKNOWN** `[?]`: não pode ser decidido estaticamente, então é listado como fronteira e nunca seguido. Exemplos:
  rebindings com `binding` e `with-redefs`, um keyword de atributo cujo papel (leitura ou escrita) não está comprovado, um
  uso de `apply` ou `partial` no signature_impact.

As linhas `counts:` dão os totais por banda, por exemplo `callers=4 [S4]` ou `findings=2 [H2]`.

Uma resposta vazia nunca é uma lista vazia simples. Ela toma uma destas formas:

- **none**: a coisa existe e nada se relaciona com ela. `callers: none (searched: call edges into this definition)`.
- **not found**: a base de código não tem tal coisa. `no definition matches "integrant.core/stop"`.
- **capability off**: o grafo não consegue responder, porque o adaptador para esse tipo de fato não encontrou nada para extrair
  ou não foi configurado. `capability route_authz is absent: an empty answer is not proof of absence`. Uma seção que depende dele aparece como
  `not extracted (route_authz is absent)`, nunca como "none". Uma cadeia de middleware que não pode ser lida aparece como
  `not extracted (UNKNOWN)`.

Quando o próprio grafo está incompleto, o log de build, o graph_info e toda resposta começam com uma linha `DEGRADED`. Ela
nomeia os arquivos que o clj-kondo não conseguiu analisar de forma alguma, os arquivos com erros de sintaxe dos quais ele
se recuperou (algumas formas podem estar faltando), os arquivos rastreados que não foram lidos e o motivo (uma pasta
oculta ou de build, um symlink, um arquivo apagado), os arquivos acima de 2 MB que foram pulados (para um arquivo `.edn`,
faltam seus dados, chaves e configuração), os namespaces definidos em mais de um arquivo (seus usos são HEURISTIC, via
`duplicate-namespace`) e as arestas descartadas porque uma ponta não era um nó. Um nome não encontrado que
provavelmente está em um arquivo assim nomeia esse arquivo. Do shadow-cljs, onde um arquivo não pode ser analisado:

```
DEGRADED: 1 file(s) could not be parsed (src/dev/demo/test_fail.cljs), so their definitions and calls are missing; 2 file(s) have syntax errors but were analyzed (src/dev/demo/errors.cljs, src/main/shadow/cljs/devtools/config.clj); some forms in them may be missing; 1 namespace(s) defined in more than one file (demo.http) share one node each, so calls into them are heuristic; an empty or missing answer may be a gap in the graph, not absence
CALLERS demo.test-fail/a-failing-test — no definition matches "demo.test-fail/a-failing-test"
note: demo.test-fail/a-failing-test probably lives in src/dev/demo/test_fail.cljs, which could not be parsed: its definitions are not in the graph, so this is not a spelling problem
note: use a fully qualified name (ns/name)
```

Do biff, cujo arquivo tem erros de sintaxe mas foi analisado: a resposta aponta primeiro para uma forma que o
clj-kondo não conseguiu ler nesse arquivo, depois para uma macro, e mantém a dica de grafia:

```
DEGRADED: 1 file(s) have syntax errors but were analyzed (libs/sqlite/src/com/biffweb/sqlite/impl/execute.clj); some forms in them may be missing; 1 namespace(s) defined in more than one file (tasks) share one node each, so calls into them are heuristic; an empty or missing answer may be a gap in the graph, not absence
CALLERS com.biffweb.sqlite.impl.execute/execute — no definition matches "com.biffweb.sqlite.impl.execute/execute"; used at libs/sqlite/src/com/biffweb/sqlite.clj:110, libs/sqlite/src/com/biffweb/sqlite.clj:121, libs/sqlite/src/com/biffweb/sqlite/impl/kv.clj:23, libs/sqlite/src/com/biffweb/sqlite/impl/kv.clj:30, libs/sqlite/src/com/biffweb/sqlite/impl/kv.clj:44 but no definition was found
note: com.biffweb.sqlite.impl.execute/execute is used at libs/sqlite/src/com/biffweb/sqlite.clj:110, libs/sqlite/src/com/biffweb/sqlite.clj:121, libs/sqlite/src/com/biffweb/sqlite/impl/kv.clj:23, libs/sqlite/src/com/biffweb/sqlite/impl/kv.clj:30, libs/sqlite/src/com/biffweb/sqlite/impl/kv.clj:44 but no definition was found: probably a form clj-kondo could not read in the file with syntax errors named below, or a macro clj-kondo cannot expand; add :lint-as for the macro in .clj-kondo/config.edn
note: com.biffweb.sqlite.impl.execute/execute may live in libs/sqlite/src/com/biffweb/sqlite/impl/execute.clj, which has syntax errors; some forms may be missing, so besides a spelling problem a form kondo could not read is possible
note: use a fully qualified name (ns/name)
```

Um nome não encontrado que provavelmente vive em um arquivo cuja execução do clj-kondo estourou o timeout, ou em um
arquivo que o git rastreia mas o build não analisou, nomeia esse arquivo da mesma forma.

Um nome que é usado mas não é definido em lugar nenhum costuma ser gerado por uma macro que o clj-kondo não consegue
expandir. A resposta diz onde ele é usado e o que adicionar. No next.jdbc:

```
CALLERS next.jdbc.types/as-other — no definition matches "next.jdbc.types/as-other"; used at test/next/jdbc/sql_test.clj:290, test/next/jdbc_test.clj:559 but no definition was found
note: next.jdbc.types/as-other is used at test/next/jdbc/sql_test.clj:290, test/next/jdbc_test.clj:559 but no definition was found: probably defined by a macro clj-kondo cannot expand; add :lint-as for the macro in .clj-kondo/config.edn
note: use a fully qualified name (ns/name)
```

Leia uma resposta vazia como uma afirmação sobre a cobertura, não como prova de que algo não existe.

## Cobertura

[docs/COVERAGE.md](docs/COVERAGE.md) mede 26 repos públicos, cada um fixado em um sha no
[corpus.json](corpus.json). A métrica principal se chama **resolution rate** (taxa de resolução): dos usos de vars que o clj-kondo
atribui a um namespace do projeto, a parcela que o grafo liga a uma definição. Usos de vars de
bibliotecas não são contados. Símbolos que o clj-kondo não consegue atribuir a nenhum namespace são informados como uma contagem bruta,
**unknown namespace** (namespace desconhecido), e ficam fora da taxa.

24 de 26 repos estão em 95% ou mais. Os dois abaixo:

| repo | resolved | unresolved | resolution rate | unknown namespace |
|---|---|---|---|---|
| datascript | 4392 | 496 | 89.9% | 1255 |
| day-of-datomic | 84 | 29 | 74.3% | 1 |

O documento os explica como está escrito lá:

> **unresolved**: a var created by a project macro clj-kondo does not know (datascript's record constructors), or
> a name in a REPL script with no ns form that clj-kondo files under a namespace not defining it (day-of-datomic's
> tutorials).

Tradução: **unresolved** é um var criado por uma macro do projeto que o clj-kondo não conhece (os construtores de record do datascript), ou um nome em um script de REPL sem forma ns que o clj-kondo arquiva sob um namespace que não o define (os tutoriais do day-of-datomic).

Outros seis repos são listados porque a contagem de unknown namespace deles passa de 5% dos resolvidos: babashka, cider-nrepl,
fulcro, pedestal, shadow-cljs e usermanager. A tabela imprime uma casa decimal, então 100.0% ainda pode conter alguns
usos não resolvidos (metabase 111, penpot 13, xtdb-v1 3). Os dois tipos diminuem quando um repo inclui uma configuração do clj-kondo para
suas macros, ou as nomeia em `:lint-as` no `.clojure-atlas.edn`. O corpus é medido sem adicionar nenhuma das duas.

## Benchmark

[docs/BENCHMARK.md](docs/BENCHMARK.md) tem 21 perguntas sobre repos do corpus. Cada resposta esperada foi conferida
à mão no código-fonte, sem a ferramenta, e seu file:line está em [bench/questions.json](bench/questions.json).

- **Perguntas positivas: 14 de 14 passam.** Uma pergunta passa quando a resposta nomeia todas as definições esperadas e
  nada além. Itens esperados encontrados: 40 de 40; itens respondidos: 40.
- **Perguntas de ausência: 7 de 7 passam.** A resposta correta é que não há nada (*none*, *not-found*,
  *used-undefined* ou *capability-off*), e a resposta deve declarar esse tipo de ausência e não nomear nada.

As primeiras doze perguntas positivas foram fixadas antes da primeira execução, que marcou 11 de 12. A falha (registros
do re-frame via `re-frame.alpha`) foi corrigida no construtor com um fixture, e a pergunta foi mantida como estava. Duas
perguntas foram adicionadas depois, para a cadeia de middleware do compojure (q13) e uma rota de frontend do reitit (q14).
Nenhuma ferramenta MCP lista rotas de cliente, então a q14 é pontuada lendo diretamente os nós do grafo: 13 das 14
respostas positivas vêm de uma ferramenta.

## Requisitos

- Node.js 22.18 ou mais novo. Sem JVM, sem babashka, sem instalação global.
- No primeiro `build`, o clj-kondo 2025.10.23 é baixado uma vez do
  [release oficial do clj-kondo](https://github.com/clj-kondo/clj-kondo/releases), conferido contra um sha256 fixado
  e guardado em cache em `$XDG_CACHE_HOME/clojure-atlas` (padrão `~/.cache/clojure-atlas`; `%LOCALAPPDATA%\clojure-atlas` no
  Windows). A primeira execução imprime:

  ```
  clojure-atlas: downloading clj-kondo 2025.10.23 (macos-aarch64) once, to <cache>/clojure-atlas/clj-kondo-2025.10.23-macos-aarch64/clj-kondo
  ```

- Offline, ou atrás de um proxy: coloque o `clj-kondo` no seu PATH. O `fetch` do Node ignora `HTTPS_PROXY`, então o download
  falha atrás de um proxy, e o clojure-atlas passa a usar o clj-kondo do PATH. Um download com sha256 errado é
  recusado, nunca executado.
- Opcional: TypeScript 5 (`npm i -D typescript@5` ao lado do clojure-atlas) para ler page objects e testes do Playwright.
  É uma dependência peer opcional. Sem ele, essa leitura fica desligada, e o graph_info e as respostas de testes de
  navegador dizem o motivo para cada projeto Playwright encontrado.
- Plataformas com binário do clj-kondo fixado: macOS arm64, macOS x64, Linux x64, Linux arm64, Windows x64. Qualquer outra
  plataforma precisa do clj-kondo no PATH. Esta versão foi desenvolvida e medida em macOS arm64. O Windows não foi testado.

## Segurança

O build lê arquivos. Ele executa apenas o clj-kondo (o binário fixado, ou o do PATH) e `git ls-files`, e nunca executa
código do repositório analisado com Node, uma JVM ou um shell. O TypeScript é carregado da própria instalação do
clojure-atlas, nunca do repositório analisado. O clj-kondo aplica a configuração `.clj-kondo` do projeto; os hooks
declarados nela são interpretados pelo próprio clj-kondo, como em qualquer editor que roda o clj-kondo. O servidor MCP
apenas lê o arquivo do grafo e, com `--repo`, executa comandos git somente de leitura. Toda chamada ao git ignora as
configurações do próprio repositório que executam comandos (`core.fsmonitor`, filter drivers, hooks), nunca pergunta
nada e tem um timeout. Cada execução do clj-kondo também tem um timeout: um hook que nunca retorna custa o seu lote
(listado em DEGRADED), não o build. O git nunca é executado dentro de um
submódulo (cuja configuração própria o clojure-atlas não consegue desligar), então os arquivos de um submódulo sempre contam como
alterados. Os dois programas são iniciados a partir de um caminho absoluto encontrado no PATH, nunca a partir do diretório
analisado, e as configurações `:output` e `:analysis` do clj-kondo do projeto são substituídas pelas que o grafo precisa.

## Por que TypeScript?

Porque o `npx` simplesmente funciona: não há JVM para instalar nem nada para compilar na máquina do usuário. A análise de Clojure
em si é feita pelo clj-kondo; o clojure-atlas lê a saída dele e as formas do código-fonte, e constrói o grafo. Contribuições de
adaptadores são bem-vindas em qualquer uma das duas linguagens: um adaptador é definido por um pequeno fixture em Clojure e pelas linhas do grafo
esperadas dele, então você pode descrever a semântica de uma biblioteca em Clojure e alguém pode portá-la, ou escrever o
TypeScript você mesmo.

## Limites

- **Somente estático.** Um var resolvido em tempo de execução não é seguido. `requiring-resolve`, `resolve` ou `ns-resolve`
  de um símbolo literal é uma referência HEURISTIC; um símbolo construído em tempo de execução, ou uma função escolhida por dados, não é, e
  callers e blast_radius dizem isso quando o projeto resolve vars dinamicamente. Uma chave de mapa lida ou escrita apenas dinamicamente não é rastreada. Testes que alcançam código por
  multimethods, `resolve`/`apply` ou fixtures HTTP não são contados.
- **Partes heurísticas**: despacho de multimethods e protocolos (`may_dispatch_to`), alguns handlers do compojure
  (mostrados como `heuristic match`), cadeias de middleware do compojure e do Ring, chamadas a fábricas de middleware,
  tabelas de rotas de frontend do reitit em namespaces que não requerem reitit (lidas quando `reitit.frontend` é usado em
  qualquer lugar do projeto), vars nomeados em corpos de macro com syntax-quote, usos dentro de uma macro do projeto que o clj-kondo não consegue
  expandir (via `unexpanded-macro`), usos de um namespace definido em mais de um arquivo (via `duplicate-namespace`),
  posições de chaves encadeadas, literais de consulta fora de uma chamada de transact ou query, achados do key_siblings.
- **Macros do projeto**: o clj-kondo só expande uma macro quando a configuração `.clj-kondo` do projeto lhe dá um
  `:lint-as` ou um hook (ou o `.clojure-atlas.edn` a nomeia em `:lint-as`). Adicione um e reconstrua, e os usos dentro
  dela voltam a ser STATIC_PROVEN. Veja [Configuração do projeto](#project-configuration).
- **Middleware cujo envolvimento não pode ser lido** é reportado como `middleware: not extracted (UNKNOWN)`, não como
  "none".
- **Arquivos não analisáveis e arquivos acima de 2 MB**: suas definições e chamadas faltam no grafo. Toda resposta
  então começa com uma linha `DEGRADED` que os nomeia.
- **Interceptors do service map do pedestal** não são lidos, então o middleware de toda rota do pedestal é UNKNOWN.
- **Autorização de rotas** precisa do `.clojure-atlas.edn`. Sem ele, o route_authz diz "not provable" e
  o permission_routes informa a capacidade como ausente.
- **Ainda não suportado**: rotas bidi, compojure-api, rotas de mapa verbosas do pedestal, registros do malli, sistemas integrant
  sem refs. Veja [ROADMAP.md](ROADMAP.md).
- **datascript e day-of-datomic** resolvem menos (89.9% e 74.3%): o datascript define construtores de record por meio de
  uma macro que o clj-kondo não conhece; os tutoriais do day-of-datomic são scripts de REPL sem forma ns. Veja
  [Cobertura](docs/COVERAGE.md).
- **Símbolos de unknown namespace** (locais ligados por macros desconhecidas, campos de deftype ou proxy) são contados, não
  ligados.
- **Sem build incremental nem watch.** Reconstrua após uma mudança; o servidor avisa com `STALE` quando consegue perceber.
- **O Windows não foi testado.** Proxies não são suportados no download do clj-kondo.

## Contribuindo

```sh
npm ci
npm test                                    # all tests
npm run test:coverage                       # the gate: 98% line coverage of src/
npm run typecheck
node scripts/coverage.ts <corpus-dir>       # rebuilds docs/COVERAGE.md from clones at the corpus.json shas
node bench/score.ts <corpus-dir>            # scores the benchmark questions
```

Para adicionar ou estender um adaptador, comece com um fixture: uma pequena base de código Clojure em `test/fixtures/<name>/` e um
`expected.txt` com todas as linhas do grafo que ele deve produzir, revisadas à mão contra o código-fonte. Liste-o em
`test/build-fixtures.test.ts`, e então escreva o adaptador em `src/build/adapters/` até as linhas coincidirem. Veja
[CONTRIBUTING.md](CONTRIBUTING.md).

## Créditos

- [clj-kondo](https://github.com/clj-kondo/clj-kondo), de Michiel Borkent, faz a análise de Clojure.
- [Model Context Protocol](https://modelcontextprotocol.io) é como os agentes falam com o servidor.
- Os repos do corpus e seus autores, cujo código público serve de base para medir a cobertura e o benchmark.

## Licença

MIT. Veja [LICENSE](LICENSE). Criado por Barış Can Ateş.
