# clojure-atlas

**Feito para programação com agentes. Dê ao seu agente de IA um mapa da sua base de código Clojure.**

Rastreie chamadores e provedores/consumidores de dados, inspecione contratos de funções **até as chaves dentro dos
argumentos map**, acompanhe eventos e rotas do re-frame e identifique os testes afetados por uma mudança.
O clojure-atlas transforma **código-fonte Clojure, ClojureScript e `.cljc`** em um grafo de código local e o expõe como
**13 ferramentas MCP** com localizações no código-fonte e níveis de confiança explícitos.

Feito como **ferramenta complementar para agentes de programação**, o Atlas fornece o contexto estrutural de que eles precisam antes de
alterar o código: quem depende dele, quais parâmetros e chaves de map seus consumidores esperam e quais testes se relacionam com ele.

![clojure-atlas — provider to map parameter set to consumer; inspect contracts with signature_impact and key_flow](docs/assets/atlas.svg)

[![License: MIT](https://img.shields.io/badge/license-MIT-91d5b6?style=flat-square&labelColor=17252b)](LICENSE)
[![Node.js: 22.18+](https://img.shields.io/badge/Node.js-22.18%2B-91d5b6?style=flat-square&labelColor=17252b)](#requisitos)
[![MCP: stdio](https://img.shields.io/badge/MCP-stdio-91d5b6?style=flat-square&labelColor=17252b)](#início-rápido)
[![Required npm runtime dependencies: 0](https://img.shields.io/badge/npm_runtime_dependencies-0-91d5b6?style=flat-square&labelColor=17252b)](#local-por-design)

**Zero dependências de execução npm obrigatórias. Análise local. For the sake of all Clojurians. (Por todos os clojuristas.)**

Um projeto pessoal de **Barış Can Ateş** · Licença MIT · Construído sobre o [clj-kondo](https://github.com/clj-kondo/clj-kondo).

[English](README.md) | [Türkçe](README.tr.md) | [Deutsch](README.de.md) | [Español](README.es.md) | Português (Brasil) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md)

[Capacidades](#o-que-você-pode-fazer) · [Contratos de map](#contratos-até-as-chaves-de-map) · [Stack suportado](#linguagens-e-suporte-ao-ecossistema) · [Exemplos](#veja-em-ação) ·
[Início rápido](#início-rápido) · [Cobertura](#cobertura) · [Como é testado](#como-o-atlas-é-testado) · [Guia completo](docs/GUIDE.md)

## O que você pode fazer

Use ao explorar um projeto desconhecido, planejar uma refatoração ou revisar uma mudança. Seu cliente MCP chama
as ferramentas; o Atlas devolve as relações que consegue estabelecer, com citações `file:line`.

| Pergunte ao seu agente… | O Atlas fornece a ele… | Ferramentas MCP |
|---|---|---|
| “Quem chama isto, e o que minha mudança pode afetar?” | Chamadores diretos, referências de valor e dependentes transitivos | `callers`, `blast_radius` |
| “Que conjunto de parâmetros cada chamador fornece, e o que a função lê?” | Aridades, chaves de map desestruturadas, valores padrão, argumentos keyword e chaves fornecidas em cada ponto de chamada | `signature_impact` |
| “Quem fornece esta chave de map, e quem a consome?” | Produtores e consumidores de chaves, incluindo chaves literais dentro de maps aninhados e caminhos de chaves | `key_flow` |
| “Esta linha de configuração está sem alguma chave?” | Chaves presentes em linhas de map irmãs, mas ausentes nesta | `key_siblings` |
| “O que trata este endpoint? Onde a permissão é verificada?” | Handlers de rota, middleware ordenado e verificações de permissão configuradas | `route_authz`, `permission_routes` |
| “O que acontece quando este evento do re-frame é disparado?” | Dispatchers, handlers, subscriptions e requisições HTTP | `event_flow` |
| “Quem lê ou escreve este atributo de banco de dados?” | Leituras e escritas comprovadas, com as referências incertas mantidas visíveis | `attribute_usage` |
| “Quais testes se relacionam com esta mudança?” | Vínculos estáticos com testes unitários, vínculos com Playwright e um contexto de revisão para arquivos ou linhas alterados | `tests_for`, `tests_covering`, `context_for_change` |
| “O que este grafo realmente sabe?” | Commit de origem, adaptadores ativos, contagens de evidência e avisos de cobertura | `graph_info` |

Uma chamada, um callback e um keyword com a mesma grafia são coisas diferentes. O Atlas modela essas distinções,
incluindo os registros e as conexões orientadas a dados do Clojure. Ele dá ao seu agente evidências para inspecionar antes de editar.

### Bugs que ele ajuda a pegar antes de irem para produção

Cada linha é uma resposta real sobre um projeto público; siga o link para ver a transcrição completa.

| Possível bug | Pergunte com | O que o Atlas mostrou (exemplo real) |
|---|---|---|
| Uma linha de configuração ou de dados está sem uma chave que as linhas irmãs têm | `key_siblings` | re-frame: 2 linhas de uma tabela de queries não têm `:re-frame/lifecycle`, que 3 de 4 linhas irmãs têm ([transcrição](docs/GUIDE.md#key_siblings)) |
| Uma nova chave obrigatória quebra os chamadores existentes | `signature_impact` com `added_keys` | polylith-realworld: se `login!` precisar de `:tenant-id`, 3 chamadores passam um map literal sem ela e 1 repassa um map que o Atlas não consegue ver ([transcrição](#inspecione-o-contrato-dentro-de-um-argumento-map)) |
| Um chamador passa a aridade errada, ou uma chave que a função nunca lê, ou deixa de passar uma chave que ela desestrutura | `signature_impact` | integrant: `init` verificado contra 38 chamadores e ambas as aridades; “no finding” com as buscas nomeadas ([transcrição](docs/GUIDE.md#signature_impact)) |
| Um endpoint está sem middleware ou sem verificação de permissão | `route_authz`, `permission_routes` | polylith-realworld: `POST /api/articles` com seus 11 wrappers em ordem, `wrap-authorization` por último; permissões honestamente “not extracted” sem um modelo declarado ([transcrição](docs/GUIDE.md#route_authz)) |
| Uma chave é lida, mas nada a escreve (muitas vezes um erro de digitação ou uma chave renomeada) | `key_flow` | compojure: `:compojure/path` tem 1 produtor (`assoc-path`) e 2 consumidores ([transcrição](docs/GUIDE.md#key_flow)) |
| Um escritor inesperado de um atributo de banco de dados | `attribute_usage` | mount: `:order/bid` tem 2 escritores comprovados, um deles em código de teste, e nenhum leitor ([transcrição](docs/GUIDE.md#attribute_usage)) |
| Um evento despachado não tem handler, ou um handler dispara eventos inesperados | `event_flow` | re-frame todomvc: `:delete-todo` é despachado de 2 pontos, tratado uma vez e não dispara nada ([transcrição](docs/GUIDE.md#event_flow)) |
| Uma pequena mudança se propaga mais do que o esperado | `blast_radius` | integrant: uma mudança em `ref?` alcança 31 definições ao longo de 6 níveis ([transcrição](docs/GUIDE.md#blast_radius)) |
| Código alterado que nenhum teste alcança | `context_for_change`, `tests_for` | polylith-realworld: as linhas 60-80 do store de article tocam 3 definições, 9 chamadores externos e 24 testes relacionados ([transcrição](docs/GUIDE.md#context_for_change)) |

O Atlas aponta o lugar para olhar; decidir se é um bug fica com você ou com o seu agente.

### O fluxo de trabalho de um agente

1. **Orientar-se:** use `graph_info` para verificar o snapshot, os adaptadores ativos e as lacunas da análise.
2. **Investigar:** inspecione chamadores, contratos de parâmetros, provedores/consumidores de chaves de map e o impacto potencial de uma mudança.
3. **Planejar e verificar:** use `context_for_change` e as ferramentas de teste para encontrar o código afetado e os testes relacionados;
   inspecione o código-fonte citado, faça a mudança e execute os testes relevantes. Reconstrua o grafo e reinicie o servidor MCP para a próxima passada.

## Contratos até as chaves de map

O Atlas torna inspecionável o **contrato de parâmetros visível no código-fonte**: o que um chamador fornece, o que uma função
desestrutura ou lê e quais pontos de chamada uma mudança proposta afeta.

| Nível | O que o Atlas pode mostrar |
|---|---|
| **Conjunto de parâmetros** | Aridades aceitas, parâmetros posicionais/rest e argumentos keyword como `& {:keys [verbose]}` |
| **Chaves dentro de um argumento map** | `{:keys [email password]}`, padrões `:or`, aliases `:as`, chaves literais passadas pelos chamadores e leituras suportadas no corpo da função |
| **Provedor / consumidor** | Produtores como literais de map, `assoc` e `assoc-in`; consumidores como desestruturação, acesso por keyword, `get` e `get-in` |
| **Mudanças de contrato** | Pontos de chamada afetados por chaves adicionadas/removidas ou aridades alteradas, usando `signature_impact` com `added_keys`, `removed_keys`, `arities` ou `base_graph` |
| **Maps aninhados** | Ocorrências de chaves literais em maps aninhados, desestruturação e caminhos como `(get-in cart [:meta :count])`, por meio de `key_flow` |

O escopo é o **uso estático de chaves**, não a validação de valores ou tipos. `key_flow` agrupa as ocorrências por keyword, não pela
identidade de um map específico. `signature_impact` registra a chave externa de uma desestruturação aninhada ou de `get-in`,
não um esquema aninhado completo. Maps e chaves construídos em tempo de execução podem permanecer desconhecidos.

## Linguagens e suporte ao ecossistema

**Linguagens principais:** Clojure (`.clj`), ClojureScript (`.cljs`) e código compartilhado (`.cljc`). Arquivos EDN contribuem com formas de
configuração e dados suportadas. TypeScript (`.ts`) é lido apenas para a integração opcional com o Playwright;
não é um analisador geral de JavaScript ou TypeScript.

| Área | Bibliotecas / formas reconhecidas | O que é coberto hoje |
|---|---|---|
| Clojure básico | Vars, chamadas, usos de valor, callbacks, multimethods, protocolos | Definições e relações de dependência; os candidatos de despacho são heurísticos |
| Contratos de parâmetros e de map | Aridades de `defn`, desestruturação de map, argumentos keyword, literais de map e operações sobre chaves | Conjuntos de chaves fornecidos pelo chamador, chaves consumidas, pontos provedor/consumidor e impacto de mudanças de assinatura |
| Estado do frontend | **re-frame**, incluindo `re-frame.alpha` | Registros de eventos/subscriptions, dispatch, entradas de subscription e subscribers |
| Roteamento do backend | Rotas de tabela do **Compojure**, **Reitit**, **Pedestal** | Caminhos, cópias de rotas montadas e handlers; os interceptors do service-map do Pedestal não são extraídos |
| Middleware | **Ring**, `wrap-routes` do Compojure, dados de rota do Reitit e `ring-handler` | Cadeias ordenadas, incluindo wrappers externos; as cadeias inferidas são marcadas como heurísticas |
| Autorização de rotas | Chaves de permissão, middleware e funções definidos pelo projeto | Exige uma pequena declaração em `.clojure-atlas.edn` |
| Roteamento no navegador | **Reitit frontend**, **Secretary** | Nós de rota de cliente no grafo; ainda não há uma ferramenta MCP dedicada para listá-los |
| Requisições HTTP | **cljs-ajax**, **cljs-http**, `js/fetch`, effect maps de requisição | Pontos de requisição e correspondências com rotas do backend por método e caminho |
| Dados | **Datomic**, **DataScript**, **XTDB v1 / Crux** | Atributos, escritas de transação, leituras de query/pull e referências incertas |
| Ciclo de vida do sistema | **Integrant**, **Mount**, **Component** | Chaves de sistema, registros e arestas de dependência; a extração da configuração do Integrant depende de refs |
| Esquemas | **clojure.spec / cljs.spec**, **Malli** | Esquemas spec registrados e esquemas Malli mantidos em vars; os registries do Malli não são suportados |
| Testes e UI | **clojure.test / cljs.test**, **Playwright**, seletores Hiccup literais | Vínculos estáticos com testes; page objects do Playwright e testes `.ts` exigem TypeScript 5 opcional |
| Estrutura do projeto | Estruturas **deps.edn**, **Leiningen**, **shadow-cljs**, **Babashka**, **Boot**, **Polylith** | Descoberta de código-fonte e agrupamento por módulo/componente; aliases de build e execução de tarefas não são analisados |

Os adaptadores de framework reconhecem formas específicas do código-fonte, não todos os usos possíveis de uma biblioteca. `graph_info` informa
o que estava disponível e foi ativado no **seu** projeto. Repositórios como Fulcro, Pathom, HoneySQL e next.jdbc estão no
corpus de medição, mas a presença deles ali **não** significa que haja análise dedicada de framework ou de SQL implementada.
Veja o [roadmap](ROADMAP.md) para esses adaptadores, bidi, compojure-api e outras lacunas.

## Veja em ação

Estes trechos vêm dos [grafos de exemplo versionados no repositório](examples/) de projetos públicos. A invocação é uma
chamada de ferramenta MCP, não um comando de shell. `[S]` significa comprovado estaticamente; `[H]` significa heurístico.

### Inspecione o contrato dentro de um argumento map

No polylith-realworld, `login!` recebe **um único argumento map** e desestrutura **`:email` e `:password`**.
O Atlas mostra esse conjunto de chaves ao lado dos argumentos fornecidos por seus chamadores:

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

O conjunto de chaves do map literal é visível; o map passado como `login-input` continua desconhecido. O `[S]` nessa linha comprova
a relação de chamada, não o conteúdo do map em tempo de execução.

<details>
<summary><strong>Mude o contrato de parâmetros: e se login! também precisar de :tenant-id?</strong></summary>

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

Os três chamadores com map literal omitem a chave proposta. O quarto chamador repassa `login-input`, então seu impacto
é **UNKNOWN**. Esta é uma mudança de contrato hipotética; a ferramenta não modifica o código-fonte. “No finding”
refere-se à assinatura existente; a seção `affected` descreve a mudança proposta.

</details>

<details>
<summary><strong>Encontre os provedores e consumidores de :email em todo o projeto</strong></summary>

```text
key_flow {"key": ":email", "group_by": "none", "limit": 2}
```

```text
KEY_FLOW :email — 9 producer(s), 5 consumer(s) in 1 component(s); 23 site(s) in tests
counts: producers=9 [S9]  consumers=5 [S5]  tests=23 [S23]
[... trimmed ...]
```

O resultado lista os produtores de map literal em `register!` e os consumidores por desestruturação, incluindo `login!`, com
localizações no código-fonte. Como `:email` não é qualificado, todo map que usa esse keyword é agrupado junto; isso
não comprova que o map de um produtor específico chegue a um consumidor específico.

</details>

<details>
<summary><strong>Encontre os chamadores antes de uma refatoração</strong></summary>

**Pergunta:** Quem chama `integrant.core/dependent-keys`?

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
<summary><strong>Rastreie um evento do re-frame pelos pontos de dispatch e seu handler</strong></summary>

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

A conexão se dá por um keyword de evento, então olhar apenas os chamadores de uma função nomeada a deixaria passar.

</details>

<details>
<summary><strong>Veja o middleware na frente de um endpoint e o que o Atlas não conseguiu verificar</strong></summary>

Do polylith-realworld, onde as rotas são envolvidas por middleware do Ring em uma definição separada:

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

O handler é comprovado; os onze wrappers são encontrados em ordem, mas marcados com `[H]`, porque a composição de middleware
é código de tempo de execução. O projeto não declara regras de permissão, então o Atlas diz **not extracted** em vez de afirmar
que a rota não tem verificação de permissão.

</details>

<details>
<summary><strong>Uma falha honesta: um nome que é usado mas nunca definido</strong></summary>

Do next.jdbc, onde uma macro gera funções auxiliares que o clj-kondo não consegue expandir:

```text
callers {"var": "next.jdbc.types/as-other"}
```

```text
CALLERS next.jdbc.types/as-other — no definition matches "next.jdbc.types/as-other"; used at test/next/jdbc/sql_test.clj:290, test/next/jdbc_test.clj:559 but no definition was found
note: next.jdbc.types/as-other is used at test/next/jdbc/sql_test.clj:290, test/next/jdbc_test.clj:559 but no definition was found: probably defined by a macro clj-kondo cannot expand; add :lint-as for the macro in .clj-kondo/config.edn
note: use a fully qualified name (ns/name)
```

Em vez de “não encontrado, verifique a ortografia”, a resposta mostra onde o nome é usado e como torná-lo visível.
Com uma entrada `:lint-as` para a macro, a mesma pergunta retorna uma definição comprovada
([configuração do projeto](docs/GUIDE.md#project-configuration)).

</details>

<details>
<summary><strong>Transforme linhas alteradas em contexto de revisão e testes relacionados</strong></summary>

Do polylith-realworld:

```text
context_for_change {"changes": ["components/article/src/clojure/realworld/article/store.clj:60-80"]}
```

```text
CONTEXT_FOR_CHANGE components/article/src/clojure/realworld/article/store.clj:60-80 — 1 file(s), 3 changed symbol(s), 0 route(s), 0 attribute(s); risk LOW
counts: changed symbols=3 [S3]  callers outside the diff=9 [S9]  tests to run=24 [S24]
[... trimmed ...]
```

A resposta completa lista as três definições alteradas, nove chamadores fora do diff e 24 testes relacionados,
agrupados por componente. `LOW` descreve as verificações que o grafo realizou; não é uma garantia de segurança.

</details>

[Mais exemplos reais](examples/README.md) · [Todas as ferramentas e transcrições completas](docs/GUIDE.md#tools)

## Início rápido

**Pré-requisitos:** Node.js **22.18+** e Git. Não é necessário JVM nem ambiente de execução do Babashka.

### 1. Instale e construa um grafo

Execute a partir da raiz do **projeto Clojure que você quer analisar**:

```sh
# Install the reviewed source revision (Git installation builds the CLI).
npm install --save-dev \
  'git+https://github.com/Bariscanates404/clojure-atlas.git#8634d33e3ed59d420eead61a9c596f752d1fe789'

npx clojure-atlas build
```

O pacote não está publicado atualmente no npm; use a instalação via Git acima. É necessário acesso ao repositório
enquanto ele for privado. Uma instalação a partir do código-fonte usa TypeScript e as definições de tipos do Node para compilar a CLI; são
dependências de tempo de build, separadas das suas zero dependências de execução npm obrigatórias.

O grafo é salvo em `.clojure-atlas/graph.json.gz`. O primeiro build baixa e verifica o binário fixado do clj-kondo;
as análises seguintes usam o binário em cache. Adicione `.clojure-atlas/` ao `.gitignore` do seu projeto.

### 2. Conecte seu cliente MCP

Para o Claude Code, pré-visualize e depois grave a configuração do projeto:

```sh
npx clojure-atlas init         # preview .mcp.json
npx clojure-atlas init --yes   # write it; keep existing servers
```

Habilite o servidor no seu cliente e peça que ele use `graph_info` e `callers` em um `ns/name` totalmente qualificado
do seu projeto.

<details>
<summary><strong>Configure outro cliente MCP</strong></summary>

O Atlas usa **MCP sobre stdio**. Configure o cliente para iniciá-lo a partir da raiz do seu projeto:

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

Se o cliente inicia servidores em outro lugar, use a configuração de diretório de trabalho dele ou caminhos absolutos para a CLI
instalada, o grafo e o repositório. Os formatos de configuração dos clientes podem variar.

</details>

### 3. Reconstrua após as mudanças

```sh
npx clojure-atlas build       # refresh the snapshot
npx clojure-atlas coverage   # inspect resolution counts and unresolved names
```

Não há modo watch. Com `--repo`, as consultas avisam com `STALE` quando a árvore de trabalho deixa de corresponder ao
grafo. Reinicie o servidor MCP após reconstruir para que ele carregue o novo grafo.

**Já tem configuração do clj-kondo?** O Atlas aplica o `.clj-kondo/config.edn` do projeto, incluindo seus
mapeamentos de macros e hooks. Um `.clojure-atlas.edn` opcional adiciona macros de rota personalizadas e regras de autorização.
Veja a [configuração do projeto](docs/GUIDE.md#project-configuration) e o [fixture de autorização](test/fixtures/authz/.clojure-atlas.edn).

## Como ler uma resposta

| Marcador | Significado | Como usar |
|---|---|---|
| `[S]` — `STATIC_PROVEN` | Resolvido pelo clj-kondo ou estabelecido a partir de uma forma literal do código-fonte | Siga a localização citada no código-fonte |
| `[H]` — `HEURISTIC` | Inferido a partir de um nome, wrapper, posição em um threading ou candidato de despacho | Verifique a relação no código-fonte |
| `[?]` — `UNKNOWN` | Não pode ser decidido estaticamente | Trate como um limite da análise |

**Um resultado vazio não é automaticamente prova de ausência.** O Atlas distingue “nenhum encontrado”, “definição não
encontrada” e “capacidade não disponível”. `DEGRADED` avisa sobre análise incompleta; `STALE` avisa sobre um
snapshot desatualizado. Uma contagem de testes igual a zero significa que nenhum vínculo estático foi encontrado, não que o código não seja testado.

Despacho dinâmico, símbolos criados em tempo de execução e macros do projeto podem limitar o que o grafo enxerga. Middleware
ilegível é reportado como desconhecido. As permissões de rota exigem configuração explícita do projeto.
[Evidência e ausência](docs/GUIDE.md#bands-and-absence) · [Limites conhecidos](docs/GUIDE.md#limits)

## Local por design

A CLI principal **não tem dependências de execução npm obrigatórias**. Ela usa a biblioteca padrão do Node, o clj-kondo para a
análise de Clojure e o Git para os metadados do repositório. Constrói e consulta o grafo localmente, sem necessidade de conta no Atlas,
índice hospedado ou serviço em nuvem.

### Requisitos

| Componente | Função |
|---|---|
| Node.js 22.18+ | Executa a CLI e o servidor MCP |
| clj-kondo 2025.10.23 | Analisador nativo; baixado uma vez e mantido em cache, com o SHA-256 do arquivo fixado |
| Git | Instalação a partir do código-fonte, verificações de arquivos rastreados e informações de snapshot/desatualização |
| TypeScript 5 — opcional em tempo de execução | Análise de page objects e testes do Playwright; instale com `npm i -D typescript@5` ao lado do Atlas |

Há binários fixados para macOS arm64/x64, Linux arm64/x64 e Windows x64. O desenvolvimento e as medições do corpus
usaram macOS arm64; o **Windows não foi testado**. Se o download não estiver disponível, inclusive atrás de um
proxy, o Atlas pode recorrer a um `clj-kondo` funcional no `PATH`. [Detalhes de plataforma e cache](docs/GUIDE.md#requirements).

### Segurança

Uma superfície pequena de dependências ajuda, mas **zero dependências npm obrigatórias não significam zero risco na cadeia de suprimentos**.

- Os arquivos do clj-kondo baixados são verificados contra um SHA-256 fixado. Um download que não corresponde é recusado; um
  executável alternativo do `PATH` é tratado como confiável separadamente e não é verificado contra esse hash de arquivo fixado.
- O Atlas não inicia a JVM da aplicação analisada, nem scripts de shell ou código Node. **Os hooks do clj-kondo do projeto
  são interpretados pelo clj-kondo**, portanto a configuração dele faz parte do código em que você confia ao analisar um repositório.
- O servidor MCP lê o grafo e usa verificações de Git somente leitura. Hooks de comandos do Git, drivers de filtro e fsmonitor
  são desativados nessas verificações; os subprocessos do Git e do clj-kondo têm timeouts.
- O Atlas serve os resultados localmente por stdio. Como o cliente de IA/MCP que você escolher trata esses resultados é uma
  fronteira de privacidade separada.

Estas são propriedades da implementação, não uma certificação de auditoria de segurança. [Modelo de execução detalhado](docs/GUIDE.md#security).

## Cobertura

Medido em **26 repositórios públicos**, cada um fixado em um commit em [corpus.json](corpus.json). O corpus inclui
Babashka, Logseq, Metabase, Penpot, re-frame, Reitit e bibliotecas menores. Os resultados completos estão em
[docs/COVERAGE.md](docs/COVERAGE.md).

**A taxa de resolução mede uma coisa específica:** `resolved / (resolved + unresolved)` para usos de vars atribuídos
a namespaces de projeto reconhecidos. Usos de bibliotecas e **usos de namespaces desconhecidos ficam fora desse denominador**.
Ela não mede todo o código compreendido, todo o comportamento de framework extraído nem a correção em tempo de execução.

| Repositório | Resolved | Unresolved | Taxa de resolução | Namespace desconhecido (contagem bruta, excluída) |
|---|---:|---:|---:|---:|
| Integrant | 442 | 0 | 100.0% | 0 |
| Babashka | 15,264 | 61 | 99.6% | 2,176 |
| Metabase | 311,181 | 111 | 100.0% | 9,522 |
| DataScript | 4,392 | 496 | 89.9% | 1,255 |
| day-of-datomic | 84 | 29 | 74.3% | 1 |

As taxas são arredondadas para uma casa decimal. Leia-as sempre junto com **ambas** as contagens: unresolved e namespace desconhecido.
Nomes desconhecidos podem incluir locais vinculados por macros incomuns além de usos de vars perdidos; o analisador não consegue
separá-los de forma confiável.

**Mudanças de métrica não são melhorias do analisador.** Os números anteriores usavam um denominador diferente. A taxa
mais alta reportada para o Babashka reflete em grande parte a exclusão de símbolos de namespaces desconhecidos, não código recém-resolvido.
Comparações entre essas definições não são equivalentes; as contagens brutas acima permanecem visíveis de propósito.

### Melhorias reais de extração

São mudanças concretas no que o Atlas consegue ler, separadas da definição da taxa de resolução:

| Melhoria | Resultado observável | Evidência |
|---|---|---|
| Ler o middleware externo do Ring/Compojure | polylith-realworld: **0 → 11** entradas de middleware para `POST /api/articles` | [Benchmark q13](docs/BENCHMARK.md#positive-questions), [fixture](test/fixtures/ring-middleware/) |
| Ler tabelas de rotas do frontend em outro namespace | Logseq: **0 → 17** nós de rota de cliente | [Cobertura](docs/COVERAGE.md), [benchmark q14](docs/BENCHMARK.md#positive-questions) |
| Reconhecer `re-frame.alpha` | Registros e dispatches pelo namespace alpha são extraídos | [Histórico do benchmark](docs/BENCHMARK.md), [fixture](test/fixtures/reframe/src/app/alpha.cljs) |
| Aplicar a configuração do clj-kondo do projeto | Os mapeamentos de macros e hooks do projeto participam da análise | [Fixture de configuração](test/fixtures/project-config/), [testes](test/config.test.ts) |

### Benchmark

O benchmark registrado passa em **14/14 perguntas positivas** e **7/7 perguntas de ausência**, com respostas esperadas
verificadas à mão contra o código-fonte. É um pequeno benchmark de regressão, não uma estimativa geral de precisão. Treze
respostas positivas usam ferramentas MCP; a pergunta sobre rotas de cliente lê os nós do grafo diretamente porque ainda nenhuma ferramenta lista
rotas de cliente. [Perguntas, resultados e metodologia](docs/BENCHMARK.md).

## Como o Atlas é testado

Uma ferramenta em que os agentes confiam não pode inventar relações. Antes desta versão, o código passou por:

| Verificação | Resultado |
|---|---|
| Testes automatizados | **831**, todos passando; cada bug corrigido tem um teste que falhava antes da correção |
| Cobertura de linhas do código-fonte | **99.75%**; a CI falha abaixo de 98% |
| Caças a bugs | Um revisor por módulo procurou respostas erradas com reproduções executáveis; **85** bugs comprovados encontrados e corrigidos |
| Revisões independentes | **Seis** rodadas de revisores que não escreveram o código, pontuando correção, limpeza, regras e testes por módulo, até que todo módulo alcançasse pelo menos 4 de 5 |
| Repositórios reais | **26** projetos públicos são construídos sem falhas e com **0** arestas perdidas (antes 690 em seis deles) |
| Repositórios não confiáveis | Fixtures hostis verificam que configurações do Git, drivers de filtro, submódulos, o TypeScript do projeto, nomes de arquivo estranhos e hooks do clj-kondo que travam não executam nada nem travam nada; a busca por executáveis ignora o diretório do repositório (testado com testes unitários; o Windows em si não foi testado) |
| Verdade de referência | O [benchmark](docs/BENCHMARK.md) acima: 14 perguntas positivas e 7 de ausência, respostas verificadas à mão |

As perguntas de ausência são as mais importantes: elas verificam que o Atlas diz “not found”, “not extracted” ou “degraded” quando
essa é a verdade, em vez de uma lista vazia que parece dizer “nenhum”.

## Contribuindo

**Let's build our Clojure X-ray tool together! (Vamos construir juntos a nossa ferramenta de raio-X para Clojure!)**

Uma contribuição útil pode começar com um pequeno exemplo em Clojure: “esta biblioteca conecta estas duas coisas, e o Atlas
deveria enxergar isso”. Adicione um fixture e as linhas esperadas do grafo, ou ajude a implementar o adaptador. As duas coisas são bem-vindas.

```sh
npm ci
npm test
npm run test:coverage   # 98% source line-coverage gate
npm run typecheck
```

A CLI é escrita em TypeScript para uma distribuição simples com Node; o clj-kondo faz a análise de Clojure.
[Guia do contribuidor](CONTRIBUTING.md) · [Roadmap](ROADMAP.md) · [Referência de ferramentas](docs/GUIDE.md)

## Créditos e licença

Criado por **Barış Can Ateş**. [Licença MIT](LICENSE), incluindo a documentação e as ilustrações originais deste
repositório. Construído sobre o **[clj-kondo](https://github.com/clj-kondo/clj-kondo)** de Michiel Borkent, com o
**[MCP](https://modelcontextprotocol.io)** como interface para agentes de programação. Agradecimentos aos autores dos projetos
públicos usados no corpus e nos exemplos. Esses projetos e dependências mantêm suas próprias licenças.

*For the sake of all Clojurians.*
