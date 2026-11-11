# clojure-atlas

**专为智能体编程打造：通过 MCP 向 AI 智能体提供 Clojure 代码库的结构地图。**

智能体在编辑 Clojure、ClojureScript 或 `.cljc` 代码之前，应该知道谁在调用该函数、函数接受哪组参数、每个调用方传入哪些 map 键、函数体读取哪些键，以及哪些路由、re-frame 事件和测试与它相关联。clojure-atlas 在你的机器上使用 [clj-kondo](https://github.com/clj-kondo/clj-kondo) 构建这张地图，并通过 **13 个 MCP 工具**回答问题。每一行都会引用 `file:line`，并说明它是已证实、启发式推断还是未知。

![clojure-atlas：提供方、map 参数集、使用方；调用、事件、路由和测试组成 MCP 工具背后的本地图](docs/assets/atlas.svg)

[![持续集成](https://github.com/Bariscanates404/clojure-atlas/actions/workflows/ci.yml/badge.svg)](https://github.com/Bariscanates404/clojure-atlas/actions/workflows/ci.yml)
[![许可证：MIT](https://img.shields.io/badge/license-MIT-91d5b6?style=flat-square&labelColor=17252b)](LICENSE)
[![Node.js：22.18+](https://img.shields.io/badge/Node.js-22.18%2B-91d5b6?style=flat-square&labelColor=17252b)](#环境要求)
[![MCP：stdio](https://img.shields.io/badge/MCP-stdio-91d5b6?style=flat-square&labelColor=17252b)](#快速开始)
[![必需的 npm 运行时依赖：0](https://img.shields.io/badge/npm_runtime_dependencies-0-91d5b6?style=flat-square&labelColor=17252b)](#从设计上坚持本地运行)

**零必需 npm 运行时依赖。本地分析。**

**Barış Can Ateş** 的个人项目 · 采用 MIT 许可证 · 基于 clj-kondo 构建。

[为什么使用](#智能体为什么应该使用它) · [参数集与 map 键](#提供方--参数集--使用方) ·
[支持的技术栈](#语言与框架支持) · [示例](#可以重新运行的真实示例) ·
[快速开始](#快速开始) · [证据等级](#如何阅读回答) · [局限](#局限) ·
[测量结果](#测量结果) · [完整指南](docs/GUIDE.md)

[English](README.md) | [Türkçe](README.tr.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Português (Brasil)](README.pt-BR.md) | [日本語](README.ja.md) | 简体中文

## 智能体为什么应该使用它

文本搜索找到的是一种拼写。它无法区分调用与回调、map 键与恰好拼写相同的 keyword，也无法区分通过 re-frame 事件到达的处理函数与从未注册过的处理函数。凭猜测编辑代码的智能体，会破坏它从未见过的调用方。Atlas 会在编辑前提供这些关系，以及每条关系的证据。

| 智能体提问 | Atlas 回答提供 | MCP 工具 |
|---|---|---|
| 谁在调用它，我的改动可能影响到哪里？ | 直接调用方、作为值的使用和回调、传递依赖方 | `callers`, `blast_radius` |
| 函数接受哪组参数，每个调用方又传入什么？ | 元数、解构的键、`:or` 默认值和可选键、keyword 参数、每个调用点传入的键 | `signature_impact` |
| 如果新增、移除某个键或将它设为必需，哪些调用方会受影响？ | 未传入新增必需键、仍传入已移除键，或使用已移除元数的调用方 | 搭配 `added_keys`、`removed_keys`、`arities` 或 `base_graph` 的 `signature_impact` |
| 谁生成这个 map 键，谁使用它？ | keyword 的生成位置和使用位置 | `key_flow` |
| 这条配置行是否缺少同级行拥有的键？ | 字面量表格中缺少多数同级行所含键的行 | `key_siblings` |
| 什么处理这个端点，在哪里检查权限？ | 处理函数、按顺序排列的 middleware、项目声明的权限检查 | `route_authz`, `permission_routes` |
| 这个 re-frame 事件触发时会发生什么？ | dispatch 位置、处理函数、订阅、HTTP 请求 | `event_flow` |
| 谁读取或写入这个数据库属性？ | 已证实的读取与写入；未证实的引用仍然可见 | `attribute_usage` |
| 哪些测试与这次改动相关？ | 静态关联的单元测试和 Playwright 测试，以及改动行的审查上下文 | `tests_for`, `tests_covering`, `context_for_change` |
| 这张图知道什么，又遗漏了什么？ | 源码提交、启用的适配器、证据计数、覆盖情况警告 | `graph_info` |

Atlas 指出应该查看的位置。是否属于 bug，仍由你和智能体判断。

## 提供方 → 参数集 → 使用方

这是大多数工具未能深入的层面：不只是*谁调用了 `line-total`*，还包括调用传入哪些键，以及函数读取其中哪些键。这个示例是本仓库中的一个测试夹具：[test/fixtures/keys/src/cart/core.clj](test/fixtures/keys/src/cart/core.clj)。

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

Clojure 中的 map 参数是开放的，回答也围绕这一点组织：

| 键的类型 | 含义 | Atlas 如何报告 |
|---|---|---|
| **必需** | 通过解构取得，没有 `:or` 默认值，且函数体既不检查它，也不为它使用回退值 | 没有任何调用方传入时视为一项发现；新增此类键会使调用方变为“受影响” |
| **可选** | 有 `:or` 默认值，读取时带默认值（`(get m :k d)`），查询其是否存在（`(contains? m :k)`），或仅用于检查值或使用回退值的位置（`(or k d)`、`(if k …)`、`(when-let [x k] …)`） | 在元数中列为 `optional:`；缺失时绝不会视为一项发现 |
| **额外** | 调用方传入，但函数从不读取 | 列在 `extra keys` 下。不会破坏任何东西。只有当它看起来像是函数确实读取、而该调用又缺少的某个键的笔误时（`:usrname` 与 `:username`），才视为一项发现，此时为 HEURISTIC |
| **无法证实** | map 被转发、保存在局部变量中，或参数被传给另一个函数 | UNKNOWN，并说明原因 |

在实施改动前，先问问它会带来什么影响：

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

`added_keys` 表示改动后开始**要求必需**的键。使用 `base_graph` 比较两张图时，如果新函数体只是可选地读取某个键，就不会影响任何调用方。

再跟踪一个键在整个项目中的使用：

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

**这个层面是什么，不是什么：**

- 它是从源码中读取的静态键使用情况，不是类型检查，也不是 schema 验证；不会检查任何值。
- `key_flow` 基于 **keyword 的出现位置**工作。它会汇集所有使用 `:total` 的 map；不会从一个 map 的构建位置一路跟踪到读取位置。
- 嵌套 map 不区分路径。`{:meta {:count 1}}` 将 `:meta` 和 `:count` 作为两个独立的键生成；`(get-in cart [:meta :count])` 则使用两者。对于嵌套解构和 `get-in`，`signature_impact` 只记录**最外层的键**。
- 被转发、合并、用 `keyword` 构建或保存在局部变量中的 map 会被标为 UNKNOWN，回答也会明确说明。

## 语言与框架支持

**语言：** Clojure（`.clj`）、ClojureScript（`.cljs`）以及共享代码（`.cljc`）。EDN 文件提供下表列出的配置和数据形式。读取 TypeScript（`.ts`）仅用于可选的 Playwright 集成；Atlas 不是 JavaScript 或 TypeScript 分析器。

| 领域 | 识别内容 | 可获得的信息 | 局限 |
|---|---|---|---|
| Clojure 核心 | Var、调用、作为值的使用、回调、多重方法、协议、record | 定义与依赖关系 | dispatch 候选项属于启发式推断；不跟踪运行时解析的 Var |
| 参数集 | `defn`/`defn-` 的元数、map 解构、`:or`、`:as`、`& {:keys […]}`、`schema.core/defn`、clj-kondo 配置按 `defn` 进行 lint 的宏 | 接受的键、可选键、每个调用点传入的键、签名变更的影响 | 嵌套模式只记录最外层键；各平台参数不同的 `.cljc` 函数不会获得签名；宏定义函数的发现属于启发式推断 |
| Map 键 | Map 字面量、`assoc`、`assoc-in`、`update`、`hash-map`、`dissoc`、keyword 查找、`get`、`get-in`、`select-keys`、`contains?`、解构 | 每个 keyword 的生成、使用和移除位置；字面量表格中同级行的缺漏 | 识别 keyword 出现位置，而非 map 身份；threading 形式中的参数位置属于启发式推断；未列出的绑定宏中不含 `:keys` 的模式会被当作字面量读取 |
| 宏 | 项目 `.clj-kondo/config.edn` 中的 `:lint-as` 和 hook，以及 `.clojure-atlas.edn` 中的 `:lint-as` | 已教给 clj-kondo 的宏内部的使用是已证实的 | 未教给它的宏内部的使用属于启发式推断，并会指出是哪个宏 |
| 前端状态 | **re-frame**，包括 `re-frame.alpha` | 事件与订阅注册、dispatch、订阅输入、订阅方 | 事件 id 通过计算得到的 dispatch 为 UNKNOWN；不跟踪 `reg-fx` 和 cofx 处理函数的行为，也不跟踪 `:fx` 的顺序 |
| 后端路由 | **Compojure**、**Reitit**、**Pedestal** 的表格路由 | 路径、挂载的路由副本、处理函数 | 不读取 bidi、compojure-api 和 Pedestal 的详细 map 路由 |
| Middleware | **Ring**、Compojure `wrap-routes`、Reitit 路由数据和 `ring-handler` | 有序调用链，包含外层包装器 | 调用链属于启发式推断；不读取 Pedestal service-map 拦截器；无法读取的包装报告为 UNKNOWN |
| 路由授权 | 项目声明的权限键、middleware 和函数 | 哪些路由检查哪些权限 | 需要一个小型 `.clojure-atlas.edn`；没有时回答为“无法证实”，绝不会是“没有” |
| 浏览器路由 | **Reitit frontend**、**Secretary** | 图中的客户端路由节点 | 目前还没有 MCP 工具列出它们 |
| HTTP 请求 | **cljs-ajax**、**cljs-http**、`js/fetch`、请求 effect map | 按方法和路径关联到后端路由的请求位置 | 运行时拼接的 URL 可能无法关联 |
| 数据 | **Datomic**、**DataScript**、**XTDB v1 / Crux** | 属性、事务写入、查询与 pull 读取 | 未证实的引用保留为 UNKNOWN 行；不分析 SQL（next.jdbc、HoneySQL） |
| 系统生命周期 | **Integrant**、**Mount**、**Component** | 系统键、注册项、依赖边 | 不读取没有引用的 Integrant 系统 |
| 数据模式 | **clojure.spec / cljs.spec**、**Malli** | 已注册的 spec、保存在 Var 中的 Malli schema | 不读取 Malli 注册表；不会将 schema 与 map 进行校验 |
| 测试 | **clojure.test / cljs.test**、**Playwright**、字面量 Hiccup 选择器 | 静态测试关联 | Playwright 需要可选的 TypeScript 5；没有类型参数的 `test.extend` fixture 没有类，因此不会被关联；通过 HTTP 或 `resolve` 到达代码的测试不会被关联 |
| 项目布局 | **deps.edn**、**Leiningen**、**shadow-cljs**、**Babashka**、**Boot**、**Polylith** | 源码发现、按组件分组 | 不分析构建别名与任务 |

适配器识别的是特定的源码形式，而不是某个库的所有用法。`graph_info` 会报告**你的**项目中启用了哪些适配器。Fulcro、Pathom、HoneySQL 和 next.jdbc 在测量语料库中，但这不代表它们有专用适配器。[路线图](ROADMAP.md)列出了尚缺的内容。

## 可以重新运行的真实示例

下面的摘录是基于[提交在 `examples/` 中的图](examples/)得到的真实服务器输出。这些图由公开项目构建，使用 [corpus.json](corpus.json) 中固定的提交。`[S]` 表示已证实，`[H]` 表示启发式推断，`[?]` 表示未知。每个代码块的第一行都是智能体发出的 MCP 工具调用。要在没有 MCP 客户端的情况下自行运行其中一个示例，请从本仓库的克隆目录执行：

```sh
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"signature_impact","arguments":{"fn":"clojure.realworld.user.core/login!","group_by":"none"}}}' \
  | node src/cli.ts mcp --graph examples/polylith-realworld.json.gz \
  | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).result.content[0].text'
```

上面的 `cart` 回答来自 `node src/cli.ts build test/fixtures/keys -o /tmp/cart.json.gz`，以及使用 `--graph /tmp/cart.json.gz` 的同一条管道。

### 对照函数的参数集与调用方传入的内容

在 polylith-realworld 中，`login!` 接受一个 map，并解构出 `:email` 和 `:password`：

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

字面量 map 会显示它的键。以 `login-input` 传入的 map 仍然未知：该行上的 `[S]` 证实的是调用，而非运行时 map 的内容。

<details>
<summary><strong>如果 <code>login!</code> 开始要求必需的 <code>:tenant-id</code>，会怎样？</strong></summary>

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

传入字面量 map 的三个调用方都省略了新键。第四个转发 `login-input`，所以它的那一行为 UNKNOWN。不会修改任何内容；这是在询问一个尚未实施的改动。

</details>

<details>
<summary><strong><code>:email</code> 的生成方与使用方</strong></summary>

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

`:email` 没有命名空间限定，因此所有使用这个 keyword 的 map 都被汇集在这里。这并不能证实某个生成方的 map 会到达某个使用方。

</details>

<details>
<summary><strong>重构前的调用方</strong></summary>

来自 integrant：

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
<summary><strong>一个 re-frame 事件：dispatch 位置与处理函数</strong></summary>

来自 re-frame：

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

这种关联通过事件 keyword 建立，因此搜索某个具名函数的调用方会遗漏它。

</details>

<details>
<summary><strong>端点前面的 middleware，以及无法检查的内容</strong></summary>

来自 polylith-realworld：

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

处理函数是已证实的。包装器按顺序找到，并标为 `[H]`，因为 middleware 的组合属于运行时代码。项目没有声明权限规则，因此回答是**未提取**，而不是“没有检查”。

</details>

<details>
<summary><strong>如实呈现遗漏：一个被使用却从未定义的名称</strong></summary>

来自 next.jdbc，其中的宏生成了 clj-kondo 无法展开的函数：

```text
callers {"var": "next.jdbc.types/as-other"}
```

```text
CALLERS next.jdbc.types/as-other — no definition matches "next.jdbc.types/as-other"; used at test/next/jdbc/sql_test.clj:290, test/next/jdbc_test.clj:559 but no definition was found
note: next.jdbc.types/as-other is used at test/next/jdbc/sql_test.clj:290, test/next/jdbc_test.clj:559 but no definition was found: probably defined by a macro clj-kondo cannot expand; add :lint-as for the macro in .clj-kondo/config.edn
note: use a fully qualified name (ns/name)
```

回答会显示这个名称的使用位置，以及如何让它可见。为该宏添加 `:lint-as` 条目后，同样的问题会返回已证实的定义（[项目配置](docs/GUIDE.md#project-configuration)）。next.jdbc 在语料库中，但不在已提交的示例图中。

</details>

<details>
<summary><strong>将改动行转为审查上下文和相关测试</strong></summary>

来自 polylith-realworld：

```text
context_for_change {"changes": ["components/article/src/clojure/realworld/article/store.clj:60-80"], "limit": 3}
```

```text
CONTEXT_FOR_CHANGE components/article/src/clojure/realworld/article/store.clj:60-80 — 1 file(s), 3 changed symbol(s), 0 route(s), 0 attribute(s); risk LOW
counts: changed symbols=3 [S3]  callers outside the diff=9 [S9]  tests to run=24 [S24]
[... trimmed ...]
```

完整回答会列出三个改动的定义、diff 之外的九个调用方，以及 24 个相关测试（[完整记录](docs/GUIDE.md#context_for_change)）。`LOW` 描述的是这张图能够完成的检查，并非安全保证。

</details>

[更多记录](examples/README.md) · [每个工具及其完整回答](docs/GUIDE.md#tools)

## 快速开始

**前置要求：** Node.js **22.18+** 和 Git。不需要 JVM，也不需要 Babashka。

### 1. 安装并构建图

在**你想分析的 Clojure 项目**根目录中执行：

```sh
npm install --save-dev 'git+https://github.com/Bariscanates404/clojure-atlas.git'
npx clojure-atlas build
```

这个包不在 npm 注册表中；它从 Git 安装，安装时会编译 CLI。要固定到你审阅过的修订版本，请在 URL 后追加 `#<commit-sha>`。TypeScript 和 Node 类型定义仅在这一步编译中需要；安装后的 CLI 没有必需的 npm 运行时依赖。

图会写入 `.clojure-atlas/graph.json.gz`。首次构建会下载固定版本的 clj-kondo 二进制文件并检查其 SHA-256；后续构建使用缓存的二进制文件。请将 `.clojure-atlas/` 加入 `.gitignore`。

### 2. 连接 MCP 客户端

对于 Claude Code，先预览，再写入项目配置：

```sh
npx clojure-atlas init         # preview .mcp.json
npx clojure-atlas init --yes   # write it; existing servers are kept
```

然后让智能体调用 `graph_info`，再对项目中的一个完全限定的 `ns/name` 调用 `callers`。

<details>
<summary><strong>其他 MCP 客户端</strong></summary>

Atlas 使用**基于 stdio 的 MCP**。从项目根目录启动它：

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

如果客户端在其他位置启动服务器，请设置它的工作目录，或为 CLI、图和仓库使用绝对路径。不同客户端的配置格式有所不同。

</details>

### 3. 改动后重新构建

```sh
npx clojure-atlas build      # refresh the snapshot
npx clojure-atlas coverage   # resolution counts and unresolved names
```

没有 watch 模式。使用 `--repo` 时，如果工作树不再与图匹配，回答就会以 `STALE` 开头。重新构建后请重启 MCP 服务器，以便加载新图。

**宏与你的 clj-kondo 配置。** Atlas 会应用项目的 `.clj-kondo/config.edn`，包括 `:lint-as` 和 hook。按 `defn` 进行 lint 的宏会获得签名；未教给 clj-kondo 的宏，其内部使用会被视为启发式推断，回答也会指出宏的名称。可选的 `.clojure-atlas.edn` 可添加路由宏和授权规则：[项目配置](docs/GUIDE.md#project-configuration)、[授权测试夹具](test/fixtures/authz/.clojure-atlas.edn)。

## 如何阅读回答

| 标记 | 含义 | 应如何处理 |
|---|---|---|
| `[S]` `STATIC_PROVEN` | 由 clj-kondo 解析，或从字面量源码形式读取 | 查看引用的 `file:line` |
| `[H]` `HEURISTIC` | 从名称、包装器、threading 形式中的参数位置、dispatch 候选项，或 Atlas 无法看透的宏推断得出 | 据此行动前，先打开所引用的行 |
| `[?]` `UNKNOWN` | 无法静态判断 | 将其视为这张图所知范围的边界 |

**空回答不是不存在的证明。** Atlas 会区分“未找到任何项”“未找到定义”和“此图不具备该能力”。`DEGRADED` 警告部分分析缺失；`STALE` 警告快照已过时。零测试表示未找到静态关联，不代表代码未经测试。
[证据等级与不存在情况的详细说明](docs/GUIDE.md#bands-and-absence)

## 局限

> [!WARNING]
> **Atlas 可能遗漏的内容。在信任空回答之前，请先阅读这里。**
>
> - **未教给 clj-kondo 的宏所创建的定义。** 项目中的 `defthing`，或未附带 clj-kondo 配置的库 DSL，会定义图中不包含的 Var：它们的调用方显示为*未解析*，这类宏内部的代码也仅属于启发式推断。这就是 DataScript 在语料库中解析率为 89.9% 的原因。将该宏教给 clj-kondo（在 `.clj-kondo/config.edn` 中添加 `:lint-as` 或 hook），重新构建，它们就会重新出现。回答会指出宏的名称。
> - **任何在运行时决定的内容。** 通过计算出的符号用 `resolve` 找到的 Var、从 map 中选取的函数、`apply` 或 `partial` 背后的参数数量、用 `keyword` 构建的键、被合并或转发的 map。这些都报告为 UNKNOWN，绝不猜测。
> - **Dispatch。** 多重方法或协议调用的目标只是候选项，不是证明。
> - **没有 `ns` 形式的脚本**（REPL 教程）：day-of-datomic 的解析率为 74.3%。
> - **clj-kondo 无法解析的文件，以及超过 2 MB 的文件。** 它们的定义会缺失；此时每个回答都以 `DEGRADED` 开头，并列出这些文件。

- **仅静态分析。** 不跟踪运行时解析的 Var、由数据选出的函数，以及用 `keyword` 构建的键。
- **Map 键是 keyword 的出现位置**，嵌套 map 则贡献最外层的键，如[上文](#提供方--参数集--使用方)所述。没有路径敏感的数据流分析。
- **可选键从函数体的形式读取。** 函数内部重新绑定的名称不会被跟踪，因此可能把并非可选的键称为可选键。反过来的情况不会发生。
- **宏。** clj-kondo 只有借助 `:lint-as` 条目或 hook 才能看透宏。对于 Atlas 未列出的绑定宏，其中不含 `:keys` 的绑定模式会被当作 map 字面量读取。
- **Middleware 与权限。** 调用链属于启发式推断；路由权限需要 `.clojure-atlas.edn`。
- **没有增量构建。** 改动后请重新构建。
- **Windows 未经测试。**

完整列表见[指南](docs/GUIDE.md#limits)；计划中的内容见[路线图](ROADMAP.md)。

## 从设计上坚持本地运行

核心 CLI **没有必需的 npm 运行时依赖**。它使用 Node 标准库、clj-kondo 进行分析，并使用 Git 获取仓库元数据。图在你的机器上构建和查询：无需账户、没有托管索引、没有遥测。

### 环境要求

| 组件 | 作用 |
|---|---|
| Node.js 22.18+ | 运行 CLI 和 MCP 服务器 |
| clj-kondo 2025.10.23 | 原生分析器；下载一次后缓存，归档文件的 SHA-256 已固定 |
| Git | 从 Git 安装、跟踪文件检查、快照和过时状态信息 |
| TypeScript 5，可选 | 仅用于 Playwright 页面对象和测试分析；在 Atlas 所在环境执行 `npm i -D typescript@5` |

提供适用于 macOS arm64/x64、Linux arm64/x64 和 Windows x64 的固定版本二进制文件。开发和语料库测量在 macOS arm64 上进行。如果无法下载，例如处于代理之后，Atlas 会回退到 `PATH` 上的 `clj-kondo`。[平台与缓存详情](docs/GUIDE.md#requirements)

### 安全

较少的依赖可以缩小攻击面。它们**并不**构成供应链保证。

- 下载的 clj-kondo 归档文件会与固定的 SHA-256 校验，不匹配就拒绝使用。从 `PATH` 获取的 `clj-kondo` 则按你安装的状态予以信任，不会与该哈希校验。
- Atlas 不会启动被分析应用的 JVM、shell 脚本或 Node 代码。**项目的 clj-kondo hook 会由 clj-kondo 解释执行**，因此在分析仓库时，这份配置属于你所信任的代码。
- MCP 服务器读取图，并执行只读 Git 检查，禁用 Git hook、过滤器驱动和 fsmonitor，同时设置超时。
- 结果通过 stdio 在本地提供。AI 客户端如何处理这些结果，属于另一个隐私边界。

这些是实现的属性，并非安全审计的结果。
[执行模型](docs/GUIDE.md#security)

## 测量结果

在 **26 个公开仓库**上测量，每个仓库都固定到 [corpus.json](corpus.json) 中的一个提交。完整表格：[docs/COVERAGE.md](docs/COVERAGE.md)。

| 概览 | |
|---|---|
| 能成功构建图的仓库 | **26 / 26**，无崩溃，0 条丢弃的边 |
| 读取规模 | 10,158 个源文件、141,604 个定义、1,927,681 条边 |
| 项目命名空间中关联到定义的 Var 使用 | **601,991 / 602,877 (99.85%)**；886 个未解析 |
| 每个仓库 | 中位数 100.0%；24 / 26 达到 99.3% 或以上；较低的两个为 89.9% 和 74.3% |
| clj-kondo 无法归属到任何命名空间的符号 | **18,517**，计数并显示，不关联，也不计入比率 |
| clj-kondo 无法完整解析的文件 | 24 |
| 回答经人工核对的基准测试 | 14 / 14 个正向问题、7 / 7 个不存在性问题 |

这些数字说明，在这些项目上，有多少代码的*静态*结构进入了图中。它们并不对你的项目作出承诺：基于未教给 clj-kondo 的宏构建的代码库，在配置完成之前，表现会更接近 DataScript，而非 Metabase。`npx clojure-atlas coverage` 会输出你的项目的相同计数。

### 解析率及其对应计数

**解析率**是 clj-kondo 归属到项目命名空间的 Var 使用的 `resolved / (resolved + unresolved)`。它不是分析准确率。库的使用不在其中，**命名空间未知的使用**也不在其中：这些是 clj-kondo 无法归属到任何命名空间的符号，可能是它不认识的宏绑定的局部变量，也可能是图遗漏的 Var 使用。静态分析无法区分两者，因此它们以原始计数显示，绝不并入比率。

| 仓库 | 已解析 | 未解析 | 解析率 | 命名空间未知（原始计数，不计入比率） |
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
| **全部 26 个仓库** | | | **中位数 100.0%；24 / 26 达到 99.3% 或以上** | **总计 18,517** |

† [说明见 docs/COVERAGE.md](docs/COVERAGE.md#repos-under-95-resolution-rate-or-with-unknown-namespace-usages-above-5-of-resolved)

**改变定义不等于改进。** 本项目最初的覆盖报告以 `resolved + unresolved + unknown` 为分母，显示 Babashka 为 87.0%。今天的 99.6% 使用上面的定义。这个差异几乎都来自分母：命名空间未知的使用被移出了比率，并没有变成已解析，最后一列仍有其中的 2,176 个。不要比较这两种定义下的比率。

### 提取实际上获得了什么

以下是 Atlas 读取内容的变化，每项均有测试夹具或测试，与上面的比率分开呈现。

| 变化 | 测量结果 | 证据 |
|---|---|---|
| 区分 map 字面量与绑定模式 | 在语料库的 26 个仓库中：新增 **5,475** 个生成位置（返回向量中的 map、hiccup、路由数据、`(d/transact conn [{…}])`）；**703** 个 keyword 值不再被列为已证实的“解构”使用位置；**5,268** 个 `:keys` / `:as` / `:or` 条目不再被列为生成的键 | [测试](test/keys-adapter.test.ts)，测试夹具：[authz](test/fixtures/authz/)、[数据](test/fixtures/data/)、[reframe](test/fixtures/reframe/) |
| 仅在 clj-kondo 统计出相同参数时记录签名 | 通过按 `defn` 进行 lint 的形式定义的 **532** 个函数获得了签名（Metabase 中有 216 个）；各平台参数不同的 **22** 个 `.cljc` 函数不再获得错误签名（DataScript 的 `first-seq` 曾被读为 `[xs xs]`）；`s/defn` 注解不再被计为参数 | [测试](test/signatures.test.ts) |
| 读取普通参数的使用方式 | 读取情况完全已知的普通参数：**3,496 → 4,184**（解构参数的 `let`、`(-> m :k)`、`contains?`） | [测试](test/signatures.test.ts) |
| 读取外层 Ring/Compojure middleware | polylith-realworld：`POST /api/articles` 的 middleware 条目 **0 → 11** | [基准测试 q13](docs/BENCHMARK.md#positive-questions)、[测试夹具](test/fixtures/ring-middleware/) |
| 读取另一命名空间中的前端路由表 | Logseq：客户端路由节点 **0 → 17** | [覆盖情况](docs/COVERAGE.md)、[基准测试 q14](docs/BENCHMARK.md#positive-questions) |
| 识别 `re-frame.alpha` | 提取通过 alpha 命名空间进行的注册与 dispatch | [测试夹具](test/fixtures/reframe/src/app/alpha.cljs) |
| 应用项目的 clj-kondo 配置 | 项目的 `:lint-as` 条目和 hook 参与分析 | [测试夹具](test/fixtures/project-config/)、[测试](test/config.test.ts) |
| 在没有项目 `node_modules` 的情况下为 Playwright fixture 提供类型 | 从 `test.extend<…>` fixture 获取页面对象的测试，在未安装 `@playwright/test` 的检出中也会关联到页面对象的成员；在测试夹具中：**0 → 12** 个关联 | [测试](test/playwright-fixtures.test.ts)、[测试夹具](test/fixtures/browser-fixtures/) |

前三行比较的是同一批固定提交在改动前后的图。在该比较中，其他类型的边没有任何变化，已解析、未解析和命名空间未知的计数也完全相同：这些是读取 map 键和参数信息的变化，而非解析率的变化。

### 基准测试

记录的基准测试通过了 **14 / 14 个正向问题**（找到预期的 40 / 40 行）和 **7 / 7 个不存在性问题**。这是一个小型回归基准测试，回答经人工对照源码核验，并非对你的项目的准确率估计。[问题、结果与方法](docs/BENCHMARK.md)

## Atlas 如何测试

智能体会信任交给它的信息，所以错误回答的代价比缺失回答更高。

| 检查项 | 状态 |
|---|---|
| 自动化测试 | **873**，全部通过（`npm test`）；每个修复的 bug 都会添加一个没有该修复就失败的测试 |
| 源码行覆盖率 | **99.79%**（`npm run test:coverage`；低于 98% 时门禁失败） |
| 类型检查 | `npm run typecheck` 无错误 |
| 持续集成 | [GitHub Actions](.github/workflows/ci.yml) 对每次推送到 `main` 以及每个拉取请求，在 Linux 的 Node.js 22 和 24 上运行类型检查和覆盖率门禁 |
| 测试夹具 | [test/fixtures](test/fixtures) 下的小型 Clojure 代码库，预期的每一条图记录都经人工核验 |
| 真实仓库 | 26 个公开项目构建时无崩溃，0 条丢弃的边 |
| 基准测试 | 回答经人工核验的正向问题和不存在性问题（[docs/BENCHMARK.md](docs/BENCHMARK.md)） |
| 独立审查 | 未编写该改动的审查者通过可运行的复现案例寻找错误回答；每个确认的缺陷都会连同测试一起修复 |
| 不可信仓库 | 恶意测试夹具验证 Git 设置、过滤器驱动、子模块、项目的 TypeScript、异常文件名和卡住的 clj-kondo hook 不会执行任何内容，也不会使任何内容卡住 |

不存在性问题最为重要：它们检查 Atlas 是否在事实如此时回答“未找到”“未提取”或“已降级”，而不是返回一个看起来像“没有”的空列表。全绿的测试套件和基准测试，是关于这些测试夹具和这些仓库的证据。它们不保证在你的仓库上回答正确；请阅读每一行的证据等级。

## 参与贡献

**让我们一起打造我们的 Clojure X 光工具！**

有用的贡献可以只是一个很小的 Clojure 示例：“这个库把这两样东西连接起来，Atlas 应该能看到它。”添加一个测试夹具和你预期的图记录，或编写适配器。两者都欢迎，也欢迎提供 Atlas 给出错误或误导性回答的案例。

```sh
npm ci
npm test
npm run test:coverage   # 98% source line-coverage gate
npm run typecheck
```

CLI 使用 TypeScript，以便以普通 Node 的形式分发；Clojure 分析由 clj-kondo 完成。
[贡献者指南](CONTRIBUTING.md) · [路线图](ROADMAP.md) · [工具参考](docs/GUIDE.md)

## 致谢与许可证

由 **Barış Can Ateş** 创建。[采用 MIT 许可证](LICENSE)，包括文档与美术素材。基于 Michiel Borkent 的 **[clj-kondo](https://github.com/clj-kondo/clj-kondo)** 构建，并以 **[MCP](https://modelcontextprotocol.io)** 作为与编程智能体交互的接口。感谢语料库和示例中公开项目的作者；这些项目保留各自的许可证。

*为了所有 Clojure 开发者。*
