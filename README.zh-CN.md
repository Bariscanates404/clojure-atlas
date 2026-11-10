# clojure-atlas

**For the sake of all Clojurians.**

*为了所有 Clojurian。*

[English](README.md) | [Türkçe](README.tr.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Português (Brasil)](README.pt-BR.md) | [日本語](README.ja.md) | 简体中文

Clojure、ClojureScript 或 .cljc 代码库的结构图，以 MCP 工具的形式提供给 AI 编码代理。
为代理式开发而构建。采用 MIT 许可证。作者是 Barış Can Ateş。

## 简介

编辑 Clojure 的代理通常用文本搜索来查找关系。文本搜索无法区分调用与同名的关键字，
看不到用 `reg-event-fx` 注册的处理器、到达某个 var 的路由，或传给 `partial` 的函数，
也无法有把握地说出“没有任何东西调用它”。clojure-atlas 对项目运行一次
[clj-kondo](https://github.com/clj-kondo/clj-kondo)，把分析结果转成图
（定义、调用、值引用、re-frame 事件、路由、系统键、数据属性、map 键、测试），
并通过 MCP 回答关于该图的问题。每一行回答都带有一个 band，说明它是如何被证明的。
回答为空时，会说明搜索了什么，以及图本身是否有可能知道答案。

## 快速开始

```sh
npm i -D clojure-atlas
npx clojure-atlas build
npx clojure-atlas init
```

`build` 会写出 `.clojure-atlas/graph.json.gz`。在 integrant 仓库上的输出如下：

```
clojure-atlas: 7 files, 138 definitions, 296 nodes, 1481 edges; resolution rate of var usages in recognized project namespaces 100.0% (442 of 442), 0 usages in an unknown namespace; 0.7 s -> .clojure-atlas/graph.json.gz
```

`init` 会显示它将要写入的项目 `.mcp.json`，只有加上 `--yes` 才会真正写入：

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

`.mcp.json` 中已有的其他服务器会被保留。

### Claude Code

`npx clojure-atlas init --yes` 会写入项目的 `.mcp.json`，Claude Code 会读取它。也可以手动添加服务器：

```sh
claude mcp add clojure-atlas -- npx clojure-atlas mcp --graph .clojure-atlas/graph.json.gz --repo .
```

### 其他 MCP 客户端

服务器通过 stdio 使用 MCP 协议。大多数客户端接受下面的 JSON：

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

### 命令

```
usage:
  clojure-atlas build [dir] [-o .clojure-atlas/graph.json.gz]
  clojure-atlas mcp [--graph .clojure-atlas/graph.json.gz] [--repo <clone>] [--max-distance N]
  clojure-atlas coverage [graph]
  clojure-atlas init [--yes]
```

- `build` 分析 `dir`（默认 `.`）并写出图。
- `mcp` 提供图服务。指定 `--repo` 后，当工作树与构建图时的工作树不一致，
  或代理作为 `base` 传入的提交领先图的提交超过 `--max-distance` 个提交（默认 20），
  或图的提交领先于 `base`，或与 `base` 已经分叉时，回答会以一行 `STALE` 开头。
  工作树检查最多每 3 秒重复一次，因此编辑会在此之后的第一次调用中体现出来。
- `coverage` 打印图的 coverage 行，以及出现最频繁的未解析名称。
- `init` 把服务器添加到项目的 `.mcp.json`。

修改代码后请重新构建图。已提供服务的图不会自动更新：

```
STALE: the working tree is not the snapshot this graph describes (2 uncommitted file(s) now, 1 at build); rebuild with clojure-atlas build.
```

项目自己的 `.clj-kondo` 配置会被采用。项目根目录下可选的 `.clojure-atlas.edn` 用于补充通用适配器无法猜到的信息：
用于类 def 宏的 `:lint-as`、`:route-macros`，以及路由授权键
`:route-authz`、`:permission-middleware` 和 `:permission-fns`。

<a id="project-configuration"></a>
### 项目配置

由项目宏创建的 var，以及用项目宏编写的路由，在宏被点名之前都是不可见的。
以一个带有这个宏和路由的小型探测项目为例：

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

没有配置时，该 var 被使用却没有定义，而该路由根本不存在：

```
CALLERS probe.defs/timeout-ms — no definition matches "probe.defs/timeout-ms"; used at src/probe/core.clj:5 but no definition was found
[... trimmed ...]
ROUTE_AUTHZ GET /hello — no route matches "GET /hello"
[... trimmed ...]
```

把下面这个 `.clojure-atlas.edn` 放在项目根目录并重新构建。两个键都是把完全限定的宏映射到
它所等同的完全限定形式：

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

（第一个回答是带 `include_references: true` 的 `callers`，因为 `timeout-ms` 是一个值，而不是函数。）
`:lint-as` 也可以放在项目的 `.clj-kondo/config.edn` 中，使用 clj-kondo 自己的格式，结果相同；
`:route-macros` 只存在于 `.clojure-atlas.edn`：

```clojure
{:lint-as {probe.defs/defsetting clojure.core/def}}
```

## 工具

下面的每个示例都是 `clojure-atlas mcp` 在 [examples/](examples/) 中某个图上的真实输出，
只在标注处做了截断。mount 在多个文件中定义了四个命名空间，因此它的回答以一行 `DEGRADED` 开头（见下一节）。
`[S]`、`[H]` 和 `[?]` 是 band，将在下一节说明。

### graph_info

图描述的是哪个提交，每个适配器找到了什么，并附各 band 的数量。问题：integrant 的图知道什么？

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

某个定义的直接调用者。问题：谁调用 `integrant.core/dependent-keys`？

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

加上 `include_references: true` 后，还会列出值引用、回调、已注册的处理器、宏展开、
分派候选和重新绑定。在带 syntax-quote 的宏体中被点名的 var（compojure 的 `defroutes` 点名 `routes`）是
HEURISTIC 引用，而不是调用。

### blast_radius

某个定义的传递依赖方。问题：修改 `integrant.core/ref?` 会影响到哪里？

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

参数个数（arity）、解构的键，以及每个调用者传入的内容。问题：`integrant.core/init` 是如何被调用的？

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

在 diff 模式下（`base_graph`，或 `added_keys` / `removed_keys` / `arities`），它会列出
签名变更所影响的调用者。

### route_authz

后端路由的处理器、中间件链和权限检查。问题：polylith-realworld 中谁处理 `POST /api/articles`，哪些中间件包裹着它？

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

第 11 行在下一页，是授权中间件，通过 compojure 的 `wrap-routes` 应用：

```
  11. clojure.realworld.rest-api.middleware/wrap-authorization  bases/rest-api/src/clojure/realworld/rest_api/api.clj:45 [H]  heuristic match  (#10 wrapper)
```

当路由的包装无法读取时，该部分会明确说明，而不是写 “none”（usermanager，`GET /user/list`）：

```
GET /user/list @usermanager.main/my-handler (base usermanager.main/my-handler): middleware: not extracted (UNKNOWN)
```

路由表之外包装的中间件按 HEURISTIC 读取：Ring 的包装、`->`、`->>`、嵌套调用、`wrap-routes`，以及 reitit 的
`ring-handler` 的外层包装和第三个参数 `{:middleware [...]}`。在那里找到的权限中间件算作一次检查。reitit 和 pedestal
路由数据中的中间件（`:middleware`、`:interceptors`）则直接从路由本身读取。当包装无法被完整读取时，route_authz 会说
`no permission check found in what could be read (...); not provable that none exists`。没有任何路由器触及的路由树，
其中间件显示为 UNKNOWN；目前每条 pedestal 路由都是如此，因为 pedestal service map 的 interceptor 不会被读取。图无法解析的
handler 显示为 `handler: not resolved (UNKNOWN)`。这里的权限结论是 “not provable”，因为该项目没有在
`.clojure-atlas.edn` 中声明任何授权模型。
### permission_routes

所有检查某项权限的路由。问题：mount 中哪些路由要求 `:admin`？

```
DEGRADED: 4 namespace(s) defined in more than one file (app.conf, app.example, tapp.conf, ...) share one node each, so calls into them are heuristic; an empty or missing answer may be a gap in the graph, not absence
PERMISSION_ROUTES :admin — no permission matches ":admin"
note: capability route_authz is absent: an empty answer is not proof of absence
note: use the exact permission name, with its namespace if it has one
searched: names, ids and kind-prefixed ids; check the spelling or pass the fully qualified name
```

### attribute_usage

某个 Datomic、datascript 或 XTDB 属性的已证明读取方和写入方。问题：在 mount 的示例应用中谁写入 `:order/bid`？

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

re-frame 事件的分发方和处理器，或订阅的处理器、输入和订阅方。事件不是字面量关键字的分发会被列为 UNKNOWN。问题：在 re-frame 的 todomvc 中谁分发 `:delete-todo`？

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

直接或在深度 3 以内到达某个定义的单元测试。问题：哪些测试会执行
`usermanager.model.user-manager/get-user-by-id`？

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

到达某个文件、定义、选择器或路由的浏览器测试（Playwright 的页面对象和测试，当 TypeScript 5 作为可选的 peer 依赖 `typescript` 安装在 clojure-atlas 旁边时用它读取；绝不使用被分析仓库自带的副本）。
示例仓库都没有这类测试，回答中也会这样说明。问题：哪些浏览器测试会到达 `mount.core/start`？

```
DEGRADED: 4 namespace(s) defined in more than one file (app.conf, app.example, tapp.conf, ...) share one node each, so calls into them are heuristic; an empty or missing answer may be a gap in the graph, not absence
TESTS_COVERING mount.core/start — 0 browser test(s) in 0 spec file(s)
note: capability selectors is available but not used (nothing in this codebase switches it on): an empty answer is not proof of absence
note: capability browser_tests is available but not used (nothing in this codebase switches it on): an empty answer is not proof of absence
note: no browser test reaches this target through selectors, page objects or requests
tests: none (searched: selector, page-object and request edges)
```

### key_flow

某个 map 键的生产方和消费方。问题：compojure 的请求键 `:compojure/path` 在哪里被写入、在哪里被读取？

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

字面量 map 表中，缺少多数同级行都有的某个键的行。问题：re-frame 的
`test/re_frame/subs/alpha_test.cljs` 表中是否有行缺少某个键？

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

缺少该键是已证明的；这一行是否应该有该键，留给读者判断。

### context_for_change

每次评审只需一次调用：变更的符号、diff 之外的调用者、路由、属性、需要运行的测试和需要补充的测试。
当变更的路由没有提取到授权时，风险是 UNKNOWN，而不是 LOW。
不在图中的路径会显示为 `no such file in the graph`，所有部分都显示为 `not checked`；格式错误的条目会被拒绝。问题：修改 polylith-realworld 中 article store 的第 60-80 行会涉及什么？

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

每个工具还接受 `base`（代理所查看的提交）、分页（`offset`、`limit`、`section`）和
`group_by`（`component`、`file`、`none`）。更多示例记录见 [examples/README.md](examples/README.md)。

## Band 与“无结果”

每一行都有一个 band：

- **STATIC_PROVEN** `[S]`：分析器解析了两端（clj-kondo 解析了该 var，或字面形式就在源码中）。
- **HEURISTIC** `[H]`：名称匹配、线程化的槽位或分派候选。据此行动前，请先打开引用的那一行。
  例如：从 defmulti 到达的 defmethod（具体用哪个方法由分派值在运行时决定）、key table 的 finding。
- **UNKNOWN** `[?]`：无法静态判定，因此作为边界列出，不会继续追踪。
  例如：`binding` 和 `with-redefs` 造成的重新绑定、角色（读或写）未被证明的属性关键字、
  signature_impact 中对 `apply` 或 `partial` 的使用。

`counts:` 行给出各 band 的总数，例如 `callers=4 [S4]` 或 `findings=2 [H2]`。

空回答不会只是一个空列表。它属于下列形式之一：

- **none**：该对象存在，但没有任何东西与它相关。`callers: none (searched: call edges into this definition)`。
- **not found**：代码库中没有这个对象。`no definition matches "integrant.core/stop"`。
- **capability off**：图无法回答，因为负责该类事实的适配器没有找到可提取的内容，或未被配置。
  `capability route_authz is absent: an empty answer is not proof of absence`。依赖它的部分会显示为
  `not extracted (route_authz is absent)`，绝不会是 “none”。无法读取的中间件链显示为 `not extracted (UNKNOWN)`。

当图本身不完整时，构建日志、graph_info 和每个回答都以一行 `DEGRADED` 开头。它会列出 clj-kondo 完全无法解析的文件、
已恢复但存在语法错误的文件（其中可能缺少一些形式）、未被读取的受跟踪文件及原因（隐藏文件夹或构建文件夹、符号链接、已删除的文件）、
被跳过的超过 2 MB 的文件（对于 `.edn` 文件，其数据、键和配置会缺失）、在多个文件中定义的命名空间（对它们的使用是 HEURISTIC，通过 `duplicate-namespace`），
以及因一端不是节点而被丢弃的边。未找到的名字若很可能位于这样的文件中，会指明该文件。
下面是 shadow-cljs 的例子，其中有一个文件无法解析：

```
DEGRADED: 1 file(s) could not be parsed (src/dev/demo/test_fail.cljs), so their definitions and calls are missing; 2 file(s) have syntax errors but were analyzed (src/dev/demo/errors.cljs, src/main/shadow/cljs/devtools/config.clj); some forms in them may be missing; 1 namespace(s) defined in more than one file (demo.http) share one node each, so calls into them are heuristic; an empty or missing answer may be a gap in the graph, not absence
CALLERS demo.test-fail/a-failing-test — no definition matches "demo.test-fail/a-failing-test"
note: demo.test-fail/a-failing-test probably lives in src/dev/demo/test_fail.cljs, which could not be parsed: its definitions are not in the graph, so this is not a spelling problem
note: use a fully qualified name (ns/name)
```

下面是 biff 的例子，其文件有语法错误但已被分析：回答首先指向该文件中 clj-kondo 无法读取的形式，其次是宏，并保留拼写提示：

```
DEGRADED: 1 file(s) have syntax errors but were analyzed (libs/sqlite/src/com/biffweb/sqlite/impl/execute.clj); some forms in them may be missing; 1 namespace(s) defined in more than one file (tasks) share one node each, so calls into them are heuristic; an empty or missing answer may be a gap in the graph, not absence
CALLERS com.biffweb.sqlite.impl.execute/execute — no definition matches "com.biffweb.sqlite.impl.execute/execute"; used at libs/sqlite/src/com/biffweb/sqlite.clj:110, libs/sqlite/src/com/biffweb/sqlite.clj:121, libs/sqlite/src/com/biffweb/sqlite/impl/kv.clj:23, libs/sqlite/src/com/biffweb/sqlite/impl/kv.clj:30, libs/sqlite/src/com/biffweb/sqlite/impl/kv.clj:44 but no definition was found
note: com.biffweb.sqlite.impl.execute/execute is used at libs/sqlite/src/com/biffweb/sqlite.clj:110, libs/sqlite/src/com/biffweb/sqlite.clj:121, libs/sqlite/src/com/biffweb/sqlite/impl/kv.clj:23, libs/sqlite/src/com/biffweb/sqlite/impl/kv.clj:30, libs/sqlite/src/com/biffweb/sqlite/impl/kv.clj:44 but no definition was found: probably a form clj-kondo could not read in the file with syntax errors named below, or a macro clj-kondo cannot expand; add :lint-as for the macro in .clj-kondo/config.edn
note: com.biffweb.sqlite.impl.execute/execute may live in libs/sqlite/src/com/biffweb/sqlite/impl/execute.clj, which has syntax errors; some forms may be missing, so besides a spelling problem a form kondo could not read is possible
note: use a fully qualified name (ns/name)
```

如果找不到的名称很可能位于 clj-kondo 运行超时的文件中，或位于 git 跟踪但构建未分析的文件中，回答会以同样的方式点出该文件。

被使用但在任何地方都没有定义的名称，通常是由 clj-kondo 无法展开的宏生成的。回答会指出它在哪里被使用以及该添加什么。以 next.jdbc 为例：

```
CALLERS next.jdbc.types/as-other — no definition matches "next.jdbc.types/as-other"; used at test/next/jdbc/sql_test.clj:290, test/next/jdbc_test.clj:559 but no definition was found
note: next.jdbc.types/as-other is used at test/next/jdbc/sql_test.clj:290, test/next/jdbc_test.clj:559 but no definition was found: probably defined by a macro clj-kondo cannot expand; add :lint-as for the macro in .clj-kondo/config.edn
note: use a fully qualified name (ns/name)
```

请把未命中理解为对覆盖范围的陈述，而不是某物不存在的证明。

## [覆盖率](docs/COVERAGE.md)

[docs/COVERAGE.md](docs/COVERAGE.md) 度量了 26 个公开仓库，每个仓库都固定在
[corpus.json](corpus.json) 中的一个 sha。核心指标名为 **resolution rate**（解析率）：
在 clj-kondo 归属到项目 namespace 的 var 使用中，图能链接到定义的比例。
库 var 的使用不计入。clj-kondo 无法归属到任何 namespace 的符号，
以原始计数 **unknown namespace** 单独报告，不计入该比率。

26 个仓库中有 24 个达到或超过 95%。低于该值的两个如下：

| repo | resolved | unresolved | resolution rate | unknown namespace |
|---|---|---|---|---|
| datascript | 4392 | 496 | 89.9% | 1255 |
| day-of-datomic | 84 | 29 | 74.3% | 1 |

文档对这两个仓库的解释如下：

> **unresolved**: a var created by a project macro clj-kondo does not know (datascript's record constructors), or
> a name in a REPL script with no ns form that clj-kondo files under a namespace not defining it (day-of-datomic's
> tutorials).

译文：**unresolved** 指由 clj-kondo 不认识的项目宏创建的 var（datascript 的 record 构造函数），
或没有 ns 形式的 REPL 脚本中的名称，clj-kondo 把它归到了并未定义它的 namespace 之下
（day-of-datomic 的教程）。

另有 6 个仓库也被列出，因为它们的 unknown namespace 数量超过 resolved 的 5%：
babashka、cider-nrepl、fulcro、pedestal、shadow-cljs 和 usermanager。表中只保留一位小数，
所以 100.0% 仍可能包含少量未解析的使用（metabase 111、penpot 13、xtdb-v1 3）。
当仓库为其宏提供 clj-kondo 配置，或在 `.clojure-atlas.edn` 中用 `:lint-as` 指明这些宏时，
两类数字都会减少。corpus 的度量没有添加其中任何一种。

## 基准测试

[docs/BENCHMARK.md](docs/BENCHMARK.md) 包含 21 个关于 corpus 仓库的问题。每个预期答案都不借助工具、
在源码中手工核对过，其 file:line 记录在 [bench/questions.json](bench/questions.json) 中。

- **肯定类问题：14 题全部通过。** 回答列出了所有预期的定义且没有其他内容，才算通过。
  找到的预期项：40 个中的 40 个；回答的项：40 个。
- **无结果类问题：7 题全部通过。** 正确答案是“没有”（*none*、*not-found*、*used-undefined* 或 *capability-off*），
  回答必须明确说出这种无结果的类型，且不得列出任何内容。

前十二道肯定类问题在首次运行之前就已确定，首次运行得分为 12 题中的 11 题。未通过的一题
（通过 `re-frame.alpha` 的 re-frame 注册）已用 fixture 在构建器中修复，该问题保持原样。之后又新增了两题，分别针对
compojure 中间件链（q13）和 reitit 前端路由（q14）。
没有任何 MCP 工具列出客户端路由，因此 q14 是通过直接读取图的节点来评分的：14 道肯定类问题中有
13 道的答案来自工具。

## 要求

- Node.js 22.18 或更高版本。无需 JVM，无需 babashka，无需全局安装。
- 首次 `build` 时，会一次性下载 clj-kondo 2025.10.23。
  它取自 [clj-kondo 官方发布](https://github.com/clj-kondo/clj-kondo/releases)，用固定的 sha256 校验，
  并缓存在 `$XDG_CACHE_HOME/clojure-atlas`（默认 `~/.cache/clojure-atlas`；Windows 上为
  `%LOCALAPPDATA%\clojure-atlas`）。首次运行会打印：

  ```
  clojure-atlas: downloading clj-kondo 2025.10.23 (macos-aarch64) once, to <cache>/clojure-atlas/clj-kondo-2025.10.23-macos-aarch64/clj-kondo
  ```

- 离线或处于代理之后：请把 `clj-kondo` 放到 PATH 中。Node 的 `fetch` 会忽略 `HTTPS_PROXY`，
  所以在代理之后下载会失败，此时 clojure-atlas 会使用 PATH 上的 clj-kondo。sha256 不匹配的下载会被拒绝，
  绝不会运行。
- 可选：TypeScript 5（在 clojure-atlas 旁执行 `npm i -D typescript@5`），用于读取 Playwright 页面对象和测试。
  它是可选的 peer 依赖。没有它，这种读取会关闭，graph_info 和浏览器测试的回答会针对找到的每个 Playwright 项目说明原因。
- 有固定 clj-kondo 二进制文件的平台：macOS arm64、macOS x64、Linux x64、Linux arm64、Windows x64。
  其他平台需要把 clj-kondo 放到 PATH 中。本版本在 macOS arm64 上开发和度量。Windows 未经测试。

## 安全

构建只读取文件。它只运行 clj-kondo（固定的二进制文件，或 PATH 上的那个）和 `git ls-files`，
绝不会用 Node、JVM 或 shell 运行被分析仓库的代码。TypeScript 从 clojure-atlas 自己的安装中加载，
绝不从被分析的仓库中加载。clj-kondo 会应用项目的 `.clj-kondo` 配置；其中声明的 hook 由 clj-kondo 自己解释，
与任何运行 clj-kondo 的编辑器一样。MCP 服务器只读取图文件，指定 `--repo` 时运行只读的 git 命令。每次 git 调用都会忽略仓库自身那些会运行命令的设置（`core.fsmonitor`、filter driver、hook），
从不弹出提示，并且有超时。每次 clj-kondo 运行同样有超时：一个永不返回的 hook 只会让它所在的批次失效（列在 DEGRADED 下），而不会让整个构建失败。git 绝不会在子模块内运行（clojure-atlas 无法关闭子模块自身的配置），因此子模块的文件始终算作已更改。
这两个程序都从在 PATH 上找到的绝对路径启动，绝不从被分析的目录启动，项目的 clj-kondo `:output` 和 `:analysis` 设置会被图所需的设置替换。

## 为什么用 TypeScript？

因为 `npx` 开箱即用：无需安装 JVM，也无需在用户的机器上编译任何东西。Clojure 的分析本身由
clj-kondo 完成；clojure-atlas 读取它的输出和源码形式，并构建图。欢迎用任一种语言贡献适配器：
适配器由一个小型 Clojure fixture 和由它预期产生的图行来定义，
所以你可以用 Clojure 描述某个库的语义，再由别人移植，也可以自己写 TypeScript。

## 限制

- **仅静态分析。** 在运行时才解析的 var 不会被追踪。对字面量符号做 `requiring-resolve`、`resolve` 或 `ns-resolve` 是 HEURISTIC 引用；
  在运行时构造的符号，或由数据选择的函数则不是，当项目动态解析 var 时，callers 和 blast_radius 会如此说明。
  只以动态方式读写的 map 键不会被追踪。通过多方法、`resolve`/`apply` 或 HTTP fixture 到达代码的测试不计入。
- **启发式部分**：多方法和协议的分派（`may_dispatch_to`）、部分 compojure 处理器（显示为 `heuristic match`）、
  compojure 和 Ring 的中间件链、中间件工厂调用、未 require reitit 的命名空间中的 reitit 前端路由表（只要项目中任何地方
  使用了 `reitit.frontend` 就会读取）、在 syntax-quote 宏体中被点名的 var、clj-kondo 无法展开的项目宏内部的使用（通过 `unexpanded-macro`）、
在多个文件中定义的命名空间的使用（通过 `duplicate-namespace`）、线程化的键槽位、transact 或 query 调用之外的
  查询字面量、key_siblings 的 finding。
- **项目宏**：只有当项目的 `.clj-kondo` 配置为某个宏提供了 `:lint-as` 或 hook（或 `.clojure-atlas.edn` 在 `:lint-as` 下点名了它）时，
  clj-kondo 才会展开它。添加其中之一并重新构建，其内部的使用就会重新成为 STATIC_PROVEN。参见[项目配置](#project-configuration)。
- **包装无法读取的中间件**会报告为 `middleware: not extracted (UNKNOWN)`，而不是 “none”。
- **无法解析的文件和超过 2 MB 的文件**：它们的定义和调用不在图中。此时每个回答都以一行 `DEGRADED` 开头，并列出这些文件。
- **Pedestal service map 的 interceptor** 不会被读取，因此每条 pedestal 路由的中间件都是 UNKNOWN。
- **路由授权**需要 `.clojure-atlas.edn`。没有它时，route_authz 回答 “not provable”，
  permission_routes 报告该 capability 为 absent。
- **尚不支持**：bidi 路由、compojure-api、pedestal 的 verbose map 路由、malli 注册表、
  没有 ref 的 integrant 系统。参见 [ROADMAP.md](ROADMAP.md)。
- **datascript 和 day-of-datomic** 的解析率较低（89.9% 和 74.3%）：datascript 通过 clj-kondo 不认识的宏定义 record 构造函数；
  day-of-datomic 的教程是没有 ns 形式的 REPL 脚本。参见[覆盖率](docs/COVERAGE.md)。
- **Unknown namespace 的符号**（由未知宏绑定的局部变量、deftype 或 proxy 的字段）会被计数，但不会被链接。
- **没有增量构建或 watch。** 修改后请重新构建；服务器在能够判断时会用 `STALE` 发出警告。
- **Windows 未经测试。** 下载 clj-kondo 时不支持代理。

## 贡献

```sh
npm ci
npm test                                    # all tests
npm run test:coverage                       # the gate: 98% line coverage of src/
npm run typecheck
node scripts/coverage.ts <corpus-dir>       # rebuilds docs/COVERAGE.md from clones at the corpus.json shas
node bench/score.ts <corpus-dir>            # scores the benchmark questions
```

要添加或扩展适配器，先从 fixture 开始：在 `test/fixtures/<name>/` 下放一个小型 Clojure 代码库，
再写一个 `expected.txt`，列出它必须产生的每一行图数据，并对照源码手工审阅。
把它列入 `test/build-fixtures.test.ts`，然后在 `src/build/adapters/` 中编写适配器，直到各行一致。
参见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 致谢

- [clj-kondo](https://github.com/clj-kondo/clj-kondo)（作者 Michiel Borkent）负责 Clojure 分析。
- [Model Context Protocol](https://modelcontextprotocol.io) 是代理与服务器通信的方式。
- corpus 中的仓库及其作者；覆盖率和基准测试都是在他们的公开代码上度量的。

## 许可证

MIT。参见 [LICENSE](LICENSE)。作者是 Barış Can Ateş。
