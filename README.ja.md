# clojure-atlas

> 最新の機能、対応技術、インストール方法、セキュリティモデルは[メインの README](README.md)をご覧ください。パッケージはまだ npm に公開されていないため、以下では Git からインストールします。リポジトリが非公開の間はアクセス権が必要です。

**For the sake of all Clojurians.**

*すべての Clojurian のために。*

[English](README.md) | [Türkçe](README.tr.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Português (Brasil)](README.pt-BR.md) | 日本語 | [简体中文](README.zh-CN.md)

Clojure、ClojureScript、.cljc のコードベースの構造マップです。MCP ツールとして AI コーディングエージェントに提供します。
エージェント開発のために作られました。MIT ライセンスです。作者は Barış Can Ateş です。

## 概要

Clojure を編集するエージェントは、たいていテキスト検索で関係を探します。テキスト検索には次のことができません。
呼び出しと同名のキーワードの区別、`reg-event-fx` で登録されたハンドラ、var に到達するルート、`partial` に渡された関数の検出、
そして「これを呼ぶものはない」と確信を持って言うことです。clojure-atlas はプロジェクトに対して
[clj-kondo](https://github.com/clj-kondo/clj-kondo) を一度実行し、その解析結果をグラフにします
(定義、呼び出し、値としての使用、re-frame イベント、ルート、システムキー、データ属性、マップキー、テスト)。
グラフに関する質問には MCP 経由で答えます。回答の各行には、どのように証明されたかを示す band が付きます。
回答が空の場合は、何を検索したか、グラフがそもそも知り得るかどうかを説明します。

## クイックスタート

```sh
npm install --save-dev \
  'git+https://github.com/Bariscanates404/clojure-atlas.git#8634d33e3ed59d420eead61a9c596f752d1fe789'
npx clojure-atlas build
npx clojure-atlas init
```

`build` は `.clojure-atlas/graph.json.gz` を書き出します。integrant リポジトリでは次のように出力されます。

```
clojure-atlas: 7 files, 138 definitions, 296 nodes, 1481 edges; resolution rate of var usages in recognized project namespaces 100.0% (442 of 442), 0 usages in an unknown namespace; 0.7 s -> .clojure-atlas/graph.json.gz
```

`init` は書き込む予定のプロジェクトの `.mcp.json` を表示します。実際に書き込むのは `--yes` を付けたときだけです。

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

`.mcp.json` にすでにある他のサーバーは残ります。

### Claude Code

`npx clojure-atlas init --yes` は、Claude Code が読み込むプロジェクトの `.mcp.json` を書き込みます。手動でサーバーを追加することもできます。

```sh
claude mcp add clojure-atlas -- npx clojure-atlas mcp --graph .clojure-atlas/graph.json.gz --repo .
```

### その他の MCP クライアント

サーバーは stdio 上で MCP を話します。多くのクライアントは次の JSON を受け付けます。

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

### コマンド

```
usage:
  clojure-atlas build [dir] [-o .clojure-atlas/graph.json.gz]
  clojure-atlas mcp [--graph .clojure-atlas/graph.json.gz] [--repo <clone>] [--max-distance N]
  clojure-atlas coverage [graph]
  clojure-atlas init [--yes]
```

- `build` は `dir` (デフォルトは `.`) を解析し、グラフを書き出します。
- `mcp` はグラフを提供します。`--repo` を指定すると、作業ツリーがグラフの作成元と異なる場合、
  またはエージェントが `base` として渡したコミットが、グラフのコミットから `--max-distance` コミット (デフォルトは 20) より
  先に進んでいる場合、あるいはグラフのコミットが `base` より先にある場合や `base` から分岐している場合に、回答が `STALE` 行で始まります。
  作業ツリーのチェックは最大でも 3 秒に 1 回だけ繰り返されるため、編集はその後の最初の呼び出しから反映されます。
- `coverage` はグラフの coverage 行と、未解決の名前のうち出現回数の多いものを表示します。
- `init` はサーバーをプロジェクトの `.mcp.json` に追加します。

コードを変更したらグラフを再構築してください。提供中のグラフは自動では更新されません。

```
STALE: the working tree is not the snapshot this graph describes (2 uncommitted file(s) now, 1 at build); rebuild with clojure-atlas build.
```

プロジェクト自身の `.clj-kondo` 設定は尊重されます。プロジェクトルートに任意で `.clojure-atlas.edn` を置くと、
汎用アダプタが推測できない情報を追加できます。def に似たマクロ用の `:lint-as`、`:route-macros`、
そしてルート認可のキーである `:route-authz`、`:permission-middleware`、`:permission-fns` です。

<a id="project-configuration"></a>
### プロジェクト設定

プロジェクトのマクロで作られた var と、プロジェクトのマクロで書かれたルートは、そのマクロに名前を付けるまで見えません。
このマクロとルートを持つ小さな検証用プロジェクトを例にします。

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

設定がないと、その var は使われているのに定義がなく、ルートも存在しないことになります。

```
CALLERS probe.defs/timeout-ms — no definition matches "probe.defs/timeout-ms"; used at src/probe/core.clj:5 but no definition was found
[... trimmed ...]
ROUTE_AUTHZ GET /hello — no route matches "GET /hello"
[... trimmed ...]
```

次の `.clojure-atlas.edn` をプロジェクトルートに置いて再構築します。どちらのキーも、完全修飾したマクロを、
そのマクロが振る舞いを真似る完全修飾の形式に対応付けます。

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

(最初の回答は `include_references: true` を付けた `callers` です。`timeout-ms` は関数ではなく値だからです。)
`:lint-as` は、プロジェクトの `.clj-kondo/config.edn` に clj-kondo 自身の形式で置くこともでき、結果は同じです。
`:route-macros` は `.clojure-atlas.edn` にしか存在しません。

```clojure
{:lint-as {probe.defs/defsetting clojure.core/def}}
```

## ツール

以下の例はすべて、[examples/](examples/) にあるグラフに対する `clojure-atlas mcp` の実際の出力です。
省略した箇所にだけ印を付けています。mount は 4 つの namespace を複数のファイルに分けて定義しているため、その回答は `DEGRADED` 行で
始まります (次のセクションを参照)。`[S]`、`[H]`、`[?]` は band で、次のセクションで説明します。

### graph_info

グラフがどのコミットを表すか、各アダプタが何を見つけたかを、band ごとの件数付きで返します。質問: integrant のグラフは何を知っているか。

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

定義の直接の呼び出し元です。質問: `integrant.core/dependent-keys` を呼ぶのは誰か。

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

`include_references: true` を付けると、値としての使用、コールバック、登録済みハンドラ、マクロ展開、
ディスパッチ候補、再束縛も一覧に含まれます。syntax-quote されたマクロ本体の中で名前が挙がった var (compojure の
`defroutes` が `routes` を指す場合) は、呼び出しではなく HEURISTIC な参照です。

### blast_radius

定義の推移的な依存元です。質問: `integrant.core/ref?` を変更すると何に影響するか。

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

アリティ、分割代入されるキー、各呼び出し元が渡す値です。質問: `integrant.core/init` はどのように呼ばれているか。

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

diff モード (`base_graph`、または `added_keys` / `removed_keys` / `arities`) では、シグネチャの変更が
影響する呼び出し元を一覧にします。

### route_authz

バックエンドルートのハンドラ、ミドルウェアチェーン、権限チェックです。質問: polylith-realworld で `POST /api/articles` を処理するのは何か。それを包むミドルウェアは何か。

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

次のページにある 11 行目が認可ミドルウェアで、compojure の `wrap-routes` で適用されています。

```
  11. clojure.realworld.rest-api.middleware/wrap-authorization  bases/rest-api/src/clojure/realworld/rest_api/api.clj:45 [H]  heuristic match  (#10 wrapper)
```

ルートのラップを読み取れない場合、セクションは「none」ではなくそう表示します (usermanager、`GET /user/list`)。

```
GET /user/list @usermanager.main/my-handler (base usermanager.main/my-handler): middleware: not extracted (UNKNOWN)
```

ルートテーブルの外側でラップされたミドルウェアは HEURISTIC として読み取ります。Ring のラップ、`->`、`->>`、ネストした呼び出し、
`wrap-routes`、そして reitit の `ring-handler` の外側のラップと第 3 引数の `{:middleware [...]}` です。そこで見つかった
権限ミドルウェアはチェックとして数えます。reitit と pedestal のルートデータ内のミドルウェア
(`:middleware`、`:interceptors`) は、ルート自体から読み取ります。ラップを最後まで読み取れなかった場合、route_authz は
`no permission check found in what could be read (...); not provable that none exists` と答えます。どのルーターからも
到達されないルートツリーは、そのミドルウェアが UNKNOWN と表示されます。現状ではすべての pedestal ルートがこれに当たります。
pedestal の service map の interceptor は読み取らないためです。グラフが解決できないハンドラーは
`handler: not resolved (UNKNOWN)` と表示されます。ここでの権限の判定は "not provable" です。このプロジェクトは
`.clojure-atlas.edn` で認可モデルを宣言していないためです。
### permission_routes

権限をチェックするすべてのルートです。質問: mount のどのルートが `:admin` を要求するか。

```
DEGRADED: 4 namespace(s) defined in more than one file (app.conf, app.example, tapp.conf, ...) share one node each, so calls into them are heuristic; an empty or missing answer may be a gap in the graph, not absence
PERMISSION_ROUTES :admin — no permission matches ":admin"
note: capability route_authz is absent: an empty answer is not proof of absence
note: use the exact permission name, with its namespace if it has one
searched: names, ids and kind-prefixed ids; check the spelling or pass the fully qualified name
```

### attribute_usage

Datomic、datascript、XTDB の属性について、証明済みの読み手と書き手です。質問: mount のサンプルアプリで `:order/bid` を書くのは誰か。

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

re-frame イベントのディスパッチ元とハンドラ、またはサブスクリプションのハンドラ、入力、購読元です。イベントがリテラルのキーワードではないディスパッチは UNKNOWN として一覧に出ます。質問: re-frame の todomvc で `:delete-todo` をディスパッチするのは誰か。

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

定義に直接、または深さ 3 まで到達するユニットテストです。質問: `usermanager.model.user-manager/get-user-by-id` を実行するテストはどれか。

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

ファイル、定義、セレクタ、ルートに到達するブラウザテストです (Playwright のページオブジェクトとテスト。オプションのピア依存 `typescript` として clojure-atlas の隣にインストールされている場合に TypeScript 5 で読み取ります。解析対象リポジトリのコピーは使いません)。
サンプルのリポジトリにはどれもブラウザテストがなく、回答もそう伝えます。質問: `mount.core/start` に到達するブラウザテストはどれか。

```
DEGRADED: 4 namespace(s) defined in more than one file (app.conf, app.example, tapp.conf, ...) share one node each, so calls into them are heuristic; an empty or missing answer may be a gap in the graph, not absence
TESTS_COVERING mount.core/start — 0 browser test(s) in 0 spec file(s)
note: capability selectors is available but not used (nothing in this codebase switches it on): an empty answer is not proof of absence
note: capability browser_tests is available but not used (nothing in this codebase switches it on): an empty answer is not proof of absence
note: no browser test reaches this target through selectors, page objects or requests
tests: none (searched: selector, page-object and request edges)
```

### key_flow

ひとつのマップキーの生成側と消費側です。質問: compojure のリクエストキー `:compojure/path` はどこで書かれ、どこで読まれるか。

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

リテラルのマップテーブルで、ほとんどの兄弟行が持つキーを欠いている行です。質問: re-frame の `test/re_frame/subs/alpha_test.cljs` のテーブルに、キーが欠けた行はあるか。

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

キーが欠けていることは証明済みです。その行にキーがあるべきかどうかは、読み手の判断に任せます。

### context_for_change

レビューごとに 1 回の呼び出しで、変更されたシンボル、diff 外の呼び出し元、ルート、属性、実行すべきテスト、追加すべきテストを返します。
変更されたルートに抽出された認可がない場合、リスクは LOW ではなく UNKNOWN になります。
グラフにないパスは `no such file in the graph` と表示され、すべてのセクションが `not checked` になります。不正な形式のエントリは拒否されます。質問: polylith-realworld の article ストアの 60-80 行目を変更すると何に影響するか。

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

どのツールも `base` (エージェントが見ているコミット)、ページング (`offset`、`limit`、`section`)、
`group_by` (`component`、`file`、`none`) を受け付けます。その他の実行例は [examples/README.md](examples/README.md) にあります。

## Band と不在

すべての行に band がひとつ付きます。

- **STATIC_PROVEN** `[S]`: アナライザが両端を解決しました (clj-kondo が var を解決したか、リテラルの形がソースにあります)。
- **HEURISTIC** `[H]`: 名前の一致、スレッドされたスロット、またはディスパッチ候補です。この行に基づいて動く前に、引用された行を開いて確認してください。
  例: defmulti から到達する defmethod (どのメソッドになるかはディスパッチ値によって実行時に決まります)、key table の finding。
- **UNKNOWN** `[?]`: 静的には決められないため、境界として一覧に出し、辿りません。
  例: `binding` と `with-redefs` による再束縛、役割 (読み取りか書き込みか) が証明されていない属性キーワード、
  signature_impact での `apply` や `partial` の使用。

`counts:` 行は band ごとの合計を示します。たとえば `callers=4 [S4]` や `findings=2 [H2]` です。

空の回答が、単なる空のリストになることはありません。次のいずれかの形を取ります。

- **none**: 対象は存在し、それに関係するものがありません。`callers: none (searched: call edges into this definition)`。
- **not found**: コードベースにそのようなものがありません。`no definition matches "integrant.core/stop"`。
- **capability off**: グラフが答えられません。その種類の事実を扱うアダプタが、抽出するものを見つけられなかったか、設定されていません。
  `capability route_authz is absent: an empty answer is not proof of absence`。その capability に依存するセクションは
  `not extracted (route_authz is absent)` と表示され、「none」にはなりません。読み取れないミドルウェアチェーンは
  `not extracted (UNKNOWN)` と表示されます。

グラフ自体が不完全なとき、ビルドログ、graph_info、すべての回答は `DEGRADED` 行で始まります。この行には、clj-kondo がまったく解析できなかった
ファイル、復旧したものの構文エラーがあったファイル (一部の form が欠けている可能性があります)、読み取られなかった追跡対象ファイルとその理由
(隠しフォルダやビルドフォルダ、シンボリックリンク、削除されたファイル)、スキップされた 2 MB を超えるファイル (`.edn` ファイルでは、そのデータ、キー、設定が欠けます)、
複数のファイルで定義されている namespace (その使用は `duplicate-namespace` により HEURISTIC になります)、
端が node でなかったために落ちたエッジが挙がります。見つからなかった名前がそのようなファイルに存在すると思われる場合は、そのファイルが示されます。
1 つのファイルを解析できない shadow-cljs の例です。

```
DEGRADED: 1 file(s) could not be parsed (src/dev/demo/test_fail.cljs), so their definitions and calls are missing; 2 file(s) have syntax errors but were analyzed (src/dev/demo/errors.cljs, src/main/shadow/cljs/devtools/config.clj); some forms in them may be missing; 1 namespace(s) defined in more than one file (demo.http) share one node each, so calls into them are heuristic; an empty or missing answer may be a gap in the graph, not absence
CALLERS demo.test-fail/a-failing-test — no definition matches "demo.test-fail/a-failing-test"
note: demo.test-fail/a-failing-test probably lives in src/dev/demo/test_fail.cljs, which could not be parsed: its definitions are not in the graph, so this is not a spelling problem
note: use a fully qualified name (ns/name)
```

構文エラーがあるものの解析されたファイルを持つ biff の例です。回答はまずそのファイル内で clj-kondo が読めなかったフォームを、次にマクロを原因として挙げ、つづりのヒントも残します。

```
DEGRADED: 1 file(s) have syntax errors but were analyzed (libs/sqlite/src/com/biffweb/sqlite/impl/execute.clj); some forms in them may be missing; 1 namespace(s) defined in more than one file (tasks) share one node each, so calls into them are heuristic; an empty or missing answer may be a gap in the graph, not absence
CALLERS com.biffweb.sqlite.impl.execute/execute — no definition matches "com.biffweb.sqlite.impl.execute/execute"; used at libs/sqlite/src/com/biffweb/sqlite.clj:110, libs/sqlite/src/com/biffweb/sqlite.clj:121, libs/sqlite/src/com/biffweb/sqlite/impl/kv.clj:23, libs/sqlite/src/com/biffweb/sqlite/impl/kv.clj:30, libs/sqlite/src/com/biffweb/sqlite/impl/kv.clj:44 but no definition was found
note: com.biffweb.sqlite.impl.execute/execute is used at libs/sqlite/src/com/biffweb/sqlite.clj:110, libs/sqlite/src/com/biffweb/sqlite.clj:121, libs/sqlite/src/com/biffweb/sqlite/impl/kv.clj:23, libs/sqlite/src/com/biffweb/sqlite/impl/kv.clj:30, libs/sqlite/src/com/biffweb/sqlite/impl/kv.clj:44 but no definition was found: probably a form clj-kondo could not read in the file with syntax errors named below, or a macro clj-kondo cannot expand; add :lint-as for the macro in .clj-kondo/config.edn
note: com.biffweb.sqlite.impl.execute/execute may live in libs/sqlite/src/com/biffweb/sqlite/impl/execute.clj, which has syntax errors; some forms may be missing, so besides a spelling problem a form kondo could not read is possible
note: use a fully qualified name (ns/name)
```

clj-kondo の実行がタイムアウトしたファイル、または git が追跡しているのにビルドが解析しなかったファイルにありそうな
見つからない名前も、同じようにそのファイルを挙げます。

使われているのにどこにも定義されていない名前は、たいてい clj-kondo が展開できないマクロによって作られています。回答は
それがどこで使われているかと、何を追加すべきかを示します。next.jdbc の例です。

```
CALLERS next.jdbc.types/as-other — no definition matches "next.jdbc.types/as-other"; used at test/next/jdbc/sql_test.clj:290, test/next/jdbc_test.clj:559 but no definition was found
note: next.jdbc.types/as-other is used at test/next/jdbc/sql_test.clj:290, test/next/jdbc_test.clj:559 but no definition was found: probably defined by a macro clj-kondo cannot expand; add :lint-as for the macro in .clj-kondo/config.edn
note: use a fully qualified name (ns/name)
```

見つからなかったという結果は、カバレッジについての記述として読んでください。存在しないことの証明ではありません。

## [カバレッジ](docs/COVERAGE.md)

[docs/COVERAGE.md](docs/COVERAGE.md) は 26 個の公開リポジトリを測定しています。各リポジトリは
[corpus.json](corpus.json) の sha に固定されています。主な指標は **resolution rate** (解決率) です。
clj-kondo がプロジェクトの namespace に帰属させた var の使用のうち、グラフが定義に結び付けられた割合です。
ライブラリの var の使用は数えません。clj-kondo がどの namespace にも帰属させられないシンボルは、
**unknown namespace** という生の件数として報告し、割合には含めません。

26 個のうち 24 個のリポジトリが 95% 以上です。下回る 2 つは次のとおりです。

| repo | resolved | unresolved | resolution rate | unknown namespace |
|---|---|---|---|---|
| datascript | 4392 | 496 | 89.9% | 1255 |
| day-of-datomic | 84 | 29 | 74.3% | 1 |

ドキュメントは、その理由を次のように説明しています。

> **unresolved**: a var created by a project macro clj-kondo does not know (datascript's record constructors), or
> a name in a REPL script with no ns form that clj-kondo files under a namespace not defining it (day-of-datomic's
> tutorials).

訳: **unresolved** は、clj-kondo が知らないプロジェクトのマクロが作った var (datascript のレコードコンストラクタ)、
または ns 形式のない REPL スクリプト内の名前で、clj-kondo がそれを定義していない namespace の下に分類したもの
(day-of-datomic のチュートリアル) です。

さらに 6 個のリポジトリが、unknown namespace の件数が resolved の 5% を超えているため掲載されています。
babashka、cider-nrepl、fulcro、pedestal、shadow-cljs、usermanager です。表は小数点以下 1 桁で表示するため、
100.0% でも少数の未解決の使用が残っていることがあります (metabase 111、penpot 13、xtdb-v1 3)。
どちらの種類も、リポジトリが自分のマクロ用に clj-kondo の設定を同梱するか、`.clojure-atlas.edn` の `:lint-as` で
それらを指定すると減ります。corpus は、どちらも追加せずに測定しています。

## ベンチマーク

[docs/BENCHMARK.md](docs/BENCHMARK.md) には、corpus のリポジトリに関する 21 の質問があります。
期待される回答はそれぞれ、ツールを使わずにソースで手作業により確認しました。その file:line は
[bench/questions.json](bench/questions.json) にあります。

- **肯定の質問: 14 問中 14 問が合格。** 回答が期待される定義をすべて挙げ、それ以外を挙げなければ合格です。
  期待された項目の発見: 40 件中 40 件。回答された項目: 40 件。
- **不在の質問: 7 問中 7 問が合格。** 正しい回答は「存在しない」(*none*、*not-found*、*used-undefined*、*capability-off*) であり、
  回答はその種類の不在を明示し、何も挙げてはいけません。

最初の 12 問の肯定の質問は最初の実行の前に固定しました。最初の実行は 12 問中 11 問でした。外れた 1 問
(`re-frame.alpha` 経由の re-frame の登録) は、フィクスチャを付けてビルダー側で修正し、質問は元のまま残しました。
後から 2 問を追加しました。compojure のミドルウェアチェーン (q13) と reitit のフロントエンドルート (q14) です。
クライアントルートを一覧する MCP ツールはないため、q14 はグラフのノードを直接読んで採点します。そのため、14 問の肯定の質問のうち
13 問の回答はツールから得られています。

## 要件

- Node.js 22.18 以降。JVM、babashka、グローバルインストールは不要です。
- 最初の `build` で、clj-kondo 2025.10.23 を一度だけダウンロードします。
  [公式の clj-kondo リリース](https://github.com/clj-kondo/clj-kondo/releases)から取得し、固定された sha256 と照合して、
  `$XDG_CACHE_HOME/clojure-atlas` にキャッシュします (デフォルトは `~/.cache/clojure-atlas`、Windows では
  `%LOCALAPPDATA%\clojure-atlas`)。最初の実行では次のように表示されます。

  ```
  clojure-atlas: downloading clj-kondo 2025.10.23 (macos-aarch64) once, to <cache>/clojure-atlas/clj-kondo-2025.10.23-macos-aarch64/clj-kondo
  ```

- オフラインの場合やプロキシの内側では、`clj-kondo` を PATH に置いてください。Node の `fetch` は `HTTPS_PROXY` を無視するため、
  プロキシの内側ではダウンロードが失敗し、clojure-atlas は PATH 上の clj-kondo を使います。sha256 が一致しない
  ダウンロードは拒否され、実行されません。
- オプション: Playwright のページオブジェクトとテストを読み取るための TypeScript 5 (clojure-atlas の隣で `npm i -D typescript@5`)。
  オプションのピア依存です。なければ、その読み取りは無効になり、graph_info とブラウザテストの回答が、見つかった
  Playwright プロジェクトごとにその理由を伝えます。
- 固定された clj-kondo バイナリがあるプラットフォーム: macOS arm64、macOS x64、Linux x64、Linux arm64、Windows x64。
  それ以外のプラットフォームでは、clj-kondo を PATH に置く必要があります。このリリースは macOS arm64 で開発と測定を行いました。
  Windows は未検証です。

## セキュリティ

ビルドはファイルを読み取ります。実行するのは clj-kondo (固定されたバイナリ、または PATH 上のもの) と `git ls-files` だけで、
解析対象リポジトリのコードを Node、JVM、シェルで実行することはありません。TypeScript は clojure-atlas 自身の
インストールから読み込まれ、解析対象リポジトリからは読み込まれません。clj-kondo はプロジェクトの `.clj-kondo` 設定を適用します。
そこで宣言された hook は、clj-kondo を実行するどのエディタとも同じように、clj-kondo 自身が解釈します。MCP サーバーは
グラフファイルを読み取るだけで、`--repo` を指定した場合は読み取り専用の git コマンドを実行します。git の呼び出しはすべて、
リポジトリ自身の設定のうちコマンドを実行するもの (`core.fsmonitor`、filter driver、hook) を無視し、プロンプトを出さず、
タイムアウトがあります。clj-kondo の各実行にもタイムアウトがあります。決して戻らない hook はそのバッチを失わせますが
(DEGRADED に挙がります)、ビルド全体は失われません。
git はサブモジュールの中では実行されないため (サブモジュール自身の設定を clojure-atlas は無効にできません)、サブモジュールのファイルは常に変更ありとして数えられます。
2 つのプログラムはどちらも、PATH 上で見つけた絶対パスから起動し、解析対象のディレクトリからは起動しません。また、プロジェクトの clj-kondo 設定の `:output` と `:analysis` は、グラフに必要なものに置き換えられます。

## なぜ TypeScript なのか

`npx` がそのまま動くからです。JVM のインストールも、ユーザーのマシンでのコンパイルも不要です。Clojure の解析自体は
clj-kondo が行います。clojure-atlas はその出力とソースの形を読み、グラフを構築します。アダプタへの貢献は
どちらの言語でも歓迎します。アダプタは、小さな Clojure のフィクスチャと、そこから期待されるグラフの行で定義されます。
ライブラリの意味論を Clojure で記述して誰かに移植してもらうことも、自分で TypeScript を書くこともできます。

## 制限

- **静的解析のみ。** 実行時に解決される var は辿りません。リテラルのシンボルに対する `requiring-resolve`、`resolve`、`ns-resolve` は
  HEURISTIC な参照です。実行時に組み立てられたシンボルや、データで選ばれる関数はそうではなく、プロジェクトが var を動的に解決している場合は
  callers と blast_radius がその旨を伝えます。動的にしか読み書きされないマップキーは追跡しません。マルチメソッド、`resolve`/`apply`、HTTP フィクスチャ経由で
  コードに到達するテストは数えません。
- **ヒューリスティックな部分**: マルチメソッドとプロトコルのディスパッチ (`may_dispatch_to`)、一部の compojure ハンドラ
  (`heuristic match` と表示)、compojure と Ring のミドルウェアチェーン、ミドルウェアファクトリの呼び出し、
  reitit を require していない namespace にある reitit のフロントエンドルート表 (プロジェクト内のどこかで
  `reitit.frontend` が使われていれば読み取ります)、syntax-quote されたマクロ本体で名前が挙がった var、
  clj-kondo が展開できないプロジェクトのマクロ内の使用 (`unexpanded-macro` 経由)、複数のファイルで定義された namespace の使用
  (`duplicate-namespace` 経由)、スレッドされたキースロット、transact や query の呼び出し外にあるクエリリテラル、key_siblings の finding。
- **プロジェクトのマクロ**: clj-kondo がマクロを展開するのは、プロジェクトの `.clj-kondo` 設定がそのマクロに `:lint-as` または
  hook を与えている場合 (または `.clojure-atlas.edn` が `:lint-as` の下にその名前を挙げている場合) だけです。
  どちらかを追加して再構築すれば、その内部の使用は再び STATIC_PROVEN になります。[プロジェクト設定](#project-configuration)を参照してください。
- **ラップを読み取れないミドルウェア**は、「none」ではなく `middleware: not extracted (UNKNOWN)` と報告されます。
- **解析できないファイルと 2 MB を超えるファイル**: その定義と呼び出しはグラフに含まれません。その場合、すべての回答は、それらを挙げる
  `DEGRADED` 行で始まります。
- **pedestal の service map の interceptor** は読み取らないため、すべての pedestal ルートのミドルウェアは UNKNOWN です。
- **ルート認可**には `.clojure-atlas.edn` が必要です。ない場合、route_authz は "not provable" と答え、
  permission_routes はその capability を absent と報告します。
- **未対応**: bidi ルート、compojure-api、pedestal の verbose map ルート、malli レジストリ、
  ref のない integrant システム。[ROADMAP.md](ROADMAP.md) を参照してください。
- **datascript と day-of-datomic** は解決率が低めです (89.9% と 74.3%)。datascript は clj-kondo が知らないマクロで
  レコードコンストラクタを定義します。day-of-datomic のチュートリアルは ns 形式のない REPL スクリプトです。
  [カバレッジ](docs/COVERAGE.md)を参照してください。
- **Unknown namespace のシンボル** (未知のマクロが束縛するローカル、deftype や proxy のフィールド) は数えますが、結び付けません。
- **インクリメンタルビルドや watch はありません。** 変更後は再構築してください。サーバーは、判別できる場合に `STALE` で警告します。
- **Windows は未検証です。** clj-kondo のダウンロードでは、プロキシはサポートされません。

## コントリビューション

```sh
npm ci
npm test                                    # all tests
npm run test:coverage                       # the gate: 98% line coverage of src/
npm run typecheck
node scripts/coverage.ts <corpus-dir>       # rebuilds docs/COVERAGE.md from clones at the corpus.json shas
node bench/score.ts <corpus-dir>            # scores the benchmark questions
```

アダプタを追加または拡張するには、まずフィクスチャを作ります。`test/fixtures/<name>/` の下に小さな Clojure コードベースを置き、
それが生成すべきグラフの行をすべて載せた `expected.txt` を、ソースと照らして手作業でレビューしながら用意します。
`test/build-fixtures.test.ts` に登録し、行が一致するまで `src/build/adapters/` にアダプタを書きます。
[CONTRIBUTING.md](CONTRIBUTING.md) を参照してください。

## クレジット

- [clj-kondo](https://github.com/clj-kondo/clj-kondo) (作者 Michiel Borkent) が Clojure の解析を行います。
- [Model Context Protocol](https://modelcontextprotocol.io) は、エージェントがサーバーと通信する方法です。
- corpus のリポジトリとその作者。公開されているコードで、カバレッジとベンチマークを測定しています。

## ライセンス

MIT。[LICENSE](LICENSE) を参照してください。作者は Barış Can Ateş です。
