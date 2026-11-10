# clojure-atlas

**为智能体编程而生。给你的 AI 智能体一张 Clojure 代码库的地图。**

追踪调用方以及数据的提供方/使用方,检查函数契约**直至 map 参数内部的键**,
跟踪 re-frame 事件和路由,并找出受某次改动影响的测试。
clojure-atlas 将 **Clojure、ClojureScript 和 `.cljc` 源代码**转换为本地代码图,再以**13 个 MCP 工具**的形式提供,
并附带源码位置和明确的置信度级别。

它是**面向编程智能体的配套工具**:Atlas 在智能体修改代码之前提供所需的结构化上下文:
谁依赖这段代码、它的使用方期望哪些参数和 map 键,以及哪些测试与之相关。

![clojure-atlas — provider to map parameter set to consumer; inspect contracts with signature_impact and key_flow](docs/assets/atlas.svg)

[![License: MIT](https://img.shields.io/badge/license-MIT-91d5b6?style=flat-square&labelColor=17252b)](LICENSE)
[![Node.js: 22.18+](https://img.shields.io/badge/Node.js-22.18%2B-91d5b6?style=flat-square&labelColor=17252b)](#环境要求)
[![MCP: stdio](https://img.shields.io/badge/MCP-stdio-91d5b6?style=flat-square&labelColor=17252b)](#快速开始)
[![Required npm runtime dependencies: 0](https://img.shields.io/badge/npm_runtime_dependencies-0-91d5b6?style=flat-square&labelColor=17252b)](#设计上即本地运行)

**零个必需的 npm 运行时依赖。本地分析。For the sake of all Clojurians.(为了所有 Clojure 开发者。)**

**Barış Can Ateş** 的个人项目 · MIT 许可 · 基于 [clj-kondo](https://github.com/clj-kondo/clj-kondo) 构建。

[English](README.md) | [Türkçe](README.tr.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Português (Brasil)](README.pt-BR.md) | [日本語](README.ja.md) | 简体中文

[功能](#你能做什么) · [map 契约](#契约直至-map-的键) · [支持的技术栈](#语言与生态系统支持) · [示例](#实际效果) ·
[快速开始](#快速开始) · [覆盖率](#覆盖率) · [测试方式](#atlas-如何测试) · [完整指南](docs/GUIDE.md)

## 你能做什么

在探索不熟悉的项目、规划重构或审查改动时使用。你的 MCP 客户端调用这些工具;
Atlas 返回它能够确立的关系,并附上 `file:line` 引用。

| 向你的智能体提问… | Atlas 提供给它… | MCP 工具 |
|---|---|---|
| “谁调用了它?我的改动可能影响什么?” | 直接调用方、值引用以及传递依赖方 | `callers`, `blast_radius` |
| “每个调用方提供了什么参数集,函数又读取了什么?” | 元数(arity)、解构的 map 键、默认值、关键字参数,以及每个调用点提供的键 | `signature_impact` |
| “谁提供了这个 map 键,谁在使用它?” | 键的生产方和使用方,包括嵌套 map 中的字面量键和键路径 | `key_flow` |
| “这一行配置是否缺少某个键?” | 同级 map 行中存在、但这一行缺少的键 | `key_siblings` |
| “谁处理这个端点?权限在哪里检查?” | 路由处理函数、有序的中间件以及已配置的权限检查 | `route_authz`, `permission_routes` |
| “这个 re-frame 事件触发时会发生什么?” | 派发方、处理函数、订阅和 HTTP 请求 | `event_flow` |
| “谁读取或写入这个数据库属性?” | 已证明的读取和写入,不确定的引用保持可见 | `attribute_usage` |
| “哪些测试与这次改动相关?” | 静态的单元测试关联、Playwright 关联,以及针对已改动文件或行的审查上下文 | `tests_for`, `tests_covering`, `context_for_change` |
| “这张图实际上知道什么?” | 来源提交、已启用的适配器、证据计数和覆盖率警告 | `graph_info` |

调用、回调和同名的关键字是不同的东西。Atlas 对这些区别建模,
包括 Clojure 的注册和数据驱动的连接。它为你的智能体提供可在编辑之前检查的证据。

### 在上线前帮你发现的 bug

每一行都是在公开项目上得到的真实回答;完整记录见链接。

| 可能的 bug | 使用工具 | Atlas 展示了什么(真实示例) |
|---|---|---|
| 某行配置或数据缺少同级行都有的键 | `key_siblings` | re-frame:一个 query 表中有 2 行缺少 `:re-frame/lifecycle`,而 4 个同级行中有 3 行有([记录](docs/GUIDE.md#key_siblings)) |
| 新增的必需键破坏了现有调用方 | `signature_impact` 加 `added_keys` | polylith-realworld:如果 `login!` 需要 `:tenant-id`,3 个调用方传入的字面量 map 中没有它,另有 1 个转发了 Atlas 看不到的 map([记录](#检查-map-参数内部的契约)) |
| 调用方传入了错误的元数,或函数从不读取的键,或漏掉了函数解构的键 | `signature_impact` | integrant:对 38 个调用方和两种元数检查了 `init`;给出写明所做搜索的“no finding”([记录](docs/GUIDE.md#signature_impact)) |
| 端点缺少中间件或权限检查 | `route_authz`, `permission_routes` | polylith-realworld:`POST /api/articles` 按顺序列出 11 个包装器,`wrap-authorization` 在最后;没有声明的模型时,权限如实标为“not extracted”([记录](docs/GUIDE.md#route_authz)) |
| 读取了一个没有任何代码写入的键(常常是拼写错误或被重命名的键) | `key_flow` | compojure:`:compojure/path` 有 1 个生产方(`assoc-path`)和 2 个使用方([记录](docs/GUIDE.md#key_flow)) |
| 数据库属性出现意料之外的写入方 | `attribute_usage` | mount:`:order/bid` 有 2 个已证明的写入方,其中一个在测试代码中,没有读取方([记录](docs/GUIDE.md#attribute_usage)) |
| 被派发的事件没有处理函数,或处理函数触发了意料之外的事件 | `event_flow` | re-frame todomvc:`:delete-todo` 从 2 处派发,被处理 1 次,不触发任何事件([记录](docs/GUIDE.md#event_flow)) |
| 一个小改动的影响比预期更广 | `blast_radius` | integrant:对 `ref?` 的改动经 6 层波及 31 个定义([记录](docs/GUIDE.md#blast_radius)) |
| 没有任何测试覆盖到的已改动代码 | `context_for_change`, `tests_for` | polylith-realworld:article store 的第 60-80 行涉及 3 个定义、9 个外部调用方和 24 个相关测试([记录](docs/GUIDE.md#context_for_change)) |

Atlas 指出该看的地方;是否真的是 bug,仍由你或你的智能体判断。

### 智能体的工作流程

1. **定位:**使用 `graph_info` 检查快照、已启用的适配器和分析缺口。
2. **调查:**检查调用方、参数契约、map 键的提供方/使用方以及改动的潜在影响。
3. **规划与验证:**使用 `context_for_change` 和测试工具找到受影响的代码和相关测试;
   检查引用的源码,进行改动并运行相关测试。为下一轮重新构建图并重启 MCP 服务器。

## 契约,直至 map 的键

Atlas 让**源码中可见的参数契约**可被检查:调用方提供了什么、函数解构或读取了什么,
以及某个拟议的改动会影响哪些调用点。

| 层级 | Atlas 能展示什么 |
|---|---|
| **参数集** | 接受的元数、位置/rest 参数,以及 `& {:keys [verbose]}` 这样的关键字参数 |
| **map 参数内部的键** | `{:keys [email password]}`、`:or` 默认值、`:as` 别名、调用方传入的字面量键,以及函数体中受支持的读取 |
| **提供方 / 使用方** | 生产方如 map 字面量、`assoc` 和 `assoc-in`;使用方如解构、关键字查找、`get` 和 `get-in` |
| **契约变更** | 受新增/移除的键或元数变化影响的调用点,使用带有 `added_keys`、`removed_keys`、`arities` 或 `base_graph` 的 `signature_impact` |
| **嵌套 map** | 通过 `key_flow` 查看嵌套 map 中字面量键的出现、解构,以及 `(get-in cart [:meta :count])` 这样的路径 |

范围是**静态的键使用**,而非值/类型校验。`key_flow` 按关键字对出现位置分组,而不是按
某个特定 map 的身份。`signature_impact` 记录嵌套解构或 `get-in` 的外层键,
而不是完整的嵌套 schema。运行时构造的 map 和键可能仍然未知。

## 语言与生态系统支持

**核心语言:**Clojure(`.clj`)、ClojureScript(`.cljs`)和共享代码(`.cljc`)。EDN 文件提供受支持的
配置和数据形式。TypeScript(`.ts`)仅为可选的 Playwright 集成而读取;
它不是通用的 JavaScript 或 TypeScript 分析器。

| 领域 | 识别的库 / 形式 | 目前覆盖的内容 |
|---|---|---|
| Clojure 核心 | Var、调用、值的使用、回调、multimethod、protocol | 定义和依赖关系;分派候选是启发式的 |
| 参数与 map 契约 | `defn` 元数、map 解构、关键字参数、map 字面量和键操作 | 调用方提供的键集合、被使用的键、提供方/使用方位置以及签名变更的影响 |
| 前端状态 | **re-frame**,包括 `re-frame.alpha` | 事件/订阅的注册、派发、订阅输入和订阅者 |
| 后端路由 | **Compojure**、**Reitit**、**Pedestal** 表路由 | 路径、挂载的路由副本和处理函数;Pedestal service-map 的拦截器不会被提取 |
| 中间件 | **Ring**、Compojure 的 `wrap-routes`、Reitit 路由数据和 `ring-handler` | 有序的链,包括外层包装器;推断出的链标记为启发式 |
| 路由授权 | 项目定义的权限键、中间件和函数 | 需要一个简短的 `.clojure-atlas.edn` 声明 |
| 浏览器路由 | **Reitit frontend**、**Secretary** | 图中的客户端路由节点;目前还没有专门列出它们的 MCP 工具 |
| HTTP 请求 | **cljs-ajax**、**cljs-http**、`js/fetch`、请求 effect map | 请求位置,以及按方法和路径与后端路由的匹配 |
| 数据 | **Datomic**、**DataScript**、**XTDB v1 / Crux** | 属性、事务写入、query/pull 读取以及不确定的引用 |
| 系统生命周期 | **Integrant**、**Mount**、**Component** | 系统键、注册和依赖边;Integrant 配置的提取依赖 ref |
| Schema | **clojure.spec / cljs.spec**、**Malli** | 已注册的 spec schema 和保存在 var 中的 Malli schema;不支持 Malli registry |
| 测试与 UI | **clojure.test / cljs.test**、**Playwright**、字面量 Hiccup 选择器 | 静态测试关联;Playwright 页面对象和 `.ts` 测试需要可选的 TypeScript 5 |
| 项目布局 | **deps.edn**、**Leiningen**、**shadow-cljs**、**Babashka**、**Boot**、**Polylith** 布局 | 源码发现以及按模块/组件分组;不分析构建别名和任务执行 |

框架适配器识别的是特定的源码形式,而不是某个库所有可能的用法。`graph_info` 会报告
**你的**项目中有哪些可用并已启用。Fulcro、Pathom、HoneySQL 和 next.jdbc 等仓库在
测量语料库中,但它们出现在那里并**不**意味着已实现专门的框架或 SQL 分析。
这些适配器、bidi、compojure-api 以及其他缺口,请参阅[路线图](ROADMAP.md)。

## 实际效果

这些摘录来自公开项目的[已提交示例图](examples/)。调用的是
MCP 工具,而不是 shell 命令。`[S]` 表示静态证明;`[H]` 表示启发式。

### 检查 map 参数内部的契约

在 polylith-realworld 中,`login!` 接收**一个 map 参数**并解构 **`:email` 和 `:password`**。
Atlas 将该键集合与其调用方提供的参数并列展示:

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

字面量 map 的键集合可见;作为 `login-input` 传入的 map 仍然未知。该行的 `[S]` 证明的是
调用关系,而不是运行时 map 的内容。

<details>
<summary><strong>更改参数契约:如果 login! 还需要 :tenant-id 会怎样?</strong></summary>

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

三个传入字面量 map 的调用方都没有提供拟议的键。第四个调用方转发 `login-input`,因此它的影响
是 **UNKNOWN**。这是一个假设性的契约变更;该工具不会修改源码。“No finding”
指的是现有签名;`affected` 部分描述的是拟议的变更。

</details>

<details>
<summary><strong>在整个项目中查找 :email 的提供方和使用方</strong></summary>

```text
key_flow {"key": ":email", "group_by": "none", "limit": 2}
```

```text
KEY_FLOW :email — 9 producer(s), 5 consumer(s) in 1 component(s); 23 site(s) in tests
counts: producers=9 [S9]  consumers=5 [S5]  tests=23 [S23]
[... trimmed ...]
```

结果列出了 `register!` 中的 map 字面量生产方,以及包括 `login!` 在内的解构使用方,并附带
源码位置。由于 `:email` 没有限定命名空间,所有使用该关键字的 map 会被分在一起;这
并不能证明某个特定生产方的 map 到达了某个特定的使用方。

</details>

<details>
<summary><strong>重构之前查找调用方</strong></summary>

**问题:**谁调用了 `integrant.core/dependent-keys`?

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
<summary><strong>沿着派发位置及其处理函数跟踪一个 re-frame 事件</strong></summary>

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

连接是通过事件关键字建立的,因此只看某个具名函数的调用方会漏掉它。

</details>

<details>
<summary><strong>查看端点前面的中间件,以及 Atlas 无法检查的内容</strong></summary>

来自 polylith-realworld,其中路由在另一处定义里被 Ring 中间件包装:

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

处理函数已被证明;十一个包装器按顺序找到,但标记为 `[H]`,因为中间件的组合
是运行时代码。该项目没有声明权限规则,因此 Atlas 说 **not extracted**,而不是声称
该路由没有权限检查。

</details>

<details>
<summary><strong>坦率的遗漏:被使用却从未定义的名称</strong></summary>

来自 next.jdbc,其中一个宏生成了 clj-kondo 无法展开的辅助函数:

```text
callers {"var": "next.jdbc.types/as-other"}
```

```text
CALLERS next.jdbc.types/as-other — no definition matches "next.jdbc.types/as-other"; used at test/next/jdbc/sql_test.clj:290, test/next/jdbc_test.clj:559 but no definition was found
note: next.jdbc.types/as-other is used at test/next/jdbc/sql_test.clj:290, test/next/jdbc_test.clj:559 but no definition was found: probably defined by a macro clj-kondo cannot expand; add :lint-as for the macro in .clj-kondo/config.edn
note: use a fully qualified name (ns/name)
```

答案没有止于“未找到,请检查拼写”,而是显示该名称在哪里被使用,以及如何让它变得可见。
为该宏添加 `:lint-as` 条目后,同样的问题会返回已证明的定义
([项目配置](docs/GUIDE.md#project-configuration))。

</details>

<details>
<summary><strong>将改动的行转化为审查上下文和相关测试</strong></summary>

来自 polylith-realworld:

```text
context_for_change {"changes": ["components/article/src/clojure/realworld/article/store.clj:60-80"]}
```

```text
CONTEXT_FOR_CHANGE components/article/src/clojure/realworld/article/store.clj:60-80 — 1 file(s), 3 changed symbol(s), 0 route(s), 0 attribute(s); risk LOW
counts: changed symbols=3 [S3]  callers outside the diff=9 [S9]  tests to run=24 [S24]
[... trimmed ...]
```

完整的回答列出三个被改动的定义、diff 之外的九个调用方和 24 个相关测试,
按组件分组。`LOW` 描述的是图所执行的检查;它不是安全保证。

</details>

[更多真实示例](examples/README.md) · [所有工具和完整记录](docs/GUIDE.md#tools)

## 快速开始

**前提条件:**Node.js **22.18+** 和 Git。不需要 JVM 或 Babashka 运行时。

### 1. 安装并构建图

在**你想分析的 Clojure 项目**的根目录运行:

```sh
# Install the reviewed source revision (Git installation builds the CLI).
npm install --save-dev \
  'git+https://github.com/Bariscanates404/clojure-atlas.git#8634d33e3ed59d420eead61a9c596f752d1fe789'

npx clojure-atlas build
```

该包目前未发布到 npm;请使用上面的 Git 安装方式。仓库保持私有期间,
需要有仓库的访问权限。从源码安装会使用 TypeScript 和 Node 类型定义来编译 CLI;这些是
构建时依赖,与它零个必需的 npm 运行时依赖是分开的。

图保存在 `.clojure-atlas/graph.json.gz`。首次构建会下载并校验固定版本的 clj-kondo 二进制文件;
之后的分析使用缓存的二进制文件。请将 `.clojure-atlas/` 添加到项目的 `.gitignore`。

### 2. 连接你的 MCP 客户端

对于 Claude Code,先预览,再写入项目配置:

```sh
npx clojure-atlas init         # preview .mcp.json
npx clojure-atlas init --yes   # write it; keep existing servers
```

在你的客户端中启用该服务器,然后让它对你项目中的完全限定 `ns/name` 使用 `graph_info` 和 `callers`。

<details>
<summary><strong>配置其他 MCP 客户端</strong></summary>

Atlas 使用**基于 stdio 的 MCP**。将客户端配置为从你的项目根目录启动它:

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

如果客户端在其他位置启动服务器,请使用其工作目录设置,或为已安装的 CLI、图和仓库
使用绝对路径。各客户端的配置格式可能不同。

</details>

### 3. 改动之后重新构建

```sh
npx clojure-atlas build       # refresh the snapshot
npx clojure-atlas coverage   # inspect resolution counts and unresolved names
```

没有 watch 模式。使用 `--repo` 时,当工作树不再与图一致,查询会以 `STALE` 发出警告。
重新构建之后请重启 MCP 服务器,使其加载新的图。

**已经有 clj-kondo 配置了吗?**Atlas 会应用项目的 `.clj-kondo/config.edn`,包括其中的
宏映射和 hook。可选的 `.clojure-atlas.edn` 可添加自定义路由宏和授权规则。
请参阅[项目配置](docs/GUIDE.md#project-configuration)和[授权 fixture](test/fixtures/authz/.clojure-atlas.edn)。

## 如何阅读回答

| 标记 | 含义 | 如何使用 |
|---|---|---|
| `[S]` — `STATIC_PROVEN` | 由 clj-kondo 解析,或由字面量源码形式确立 | 沿着引用的源码位置查看 |
| `[H]` — `HEURISTIC` | 由名称、包装器、threading 位置或分派候选推断而来 | 在源码中验证这一关系 |
| `[?]` — `UNKNOWN` | 无法静态判定 | 将其视为分析的边界 |

**空结果并不自动等于不存在的证明。**Atlas 区分“未找到任何内容”、“未找到定义”和“能力不可用”。
`DEGRADED` 提醒分析不完整;`STALE` 提醒快照已过时。测试数为零表示没有找到静态关联,
而不表示这段代码没有被测试。

动态分派、运行时创建的符号和项目宏可能限制图所能看到的内容。无法读取的
中间件会报告为 unknown。路由权限需要显式的项目配置。
[证据与不存在](docs/GUIDE.md#bands-and-absence) · [已知限制](docs/GUIDE.md#limits)

## 设计上即本地运行

核心 CLI **没有必需的 npm 运行时依赖**。它使用 Node 标准库、用于 Clojure 分析的 clj-kondo,
以及用于仓库元数据的 Git。图的构建和查询都在本地完成,不需要 Atlas 账号、托管索引
或云服务。

### 环境要求

| 组件 | 作用 |
|---|---|
| Node.js 22.18+ | 运行 CLI 和 MCP 服务器 |
| clj-kondo 2025.10.23 | 原生分析器;下载一次并缓存,压缩包的 SHA-256 已固定 |
| Git | 源码安装、已跟踪文件检查以及快照/过期信息 |
| TypeScript 5 — 运行时可选 | Playwright 页面对象和测试分析;在 Atlas 旁用 `npm i -D typescript@5` 安装 |

提供固定版本的二进制文件,支持 macOS arm64/x64、Linux arm64/x64 和 Windows x64。开发和语料库
测量使用的是 macOS arm64;**Windows 未经测试**。如果无法下载,包括在代理之后,
Atlas 可以回退到 `PATH` 中可用的 `clj-kondo`。[平台和缓存详情](docs/GUIDE.md#requirements)。

### 安全

较小的依赖面有帮助,但**零个必需的 npm 依赖并不意味着零供应链风险**。

- 下载的 clj-kondo 压缩包会与固定的 SHA-256 核对。不匹配的下载会被拒绝;来自 `PATH` 的
  回退可执行文件被单独信任,不会与该固定的压缩包哈希核对。
- Atlas 不会启动被分析应用的 JVM、shell 脚本或 Node 代码。**项目的 clj-kondo hook
  由 clj-kondo 解释执行**,因此在分析仓库时,其配置属于你所信任的代码的一部分。
- MCP 服务器读取图,并使用只读的 Git 检查。这些检查中 Git 命令 hook、过滤器驱动
  和 fsmonitor 均被禁用;Git 和 clj-kondo 子进程设有超时。
- Atlas 通过 stdio 在本地提供结果。你所选的 AI/MCP 客户端如何处理这些结果,是另一个
  隐私边界。

这些是实现层面的特性,而不是安全审计认证。[详细的执行模型](docs/GUIDE.md#security)。

## 覆盖率

在 **26 个公开仓库**上测量,每个仓库都固定到 [corpus.json](corpus.json) 中的某个提交。语料库包括
Babashka、Logseq、Metabase、Penpot、re-frame、Reitit 以及较小的库。完整结果见
[docs/COVERAGE.md](docs/COVERAGE.md)。

**解析率衡量的是某一件具体的事:**对归属于已识别项目命名空间的 var 使用,计算
`resolved / (resolved + unresolved)`。库的使用和**未知命名空间的使用不在该分母之内**。
它不衡量被理解的全部代码、被提取的全部框架行为,也不衡量运行时的正确性。

| 仓库 | Resolved | Unresolved | 解析率 | 未知命名空间(原始计数,已排除) |
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
| **All 26 repos** | | | **median 100.0%; 24 of 26 at 99.3% or more** | |

† [docs/COVERAGE.md](docs/COVERAGE.md#repos-under-95-resolution-rate-or-with-unknown-namespace-usages-above-5-of-resolved)

比率四舍五入到一位小数。请务必与 unresolved **和**未知命名空间两个计数一起阅读。
未知名称既可能是被遗漏的 var 使用,也可能是由不熟悉的宏绑定的局部变量;分析器无法
可靠地区分二者。

**指标的变化不等于分析器的改进。**早期的数字使用了不同的分母。Babashka 报告的
较高比率主要反映了对未知命名空间符号的排除,而不是新解析的代码。
在这些定义之间做比较并不对等;上面的原始计数被有意保持可见。

### 实际的提取改进

这些是 Atlas 所能读取内容的具体变化,与解析率的定义无关:

| 改进 | 可观察的结果 | 证据 |
|---|---|---|
| 读取外层 Ring/Compojure 中间件 | polylith-realworld:`POST /api/articles` 的中间件条目 **0 → 11** | [Benchmark q13](docs/BENCHMARK.md#positive-questions)、[fixture](test/fixtures/ring-middleware/) |
| 读取另一个命名空间中的前端路由表 | Logseq:客户端路由节点 **0 → 17** | [覆盖率](docs/COVERAGE.md)、[benchmark q14](docs/BENCHMARK.md#positive-questions) |
| 识别 `re-frame.alpha` | 通过 alpha 命名空间的注册和派发会被提取 | [Benchmark 历史](docs/BENCHMARK.md)、[fixture](test/fixtures/reframe/src/app/alpha.cljs) |
| 应用项目的 clj-kondo 配置 | 项目的宏映射和 hook 参与分析 | [配置 fixture](test/fixtures/project-config/)、[测试](test/config.test.ts) |

### Benchmark

记录在案的 benchmark 通过了 **14/14 个肯定问题**和 **7/7 个不存在问题**,预期答案
已对照源码手工核对。它是一个小型回归 benchmark,而不是通用的准确率估计。其中十三个
肯定问题的回答使用 MCP 工具;客户端路由问题直接读取图节点,因为目前还没有工具列出
客户端路由。[问题、结果和方法](docs/BENCHMARK.md)。

## Atlas 如何测试

智能体所信任的工具不能凭空捏造关系。在此版本发布之前,代码经过了:

| 检查 | 结果 |
|---|---|
| 自动化测试 | **831** 个,全部通过;每个已修复的 bug 都有一个在修复前会失败的测试 |
| 源码行覆盖率 | **99.75%**;低于 98% 时 CI 失败 |
| Bug 排查 | 每个模块一名审查者,用可运行的复现来查找错误回答;发现并修复了 **85** 个已证明的 bug |
| 独立审查 | 由没有编写过这些代码的审查者进行了**六**轮,按模块对正确性、整洁度、规则和测试评分,直到每个模块都至少达到 5 分中的 4 分 |
| 真实仓库 | **26** 个公开项目构建时没有崩溃,且丢失的边为 **0**(此前其中六个项目共 690 条) |
| 不受信任的仓库 | 恶意的 fixture 检查 Git 设置、过滤器驱动、子模块、项目 TypeScript、奇怪的文件名和卡住的 clj-kondo hook 不会运行任何东西,也不会卡住任何东西;可执行文件查找会跳过仓库目录(已有单元测试;Windows 本身未经测试) |
| 基准真值 | 上面的 [benchmark](docs/BENCHMARK.md):14 个肯定问题和 7 个不存在问题,答案经手工核对 |

最重要的是不存在问题:它们检查 Atlas 在事实如此时会说 “not found”、“not extracted” 或 “degraded”,
而不是给出一个读起来像“没有”的空列表。

## 参与贡献

**Let's build our Clojure X-ray tool together!(让我们一起打造 Clojure 的 X 光工具!)**

一次有价值的贡献可以从一个很小的 Clojure 示例开始:“这个库把这两样东西连在一起,而 Atlas
应该能看到。”添加一个 fixture 和预期的图行,或者帮助实现它的适配器。两者都欢迎。

```sh
npm ci
npm test
npm run test:coverage   # 98% source line-coverage gate
npm run typecheck
```

CLI 使用 TypeScript 编写,以便通过 Node 轻松分发;Clojure 分析由 clj-kondo 完成。
[贡献者指南](CONTRIBUTING.md) · [路线图](ROADMAP.md) · [工具参考](docs/GUIDE.md)

## 致谢与许可

由 **Barış Can Ateş** 创建。[MIT 许可](LICENSE),包括本仓库中的文档和原创图稿。基于 Michiel Borkent 的
**[clj-kondo](https://github.com/clj-kondo/clj-kondo)** 构建,以
**[MCP](https://modelcontextprotocol.io)** 作为与编程智能体之间的接口。感谢语料库和示例中所用公开
项目的作者。这些项目和依赖保留各自的许可。

*For the sake of all Clojurians.*
