# clojure-atlas

**エージェント型コーディングのために作られました。AI エージェントに Clojure コードベースの地図を渡しましょう。**

呼び出し元やデータの提供元/利用先をたどり、関数のコントラクトを **map 引数の中のキーに至るまで**調べ、
re-frame のイベントとルートを追い、変更の影響を受けるテストを特定できます。
clojure-atlas は **Clojure、ClojureScript、`.cljc` のソースコード**をローカルのコードグラフに変換し、
ソース上の位置と明示的な信頼度つきの **13 個の MCP ツール**として公開します。

**コーディングエージェントのためのコンパニオンツール**として作られており、Atlas はコードを変更する前にエージェントが必要とする構造的な文脈を提供します。
そのコードに誰が依存しているか、利用側がどのパラメータや map キーを期待しているか、どのテストが関係しているかです。

![clojure-atlas — provider to map parameter set to consumer; inspect contracts with signature_impact and key_flow](docs/assets/atlas.svg)

[![License: MIT](https://img.shields.io/badge/license-MIT-91d5b6?style=flat-square&labelColor=17252b)](LICENSE)
[![Node.js: 22.18+](https://img.shields.io/badge/Node.js-22.18%2B-91d5b6?style=flat-square&labelColor=17252b)](#要件)
[![MCP: stdio](https://img.shields.io/badge/MCP-stdio-91d5b6?style=flat-square&labelColor=17252b)](#クイックスタート)
[![Required npm runtime dependencies: 0](https://img.shields.io/badge/npm_runtime_dependencies-0-91d5b6?style=flat-square&labelColor=17252b)](#設計上ローカル)

**必須の npm 実行時依存はゼロ。解析はローカル。For the sake of all Clojurians.(すべての Clojurian のために。)**

**Barış Can Ateş** の個人プロジェクト · MIT ライセンス · [clj-kondo](https://github.com/clj-kondo/clj-kondo) をベースに構築。

[English](README.md) | [Türkçe](README.tr.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Português (Brasil)](README.pt-BR.md) | 日本語 | [简体中文](README.zh-CN.md)

[できること](#できること) · [map のコントラクト](#map-のキーに至るまでのコントラクト) · [対応スタック](#言語とエコシステムの対応) · [実例](#実際の動作を見る) ·
[クイックスタート](#クイックスタート) · [カバレッジ](#カバレッジ) · [テスト方法](#atlas-のテスト方法) · [完全ガイド](docs/GUIDE.md)

## できること

見慣れないプロジェクトを調べるとき、リファクタリングを計画するとき、変更をレビューするときに使います。MCP クライアントが
ツールを呼び出し、Atlas は確立できた関係を `file:line` の出典つきで返します。

| エージェントにこう尋ねる… | Atlas が返すもの… | MCP ツール |
|---|---|---|
| 「これを誰が呼んでいて、変更は何に影響しうるか?」 | 直接の呼び出し元、値としての参照、推移的な依存元 | `callers`, `blast_radius` |
| 「各呼び出し元はどんなパラメータ集合を渡し、関数は何を読むか?」 | アリティ、分配束縛された map キー、デフォルト値、キーワード引数、各呼び出し箇所で渡されるキー | `signature_impact` |
| 「この map キーを提供しているのは誰で、利用しているのは誰か?」 | ネストした map 内のリテラルキーやキーパスを含む、キーの生成側と利用側 | `key_flow` |
| 「この設定行にはキーが欠けていないか?」 | 兄弟の map 行にはあるが、この行にはないキー | `key_siblings` |
| 「このエンドポイントを処理するのは何か? 権限はどこで確認されるか?」 | ルートハンドラ、順序つきミドルウェア、設定された権限チェック | `route_authz`, `permission_routes` |
| 「この re-frame イベントが発火すると何が起きるか?」 | ディスパッチ元、ハンドラ、サブスクリプション、HTTP リクエスト | `event_flow` |
| 「このデータベース属性を読み書きしているのは誰か?」 | 証明済みの読み書き。不確かな参照も見える形で残す | `attribute_usage` |
| 「この変更に関係するテストは?」 | 静的なユニットテストのリンク、Playwright のリンク、変更されたファイルや行のレビューコンテキスト | `tests_for`, `tests_covering`, `context_for_change` |
| 「このグラフは実際に何を知っているのか?」 | ソースのコミット、有効なアダプタ、根拠の件数、カバレッジの警告 | `graph_info` |

呼び出し、コールバック、同じ綴りのキーワードは別物です。Atlas はこうした区別をモデル化しており、
Clojure の登録やデータ駆動の接続も含まれます。編集の前にエージェントが確認できる根拠を提供します。

### 出荷前にバグを見つける助けになる場面

各行は公開プロジェクトでの実際の回答です。完全な出力はリンク先を参照してください。

| 起こりうるバグ | 使うツール | Atlas が示したもの(実例) |
|---|---|---|
| 設定行やデータ行に、兄弟の行にあるキーが欠けている | `key_siblings` | re-frame: query テーブルの 2 行に、4 つの兄弟行のうち 3 行にある `:re-frame/lifecycle` がない([出力](docs/GUIDE.md#key_siblings)) |
| 新しい必須キーが既存の呼び出し元を壊す | `signature_impact` と `added_keys` | polylith-realworld: `login!` が `:tenant-id` を必要とするなら、3 つの呼び出し元はそれを含まないリテラル map を渡し、1 つは Atlas から見えない map を転送している([出力](#map-引数の中のコントラクトを調べる)) |
| 呼び出し元が誤ったアリティ、関数が読まないキーを渡す、または関数が分配束縛するキーを渡し忘れる | `signature_impact` | integrant: `init` を 38 個の呼び出し元と両方のアリティに対して確認。行った検索を明記した「no finding」([出力](docs/GUIDE.md#signature_impact)) |
| エンドポイントにミドルウェアや権限チェックがない | `route_authz`, `permission_routes` | polylith-realworld: `POST /api/articles` の 11 個のラッパーを順番どおりに表示し、`wrap-authorization` が最後。宣言されたモデルがないため、権限は正直に「not extracted」([出力](docs/GUIDE.md#route_authz)) |
| 誰も書き込まないキーが読まれている(多くは誤字や名前を変えたキー) | `key_flow` | compojure: `:compojure/path` には生成側が 1 つ(`assoc-path`)、利用側が 2 つある([出力](docs/GUIDE.md#key_flow)) |
| データベース属性への予期しない書き込み元 | `attribute_usage` | mount: `:order/bid` には証明済みの書き込み元が 2 つあり、1 つはテストコード内。読み取り元はない([出力](docs/GUIDE.md#attribute_usage)) |
| ディスパッチされたイベントにハンドラがない、またはハンドラが予期しないイベントを発火する | `event_flow` | re-frame todomvc: `:delete-todo` は 2 箇所からディスパッチされ、1 回処理され、何も発火しない([出力](docs/GUIDE.md#event_flow)) |
| 小さな変更が想定より広く波及する | `blast_radius` | integrant: `ref?` の変更は 6 階層にわたって 31 個の定義に届く([出力](docs/GUIDE.md#blast_radius)) |
| どのテストも通らない変更されたコード | `context_for_change`, `tests_for` | polylith-realworld: article ストアの 60-80 行目は 3 個の定義、外部の呼び出し元 9 個、関連テスト 24 個に関わる([出力](docs/GUIDE.md#context_for_change)) |

Atlas は見るべき場所を指し示します。それがバグかどうかの判断は、あなたかあなたのエージェントに委ねられます。

### エージェントのワークフロー

1. **状況把握:** `graph_info` でスナップショット、有効なアダプタ、解析の抜けを確認します。
2. **調査:** 呼び出し元、パラメータのコントラクト、map キーの提供元/利用先、変更の潜在的な影響を調べます。
3. **計画と検証:** `context_for_change` とテストツールで影響を受けるコードと関連テストを見つけます。
   引用されたソースを確認し、変更を加え、関連するテストを実行します。次の周回に向けてグラフを再構築し、MCP サーバーを再起動します。

## map のキーに至るまでのコントラクト

Atlas は **ソース上で見えるパラメータのコントラクト**を調べられるようにします。呼び出し元が何を渡し、関数が何を
分配束縛または読み取り、提案された変更がどの呼び出し箇所に影響するかです。

| レベル | Atlas が示せるもの |
|---|---|
| **パラメータ集合** | 受け付けるアリティ、位置引数/rest 引数、`& {:keys [verbose]}` のようなキーワード引数 |
| **map 引数の中のキー** | `{:keys [email password]}`、`:or` のデフォルト、`:as` の別名、呼び出し元が渡すリテラルキー、関数本体で対応している読み取り |
| **提供元 / 利用先** | map リテラル、`assoc`、`assoc-in` などの生成側。分配束縛、キーワード参照、`get`、`get-in` などの利用側 |
| **コントラクトの変更** | `signature_impact` の `added_keys`、`removed_keys`、`arities`、`base_graph` を使い、キーの追加/削除やアリティの変更で影響を受ける呼び出し箇所を示す |
| **ネストした map** | `key_flow` による、ネストした map のリテラルキーの出現、分配束縛、`(get-in cart [:meta :count])` のようなパス |

対象は **静的なキー使用**であり、値や型の検証ではありません。`key_flow` は出現箇所を、特定の map の同一性ではなく
キーワードごとにまとめます。`signature_impact` が記録するのは、ネストした分配束縛や `get-in` の外側のキーであり、
ネストしたスキーマの全体ではありません。実行時に組み立てられる map やキーは不明のまま残ることがあります。

## 言語とエコシステムの対応

**中核となる言語:** Clojure(`.clj`)、ClojureScript(`.cljs`)、共有コード(`.cljc`)。EDN ファイルは対応する
設定やデータの形式を提供します。TypeScript(`.ts`)はオプションの Playwright 連携のためだけに読み込まれます。
汎用の JavaScript や TypeScript の解析ツールではありません。

| 領域 | 認識するライブラリ / 形式 | 現在カバーしている範囲 |
|---|---|---|
| Clojure の中核 | Var、呼び出し、値としての使用、コールバック、マルチメソッド、プロトコル | 定義と依存関係。ディスパッチの候補はヒューリスティック |
| パラメータと map のコントラクト | `defn` のアリティ、map の分配束縛、キーワード引数、map リテラル、キー操作 | 呼び出し元が渡すキー集合、利用されるキー、提供元/利用先の箇所、シグネチャ変更の影響 |
| フロントエンドの状態 | **re-frame**(`re-frame.alpha` を含む) | イベント/サブスクリプションの登録、ディスパッチ、サブスクリプションの入力とサブスクライバ |
| バックエンドのルーティング | **Compojure**、**Reitit**、**Pedestal** のテーブルルート | パス、マウントされたルートのコピー、ハンドラ。Pedestal の service-map のインターセプタは抽出しない |
| ミドルウェア | **Ring**、Compojure の `wrap-routes`、Reitit のルートデータ、`ring-handler` | 外側のラッパーを含む順序つきのチェーン。推論したチェーンはヒューリスティックと表示 |
| ルートの認可 | プロジェクトで定義した権限キー、ミドルウェア、関数 | 小さな `.clojure-atlas.edn` の宣言が必要 |
| ブラウザのルーティング | **Reitit frontend**、**Secretary** | グラフ内のクライアントルートのノード。それらを一覧する専用の MCP ツールはまだない |
| HTTP リクエスト | **cljs-ajax**、**cljs-http**、`js/fetch`、リクエストの effect map | リクエスト箇所と、メソッドとパスによるバックエンドルートとの対応づけ |
| データ | **Datomic**、**DataScript**、**XTDB v1 / Crux** | 属性、トランザクションの書き込み、クエリ/pull の読み取り、不確かな参照 |
| システムのライフサイクル | **Integrant**、**Mount**、**Component** | システムキー、登録、依存エッジ。Integrant の設定の抽出は ref に依存 |
| スキーマ | **clojure.spec / cljs.spec**、**Malli** | 登録された spec スキーマと、var に保持された Malli スキーマ。Malli のレジストリは非対応 |
| テストと UI | **clojure.test / cljs.test**、**Playwright**、リテラルな Hiccup セレクタ | 静的なテストのリンク。Playwright のページオブジェクトと `.ts` のテストにはオプションの TypeScript 5 が必要 |
| プロジェクト構成 | **deps.edn**、**Leiningen**、**shadow-cljs**、**Babashka**、**Boot**、**Polylith** の構成 | ソースの探索と、モジュール/コンポーネントごとのグループ化。ビルドのエイリアスやタスクの実行は解析しない |

フレームワークのアダプタが認識するのは特定のソース形式であり、ライブラリのあらゆる使い方ではありません。`graph_info` は
**あなたの**プロジェクトで何が利用可能で、何が有効になったかを報告します。Fulcro、Pathom、HoneySQL、next.jdbc などのリポジトリは
測定コーパスに含まれていますが、そこにあることは、専用のフレームワーク解析や SQL 解析が実装されていることを意味**しません**。
これらのアダプタ、bidi、compojure-api、その他の未対応については[ロードマップ](ROADMAP.md)を参照してください。

## 実際の動作を見る

以下の抜粋は、公開プロジェクトの[コミット済みのサンプルグラフ](examples/)によるものです。呼び出しは
MCP ツールの呼び出しであり、シェルコマンドではありません。`[S]` は静的に証明済み、`[H]` はヒューリスティックを意味します。

### map 引数の中のコントラクトを調べる

polylith-realworld では、`login!` は **1 つの map 引数**を受け取り、**`:email` と `:password`** を分配束縛します。
Atlas は、そのキー集合を呼び出し元が渡す引数と並べて示します。

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

リテラル map のキー集合は見えますが、`login-input` として渡される map は不明のままです。その行の `[S]` が証明するのは
呼び出しの関係であり、実行時の map の中身ではありません。

<details>
<summary><strong>パラメータのコントラクトを変更する: login! が :tenant-id も必要とするなら?</strong></summary>

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

リテラル map を渡す 3 つの呼び出し元はすべて、提案されたキーを渡していません。4 つ目の呼び出し元は `login-input` を転送しているため、
その影響は **UNKNOWN** です。これは仮定のコントラクト変更であり、ツールがソースを変更することはありません。「No finding」は
現在のシグネチャについてのもので、`affected` セクションが提案された変更を説明します。

</details>

<details>
<summary><strong>プロジェクト全体で :email の提供元と利用先を探す</strong></summary>

```text
key_flow {"key": ":email", "group_by": "none", "limit": 2}
```

```text
KEY_FLOW :email — 9 producer(s), 5 consumer(s) in 1 component(s); 23 site(s) in tests
counts: producers=9 [S9]  consumers=5 [S5]  tests=23 [S23]
[... trimmed ...]
```

結果には、`register!` 内の map リテラルの生成側と、`login!` を含む分配束縛の利用側が、ソース上の位置とともに
並びます。`:email` は修飾されていないため、そのキーワードを使うすべての map がまとめられます。これは、
特定の生成側の map が特定の利用側に届くことを証明するものではありません。

</details>

<details>
<summary><strong>リファクタリングの前に呼び出し元を探す</strong></summary>

**質問:** `integrant.core/dependent-keys` を呼んでいるのは誰か?

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
<summary><strong>re-frame のイベントをディスパッチ箇所とハンドラまでたどる</strong></summary>

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

接続はイベントのキーワードを介しているため、名前つき関数の呼び出し元だけを見ていたのでは見逃してしまいます。

</details>

<details>
<summary><strong>エンドポイントの手前にあるミドルウェアと、Atlas が確認できなかったことを見る</strong></summary>

polylith-realworld の例です。ここではルートが別の定義で Ring のミドルウェアにラップされています。

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

ハンドラは証明済みです。11 個のラッパーは順番どおりに見つかりますが `[H]` と表示されます。ミドルウェアの合成は
実行時のコードだからです。このプロジェクトは権限ルールを宣言していないため、Atlas はルートに権限チェックがないと断定せず、
**not extracted** と答えます。

</details>

<details>
<summary><strong>正直な見逃し: 使われているのに定義されていない名前</strong></summary>

next.jdbc の例です。ここではマクロが、clj-kondo が展開できないヘルパー関数を生成しています。

```text
callers {"var": "next.jdbc.types/as-other"}
```

```text
CALLERS next.jdbc.types/as-other — no definition matches "next.jdbc.types/as-other"; used at test/next/jdbc/sql_test.clj:290, test/next/jdbc_test.clj:559 but no definition was found
note: next.jdbc.types/as-other is used at test/next/jdbc/sql_test.clj:290, test/next/jdbc_test.clj:559 but no definition was found: probably defined by a macro clj-kondo cannot expand; add :lint-as for the macro in .clj-kondo/config.edn
note: use a fully qualified name (ns/name)
```

「見つかりません。綴りを確認してください」ではなく、その名前がどこで使われているか、どうすれば見えるようになるかを示します。
そのマクロに `:lint-as` を設定すれば、同じ質問に対して証明済みの定義が返ります
([プロジェクト設定](docs/GUIDE.md#project-configuration))。

</details>

<details>
<summary><strong>変更された行をレビューのコンテキストと関連テストに変える</strong></summary>

polylith-realworld の例です。

```text
context_for_change {"changes": ["components/article/src/clojure/realworld/article/store.clj:60-80"]}
```

```text
CONTEXT_FOR_CHANGE components/article/src/clojure/realworld/article/store.clj:60-80 — 1 file(s), 3 changed symbol(s), 0 route(s), 0 attribute(s); risk LOW
counts: changed symbols=3 [S3]  callers outside the diff=9 [S9]  tests to run=24 [S24]
[... trimmed ...]
```

完全な回答には、3 つの変更された定義、diff の外にある 9 つの呼び出し元、関連する 24 個のテストが
コンポーネントごとにまとめて並びます。`LOW` はグラフが行ったチェックを表すものであり、安全の保証ではありません。

</details>

[その他の実例](examples/README.md) · [すべてのツールと完全な出力](docs/GUIDE.md#tools)

## クイックスタート

**前提条件:** Node.js **22.18+** と Git。JVM や Babashka のランタイムは不要です。

### 1. インストールしてグラフを構築する

**解析したい Clojure プロジェクト**のルートで実行します。

```sh
# Install the reviewed source revision (Git installation builds the CLI).
npm install --save-dev \
  'git+https://github.com/Bariscanates404/clojure-atlas.git#8634d33e3ed59d420eead61a9c596f752d1fe789'

npx clojure-atlas build
```

このパッケージは現在 npm には公開されていないため、上記の Git からのインストールを使ってください。リポジトリが非公開の間は、
リポジトリへのアクセス権が必要です。ソースからのインストールでは、CLI のコンパイルに TypeScript と Node の型定義を使います。
これらはビルド時の依存であり、必須の npm 実行時依存がゼロであることとは別です。

グラフは `.clojure-atlas/graph.json.gz` に保存されます。最初のビルドでは固定された clj-kondo のバイナリをダウンロードして検証し、
以降の解析ではキャッシュされたバイナリを使います。`.clojure-atlas/` をプロジェクトの `.gitignore` に追加してください。

### 2. MCP クライアントを接続する

Claude Code では、プロジェクトの設定をプレビューしてから書き込みます。

```sh
npx clojure-atlas init         # preview .mcp.json
npx clojure-atlas init --yes   # write it; keep existing servers
```

クライアントでサーバーを有効にしたら、プロジェクト内の完全修飾の `ns/name` に対して `graph_info` と `callers` を
使うよう依頼してください。

<details>
<summary><strong>別の MCP クライアントを設定する</strong></summary>

Atlas は **stdio 上の MCP** を使います。プロジェクトのルートから起動するようにクライアントを設定してください。

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

クライアントが別の場所でサーバーを起動する場合は、クライアントの作業ディレクトリの設定を使うか、インストール済みの CLI、グラフ、
リポジトリに絶対パスを使ってください。クライアントの設定形式は異なる場合があります。

</details>

### 3. 変更後に再構築する

```sh
npx clojure-atlas build       # refresh the snapshot
npx clojure-atlas coverage   # inspect resolution counts and unresolved names
```

watch モードはありません。`--repo` を指定すると、作業ツリーがグラフと一致しなくなったときに、クエリが `STALE` で警告します。
新しいグラフを読み込ませるため、再構築した後で MCP サーバーを再起動してください。

**すでに clj-kondo の設定がありますか?** Atlas はプロジェクトの `.clj-kondo/config.edn` を、マクロのマッピングや
フックを含めて適用します。オプションの `.clojure-atlas.edn` で、独自のルートマクロと認可ルールを追加できます。
[プロジェクト設定](docs/GUIDE.md#project-configuration)と[認可のフィクスチャ](test/fixtures/authz/.clojure-atlas.edn)を参照してください。

## 回答の読み方

| マーカー | 意味 | 使い方 |
|---|---|---|
| `[S]` — `STATIC_PROVEN` | clj-kondo が解決したか、リテラルなソース形式から確立された | 引用されたソース上の位置をたどる |
| `[H]` — `HEURISTIC` | 名前、ラッパー、スレッディングの位置、ディスパッチの候補から推論された | ソースで関係を確認する |
| `[?]` — `UNKNOWN` | 静的には判断できない | 解析の境界として扱う |

**結果が空でも、自動的に不在の証明になるわけではありません。** Atlas は「見つからなかった」「定義が見つからなかった」
「機能が利用できない」を区別します。`DEGRADED` は解析が不完全であることを、`STALE` はスナップショットが古いことを警告します。
テスト数がゼロとは、静的なリンクが見つからなかったという意味であり、そのコードがテストされていないという意味ではありません。

動的ディスパッチ、実行時に作られるシンボル、プロジェクトのマクロは、グラフに見えるものを制限することがあります。読み取れない
ミドルウェアは unknown として報告されます。ルートの権限には、プロジェクトでの明示的な設定が必要です。
[根拠と不在](docs/GUIDE.md#bands-and-absence) · [既知の制限](docs/GUIDE.md#limits)

## 設計上ローカル

中核となる CLI には**必須の npm 実行時依存がありません**。Node の標準ライブラリ、Clojure の解析には clj-kondo、
リポジトリのメタデータには Git を使います。グラフの構築とクエリはローカルで行われ、Atlas のアカウント、ホスト型のインデックス、
クラウドサービスは不要です。

### 要件

| コンポーネント | 役割 |
|---|---|
| Node.js 22.18+ | CLI と MCP サーバーを実行する |
| clj-kondo 2025.10.23 | ネイティブの解析ツール。一度ダウンロードしてキャッシュされ、アーカイブの SHA-256 が固定されている |
| Git | ソースからのインストール、追跡ファイルの確認、スナップショット/陳腐化の情報 |
| TypeScript 5 — 実行時はオプション | Playwright のページオブジェクトとテストの解析。Atlas と並べて `npm i -D typescript@5` でインストールする |

固定されたバイナリは macOS arm64/x64、Linux arm64/x64、Windows x64 向けに用意されています。開発とコーパスの測定には
macOS arm64 を使いました。**Windows は未検証です**。プロキシの内側などでダウンロードできない場合、Atlas は
`PATH` 上の動作する `clj-kondo` にフォールバックできます。[プラットフォームとキャッシュの詳細](docs/GUIDE.md#requirements)。

### セキュリティ

依存の表面が小さいことは助けになりますが、**必須の npm 依存がゼロであることは、サプライチェーンのリスクがゼロであることを意味しません**。

- ダウンロードした clj-kondo のアーカイブは、固定された SHA-256 と照合されます。一致しないダウンロードは拒否されます。
  `PATH` 上のフォールバックの実行ファイルは別途信頼されるものであり、固定されたアーカイブのハッシュとは照合されません。
- Atlas は、解析対象のアプリケーションの JVM、シェルスクリプト、Node のコードを起動しません。**プロジェクトの clj-kondo のフックは
  clj-kondo が解釈します**。そのため、リポジトリを解析するときは、その設定も信頼するコードの一部です。
- MCP サーバーはグラフを読み取り、読み取り専用の Git チェックを使います。これらのチェックでは、Git のコマンドフック、
  フィルタドライバ、fsmonitor が無効化されており、Git と clj-kondo のサブプロセスにはタイムアウトがあります。
- Atlas は結果を stdio 経由でローカルに提供します。選んだ AI/MCP クライアントがその結果をどう扱うかは、別個の
  プライバシー上の境界です。

これらは実装上の性質であり、セキュリティ監査の認証ではありません。[実行モデルの詳細](docs/GUIDE.md#security)。

## カバレッジ

**26 個の公開リポジトリ**で測定しました。それぞれ [corpus.json](corpus.json) 内の特定のコミットに固定されています。コーパスには
Babashka、Logseq、Metabase、Penpot、re-frame、Reitit と、より小さなライブラリが含まれます。完全な結果は
[docs/COVERAGE.md](docs/COVERAGE.md) にあります。

**解決率が測るのは特定の一点です。** 認識されたプロジェクトの名前空間に帰属する var 使用についての
`resolved / (resolved + unresolved)` です。ライブラリの使用と**未知の名前空間の使用は、この分母に含まれません**。
理解されたコードの全体、抽出されたフレームワークの挙動の全体、実行時の正しさは測っていません。

| リポジトリ | Resolved | Unresolved | 解決率 | 未知の名前空間(生の件数、除外) |
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

率は小数第 1 位に丸めています。必ず unresolved と未知の名前空間の**両方**の件数と合わせて読んでください。
未知の名前には、見逃された var 使用のほか、見慣れないマクロが束縛するローカル変数も含まれる可能性があり、解析ツールは
それらを確実には区別できません。

**指標の変更は、解析ツールの改善ではありません。** 以前の数値は異なる分母を使っていました。Babashka について報告されている
より高い率は、主に未知の名前空間のシンボルを除外した結果であり、新たに解決されたコードではありません。
これらの定義をまたいだ比較は同じ条件ではありません。上の生の件数は意図的に表示したままにしています。

### 実際の抽出の改善

解決率の定義とは別に、Atlas が読めるものについての具体的な変更です。

| 改善 | 観測できる結果 | 根拠 |
|---|---|---|
| 外側の Ring/Compojure ミドルウェアを読む | polylith-realworld: `POST /api/articles` のミドルウェアのエントリが **0 → 11** | [Benchmark q13](docs/BENCHMARK.md#positive-questions)、[フィクスチャ](test/fixtures/ring-middleware/) |
| 別の名前空間にあるフロントエンドのルートテーブルを読む | Logseq: クライアントルートのノードが **0 → 17** | [カバレッジ](docs/COVERAGE.md)、[benchmark q14](docs/BENCHMARK.md#positive-questions) |
| `re-frame.alpha` を認識する | alpha 名前空間を通じた登録とディスパッチが抽出される | [Benchmark の履歴](docs/BENCHMARK.md)、[フィクスチャ](test/fixtures/reframe/src/app/alpha.cljs) |
| プロジェクトの clj-kondo 設定を適用する | プロジェクトのマクロのマッピングとフックが解析に反映される | [設定のフィクスチャ](test/fixtures/project-config/)、[テスト](test/config.test.ts) |

### ベンチマーク

記録されたベンチマークは **14/14 の肯定的な質問**と **7/7 の不在の質問**に合格しており、期待される回答は
ソースと照らして手作業で確認されています。これは小規模な回帰ベンチマークであり、一般的な精度の推定ではありません。13 個の
肯定的な回答は MCP ツールを使っています。クライアントルートの質問は、クライアントルートを一覧するツールがまだないため、
グラフのノードを直接読みます。[質問、結果、方法論](docs/BENCHMARK.md)。

## Atlas のテスト方法

エージェントが信頼するツールは、関係を捏造してはなりません。このリリースの前に、コードは次の確認を通りました。

| 確認 | 結果 |
|---|---|
| 自動テスト | **831** 件、すべて合格。修正した各バグには、修正前に失敗するテストがある |
| ソースの行カバレッジ | **99.75%**。CI は 98% を下回ると失敗する |
| バグ探し | モジュールごとに 1 人のレビュアーが、実行できる再現手順つきで誤った回答を探し、**85** 件の証明済みバグを見つけて修正した |
| 独立レビュー | コードを書いていないレビュアーによる **6** ラウンド。モジュールごとに正しさ、清潔さ、ルール、テストを採点し、すべてのモジュールが 5 点中 4 点以上になるまで続けた |
| 実際のリポジトリ | **26** 個の公開プロジェクトが、クラッシュなし、欠落したエッジ **0** 件でビルドできる(以前は、そのうち 6 個で 690 件) |
| 信頼できないリポジトリ | 悪意のあるフィクスチャで、Git の設定、フィルタドライバ、サブモジュール、プロジェクトの TypeScript、変わったファイル名、ハングする clj-kondo のフックが何も実行せず、何もハングさせないことを確認する。実行ファイルの検索はリポジトリのディレクトリを飛ばす(ユニットテスト済み。Windows 自体は未検証) |
| 正解データ | 上記の[ベンチマーク](docs/BENCHMARK.md): 肯定的な質問 14 個と不在の質問 7 個、回答は手作業で確認 |

最も重要なのは不在の質問です。これは、Atlas が「なし」と読めてしまう空のリストではなく、それが事実であるときに
「not found」「not extracted」「degraded」と答えることを確認します。

## コントリビューション

**Let's build our Clojure X-ray tool together!(みんなで Clojure の X 線ツールを作りましょう!)**

役に立つ貢献は、ごく小さな Clojure の例から始められます。「このライブラリはこの 2 つをつないでいて、Atlas は
それを見るべきだ」という例です。フィクスチャと期待されるグラフの行を追加するか、そのアダプタの実装を手伝ってください。どちらも歓迎します。

```sh
npm ci
npm test
npm run test:coverage   # 98% source line-coverage gate
npm run typecheck
```

CLI は、Node での配布を容易にするために TypeScript で書かれています。Clojure の解析は clj-kondo が行います。
[コントリビューターガイド](CONTRIBUTING.md) · [ロードマップ](ROADMAP.md) · [ツールリファレンス](docs/GUIDE.md)

## クレジットとライセンス

作成者は **Barış Can Ateş** です。このリポジトリのドキュメントとオリジナルのアートワークを含め、[MIT ライセンス](LICENSE)です。
Michiel Borkent による **[clj-kondo](https://github.com/clj-kondo/clj-kondo)** をベースに構築し、コーディングエージェントへの
インターフェースとして **[MCP](https://modelcontextprotocol.io)** を使っています。コーパスと実例で使った公開プロジェクトの作者に
感謝します。それらのプロジェクトと依存ライブラリは、それぞれのライセンスを保持します。

*For the sake of all Clojurians.*
