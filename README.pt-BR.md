# clojure-atlas

**Feito para programação com agentes: um mapa estrutural da sua base de código Clojure, disponibilizado ao seu agente de IA via MCP.**

Antes de um agente editar código Clojure, ClojureScript ou `.cljc`, ele deve saber quem chama a função, qual conjunto de parâmetros ela recebe, quais chaves de mapa cada chamador passa e quais o corpo lê, e quais rotas, eventos do re-frame e testes estão conectados a ela. O clojure-atlas constrói esse mapa na sua máquina com [clj-kondo](https://github.com/clj-kondo/clj-kondo) e responde por meio de **13 ferramentas MCP**. Cada linha cita `file:line` e informa se é comprovada, heurística ou desconhecida.

![clojure-atlas: provedor, conjunto de parâmetros de mapa, consumidor; chamadas, eventos, rotas e testes como um grafo local por trás das ferramentas MCP](docs/assets/atlas.svg)

[![Integração contínua](https://github.com/Bariscanates404/clojure-atlas/actions/workflows/ci.yml/badge.svg)](https://github.com/Bariscanates404/clojure-atlas/actions/workflows/ci.yml)
[![Licença: MIT](https://img.shields.io/badge/license-MIT-91d5b6?style=flat-square&labelColor=17252b)](LICENSE)
[![Node.js: 22.18+](https://img.shields.io/badge/Node.js-22.18%2B-91d5b6?style=flat-square&labelColor=17252b)](#requisitos)
[![MCP: stdio](https://img.shields.io/badge/MCP-stdio-91d5b6?style=flat-square&labelColor=17252b)](#início-rápido)
[![Dependências npm obrigatórias em tempo de execução: 0](https://img.shields.io/badge/npm_runtime_dependencies-0-91d5b6?style=flat-square&labelColor=17252b)](#local-por-concepção)

**Zero dependências npm obrigatórias em tempo de execução. Análise local.**

Um projeto pessoal de **Barış Can Ateş** · licenciado sob a MIT · construído sobre clj-kondo.

[Por quê](#por-que-um-agente-deve-usá-lo) · [Conjuntos de parâmetros e chaves de mapa](#provedor--conjunto-de-parâmetros--consumidor) ·
[Stack compatível](#suporte-a-linguagens-e-frameworks) · [Exemplos](#exemplos-reais-que-você-pode-executar-novamente) ·
[Início rápido](#início-rápido) · [Faixas de evidência](#como-ler-uma-resposta) · [Limites](#limites) ·
[Medições](#medições) · [Guia completo](docs/GUIDE.md)

[English](README.md) | [Türkçe](README.tr.md) | [Deutsch](README.de.md) | [Español](README.es.md) | Português (Brasil) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md)

## Por que um agente deve usá-lo

Uma busca textual encontra uma grafia. Ela não distingue uma chamada de um callback, uma chave de mapa de uma keyword que por acaso tem a mesma grafia, nem um handler alcançado por um evento do re-frame de outro que nunca é registrado. Um agente que edita com base em um palpite quebra um chamador que nunca viu. O Atlas fornece as relações, com as evidências de cada uma, antes da edição.

| O agente pergunta | O Atlas responde com | Ferramentas MCP |
|---|---|---|
| Quem chama isto, e até onde minha alteração pode chegar? | Chamadores diretos, usos como valor e callbacks, dependentes transitivos | `callers`, `blast_radius` |
| Qual conjunto de parâmetros a função recebe, e o que cada chamador passa? | Aridades, chaves extraídas por destructuring, valores padrão de `:or` e chaves opcionais, argumentos keyword, chaves que cada ponto de chamada passa | `signature_impact` |
| Se eu adicionar, remover ou exigir uma chave, quais chamadores serão afetados? | Chamadores que não passam uma nova chave obrigatória, ainda passam uma removida ou usam uma aridade que deixou de existir | `signature_impact` com `added_keys`, `removed_keys`, `arities` ou `base_graph` |
| Quem produz esta chave de mapa e quem a consome? | Pontos produtores e consumidores da keyword | `key_flow` |
| Falta nesta linha de configuração uma chave que suas linhas irmãs têm? | Linhas de uma tabela literal sem uma chave presente na maioria das linhas irmãs | `key_siblings` |
| O que trata este endpoint, e onde a permissão é verificada? | Handler, middleware em ordem, verificações de permissão declaradas pelo projeto | `route_authz`, `permission_routes` |
| O que acontece quando este evento do re-frame é disparado? | Pontos de dispatch, handler, assinaturas, requisições HTTP | `event_flow` |
| Quem lê ou escreve este atributo do banco de dados? | Leituras e escritas comprovadas; referências não comprovadas permanecem visíveis | `attribute_usage` |
| Quais testes estão relacionados a esta alteração? | Testes unitários e testes Playwright vinculados estaticamente, e um contexto de revisão para as linhas alteradas | `tests_for`, `tests_covering`, `context_for_change` |
| O que este grafo sabe, e o que deixou passar? | Commit de origem, adaptadores ativos, contagens de evidências, avisos de cobertura | `graph_info` |

O Atlas aponta onde olhar. Decidir se é um bug continua sendo responsabilidade sua e do seu agente.

## Provedor → conjunto de parâmetros → consumidor

Este é o nível ao qual a maioria das ferramentas não chega: não apenas *quem chama `line-total`*, mas quais chaves a chamada entrega e quais delas a função lê. O exemplo é uma fixture deste repositório: [test/fixtures/keys/src/cart/core.clj](test/fixtures/keys/src/cart/core.clj).

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

Um parâmetro de mapa em Clojure é aberto, e a resposta é construída em torno disso:

| Tipo de chave | O que significa | Como o Atlas informa |
|---|---|---|
| **Obrigatória** | Extraída por destructuring, sem valor padrão de `:or`, e o corpo não a testa nem recorre a um valor alternativo | Um achado quando nenhum chamador a passa; uma nova torna os chamadores "afetados" |
| **Opcional** | Tem um valor padrão de `:or`, é lida com um valor padrão (`(get m :k d)`), tem sua presença consultada (`(contains? m :k)`) ou é usada apenas onde um valor é testado ou substituído por uma alternativa (`(or k d)`, `(if k …)`, `(when-let [x k] …)`) | Listada como `optional:` na aridade; sua ausência nunca é um achado |
| **Extra** | Um chamador a passa, a função nunca a lê | Listada em `extra keys`. Não quebra nada. Só é um achado quando parece um erro de digitação de uma chave que a função realmente lê e que falta naquela chamada (`:usrname` ao lado de `:username`), e então é HEURISTIC |
| **Não comprovável** | O mapa é repassado, mantido em uma variável local ou o parâmetro é entregue a outra função | UNKNOWN, com o motivo |

Pergunte o que uma alteração faria antes de realizá-la:

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

`added_keys` significa as chaves que a alteração passa a **exigir**. Quando dois grafos são comparados com `base_graph`, uma chave que o novo corpo só lê opcionalmente não afeta nenhum chamador.

E acompanhe uma chave pelo projeto:

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

**O que este nível é e o que não é:**

- É o uso estático de chaves lido do código-fonte. Não é verificação de tipos nem validação de esquemas; nenhum valor é inspecionado.
- `key_flow` trabalha com **ocorrências de keywords**. Ele agrupa todos os mapas que usam `:total`; não acompanha um mapa desde onde é construído até onde é lido.
- Mapas aninhados não são sensíveis ao caminho. `{:meta {:count 1}}` produz `:meta` e `:count` como duas chaves separadas; `(get-in cart [:meta :count])` consome ambas. `signature_impact` registra apenas a **chave externa** do destructuring aninhado e de `get-in`.
- Um mapa repassado, mesclado, construído com `keyword` ou mantido em uma variável local é UNKNOWN, e a resposta diz isso.

## Suporte a linguagens e frameworks

**Linguagens:** Clojure (`.clj`), ClojureScript (`.cljs`) e código compartilhado (`.cljc`). Arquivos EDN contribuem com as formas de configuração e dados listadas abaixo. TypeScript (`.ts`) é lido apenas para a integração opcional com Playwright; o Atlas não é um analisador de JavaScript ou TypeScript.

| Área | O que é reconhecido | O que você obtém | Limites |
|---|---|---|---|
| Núcleo do Clojure | Vars, chamadas, usos como valor, callbacks, multimétodos, protocolos, records | Definições e relações de dependência | Candidatos de dispatch são heurísticos; vars resolvidas em tempo de execução não são acompanhadas |
| Conjuntos de parâmetros | Aridades de `defn`/`defn-`, destructuring de mapas, `:or`, `:as`, `& {:keys […]}`, `schema.core/defn`, macros que sua configuração do clj-kondo analisa como `defn` | Chaves recebidas, chaves opcionais, chaves que cada ponto de chamada passa, impacto de uma alteração de assinatura | Apenas a chave externa em padrões aninhados; uma função `.cljc` cujos parâmetros diferem por plataforma não recebe assinatura; achados sobre uma função definida por macro são heurísticos |
| Chaves de mapa | Mapas literais, `assoc`, `assoc-in`, `update`, `hash-map`, `dissoc`, acesso por keyword, `get`, `get-in`, `select-keys`, `contains?`, destructuring | Pontos produtores, consumidores e de remoção por keyword; lacunas em linhas irmãs de tabelas literais | Ocorrências de keywords, não identidade de mapas; posições em formas de threading são heurísticas; um padrão sem `:keys` em uma macro de binding não listada é lido como literal |
| Macros | `:lint-as` e hooks de `.clj-kondo/config.edn` do projeto, além de `:lint-as` em `.clojure-atlas.edn` | Usos dentro de uma macro ensinada ao clj-kondo são comprovados | Usos dentro de uma macro não ensinada são heurísticos e indicam qual é a macro |
| Estado do frontend | **re-frame**, incluindo `re-frame.alpha` | Registros de eventos e assinaturas, dispatches, entradas de assinaturas, assinantes | Um dispatch cujo id do evento é calculado é UNKNOWN; o que os handlers de `reg-fx` e cofx fazem e a ordem de `:fx` não são acompanhados |
| Roteamento do backend | Rotas de tabela de **Compojure**, **Reitit**, **Pedestal** | Caminhos, cópias de rotas montadas, handlers | bidi, compojure-api e as rotas de mapa detalhadas do Pedestal não são lidos |
| Middleware | **Ring**, `wrap-routes` do Compojure, dados de rota do Reitit e `ring-handler` | Cadeias ordenadas, incluindo wrappers externos | As cadeias são heurísticas; interceptadores do service-map do Pedestal não são lidos; wrappers que não podem ser lidos são informados como UNKNOWN |
| Autorização de rotas | Chaves de permissão, middleware e funções declarados pelo seu projeto | Quais rotas verificam quais permissões | Precisa de um pequeno `.clojure-atlas.edn`; sem ele, a resposta é "não comprovável", nunca "nenhuma" |
| Roteamento do navegador | **Reitit frontend**, **Secretary** | Nós de rotas de cliente no grafo | Nenhuma ferramenta MCP os lista ainda |
| Requisições HTTP | **cljs-ajax**, **cljs-http**, `js/fetch`, mapas de efeitos de requisição | Pontos de requisição vinculados a rotas do backend por método e caminho | Uma URL montada em tempo de execução pode não ser vinculada |
| Dados | **Datomic**, **DataScript**, **XTDB v1 / Crux** | Atributos, escritas de transações, leituras por consultas e pull | Referências não comprovadas são mantidas como linhas UNKNOWN; sem análise SQL (next.jdbc, HoneySQL) |
| Ciclo de vida do sistema | **Integrant**, **Mount**, **Component** | Chaves do sistema, registros, arestas de dependência | Sistemas Integrant sem referências não são lidos |
| Esquemas | **clojure.spec / cljs.spec**, **Malli** | Specs registrados, esquemas Malli mantidos em vars | Registros do Malli não são lidos; esquemas não são verificados contra mapas |
| Testes | **clojure.test / cljs.test**, **Playwright**, seletores Hiccup literais | Vínculos estáticos de testes | Playwright precisa do TypeScript 5 opcional; um fixture de `test.extend` sem argumento de tipo não tem classe, então não é vinculado; testes que chegam ao código por HTTP ou `resolve` não são vinculados |
| Estrutura do projeto | **deps.edn**, **Leiningen**, **shadow-cljs**, **Babashka**, **Boot**, **Polylith** | Descoberta de fontes, agrupamento por componente | Aliases de build e tarefas não são analisados |

Um adaptador reconhece formas específicas do código-fonte, não todos os usos de uma biblioteca. `graph_info` informa quais adaptadores foram ativados no **seu** projeto. Fulcro, Pathom, HoneySQL e next.jdbc estão no corpus de medição, o que não significa que tenham um adaptador dedicado. O [roteiro](ROADMAP.md) lista o que falta.

## Exemplos reais que você pode executar novamente

Os trechos abaixo são saídas reais do servidor sobre os [grafos versionados em `examples/`](examples/), construídos a partir de projetos públicos nos commits fixados em [corpus.json](corpus.json). `[S]` significa comprovado, `[H]` heurístico e `[?]` desconhecido. A primeira linha de cada bloco é a chamada à ferramenta MCP que seu agente faz. Para executar uma delas por conta própria sem um cliente MCP, a partir de um clone deste repositório:

```sh
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"signature_impact","arguments":{"fn":"clojure.realworld.user.core/login!","group_by":"none"}}}' \
  | node src/cli.ts mcp --graph examples/polylith-realworld.json.gz \
  | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).result.content[0].text'
```

As respostas de `cart` acima vêm de `node src/cli.ts build test/fixtures/keys -o /tmp/cart.json.gz` e do mesmo pipe com `--graph /tmp/cart.json.gz`.

### O conjunto de parâmetros de uma função ao lado do que seus chamadores passam

Em polylith-realworld, `login!` recebe um mapa e extrai `:email` e `:password` por destructuring:

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

Um mapa literal mostra suas chaves. O mapa passado como `login-input` permanece desconhecido: `[S]` naquela linha comprova a chamada, não o conteúdo de um mapa em tempo de execução.

<details>
<summary><strong>E se <code>login!</code> passar a exigir <code>:tenant-id</code>?</strong></summary>

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

Os três chamadores que passam um mapa literal omitem a nova chave. O quarto repassa `login-input`, então sua linha é UNKNOWN. Nada é modificado; esta é uma pergunta sobre uma alteração que você ainda não fez.

</details>

<details>
<summary><strong>Produtores e consumidores de <code>:email</code></strong></summary>

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

`:email` não é qualificada por namespace, então todos os mapas que usam a keyword são agrupados aqui. Isso não comprova que o mapa de um produtor chega a um consumidor.

</details>

<details>
<summary><strong>Chamadores antes de uma refatoração</strong></summary>

Do integrant:

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
<summary><strong>Um evento do re-frame: pontos de dispatch e handler</strong></summary>

Do re-frame:

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

A conexão passa por uma keyword de evento, então buscar chamadores de uma função nomeada não a encontraria.

</details>

<details>
<summary><strong>O middleware à frente de um endpoint e o que não pôde ser verificado</strong></summary>

Do polylith-realworld:

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

O handler é comprovado. Os wrappers são encontrados em ordem e marcados com `[H]`, porque a composição de middleware é código de tempo de execução. O projeto não declara regras de permissão, então a resposta é **não extraído**, e não "sem verificação".

</details>

<details>
<summary><strong>Uma falha reconhecida: um nome que é usado e nunca definido</strong></summary>

Do next.jdbc, onde uma macro gera funções que o clj-kondo não consegue expandir:

```text
callers {"var": "next.jdbc.types/as-other"}
```

```text
CALLERS next.jdbc.types/as-other — no definition matches "next.jdbc.types/as-other"; used at test/next/jdbc/sql_test.clj:290, test/next/jdbc_test.clj:559 but no definition was found
note: next.jdbc.types/as-other is used at test/next/jdbc/sql_test.clj:290, test/next/jdbc_test.clj:559 but no definition was found: probably defined by a macro clj-kondo cannot expand; add :lint-as for the macro in .clj-kondo/config.edn
note: use a fully qualified name (ns/name)
```

A resposta mostra onde o nome é usado e como torná-lo visível. Com uma entrada `:lint-as` para a macro, a mesma pergunta retorna uma definição comprovada ([configuração do projeto](docs/GUIDE.md#project-configuration)). next.jdbc está no corpus, não entre os grafos de exemplo versionados.

</details>

<details>
<summary><strong>Linhas alteradas transformadas em contexto de revisão e testes relacionados</strong></summary>

Do polylith-realworld:

```text
context_for_change {"changes": ["components/article/src/clojure/realworld/article/store.clj:60-80"], "limit": 3}
```

```text
CONTEXT_FOR_CHANGE components/article/src/clojure/realworld/article/store.clj:60-80 — 1 file(s), 3 changed symbol(s), 0 route(s), 0 attribute(s); risk LOW
counts: changed symbols=3 [S3]  callers outside the diff=9 [S9]  tests to run=24 [S24]
[... trimmed ...]
```

A resposta completa lista as três definições alteradas, nove chamadores fora do diff e 24 testes relacionados ([transcrição completa](docs/GUIDE.md#context_for_change)). `LOW` descreve as verificações que o grafo conseguiu fazer. Não é uma garantia de segurança.

</details>

[Mais transcrições](examples/README.md) · [Cada ferramenta com uma resposta completa](docs/GUIDE.md#tools)

## Início rápido

**Pré-requisitos:** Node.js **22.18+** e Git. Sem JVM e sem Babashka.

### 1. Instale e construa um grafo

A partir da raiz do **projeto Clojure que você quer analisar**:

```sh
npm install --save-dev 'git+https://github.com/Bariscanates404/clojure-atlas.git'
npx clojure-atlas build
```

O pacote não está no registro npm; ele é instalado a partir do Git, e essa instalação compila a CLI. Para fixar a revisão que você analisou, acrescente `#<commit-sha>` à URL. TypeScript e as definições de tipos do Node são necessários apenas nessa etapa de compilação; a CLI instalada não tem dependência npm obrigatória em tempo de execução.

O grafo é gravado em `.clojure-atlas/graph.json.gz`. O primeiro build baixa o binário fixado do clj-kondo e verifica seu SHA-256; builds posteriores usam o binário em cache. Adicione `.clojure-atlas/` ao seu `.gitignore`.

### 2. Conecte seu cliente MCP

Para o Claude Code, visualize e depois grave a configuração do projeto:

```sh
npx clojure-atlas init         # preview .mcp.json
npx clojure-atlas init --yes   # write it; existing servers are kept
```

Em seguida, peça ao agente para chamar `graph_info` e `callers` com um `ns/name` totalmente qualificado do seu projeto.

<details>
<summary><strong>Outro cliente MCP</strong></summary>

O Atlas fala **MCP sobre stdio**. Inicie-o a partir da raiz do seu projeto:

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

Se o cliente iniciar servidores em outro lugar, configure seu diretório de trabalho ou use caminhos absolutos para a CLI, o grafo e o repositório. Os formatos de configuração diferem entre clientes.

</details>

### 3. Reconstrua após alterações

```sh
npx clojure-atlas build      # refresh the snapshot
npx clojure-atlas coverage   # resolution counts and unresolved names
```

Não há modo watch. Com `--repo`, as respostas começam com `STALE` quando a árvore de trabalho deixa de corresponder ao grafo. Reinicie o servidor MCP após um novo build para que ele carregue o novo grafo.

**Macros e sua configuração do clj-kondo.** O Atlas aplica `.clj-kondo/config.edn` do projeto, incluindo `:lint-as` e hooks. Uma macro analisada como `defn` recebe uma assinatura; uma macro não ensinada ao clj-kondo torna heurísticos os usos em seu interior, e a resposta nomeia a macro. Um `.clojure-atlas.edn` opcional adiciona macros de rotas e regras de autorização: [configuração do projeto](docs/GUIDE.md#project-configuration), [fixture de autorização](test/fixtures/authz/.clojure-atlas.edn).

## Como ler uma resposta

| Marcador | Significado | O que fazer com ele |
|---|---|---|
| `[S]` `STATIC_PROVEN` | Resolvido pelo clj-kondo ou lido de uma forma literal do código-fonte | Siga a referência `file:line` citada |
| `[H]` `HEURISTIC` | Inferido de um nome, um wrapper, uma posição em uma forma de threading, um candidato de dispatch ou uma macro cujo interior o Atlas não consegue enxergar | Abra a linha citada antes de agir com base nela |
| `[?]` `UNKNOWN` | Não pode ser decidido estaticamente | Trate como o limite do que o grafo sabe |

**Uma resposta vazia não comprova ausência.** O Atlas distingue "nenhum encontrado", "definição não encontrada" e "capacidade ausente neste grafo". `DEGRADED` avisa que parte da análise está faltando; `STALE`, que o snapshot está antigo. Zero testes significa que nenhum vínculo estático foi encontrado, não que o código não foi testado.
[Faixas e ausência em detalhes](docs/GUIDE.md#bands-and-absence)

## Limites

> [!WARNING]
> **O que o Atlas pode deixar passar. Leia isto antes de confiar em uma resposta vazia.**
>
> - **Definições criadas por uma macro não ensinada ao clj-kondo.** Um `defthing` do projeto ou uma DSL de biblioteca que não inclui configuração do clj-kondo define vars que o grafo não contém: seus chamadores aparecem como *não resolvidos*, e o código dentro dessa macro é apenas heurístico. É por isso que o DataScript resolve 89.9% no corpus. Ensine a macro ao clj-kondo (`:lint-as` ou um hook em `.clj-kondo/config.edn`), reconstrua, e elas estarão de volta. A resposta nomeia a macro.
> - **Qualquer coisa decidida em tempo de execução.** Uma var encontrada com `resolve` a partir de um símbolo calculado, uma função escolhida de um mapa, a quantidade de argumentos por trás de `apply` ou `partial`, uma chave construída com `keyword`, um mapa mesclado ou repassado. Isso é informado como UNKNOWN, nunca adivinhado.
> - **Dispatch.** Os destinos de uma chamada de multimétodo ou protocolo são candidatos, não provas.
> - **Scripts sem uma forma `ns`** (tutoriais de REPL): day-of-datomic resolve 74.3%.
> - **Arquivos que o clj-kondo não consegue analisar e arquivos com mais de 2 MB.** Suas definições ficam ausentes; cada resposta então começa com `DEGRADED` e os nomeia.

- **Apenas estático.** Vars resolvidas em tempo de execução, funções escolhidas por dados e chaves construídas com `keyword` não são acompanhadas.
- **Chaves de mapa são ocorrências de keywords**, e mapas aninhados contribuem com chaves externas, como descrito [acima](#provedor--conjunto-de-parâmetros--consumidor). Não há fluxo de dados sensível ao caminho.
- **Chaves opcionais são lidas a partir da forma do corpo.** Um nome vinculado novamente dentro da função não é acompanhado, então uma chave pode ser chamada de opcional sem ser. O contrário não acontece.
- **Macros.** O clj-kondo só enxerga o interior de uma macro com uma entrada `:lint-as` ou um hook. Um padrão de binding sem `:keys` dentro de uma macro de binding que o Atlas não lista é lido como mapa literal.
- **Middleware e permissões.** As cadeias são heurísticas; permissões de rotas precisam de `.clojure-atlas.edn`.
- **Sem build incremental.** Reconstrua após alterações.
- **Windows não foi testado.**

A lista completa está no [guia](docs/GUIDE.md#limits); o que está planejado está no [roteiro](ROADMAP.md).

## Local por concepção

A CLI principal **não tem dependências npm obrigatórias em tempo de execução**. Ela usa a biblioteca padrão do Node, o clj-kondo para a análise e o Git para metadados do repositório. O grafo é construído e consultado na sua máquina: sem conta, sem índice hospedado, sem telemetria.

### Requisitos

| Componente | Papel |
|---|---|
| Node.js 22.18+ | Executa a CLI e o servidor MCP |
| clj-kondo 2025.10.23 | Analisador nativo; baixado uma vez e armazenado em cache, SHA-256 do arquivo fixado |
| Git | Instalação via Git, verificações de arquivos rastreados, informações de snapshot e desatualização |
| TypeScript 5, opcional | Apenas análise de page objects e testes Playwright; `npm i -D typescript@5` junto ao Atlas |

Há binários fixados para macOS arm64/x64, Linux arm64/x64 e Windows x64. O desenvolvimento e as medições do corpus foram executados em macOS arm64. Se o download estiver indisponível, por exemplo atrás de um proxy, o Atlas recorre a um `clj-kondo` no `PATH`. [Detalhes de plataformas e cache](docs/GUIDE.md#requirements)

### Segurança

Poucas dependências reduzem a superfície de ataque. Elas **não** oferecem uma garantia da cadeia de suprimentos.

- Um arquivo baixado do clj-kondo é verificado contra um SHA-256 fixado e recusado se houver divergência. Um `clj-kondo` obtido do `PATH` é considerado confiável como você o instalou; ele não é verificado contra esse hash.
- O Atlas não inicia a JVM da aplicação analisada, seus scripts de shell ou seu código Node. **Os hooks do clj-kondo do projeto são interpretados pelo clj-kondo**, então essa configuração é código em que você confia ao analisar um repositório.
- O servidor MCP lê o grafo e executa verificações do Git somente de leitura, com hooks do Git, drivers de filtro e fsmonitor desativados e com limites de tempo.
- Os resultados são disponibilizados localmente via stdio. O que seu cliente de IA faz com eles é um limite de privacidade separado.

Essas são propriedades da implementação, não o resultado de uma auditoria de segurança.
[Modelo de execução](docs/GUIDE.md#security)

## Medições

Medido em **26 repositórios públicos**, cada um fixado em um commit em [corpus.json](corpus.json). Tabela completa: [docs/COVERAGE.md](docs/COVERAGE.md).

| Visão geral | |
|---|---|
| Repositórios que geram um grafo | **26 de 26**, sem crashes, 0 arestas descartadas |
| Tamanho do que foi lido | 10,158 arquivos-fonte, 141,604 definições, 1,927,681 arestas |
| Usos de vars em namespaces do projeto vinculados à sua definição | **601,991 de 602,877 (99.85%)**; 886 não resolvidos |
| Por repositório | mediana de 100.0%; 24 de 26 em 99.3% ou mais; os dois abaixo estão em 89.9% e 74.3% |
| Símbolos que o clj-kondo não conseguiu atribuir a nenhum namespace | **18,517**, contados e exibidos, não vinculados nem incluídos na taxa |
| Arquivos que o clj-kondo não conseguiu analisar completamente | 24 |
| Benchmark com respostas verificadas à mão | 14 de 14 perguntas positivas, 7 de 7 perguntas de ausência |

Esses números dizem quanto da estrutura *estática* do código chega ao grafo nesses projetos. Não são uma promessa sobre o seu: uma base de código construída sobre macros não ensinadas ao clj-kondo ficará mais próxima do DataScript do que do Metabase até ser configurada. `npx clojure-atlas coverage` imprime as mesmas contagens para o seu projeto.

### Taxa de resolução com as contagens ao lado

A **taxa de resolução** é `resolved / (resolved + unresolved)` para os usos de vars que o clj-kondo atribui a um namespace do projeto. Ela não é a precisão da análise. Usos de bibliotecas ficam de fora, assim como **usos com namespace desconhecido**: símbolos que o clj-kondo não conseguiu atribuir a nenhum namespace, que podem ser variáveis locais vinculadas por uma macro que ele não conhece ou usos de vars que o grafo deixa passar. Nada estático distingue os dois casos, então eles são exibidos como uma contagem bruta e nunca incorporados à taxa.

| Repositório | Resolvidos | Não resolvidos | Taxa de resolução | Namespace desconhecido (bruto, fora da taxa) |
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
| **Todos os 26 repositórios** | | | **mediana de 100.0%; 24 de 26 em 99.3% ou mais** | **18,517 no total** |

† [explicado em docs/COVERAGE.md](docs/COVERAGE.md#repos-under-95-resolution-rate-or-with-unknown-namespace-usages-above-5-of-resolved)

**Uma definição alterada não é uma melhoria.** O primeiro relatório de cobertura deste projeto dividia por `resolved + unresolved + unknown` e mostrava o Babashka em 87.0%. Os 99.6% atuais usam a definição acima. Quase toda essa diferença está no denominador: os usos com namespace desconhecido saíram da taxa, não passaram a ser resolvidos, e 2,176 deles continuam na última coluna. Não compare taxas entre as duas definições.

### O que a extração realmente ganhou

Mudanças no que o Atlas lê, cada uma com uma fixture ou teste, separadas da taxa acima.

| Mudança | Resultado medido | Evidência |
|---|---|---|
| Distinguir um mapa literal de um padrão de binding | Nos 26 repositórios do corpus: **5,475** pontos produtores adicionados (mapas em um vetor retornado, hiccup, dados de rota, `(d/transact conn [{…}])`); **703** valores keyword deixam de ser listados como consumidores de "destructuring" comprovados; **5,268** entradas `:keys` / `:as` / `:or` deixam de ser listadas como chaves produzidas | [testes](test/keys-adapter.test.ts), fixtures [authz](test/fixtures/authz/), [dados](test/fixtures/data/), [reframe](test/fixtures/reframe/) |
| Registrar uma assinatura apenas onde o clj-kondo conta os mesmos parâmetros | **532** funções definidas por uma forma analisada como `defn` ganharam uma assinatura (216 no Metabase); **22** funções `.cljc` cujos parâmetros diferem por plataforma deixam de receber uma incorreta (`first-seq` do DataScript era lida como `[xs xs]`); anotações de `s/defn` deixam de ser contadas como parâmetros | [testes](test/signatures.test.ts) |
| Ler como um parâmetro simples é usado | Parâmetros simples cujas leituras são totalmente conhecidas: **3,496 → 4,184** (um `let` que faz destructuring do parâmetro, `(-> m :k)`, `contains?`) | [testes](test/signatures.test.ts) |
| Ler o middleware externo de Ring/Compojure | polylith-realworld: **0 → 11** entradas de middleware para `POST /api/articles` | [benchmark q13](docs/BENCHMARK.md#positive-questions), [fixture](test/fixtures/ring-middleware/) |
| Ler tabelas de rotas do frontend em outro namespace | Logseq: **0 → 17** nós de rotas de cliente | [cobertura](docs/COVERAGE.md), [benchmark q14](docs/BENCHMARK.md#positive-questions) |
| Reconhecer `re-frame.alpha` | Registros e dispatches pelo namespace alpha são extraídos | [fixture](test/fixtures/reframe/src/app/alpha.cljs) |
| Aplicar a configuração do clj-kondo do projeto | As entradas `:lint-as` e os hooks do projeto participam da análise | [fixture](test/fixtures/project-config/), [testes](test/config.test.ts) |
| Tipar fixtures do Playwright sem os `node_modules` do projeto | Testes que obtêm page objects de fixtures `test.extend<…>` são vinculados aos membros do page object em um checkout onde `@playwright/test` não está instalado; no fixture: **0 → 12** vínculos | [testes](test/playwright-fixtures.test.ts), [fixture](test/fixtures/browser-fixtures/) |

As três primeiras linhas comparam grafos dos mesmos commits fixados antes e depois da mudança. Nessa comparação, nenhuma aresta de outro tipo mudou, e as contagens de resolvidos, não resolvidos e namespace desconhecido são idênticas: são mudanças no que é lido sobre chaves de mapa e parâmetros, não na taxa de resolução.

### Benchmark

O benchmark registrado passa em **14 de 14 perguntas positivas** (40 de 40 linhas esperadas encontradas) e **7 de 7 perguntas de ausência**. É um pequeno benchmark de regressão com respostas verificadas à mão contra o código-fonte, não uma estimativa de precisão para o seu projeto. [Perguntas, resultados e método](docs/BENCHMARK.md)

## Como o Atlas é testado

Um agente confia no que recebe, então uma resposta errada custa mais do que uma ausente.

| Verificação | Estado |
|---|---|
| Testes automatizados | **873**, todos passando (`npm test`); um bug corrigido recebe um teste que falha sem a correção |
| Cobertura de linhas do código-fonte | **99.79%** (`npm run test:coverage`; a verificação falha abaixo de 98%) |
| Verificação de tipos | `npm run typecheck` sem erros |
| Integração contínua | [GitHub Actions](.github/workflows/ci.yml) executa a verificação de tipos e a verificação de cobertura no Node.js 22 e 24, no Linux, a cada push para `main` e a cada pull request |
| Fixtures | Pequenas bases de código Clojure em [test/fixtures](test/fixtures), com cada linha esperada do grafo verificada à mão |
| Repositórios reais | 26 projetos públicos são construídos sem crashes e com 0 arestas descartadas |
| Benchmark | Perguntas positivas e de ausência com respostas verificadas à mão ([docs/BENCHMARK.md](docs/BENCHMARK.md)) |
| Revisão independente | Revisores que não escreveram a mudança procuram respostas erradas com reproduções executáveis; cada defeito confirmado é corrigido com um teste |
| Repositórios não confiáveis | Fixtures hostis verificam que configurações do Git, drivers de filtro, submódulos, o TypeScript do projeto, nomes de arquivo estranhos e hooks do clj-kondo que travam não executem nada nem deixem nada travado |

As perguntas de ausência são as mais importantes: elas verificam se o Atlas diz "não encontrado", "não extraído" ou "degradado" quando essa é a verdade, em vez de uma lista vazia que parece dizer "nenhum". Uma suíte verde e um benchmark são evidências sobre essas fixtures e esses repositórios. Não garantem uma resposta correta no seu; leia a faixa em cada linha.

## Como contribuir

**Vamos construir juntos nossa ferramenta de raio X para Clojure!**

Uma contribuição útil pode ser um exemplo minúsculo de Clojure: "esta biblioteca conecta estas duas coisas, e o Atlas deveria enxergar isso". Adicione uma fixture e as linhas do grafo que você espera, ou escreva o adaptador. Ambos são bem-vindos, assim como um caso em que o Atlas tenha dado uma resposta errada ou enganosa.

```sh
npm ci
npm test
npm run test:coverage   # 98% source line-coverage gate
npm run typecheck
```

A CLI é em TypeScript para ser distribuída como Node puro; o clj-kondo faz a análise de Clojure.
[Guia de contribuição](CONTRIBUTING.md) · [Roteiro](ROADMAP.md) · [Referência de ferramentas](docs/GUIDE.md)

## Créditos e licença

Criado por **Barış Can Ateş**. [Licenciado sob a MIT](LICENSE), incluindo documentação e ilustrações. Construído sobre **[clj-kondo](https://github.com/clj-kondo/clj-kondo)** de Michiel Borkent, com **[MCP](https://modelcontextprotocol.io)** como interface para agentes de programação. Agradecemos aos autores dos projetos públicos no corpus e nos exemplos; esses projetos mantêm suas próprias licenças.

*Pelo bem de toda a comunidade Clojure.*
