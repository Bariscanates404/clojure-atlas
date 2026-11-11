# clojure-atlas

**エージェントによるコーディングのために設計：Clojureコードベースの構造マップを、MCP経由でAIエージェントに提供します。**

エージェントがClojure、ClojureScript、`.cljc`のコードを編集する前に把握しておくべきなのは、その関数を誰が呼び出すか、関数がどのパラメーターセットを受け取るか、各呼び出し元がどのマップキーを渡し、関数本体がどれを読むか、そしてどのルート、re-frameイベント、テストがつながっているかです。clojure-atlasは、あなたのマシン上で[clj-kondo](https://github.com/clj-kondo/clj-kondo)を使ってこのマップを構築し、**13個のMCPツール**で回答します。各行には`file:line`が示され、証明済み、ヒューリスティック、不明のいずれかが明記されます。

![clojure-atlas：提供側、マップのパラメーターセット、利用側。MCPツールの背後にあるローカルグラフとしての呼び出し、イベント、ルート、テスト](docs/assets/atlas.svg)

[![継続的インテグレーション](https://github.com/Bariscanates404/clojure-atlas/actions/workflows/ci.yml/badge.svg)](https://github.com/Bariscanates404/clojure-atlas/actions/workflows/ci.yml)
[![ライセンス：MIT](https://img.shields.io/badge/license-MIT-91d5b6?style=flat-square&labelColor=17252b)](LICENSE)
[![Node.js：22.18+](https://img.shields.io/badge/Node.js-22.18%2B-91d5b6?style=flat-square&labelColor=17252b)](#要件)
[![MCP：stdio](https://img.shields.io/badge/MCP-stdio-91d5b6?style=flat-square&labelColor=17252b)](#クイックスタート)
[![必須のnpmランタイム依存関係：0](https://img.shields.io/badge/npm_runtime_dependencies-0-91d5b6?style=flat-square&labelColor=17252b)](#設計からローカル)

**必須のnpmランタイム依存関係はゼロ。解析はローカルで。**

**Barış Can Ateş**による個人プロジェクト · MITライセンス · clj-kondoを基盤に構築。

[使う理由](#エージェントが使うべき理由) · [パラメーターセットとマップキー](#提供側--パラメーターセット--利用側) ·
[対応スタック](#言語とフレームワークの対応状況) · [使用例](#再実行できる実例) ·
[クイックスタート](#クイックスタート) · [証拠の区分](#回答の読み方) · [制限](#制限) ·
[測定結果](#測定結果) · [完全ガイド](docs/GUIDE.md)

[English](README.md) | [Türkçe](README.tr.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Português (Brasil)](README.pt-BR.md) | 日本語 | [简体中文](README.zh-CN.md)

## エージェントが使うべき理由

テキスト検索で見つかるのは文字の並びです。呼び出しとコールバック、マップキーと偶然同じ綴りのキーワード、re-frameイベント経由で到達するハンドラーと一度も登録されないハンドラーを区別することはできません。推測で編集するエージェントは、存在を把握していなかった呼び出し元を壊してしまいます。Atlasは編集前に、それぞれの証拠を添えて関係を提供します。

| エージェントの問い | Atlasが回答で示すもの | MCPツール |
|---|---|---|
| 誰がこれを呼び出し、変更はどこまで届きうるか？ | 直接の呼び出し元、値としての使用とコールバック、推移的に依存するもの | `callers`, `blast_radius` |
| 関数はどのパラメーターセットを受け取り、各呼び出し元は何を渡すか？ | アリティ、destructuringで取り出すキー、`:or`のデフォルト値と任意のキー、キーワード引数、各呼び出し箇所が渡すキー | `signature_impact` |
| キーを追加、削除、必須化すると、どの呼び出し元が影響を受けるか？ | 新しい必須キーを渡さない、削除されたキーをまだ渡す、または廃止されたアリティを使う呼び出し元 | `added_keys`、`removed_keys`、`arities`、`base_graph`のいずれかを指定した`signature_impact` |
| このマップキーを誰が生成し、誰が利用するか？ | キーワードの生成箇所と利用箇所 | `key_flow` |
| この設定行には、同列のほかの行にあるキーが欠けているか？ | リテラルの表で、同列の行の大半が持つキーを欠く行 | `key_siblings` |
| このエンドポイントを何が処理し、どこで権限を確認するか？ | ハンドラー、順序付きmiddleware、プロジェクトが宣言した権限チェック | `route_authz`, `permission_routes` |
| このre-frameイベントが発火すると何が起きるか？ | dispatch箇所、ハンドラー、サブスクリプション、HTTPリクエスト | `event_flow` |
| このデータベース属性を誰が読み書きするか？ | 証明済みの読み取りと書き込み。未証明の参照も表示を維持 | `attribute_usage` |
| この変更に関係するテストはどれか？ | 静的に関連付けられたユニットテストとPlaywrightテスト、変更行のレビューコンテキスト | `tests_for`, `tests_covering`, `context_for_change` |
| このグラフが把握しているものと、見落としたものは何か？ | ソースのコミット、有効なアダプター、証拠の件数、カバレッジの警告 | `graph_info` |

Atlasは確認すべき場所を示します。それがバグかどうかの判断は、あなたとエージェントに委ねられます。

## 提供側 → パラメーターセット → 利用側

これは、ほとんどのツールが踏み込まない深さです。*誰が`line-total`を呼ぶか*だけでなく、その呼び出しがどのキーを渡し、関数がそのうちどれを読むかを示します。この例は、このリポジトリのフィクスチャです：[test/fixtures/keys/src/cart/core.clj](test/fixtures/keys/src/cart/core.clj)。

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

Clojureのマップパラメーターは開かれており、回答はその性質に沿って組み立てられます：

| キーの種類 | 意味 | Atlasでの報告方法 |
|---|---|---|
| **必須** | destructuringで取り出され、`:or`のデフォルト値がなく、本体がその値の判定も代替値へのフォールバックもしない | どの呼び出し元も渡していなければ検出事項となる。新たな必須キーは呼び出し元を「影響あり」にする |
| **任意** | `:or`のデフォルト値がある、デフォルト値付きで読む（`(get m :k d)`）、存在を問い合わせる（`(contains? m :k)`）、または値の判定や代替値へのフォールバックを行う箇所だけで使う（`(or k d)`、`(if k …)`、`(when-let [x k] …)`） | アリティに`optional:`として記載。欠けていても検出事項にはしない |
| **余分** | 呼び出し元が渡すが、関数は一度も読まない | `extra keys`に記載。何も壊さない。関数が実際に読み、その呼び出しには欠けているキーの誤記と思われる場合（`:username`に対する`:usrname`）のみ検出事項となり、その場合はHEURISTIC |
| **証明不能** | マップが転送される、ローカル変数に保持される、またはパラメーターが別の関数に渡される | 理由付きのUNKNOWN |

変更する前に、その変更が何をもたらすかを尋ねてください：

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

`added_keys`は、変更によって新たに**必須になる**キーを意味します。`base_graph`で二つのグラフを比較する場合、新しい本体が任意に読むだけのキーは、どの呼び出し元にも影響しません。

さらに、一つのキーをプロジェクト全体で追ってみましょう：

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

**このレベルでわかること、わからないこと：**

- ソースから読み取った静的なキー使用状況です。型チェックでもスキーマ検証でもなく、値は調べません。
- `key_flow`は**キーワードの出現箇所**を対象にします。`:total`を使うすべてのマップをまとめますが、一つのマップを生成元から読み取り先まで追跡するものではありません。
- ネストしたマップはパスを区別しません。`{:meta {:count 1}}`は`:meta`と`:count`を別々のキーとして生成し、`(get-in cart [:meta :count])`は両方を利用します。`signature_impact`がネストしたdestructuringと`get-in`について記録するのは、**外側のキー**のみです。
- 転送、マージ、`keyword`による生成、ローカル変数への保持が行われるマップはUNKNOWNとなり、回答にもそう示されます。

## 言語とフレームワークの対応状況

**言語：** Clojure（`.clj`）、ClojureScript（`.cljs`）、共有コード（`.cljc`）。EDNファイルからは、以下に挙げる設定とデータのフォームを取り込みます。TypeScript（`.ts`）を読むのは任意のPlaywright連携のためだけです。AtlasはJavaScriptやTypeScriptの解析ツールではありません。

| 分野 | 認識するもの | 得られるもの | 制限 |
|---|---|---|---|
| Clojureの基本要素 | Var、呼び出し、値としての使用、コールバック、マルチメソッド、プロトコル、レコード | 定義と依存関係 | dispatchの候補はヒューリスティック。実行時に解決されるVarは追跡しない |
| パラメーターセット | `defn`/`defn-`のアリティ、マップのdestructuring、`:or`、`:as`、`& {:keys […]}`、`schema.core/defn`、clj-kondo設定で`defn`としてlintするマクロ | 受け取るキー、任意のキー、各呼び出し箇所が渡すキー、シグネチャ変更の影響 | ネストしたパターンは外側のキーのみ。プラットフォームごとにパラメーターが異なる`.cljc`関数にはシグネチャを付けない。マクロで定義された関数の検出事項はヒューリスティック |
| マップキー | マップリテラル、`assoc`、`assoc-in`、`update`、`hash-map`、`dissoc`、キーワードによる参照、`get`、`get-in`、`select-keys`、`contains?`、destructuring | キーワードごとの生成・利用・削除箇所。リテラルの表における同列の行の欠落 | マップの同一性ではなくキーワードの出現箇所を扱う。threading形式の引数位置はヒューリスティック。未掲載の束縛マクロ内にある`:keys`のないパターンはリテラルとして読む |
| マクロ | プロジェクトの`.clj-kondo/config.edn`の`:lint-as`とフック、および`.clojure-atlas.edn`の`:lint-as` | clj-kondoに教えたマクロ内部の使用は証明済み | 教えていないマクロ内部の使用はヒューリスティックで、どのマクロかを示す |
| フロントエンドの状態 | `re-frame.alpha`を含む**re-frame** | イベントとサブスクリプションの登録、dispatch、サブスクリプションへの入力、購読元 | イベントIDを計算するdispatchはUNKNOWN。`reg-fx`とcofxハンドラーの処理内容や`:fx`の順序は追跡しない |
| バックエンドのルーティング | **Compojure**、**Reitit**、**Pedestal**のテーブルルート | パス、マウントされたルートのコピー、ハンドラー | bidi、compojure-api、Pedestalの詳細なマップ形式のルートは読まない |
| Middleware | **Ring**、Compojureの`wrap-routes`、Reititのルートデータと`ring-handler` | 外側のラッパーを含む順序付きチェーン | チェーンはヒューリスティック。Pedestalのservice-mapインターセプターは読まない。読み取れないラッピングはUNKNOWNとして報告 |
| ルートの認可 | プロジェクトが宣言する権限キー、middleware、関数 | どのルートがどの権限を確認するか | 小さな`.clojure-atlas.edn`が必要。なければ回答は「証明不能」であり、決して「なし」にはしない |
| ブラウザーのルーティング | **Reitit frontend**、**Secretary** | グラフ内のクライアントルートノード | まだ一覧表示するMCPツールはない |
| HTTPリクエスト | **cljs-ajax**、**cljs-http**、`js/fetch`、リクエストのeffectマップ | メソッドとパスでバックエンドルートに関連付けられたリクエスト箇所 | 実行時に組み立てるURLは関連付けられない場合がある |
| データ | **Datomic**、**DataScript**、**XTDB v1 / Crux** | 属性、トランザクションによる書き込み、クエリとpullによる読み取り | 未証明の参照はUNKNOWN行として残す。SQL（next.jdbc、HoneySQL）の解析は行わない |
| システムのライフサイクル | **Integrant**、**Mount**、**Component** | システムキー、登録、依存エッジ | 参照を持たないIntegrantシステムは読まない |
| スキーマ | **clojure.spec / cljs.spec**、**Malli** | 登録されたspec、Varに保持されたMalliスキーマ | Malliレジストリは読まない。スキーマをマップと照合しない |
| テスト | **clojure.test / cljs.test**、**Playwright**、リテラルのHiccupセレクター | 静的なテストの関連付け | Playwrightには任意のTypeScript 5が必要。型引数のない`test.extend`のフィクスチャにはクラスがないため関連付けない。HTTPや`resolve`経由でコードに到達するテストは関連付けない |
| プロジェクト構成 | **deps.edn**、**Leiningen**、**shadow-cljs**、**Babashka**、**Boot**、**Polylith** | ソースの検出、コンポーネントごとのグループ化 | ビルドエイリアスとタスクは解析しない |

アダプターが認識するのは特定のソースフォームであり、ライブラリのあらゆる使い方ではありません。`graph_info`は、**あなたの**プロジェクトでどのアダプターが有効になったかを報告します。Fulcro、Pathom、HoneySQL、next.jdbcは測定コーパスに含まれますが、専用アダプターがあるという意味ではありません。足りないものは[ロードマップ](ROADMAP.md)に記載しています。

## 再実行できる実例

以下の抜粋は、[corpus.json](corpus.json)で固定したコミットの公開プロジェクトから構築し、[`examples/`にコミットしたグラフ](examples/)に対する実際のサーバー出力です。`[S]`は証明済み、`[H]`はヒューリスティック、`[?]`は不明です。各ブロックの最初の行は、エージェントが行うMCPツール呼び出しです。MCPクライアントなしで自分で実行するには、このリポジトリのクローンから次を実行します：

```sh
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"signature_impact","arguments":{"fn":"clojure.realworld.user.core/login!","group_by":"none"}}}' \
  | node src/cli.ts mcp --graph examples/polylith-realworld.json.gz \
  | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).result.content[0].text'
```

上の`cart`の回答は、`node src/cli.ts build test/fixtures/keys -o /tmp/cart.json.gz`と、`--graph /tmp/cart.json.gz`を指定した同じパイプから得られます。

### 関数のパラメーターセットと呼び出し元が渡すものを並べて見る

polylith-realworldでは、`login!`はマップを一つ受け取り、destructuringで`:email`と`:password`を取り出します：

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

マップリテラルならキーがわかります。`login-input`として渡すマップは不明のままです。その行の`[S]`が証明するのは呼び出しであり、実行時のマップの内容ではありません。

<details>
<summary><strong><code>login!</code>が<code>:tenant-id</code>を必須にしたら？</strong></summary>

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

マップリテラルを渡す三つの呼び出し元は、新しいキーを省略しています。四つ目は`login-input`を転送するため、その行はUNKNOWNになります。何も変更されません。これは、まだ行っていない変更についての問いです。

</details>

<details>
<summary><strong><code>:email</code>の生成元と利用先</strong></summary>

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

`:email`は名前空間で修飾されていないため、このキーワードを使うすべてのマップをここでまとめます。ある生成元のマップが、ある利用先に届くことを証明するものではありません。

</details>

<details>
<summary><strong>リファクタリング前の呼び出し元</strong></summary>

integrantから：

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
<summary><strong>re-frameイベント：dispatch箇所とハンドラー</strong></summary>

re-frameから：

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

このつながりはイベントのキーワードを介するため、名前付き関数の呼び出し元を探しても見落とします。

</details>

<details>
<summary><strong>エンドポイントの前段にあるmiddlewareと、確認できなかったこと</strong></summary>

polylith-realworldから：

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

ハンドラーは証明済みです。ラッパーは順序どおりに検出されますが、middlewareの合成は実行時のコードなので`[H]`と表示されます。プロジェクトが権限ルールを宣言していないため、回答は「チェックなし」ではなく**未抽出**です。

</details>

<details>
<summary><strong>正直に示す見落とし：使われているのに定義がない名前</strong></summary>

clj-kondoが展開できない関数をマクロが生成している、next.jdbcから：

```text
callers {"var": "next.jdbc.types/as-other"}
```

```text
CALLERS next.jdbc.types/as-other — no definition matches "next.jdbc.types/as-other"; used at test/next/jdbc/sql_test.clj:290, test/next/jdbc_test.clj:559 but no definition was found
note: next.jdbc.types/as-other is used at test/next/jdbc/sql_test.clj:290, test/next/jdbc_test.clj:559 but no definition was found: probably defined by a macro clj-kondo cannot expand; add :lint-as for the macro in .clj-kondo/config.edn
note: use a fully qualified name (ns/name)
```

回答は、その名前が使われる場所と、解析で見えるようにする方法を示します。そのマクロに`:lint-as`エントリーを追加すると、同じ問いに証明済みの定義が返ります（[プロジェクト設定](docs/GUIDE.md#project-configuration)）。next.jdbcはコーパスに含まれますが、コミット済みのサンプルグラフには含まれません。

</details>

<details>
<summary><strong>変更行をレビューコンテキストと関連テストに変換</strong></summary>

polylith-realworldから：

```text
context_for_change {"changes": ["components/article/src/clojure/realworld/article/store.clj:60-80"], "limit": 3}
```

```text
CONTEXT_FOR_CHANGE components/article/src/clojure/realworld/article/store.clj:60-80 — 1 file(s), 3 changed symbol(s), 0 route(s), 0 attribute(s); risk LOW
counts: changed symbols=3 [S3]  callers outside the diff=9 [S9]  tests to run=24 [S24]
[... trimmed ...]
```

完全な回答には、変更された三つの定義、diff外の九つの呼び出し元、関連する24個のテストが列挙されます（[完全なトランスクリプト](docs/GUIDE.md#context_for_change)）。`LOW`が表すのは、グラフで行えたチェックです。安全性の保証ではありません。

</details>

[その他のトランスクリプト](examples/README.md) · [全ツールと完全な回答](docs/GUIDE.md#tools)

## クイックスタート

**前提条件：** Node.js **22.18+**とGit。JVMもBabashkaも不要です。

### 1. インストールしてグラフを構築する

**解析したいClojureプロジェクト**のルートから：

```sh
npm install --save-dev 'git+https://github.com/Bariscanates404/clojure-atlas.git'
npx clojure-atlas build
```

このパッケージはnpmレジストリにはありません。Gitからインストールし、その際にCLIをコンパイルします。確認したリビジョンに固定するには、URLの末尾に`#<commit-sha>`を追加してください。TypeScriptとNodeの型定義が必要なのは、このコンパイル手順だけです。インストールされたCLIに必須のnpmランタイム依存関係はありません。

グラフは`.clojure-atlas/graph.json.gz`に書き込まれます。初回ビルドでは、固定されたclj-kondoバイナリをダウンロードし、そのSHA-256を確認します。以降のビルドではキャッシュ済みのバイナリを使います。`.clojure-atlas/`を`.gitignore`に追加してください。

### 2. MCPクライアントを接続する

Claude Codeでは、プロジェクト設定をプレビューしてから書き込みます：

```sh
npx clojure-atlas init         # preview .mcp.json
npx clojure-atlas init --yes   # write it; existing servers are kept
```

次に、`graph_info`と、プロジェクト内の完全修飾された`ns/name`に対する`callers`を呼び出すようエージェントに依頼してください。

<details>
<summary><strong>別のMCPクライアント</strong></summary>

Atlasは**stdio経由のMCP**を使います。プロジェクトのルートから起動してください：

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

クライアントが別の場所でサーバーを起動する場合は、作業ディレクトリを設定するか、CLI、グラフ、リポジトリに絶対パスを使ってください。設定形式はクライアントによって異なります。

</details>

### 3. 変更後に再構築する

```sh
npx clojure-atlas build      # refresh the snapshot
npx clojure-atlas coverage   # resolution counts and unresolved names
```

watchモードはありません。`--repo`を指定すると、作業ツリーがグラフと一致しなくなった時点で、回答は`STALE`から始まります。再構築後は、新しいグラフを読み込むようMCPサーバーを再起動してください。

**マクロとclj-kondo設定。** Atlasは、`:lint-as`とフックを含むプロジェクトの`.clj-kondo/config.edn`を適用します。`defn`としてlintされるマクロにはシグネチャが付きます。clj-kondoに教えていないマクロでは、その内部の使用がヒューリスティックとなり、回答にマクロ名が示されます。任意の`.clojure-atlas.edn`で、ルートマクロと認可ルールを追加できます：[プロジェクト設定](docs/GUIDE.md#project-configuration)、[認可のフィクスチャ](test/fixtures/authz/.clojure-atlas.edn)。

## 回答の読み方

| マーカー | 意味 | 扱い方 |
|---|---|---|
| `[S]` `STATIC_PROVEN` | clj-kondoが解決した、またはソースのリテラルフォームから読み取った | 示された`file:line`をたどる |
| `[H]` `HEURISTIC` | 名前、ラッパー、threading形式の引数位置、dispatchの候補、Atlasが内部を見通せないマクロから推測した | それに基づいて行動する前に、示された行を開く |
| `[?]` `UNKNOWN` | 静的には判断できない | グラフが把握できる範囲の境界として扱う |

**空の回答は、不在の証明ではありません。** Atlasは「見つからない」「定義が見つからない」「このグラフにその機能がない」を区別します。`DEGRADED`は解析の一部が欠けていることを、`STALE`はスナップショットが古いことを警告します。テストがゼロなのは静的な関連付けが見つからなかったという意味で、コードがテストされていないという意味ではありません。
[区分と不在の詳細](docs/GUIDE.md#bands-and-absence)

## 制限

> [!WARNING]
> **Atlasが見落としうるもの。空の回答を信頼する前にお読みください。**
>
> - **clj-kondoに教えていないマクロが生成する定義。** プロジェクトの`defthing`や、clj-kondo設定を同梱しないライブラリのDSLは、グラフに含まれないVarを定義します。その呼び出し元は*未解決*として表示され、そのようなマクロ内部のコードはヒューリスティックにとどまります。コーパスでDataScriptの解決率が89.9%なのはこのためです。clj-kondoにマクロを教え（`.clj-kondo/config.edn`の`:lint-as`またはフック）、再構築すれば戻ってきます。回答にはマクロ名が示されます。
> - **実行時に決まるものすべて。** 計算されたシンボルから`resolve`で見つけるVar、マップから選ぶ関数、`apply`や`partial`の背後にある引数の数、`keyword`で生成するキー、マージまたは転送されるマップ。これらはUNKNOWNとして報告し、決して推測しません。
> - **Dispatch。** マルチメソッドやプロトコル呼び出しの対象は候補であり、証明ではありません。
> - **`ns`フォームのないスクリプト**（REPLチュートリアル）：day-of-datomicの解決率は74.3%です。
> - **clj-kondoがパースできないファイルと、2 MBを超えるファイル。** その定義が欠けるため、すべての回答が`DEGRADED`で始まり、該当ファイルを示します。

- **静的解析のみ。** 実行時に解決されるVar、データによって選ばれる関数、`keyword`で生成されるキーは追跡しません。
- **マップキーはキーワードの出現箇所です。** また、[上記](#提供側--パラメーターセット--利用側)のとおり、ネストしたマップからは外側のキーを取り込みます。パスを区別するデータフローはありません。
- **任意のキーは、本体の形から読み取ります。** 関数内で再束縛された名前は追跡しないため、実際には任意でないキーを任意とすることがあります。逆は起こりません。
- **マクロ。** clj-kondoがマクロ内部を見通せるのは、`:lint-as`エントリーかフックがある場合だけです。Atlasが列挙していない束縛マクロ内にある、`:keys`のない束縛パターンは、マップリテラルとして読み取ります。
- **Middlewareと権限。** チェーンはヒューリスティックです。ルートの権限には`.clojure-atlas.edn`が必要です。
- **増分ビルドはありません。** 変更後は再構築してください。
- **Windowsは未テストです。**

完全な一覧は[ガイド](docs/GUIDE.md#limits)、今後の計画は[ロードマップ](ROADMAP.md)にあります。

## 設計からローカル

コアCLIには**必須のnpmランタイム依存関係がありません**。Nodeの標準ライブラリ、解析用のclj-kondo、リポジトリのメタデータ用のGitを使います。グラフの構築と問い合わせは、あなたのマシン上で行います。アカウント不要、ホストされたインデックスなし、テレメトリなし。

### 要件

| コンポーネント | 役割 |
|---|---|
| Node.js 22.18+ | CLIとMCPサーバーを実行 |
| clj-kondo 2025.10.23 | ネイティブ解析ツール。一度ダウンロードしてキャッシュし、アーカイブのSHA-256は固定 |
| Git | Git経由のインストール、追跡対象ファイルの確認、スナップショットと古さの情報 |
| TypeScript 5、任意 | Playwrightのページオブジェクトとテストの解析のみ。Atlasと同じ環境で`npm i -D typescript@5` |

macOS arm64/x64、Linux arm64/x64、Windows x64用に固定されたバイナリがあります。開発とコーパス測定はmacOS arm64で行いました。プロキシの背後などでダウンロードできない場合、Atlasは`PATH`上の`clj-kondo`にフォールバックします。[プラットフォームとキャッシュの詳細](docs/GUIDE.md#requirements)

### セキュリティ

依存関係が少ないと攻撃対象領域は小さくなります。サプライチェーンの安全性を保証するものでは**ありません**。

- ダウンロードしたclj-kondoアーカイブは、固定されたSHA-256と照合し、不一致なら拒否します。`PATH`から取得する`clj-kondo`は、あなたがインストールしたものとして信頼し、そのハッシュとは照合しません。
- Atlasは、解析対象アプリケーションのJVM、シェルスクリプト、Nodeコードを起動しません。**プロジェクトのclj-kondoフックはclj-kondoによって解釈される**ため、その設定はリポジトリを解析する際に信頼するコードです。
- MCPサーバーはグラフを読み、Gitフック、フィルタードライバー、fsmonitorを無効にし、タイムアウト付きで読み取り専用のGitチェックを実行します。
- 結果はstdio経由でローカルに提供します。AIクライアントがその結果をどう扱うかは、別のプライバシー境界です。

これらは実装の特性であり、セキュリティ監査の結果ではありません。
[実行モデル](docs/GUIDE.md#security)

## 測定結果

[corpus.json](corpus.json)でそれぞれコミットを固定した**26個の公開リポジトリ**で測定しました。完全な表：[docs/COVERAGE.md](docs/COVERAGE.md)。

| 概要 | |
|---|---|
| グラフを構築できるリポジトリ | **26 / 26**、クラッシュなし、脱落したエッジ0 |
| 読み取った規模 | ソースファイル10,158、定義141,604、エッジ1,927,681 |
| プロジェクトの名前空間内で定義に関連付けられたVar使用 | **601,991 / 602,877（99.85%）**。未解決886 |
| リポジトリごと | 中央値100.0%。24 / 26が99.3%以上。それを下回る二つは89.9%と74.3% |
| clj-kondoがどの名前空間にも帰属させられなかったシンボル | **18,517**。集計して表示するが、関連付けず、比率にも含めない |
| clj-kondoが完全にはパースできなかったファイル | 24 |
| 回答を手作業で確認したベンチマーク | 肯定的な問い14 / 14、不在を問う問い7 / 7 |

これらの数値は、これらのプロジェクトでコードの*静的*構造がどの程度グラフに届くかを示します。あなたのプロジェクトについての約束ではありません。clj-kondoに教えていないマクロを基盤にしたコードベースは、設定するまでMetabaseよりDataScriptに近い結果になります。`npx clojure-atlas coverage`は、あなたのプロジェクトについて同じ件数を出力します。

### 件数を併記した解決率

**解決率**は、clj-kondoがプロジェクトの名前空間に帰属させたVar使用についての`resolved / (resolved + unresolved)`です。解析の正確さを表すものではありません。ライブラリの使用は対象外で、**名前空間が不明の使用**も対象外です。後者はclj-kondoがどの名前空間にも帰属させられなかったシンボルで、未知のマクロが束縛したローカル変数か、グラフが見落としたVar使用かもしれません。静的には両者を区別できないため、生の件数として示し、比率には決して含めません。

| リポジトリ | 解決済み | 未解決 | 解決率 | 名前空間不明（生の件数、比率の対象外） |
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
| **全26リポジトリ** | | | **中央値100.0%。24 / 26が99.3%以上** | **合計18,517** |

† [docs/COVERAGE.mdで説明](docs/COVERAGE.md#repos-under-95-resolution-rate-or-with-unknown-namespace-usages-above-5-of-resolved)

**定義の変更は改善ではありません。** このプロジェクトの最初のカバレッジレポートは`resolved + unresolved + unknown`を分母とし、Babashkaを87.0%と表示していました。現在の99.6%は上記の定義を使っています。差のほとんどは分母の違いです。名前空間が不明の使用は比率から外れただけで、解決済みになったわけではなく、2,176件が今も最後の列に残っています。二つの定義の間で比率を比較しないでください。

### 抽出で実際に得られたもの

Atlasが読み取る内容の変更を、それぞれのフィクスチャやテストとともに、上の比率とは分けて示します。

| 変更 | 測定結果 | 証拠 |
|---|---|---|
| マップリテラルと束縛パターンを区別 | コーパスの26リポジトリ全体で、生成箇所が**5,475**増加（返されるベクター内のマップ、hiccup、ルートデータ、`(d/transact conn [{…}])`）。**703**個のキーワード値を、証明済みの「destructuring」利用箇所として記載しなくなった。**5,268**個の`:keys` / `:as` / `:or`エントリーを、生成されたキーとして記載しなくなった | [テスト](test/keys-adapter.test.ts)、フィクスチャ：[authz](test/fixtures/authz/)、[データ](test/fixtures/data/)、[reframe](test/fixtures/reframe/) |
| clj-kondoが同じパラメーター数を数える場合だけシグネチャを記録 | `defn`としてlintされるフォームで定義された**532**個の関数にシグネチャが付いた（Metabaseで216）。プラットフォームごとにパラメーターが異なる**22**個の`.cljc`関数に、誤ったシグネチャを付けなくなった（DataScriptの`first-seq`は`[xs xs]`として読まれていた）。`s/defn`の注釈をパラメーターとして数えなくなった | [テスト](test/signatures.test.ts) |
| 通常のパラメーターがどう使われるかを読み取る | 読み取り箇所が完全にわかる通常のパラメーター：**3,496 → 4,184**（パラメーターをdestructuringする`let`、`(-> m :k)`、`contains?`） | [テスト](test/signatures.test.ts) |
| 外側のRing/Compojure middlewareを読み取る | polylith-realworld：`POST /api/articles`のmiddlewareエントリーが**0 → 11** | [ベンチマークq13](docs/BENCHMARK.md#positive-questions)、[フィクスチャ](test/fixtures/ring-middleware/) |
| 別の名前空間のフロントエンドルートテーブルを読み取る | Logseq：クライアントルートノードが**0 → 17** | [カバレッジ](docs/COVERAGE.md)、[ベンチマークq14](docs/BENCHMARK.md#positive-questions) |
| `re-frame.alpha`を認識 | alpha名前空間経由の登録とdispatchを抽出 | [フィクスチャ](test/fixtures/reframe/src/app/alpha.cljs) |
| プロジェクトのclj-kondo設定を適用 | プロジェクトの`:lint-as`エントリーとフックが解析に加わる | [フィクスチャ](test/fixtures/project-config/)、[テスト](test/config.test.ts) |
| プロジェクトの`node_modules`なしでPlaywrightフィクスチャに型を付ける | `test.extend<…>`フィクスチャからページオブジェクトを受け取るテストが、`@playwright/test`が未インストールのチェックアウトでもページオブジェクトのメンバーに関連付けられる。フィクスチャでは**0 → 12**リンク | [テスト](test/playwright-fixtures.test.ts)、[フィクスチャ](test/fixtures/browser-fixtures/) |

最初の三行は、同じ固定コミットのグラフを変更前後で比較しています。この比較では、ほかの種類のエッジは一切変わらず、解決済み、未解決、名前空間不明の件数も同じです。これらはマップキーとパラメーターについて読み取る内容の変更であり、解決率の変更ではありません。

### ベンチマーク

記録済みのベンチマークは、**肯定的な問い14 / 14**（期待する行40 / 40を検出）と**不在を問う問い7 / 7**に合格しています。ソースと照らして回答を手作業で確認した小さな回帰ベンチマークであり、あなたのプロジェクトの正確さを推定するものではありません。[問い、結果、方法](docs/BENCHMARK.md)

## Atlasのテスト方法

エージェントは渡されたものを信頼するため、誤った回答は回答がないことよりも高くつきます。

| 確認項目 | 状態 |
|---|---|
| 自動テスト | **873**、すべて成功（`npm test`）。修正したバグには、修正なしでは失敗するテストを追加 |
| ソース行カバレッジ | **99.79%**（`npm run test:coverage`。98%未満でゲートが失敗） |
| 型チェック | `npm run typecheck`でエラーなし |
| 継続的インテグレーション | [GitHub Actions](.github/workflows/ci.yml)で、`main`へのpushとすべてのプルリクエストごとに、Linux上のNode.js 22と24で型チェックとカバレッジゲートを実行 |
| フィクスチャ | [test/fixtures](test/fixtures)内の小さなClojureコードベース。期待するグラフの各行を手作業で確認 |
| 実際のリポジトリ | 26個の公開プロジェクトをクラッシュなし、脱落エッジ0で構築 |
| ベンチマーク | 回答を手作業で確認した肯定的な問いと不在を問う問い（[docs/BENCHMARK.md](docs/BENCHMARK.md)） |
| 独立したレビュー | 変更を書いていないレビュアーが、実行可能な再現例を使って誤った回答を探す。確認された不具合はそれぞれテストとともに修正 |
| 信頼できないリポジトリ | 悪意のあるフィクスチャにより、Git設定、フィルタードライバー、サブモジュール、プロジェクトのTypeScript、特殊なファイル名、停止しないclj-kondoフックが、何も実行せず、何もハングさせないことを確認 |

最も重要なのは不在を問う問いです。空のリストが「なし」と読めてしまう代わりに、事実に応じてAtlasが「見つからない」「未抽出」「機能低下」と答えることを確認します。成功するテストスイートとベンチマークは、これらのフィクスチャとリポジトリについての証拠です。あなたのリポジトリでの正しい回答を保証しません。各行の区分を読んでください。

## コントリビュート

**私たちのClojure X線ツールを、一緒に作りましょう！**

役立つ貢献は、小さなClojureの例でもかまいません。「このライブラリはこの二つをつないでいるので、Atlasでも見えるべきだ」というものです。フィクスチャと期待するグラフ行を追加するか、アダプターを書いてください。どちらも歓迎しますし、Atlasが誤った回答や誤解を招く回答を返した事例も歓迎します。

```sh
npm ci
npm test
npm run test:coverage   # 98% source line-coverage gate
npm run typecheck
```

CLIがTypeScriptなのは、通常のNodeとして配布するためです。Clojureの解析はclj-kondoが行います。
[貢献者向けガイド](CONTRIBUTING.md) · [ロードマップ](ROADMAP.md) · [ツールリファレンス](docs/GUIDE.md)

## クレジットとライセンス

作者は**Barış Can Ateş**です。ドキュメントとアートワークを含めて[MITライセンス](LICENSE)です。Michiel Borkentによる**[clj-kondo](https://github.com/clj-kondo/clj-kondo)**を基盤とし、コーディングエージェントへのインターフェースに**[MCP](https://modelcontextprotocol.io)**を使っています。コーパスと例に含まれる公開プロジェクトの作者の皆さんに感謝します。これらのプロジェクトはそれぞれのライセンスを維持します。

*すべてのClojureユーザーのために。*
