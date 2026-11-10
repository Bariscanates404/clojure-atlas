# clojure-atlas

**For the sake of all Clojurians.**

*Tüm Clojure'cular için.*

[English](README.md) | Türkçe | [Deutsch](README.de.md) | [Español](README.es.md) | [Português (Brasil)](README.pt-BR.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md)

Bir Clojure, ClojureScript veya .cljc kod tabanının yapısal haritası. Yapay zeka kodlama ajanlarına MCP araçları olarak sunulur.
Ajan tabanlı geliştirme için yapılmıştır. MIT lisanslıdır. Barış Can Ateş tarafından oluşturulmuştur.

## Nedir

Clojure düzenleyen bir ajan, ilişkileri genellikle metin araması ile bulur. Metin araması, bir çağrıyı aynı adlı bir
keyword'den ayıramaz. `reg-event-fx` ile kaydedilmiş bir handler'ı, bir var'a ulaşan bir route'u ya da `partial`'a
verilmiş bir fonksiyonu göremez. "Bunu hiçbir şey çağırmıyor" cümlesini de güvenle söyleyemez. clojure-atlas,
projenin üzerinde bir kez [clj-kondo](https://github.com/clj-kondo/clj-kondo) çalıştırır, analizini bir grafa çevirir
(tanımlar, çağrılar, değer kullanımları, re-frame event'leri, route'lar, sistem anahtarları, veri nitelikleri, map
anahtarları, testler) ve bu graf hakkındaki soruları MCP üzerinden yanıtlar. Her yanıt satırı, nasıl kanıtlandığını
söyleyen bir band taşır. Her boş yanıt da neyin arandığını ve grafın bunu bilmesinin mümkün olup olmadığını söyler.

## Hızlı başlangıç

```sh
npm i -D clojure-atlas
npx clojure-atlas build
npx clojure-atlas init
```

`build`, `.clojure-atlas/graph.json.gz` dosyasını yazar. integrant deposunda şunu yazdırır:

```
clojure-atlas: 7 files, 138 definitions, 296 nodes, 1481 edges; resolution rate of var usages in recognized project namespaces 100.0% (442 of 442), 0 usages in an unknown namespace; 0.7 s -> .clojure-atlas/graph.json.gz
```

`init`, yazacağı proje `.mcp.json` dosyasını gösterir ve yalnızca `--yes` ile yazar:

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

`.mcp.json` içindeki diğer sunucular korunur.

### Claude Code

`npx clojure-atlas init --yes`, Claude Code'un okuduğu proje `.mcp.json` dosyasını yazar. Sunucu elle de eklenebilir:

```sh
claude mcp add clojure-atlas -- npx clojure-atlas mcp --graph .clojure-atlas/graph.json.gz --repo .
```

### Diğer MCP istemcileri

Sunucu, stdio üzerinden MCP konuşur. Çoğu istemci şu JSON'u kabul eder:

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

### Komutlar

```
usage:
  clojure-atlas build [dir] [-o .clojure-atlas/graph.json.gz]
  clojure-atlas mcp [--graph .clojure-atlas/graph.json.gz] [--repo <clone>] [--max-distance N]
  clojure-atlas coverage [graph]
  clojure-atlas init [--yes]
```

- `build`, `dir` dizinini (varsayılan `.`) analiz eder ve grafı yazar.
- `mcp`, bir grafı sunar. `--repo` verildiğinde, çalışma ağacı grafın oluşturulduğu ağaç değilse ya da ajanın `base`
  olarak verdiği commit grafın commit'inin `--max-distance` commit'ten daha gerisindeyse (varsayılan 20) ya da grafın
  commit'i `base`'in ilerisindeyse veya ondan ayrışmışsa, yanıtlar bir `STALE` satırı ile başlar. Çalışma ağacı denetimi
  en fazla her 3 saniyede bir tekrarlanır, bu yüzden bir düzenleme o andan sonraki ilk çağrıdan itibaren görünür.
- `coverage`, bir grafın coverage satırını ve en sık çözülemeyen adlarını yazdırır.
- `init`, sunucuyu projenin `.mcp.json` dosyasına ekler.

Kodu değiştirdikten sonra grafı yeniden oluşturun. Sunulan graf kendini güncellemez:

```
STALE: the working tree is not the snapshot this graph describes (2 uncommitted file(s) now, 1 at build); rebuild with clojure-atlas build.
```

Projenin kendi `.clj-kondo` yapılandırması dikkate alınır. Proje kökündeki isteğe bağlı `.clojure-atlas.edn`, genel
adaptörlerin tahmin edemediği şeyleri ekler: def benzeri makrolar için `:lint-as`, `:route-macros` ve route yetkilendirme
anahtarları olan `:route-authz`, `:permission-middleware` ve `:permission-fns`.

## Araçlar

Aşağıdaki her örnek, [examples/](examples/) içindeki bir graf üzerinde `clojure-atlas mcp` çıktısıdır. Yalnızca
işaretlenen yerlerde kısaltılmıştır. mount, dört namespace'i birden fazla dosyada tanımlar, bu yüzden yanıtları
bir `DEGRADED` satırı ile başlar (bkz. sonraki bölüm). `[S]`, `[H]` ve `[?]` band'lerdir ve sonraki bölümde açıklanır.

### graph_info

Grafın hangi commit'i anlattığı, her adaptörün ne bulduğu ve band sayıları. Soru: integrant grafı neleri biliyor?

```
graph integrant @ master sha bcad6bcf35b62d3a32a453dc26b6d3a4d659dc01 built 2026-11-10T02:17:12.010Z: 296 nodes, 1481 edges
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

Bir tanımın doğrudan çağıranları. Soru: `integrant.core/dependent-keys` fonksiyonunu kim çağırıyor?

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

`include_references: true` ile değer kullanımlarını, callback'leri, kayıtlı handler'ları, makro açılımlarını,
dispatch adaylarını ve rebinding'leri de listeler. Syntax-quote'lu bir makro gövdesinde adı geçen bir var (compojure'ın
`routes` adını veren `defroutes`'u) çağrı değil, HEURISTIC bir referanstır.

### blast_radius

Bir tanımın geçişli bağımlıları. Soru: `integrant.core/ref?` üzerindeki bir değişiklik nelere ulaşabilir?

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

Arity'ler, destructure edilen anahtarlar ve her çağıranın ne verdiği. Soru: `integrant.core/init` nasıl çağrılıyor?

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

Diff modunda (`base_graph`, ya da `added_keys` / `removed_keys` / `arities`) bir imza değişikliğinin etkilediği
çağıranları listeler.

### route_authz

Bir backend route'unun handler'ı, middleware zinciri ve izin kontrolü. Soru: polylith-realworld'de `POST /api/articles` isteğini ne
karşılıyor ve hangi middleware onu sarıyor?

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

On birinci satır, sonraki sayfada, compojure'ın `wrap-routes` ile uygulanan yetkilendirme middleware'idir:

```
  11. clojure.realworld.rest-api.middleware/wrap-authorization  bases/rest-api/src/clojure/realworld/rest_api/api.clj:45 [H]  heuristic match  (#10 wrapper)
```

Bir route'un sarmalanması okunamadığında bölüm "none" yerine bunu söyler (usermanager, `GET /user/list`):

```
GET /user/list @usermanager.main/my-handler (base usermanager.main/my-handler): middleware: not extracted (UNKNOWN)
```

Route tablosunun dışında sarılan middleware HEURISTIC olarak okunur: Ring sarmalayıcıları, `->`, `->>`, iç içe
çağrılar, `wrap-routes` ve reitit'in `ring-handler`'ının dış sarmalayıcıları ile üçüncü argümandaki
`{:middleware [...]}`. Orada bulunan bir izin middleware'i kontrol sayılır. reitit ve pedestal route verisindeki
middleware (`:middleware`, `:interceptors`) route'un kendisinden okunur. Sarmalama tam okunamadığında route_authz
şunu der: `no permission check found in what could be read (...); not provable that none exists`. Hiçbir router'ın
ulaşmadığı bir route ağacında middleware UNKNOWN olarak gösterilir; bugün bu her pedestal route'tur, çünkü bir
pedestal service map'inin interceptor'ları okunmaz. Graf'ın çözemediği bir handler `handler: not resolved (UNKNOWN)`
olarak görünür. Burada izin hükmü "not provable" (kanıtlanamaz) olur, çünkü bu proje `.clojure-atlas.edn` içinde bir
yetkilendirme modeli tanımlamaz.

### permission_routes

Bir izni kontrol eden her route. Soru: mount içinde hangi route'lar `:admin` ister?

```
DEGRADED: 4 namespace(s) defined in more than one file (app.conf, app.example, tapp.conf, ...) share one node each, so calls into them are heuristic; an empty or missing answer may be a gap in the graph, not absence
PERMISSION_ROUTES :admin — no permission matches ":admin"
note: capability route_authz is absent: an empty answer is not proof of absence
note: use the exact permission name, with its namespace if it has one
searched: names, ids and kind-prefixed ids; check the spelling or pass the fully qualified name
```

### attribute_usage

Bir Datomic, datascript veya XTDB niteliğinin kanıtlanmış okuyucuları ve yazıcıları. Soru: mount'un örnek uygulamasında
`:order/bid` niteliğini kim yazıyor?

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

Bir re-frame event'inin dispatch edenleri ve handler'ı ya da bir subscription'ın handler'ı, girdileri ve aboneleri.
Event'i değişmez bir keyword olmayan bir dispatch UNKNOWN olarak listelenir.
Soru: re-frame'in todomvc örneğinde `:delete-todo` event'ini kim dispatch ediyor?

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

Bir tanıma doğrudan ya da 3 derinliğe kadar ulaşan unit testler. Soru: hangi testler
`usermanager.model.user-manager/get-user-by-id` fonksiyonunu çalıştırıyor?

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

Bir dosyaya, tanıma, selector'a ya da route'a ulaşan browser testleri (Playwright page object'leri ve testleri, clojure-atlas'ın
yanına isteğe bağlı peer `typescript` olarak kuruluysa TypeScript 5 ile okunur; analiz edilen deponun kopyası asla
kullanılmaz). Örnek depoların hiçbirinde bunlar yoktur ve yanıt bunu söyler. Soru: hangi browser
testleri `mount.core/start` fonksiyonuna ulaşıyor?

```
DEGRADED: 4 namespace(s) defined in more than one file (app.conf, app.example, tapp.conf, ...) share one node each, so calls into them are heuristic; an empty or missing answer may be a gap in the graph, not absence
TESTS_COVERING mount.core/start — 0 browser test(s) in 0 spec file(s)
note: capability selectors is available but not used (nothing in this codebase switches it on): an empty answer is not proof of absence
note: capability browser_tests is available but not used (nothing in this codebase switches it on): an empty answer is not proof of absence
note: no browser test reaches this target through selectors, page objects or requests
tests: none (searched: selector, page-object and request edges)
```

### key_flow

Tek bir map anahtarının üreticileri ve tüketicileri. Soru: compojure'ın `:compojure/path` istek anahtarı nerede yazılıyor
ve nerede okunuyor?

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

Literal bir map tablosunun, kardeş satırların çoğunda bulunan bir anahtarı eksik olan satırları. Soru: re-frame'in
`test/re_frame/subs/alpha_test.cljs` tablosunda anahtarı eksik bir satır var mı?

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

Eksik anahtar kanıtlanmıştır. Satırda olması gerekip gerekmediği okuyucuya bırakılır.

### context_for_change

Her review için tek çağrı: değişen semboller, diff dışındaki çağıranlar, route'lar, nitelikler, çalıştırılacak testler
ve eklenecek testler. Değişen bir route'un çıkarılmış yetkilendirmesi yoksa risk LOW değil UNKNOWN'dur. Soru: polylith-realworld'ün article store dosyasının 60-80. satırlarındaki bir değişiklik neye
dokunuyor?

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

Her araç ayrıca `base` (ajanın baktığı commit), sayfalama (`offset`, `limit`, `section`) ve `group_by` (`component`,
`file`, `none`) alır. Daha fazla çıktı örneği [examples/README.md](examples/README.md) içindedir.

## Band'ler ve yokluk

Her satırın bir band'i vardır:

- **STATIC_PROVEN** `[S]`: analizci iki ucu da çözdü (clj-kondo var'ı çözdü ya da literal form kaynakta var).
- **HEURISTIC** `[H]`: bir ad eşleşmesi, bir threaded slot ya da bir dispatch adayı. Üzerine işlem yapmadan önce
  belirtilen satırı açın. Örnekler: defmulti'sinden ulaşılan bir defmethod (dispatch değeri metodu çalışma zamanında
  seçer), bir key table bulgusu.
- **UNKNOWN** `[?]`: statik olarak karar verilemez, bu yüzden sınır olarak listelenir ve hiçbir zaman izlenmez.
  Örnekler: `binding` ve `with-redefs` rebinding'leri, rolü (okuma ya da yazma) kanıtlanmamış bir nitelik keyword'ü,
  signature_impact içindeki bir `apply` ya da `partial` kullanımı.

`counts:` satırları band toplamlarını verir, örneğin `callers=4 [S4]` ya da `findings=2 [H2]`.

Boş bir yanıt hiçbir zaman çıplak bir boş liste değildir. Şu biçimlerden birini alır:

- **none**: şey vardır ve hiçbir şey onunla ilişkili değildir. `callers: none (searched: call edges into this definition)`.
- **not found**: kod tabanında böyle bir şey yoktur. `no definition matches "integrant.core/stop"`.
- **capability off**: graf yanıtlayamaz, çünkü o tür olgunun adaptörü çıkaracak bir şey bulamadı ya da
  yapılandırılmadı. `capability route_authz is absent: an empty answer is not proof of absence`. Buna bağlı bir bölüm
  `not extracted (route_authz is absent)` yazar, asla "none" yazmaz. Okunamayan bir middleware zinciri `not extracted (UNKNOWN)`
  yazar.

Grafın kendisi eksik olduğunda, build günlüğü, graph_info ve her yanıt bir `DEGRADED` satırı ile başlar. Satır,
clj-kondo'nun hiç ayrıştıramadığı dosyaları, kurtarabildiği sözdizimi hatalı dosyaları (bazı formlar eksik olabilir),
okunmayan izlenen dosyaları ve nedenini (gizli ya da build klasörü, symlink, silinmiş dosya), atlanan 2 MB'tan büyük
dosyaları (bir `.edn` dosyasında verisi, anahtarları ve config'i eksiktir), birden fazla dosyada tanımlanan
namespace'leri (bunların kullanımları `duplicate-namespace` üzerinden HEURISTIC'tir) ve bir ucu node olmadığı için
düşürülen edge'leri adlandırır. Bulunamayan bir ad büyük olasılıkla böyle bir dosyada duruyorsa, yanıt o dosyayı
adlandırır. Bir dosyanın ayrıştırılamadığı shadow-cljs'ten:

```
DEGRADED: 1 file(s) could not be parsed (src/dev/demo/test_fail.cljs), so their definitions and calls are missing; 2 file(s) have syntax errors but were analyzed (src/dev/demo/errors.cljs, src/main/shadow/cljs/devtools/config.clj); some forms in them may be missing; 1 namespace(s) defined in more than one file (demo.http) share one node each, so calls into them are heuristic; an empty or missing answer may be a gap in the graph, not absence
CALLERS demo.test-fail/a-failing-test — no definition matches "demo.test-fail/a-failing-test"
note: demo.test-fail/a-failing-test probably lives in src/dev/demo/test_fail.cljs, which could not be parsed: its definitions are not in the graph, so this is not a spelling problem
note: use a fully qualified name (ns/name)
```

Sözdizimi hataları olan ama analiz edilebilen bir dosyanın bulunduğu biff'ten: tanım yine de eksik olabilir, bu
yüzden yanıt hem yazım ipucunu hem makro ipucunu korur:

```
DEGRADED: 1 file(s) have syntax errors but were analyzed (libs/sqlite/src/com/biffweb/sqlite/impl/execute.clj); some forms in them may be missing; 1 namespace(s) defined in more than one file (tasks) share one node each, so calls into them are heuristic; an empty or missing answer may be a gap in the graph, not absence
CALLERS com.biffweb.sqlite.impl.execute/execute — no definition matches "com.biffweb.sqlite.impl.execute/execute"; used at libs/sqlite/src/com/biffweb/sqlite.clj:110, libs/sqlite/src/com/biffweb/sqlite.clj:121, libs/sqlite/src/com/biffweb/sqlite/impl/kv.clj:23, libs/sqlite/src/com/biffweb/sqlite/impl/kv.clj:30, libs/sqlite/src/com/biffweb/sqlite/impl/kv.clj:44 but no definition was found
note: com.biffweb.sqlite.impl.execute/execute is used at libs/sqlite/src/com/biffweb/sqlite.clj:110, libs/sqlite/src/com/biffweb/sqlite.clj:121, libs/sqlite/src/com/biffweb/sqlite/impl/kv.clj:23, libs/sqlite/src/com/biffweb/sqlite/impl/kv.clj:30, libs/sqlite/src/com/biffweb/sqlite/impl/kv.clj:44 but no definition was found: probably defined by a macro clj-kondo cannot expand; add :lint-as for the macro in .clj-kondo/config.edn
note: com.biffweb.sqlite.impl.execute/execute may live in libs/sqlite/src/com/biffweb/sqlite/impl/execute.clj, which has syntax errors; some forms may be missing, so besides a spelling problem a form kondo could not read is possible
note: use a fully qualified name (ns/name)
```

clj-kondo çalıştırması zaman aşımına uğramış bir dosyada ya da git'in izlediği ama build'in analiz etmediği bir
dosyada olması muhtemel bir bulunamayan ad, o dosyayı aynı şekilde adlandırır.

Kullanılan ama hiçbir yerde tanımlanmayan bir ad genellikle clj-kondo'nun açamadığı bir makroyla üretilir. Yanıt, adın
nerede kullanıldığını ve neyin eklenmesi gerektiğini söyler. next.jdbc'den:

```
CALLERS next.jdbc.types/as-other — no definition matches "next.jdbc.types/as-other"; used at test/next/jdbc/sql_test.clj:290, test/next/jdbc_test.clj:559 but no definition was found
note: next.jdbc.types/as-other is used at test/next/jdbc/sql_test.clj:290, test/next/jdbc_test.clj:559 but no definition was found: probably defined by a macro clj-kondo cannot expand; add :lint-as for the macro in .clj-kondo/config.edn
note: use a fully qualified name (ns/name)
```

Bir ıskayı, bir şeyin var olmadığının kanıtı olarak değil, kapsama hakkında bir ifade olarak okuyun.

## Kapsam

[docs/COVERAGE.md](docs/COVERAGE.md), her biri [corpus.json](corpus.json) içinde bir sha'ya sabitlenmiş 26 herkese açık
depoyu ölçer. Ana metriğin adı **resolution rate**: clj-kondo'nun bir proje namespace'ine atfettiği var kullanımlarından,
grafın bir tanıma bağladığı payı gösterir. Kütüphane var'larının kullanımları sayılmaz. clj-kondo'nun hiçbir
namespace'e atfedemediği semboller ham bir sayı olarak, **unknown namespace**, raporlanır ve orandan çıkarılır.

26 depodan 24'ü %95 ve üzerindedir. Altta kalan ikisi:

| depo | çözülen | çözülemeyen | resolution rate | unknown namespace |
|---|---|---|---|---|
| datascript | 4392 | 496 | 89.9% | 1255 |
| day-of-datomic | 84 | 29 | 74.3% | 1 |

Doküman bunları orada yazdığı gibi açıklar:

> **unresolved**: a var created by a project macro clj-kondo does not know (datascript's record constructors), or
> a name in a REPL script with no ns form that clj-kondo files under a namespace not defining it (day-of-datomic's
> tutorials).

Çeviri: **unresolved** (çözülemeyen), clj-kondo'nun tanımadığı bir proje makrosunun oluşturduğu bir var'dır
(datascript'in record constructor'ları) ya da ns formu olmayan bir REPL betiğindeki, clj-kondo'nun onu tanımlamayan bir
namespace altına koyduğu bir addır (day-of-datomic'in eğitim betikleri).

Altı depo daha, unknown-namespace sayıları çözülenin %5'inin üzerinde olduğu için listelenmiştir: babashka,
cider-nrepl, fulcro, pedestal, shadow-cljs ve usermanager. Tablo bir ondalık basamak yazdırır, bu yüzden 100.0% hâlâ
birkaç çözülemeyen kullanım içerebilir (metabase 111, penpot 13, xtdb-v1 3). Her iki tür de, bir depo makroları için
bir clj-kondo yapılandırması getirdiğinde ya da bunları `.clojure-atlas.edn` içinde `:lint-as` altında adlandırdığında
küçülür. Corpus bunların hiçbiri eklenmeden ölçülür.

## Benchmark

[docs/BENCHMARK.md](docs/BENCHMARK.md), corpus depoları hakkında 21 soru içerir. Beklenen her yanıt, araç olmadan,
kaynakta elle kontrol edildi ve file:line bilgisi [bench/questions.json](bench/questions.json) içindedir.

- **Positive soruları: 14 üzerinden 14 geçti.** Bir soru, yanıt beklenen her tanımı adlandırıp başka hiçbir şey
  adlandırmadığında geçer. Bulunan beklenen öğe: 40 üzerinden 40. Yanıtlanan öğe: 40.
- **Absence soruları: 7 üzerinden 7 geçti.** Doğru yanıt, hiçbir şeyin olmadığıdır (*none*, *not-found*,
  *used-undefined* ya da *capability-off*). Yanıt bu tür bir yokluğu belirtmeli ve hiçbir şey adlandırmamalıdır.

İlk on iki positive soru ilk koşudan önce sabitlendi ve ilk koşu 12 üzerinden 11 aldı. Iskalanan soru (`re-frame.alpha`
üzerinden re-frame kayıtları) builder'da bir fixture ile düzeltildi ve soru olduğu gibi tutuldu. Sonradan iki soru eklendi: compojure middleware zinciri (q13) ve bir reitit
frontend route'u (q14).

## Gereksinimler

- Node.js 22.18 ya da daha yeni. JVM yok, babashka yok, global kurulum yok.
- İlk `build` sırasında clj-kondo 2025.10.23 bir kez indirilir, sabitlenmiş bir sha256 ile doğrulanır ve
  `$XDG_CACHE_HOME/clojure-atlas` içinde önbelleğe alınır (varsayılan `~/.cache/clojure-atlas`; Windows'ta
  `%LOCALAPPDATA%\clojure-atlas`). Kaynak:
  [resmi clj-kondo sürümü](https://github.com/clj-kondo/clj-kondo/releases). İlk koşu şunu yazdırır:

  ```
  clojure-atlas: downloading clj-kondo 2025.10.23 (macos-aarch64) once, to <cache>/clojure-atlas/clj-kondo-2025.10.23-macos-aarch64/clj-kondo
  ```

- Çevrimdışıyken ya da bir proxy arkasında: `clj-kondo`'yu PATH'e koyun. Node'un `fetch`'i `HTTPS_PROXY` değerini yok
  sayar, bu yüzden indirme proxy arkasında başarısız olur ve clojure-atlas PATH üzerindeki clj-kondo'yu kullanır.
  Yanlış sha256'lı bir indirme reddedilir, hiçbir zaman çalıştırılmaz.
- İsteğe bağlı: Playwright page object'lerini ve testlerini okumak için TypeScript 5 (clojure-atlas'ın yanında
  `npm i -D typescript@5`). İsteğe bağlı bir peer bağımlılıktır. Olmadan bu okuma kapalıdır ve graph_info ile browser
  test yanıtları bulunan her Playwright projesi için nedenini söyler.
- Sabitlenmiş clj-kondo ikili dosyası olan platformlar: macOS arm64, macOS x64, Linux x64, Linux arm64, Windows x64.
  Diğer her platform için PATH üzerinde clj-kondo gerekir. Bu sürüm macOS arm64 üzerinde geliştirildi ve ölçüldü.
  Windows test edilmedi.

## Güvenlik

Build dosyaları okur. Yalnızca clj-kondo'yu (sabitlenmiş ikili dosyayı ya da PATH üzerindekini) ve `git ls-files`
komutunu çalıştırır; analiz edilen deponun kodunu Node, JVM ya da shell ile asla çalıştırmaz. TypeScript, analiz edilen
depodan değil, clojure-atlas'ın kendi kurulumundan yüklenir. clj-kondo, projenin `.clj-kondo` config'ini uygular; orada
bildirilen hook'ları clj-kondo'nun kendisi yorumlar, clj-kondo çalıştıran her editörde olduğu gibi. MCP sunucusu yalnızca
graf dosyasını okur ve `--repo` ile salt okunur git komutları çalıştırır. Her git çağrısı, deponun kendi komut
çalıştıran ayarlarını (`core.fsmonitor`, filter driver'ları, hook'lar) yok sayar, asla soru sormaz ve bir zaman aşımı
vardır. Her clj-kondo çalıştırmasının da bir zaman aşımı vardır: hiç dönmeyen bir hook build'i değil, kendi batch'ini
götürür (DEGRADED altında listelenir). Git hiçbir zaman bir submodule'ün içinde çalışmaz (kendi config'ini clojure-atlas kapatamaz), bu yüzden bir
submodule'ün dosyaları her zaman değişmiş sayılır. Her iki program da PATH üzerinde bulunan mutlak bir yoldan başlatılır,
hiçbir zaman analiz edilen dizinden değil; projenin `:output` ve `:analysis` clj-kondo ayarları, grafın ihtiyaç duyduğu
ayarlarla değiştirilir.

## Neden TypeScript?

Çünkü `npx` sorunsuz çalışır: kurulacak bir JVM yok ve kullanıcının makinesinde derlenecek bir şey yok. Clojure
analizinin kendisini clj-kondo yapar. clojure-atlas onun çıktısını ve kaynak formlarını okur ve grafı oluşturur.
Adaptör katkıları iki dilde de kabul edilir: bir adaptör, küçük bir Clojure fixture'ı ve ondan beklenen graf
satırlarıyla tanımlanır. Böylece bir kütüphanenin semantiğini Clojure'da anlatabilir ve biri bunu taşıyabilir ya da
TypeScript'i kendiniz yazabilirsiniz.

## Sınırlar

- **Yalnızca statik.** Çalışma zamanında çözülen bir var izlenmez. Sabit bir sembolün `requiring-resolve`, `resolve`
  ya da `ns-resolve` ile çözülmesi bir HEURISTIC referanstır; çalışma zamanında üretilen bir sembol ya da veriyle
  seçilen bir fonksiyon değildir; proje var'ları dinamik çözdüğünde callers ve blast_radius bunu söyler. Yalnızca
  dinamik olarak okunan ya da yazılan bir map anahtarı izlenmez. Koda multimethod'lar, `resolve`/`apply` ya da HTTP
  fixture'ları üzerinden ulaşan testler sayılmaz.
- **Heuristic kısımlar**: multimethod ve protocol dispatch (`may_dispatch_to`), bazı compojure handler'ları
  (`heuristic match` olarak gösterilir), compojure ve Ring middleware zincirleri, middleware factory çağrıları, reitit
  gerektirmeyen namespace'lerdeki reitit frontend route tabloları (projede herhangi bir yerde `reitit.frontend`
  kullanılıyorsa okunur), syntax-quote'lu makro gövdelerinde adı geçen var'lar, clj-kondo'nun açamadığı bir proje makrosunun içindeki
  kullanımlar (`unexpanded-macro` üzerinden), birden fazla dosyada tanımlanan bir namespace'in kullanımları
  (`duplicate-namespace` üzerinden), threaded anahtar slotları, transact ya da query çağrısı dışındaki query
  literal'leri, key_siblings bulguları.
- **Proje makroları**: clj-kondo bir makroyu yalnızca projenin `.clj-kondo` config'i ona bir `:lint-as` ya da hook
  verdiğinde açar (ya da `.clojure-atlas.edn` onu `:lint-as` altında adlandırır). Birini ekleyip yeniden build
  ederseniz, içindeki kullanımlar yine STATIC_PROVEN olur.
- **Sarmalanması okunamayan middleware** `middleware: not extracted (UNKNOWN)` olarak bildirilir, "none" olarak değil.
- **Ayrıştırılamayan dosyalar ve 2 MB'tan büyük dosyalar**: tanımları ve çağrıları graftan eksik kalır. Her yanıt bu durumda onları adlandıran bir
  `DEGRADED` satırı ile başlar.
- **Pedestal service-map interceptor'ları** okunmaz, bu yüzden her pedestal route'un middleware'i UNKNOWN'dır.
- **Route yetkilendirmesi** `.clojure-atlas.edn` gerektirir. Bu dosya olmadan route_authz "not provable" der ve
  permission_routes capability'yi absent olarak bildirir.
- **Henüz desteklenmeyenler**: bidi route'ları, compojure-api, pedestal verbose map route'ları, malli registry'leri,
  ref içermeyen integrant sistemleri. Bkz. [ROADMAP.md](ROADMAP.md).
- **datascript ve day-of-datomic** daha az çözer (89.9% ve 74.3%): datascript, record constructor'larını clj-kondo'nun
  tanımadığı bir makro ile tanımlar. day-of-datomic'in eğitim betikleri ns formu olmayan REPL betikleridir. Bkz.
  [Kapsam](docs/COVERAGE.md).
- **Unknown-namespace sembolleri** (bilinmeyen makroların bağladığı local'ler, deftype ya da proxy alanları) sayılır,
  bağlanmaz.
- **Artımlı build ya da watch yok.** Değişiklikten sonra yeniden oluşturun. Sunucu anlayabildiğinde `STALE` ile uyarır.
- **Windows test edilmedi.** clj-kondo indirmesi için proxy desteklenmez.

## Katkıda bulunma

```sh
npm ci
npm test                                    # all tests
npm run test:coverage                       # the gate: 98% line coverage of src/
npm run typecheck
node scripts/coverage.ts <corpus-dir>       # rebuilds docs/COVERAGE.md from clones at the corpus.json shas
node bench/score.ts <corpus-dir>            # scores the benchmark questions
```

Bir adaptör eklemek ya da genişletmek için bir fixture ile başlayın: `test/fixtures/<name>/` altında küçük bir Clojure
kod tabanı ve üretmesi gereken her graf satırını içeren, kaynağa karşı elle gözden geçirilmiş bir `expected.txt`. Bunu
`test/build-fixtures.test.ts` içinde listeleyin, ardından satırlar eşleşene kadar adaptörü `src/build/adapters/` altında
yazın. Bkz. [CONTRIBUTING.md](CONTRIBUTING.md).

## Teşekkürler

- Clojure analizini Michiel Borkent'in [clj-kondo](https://github.com/clj-kondo/clj-kondo) projesi yapar.
- [Model Context Protocol](https://modelcontextprotocol.io), ajanların sunucuyla konuşma biçimidir.
- Corpus depoları ve yazarları: coverage ve benchmark onların herkese açık kodu üzerinde ölçülür.

## Lisans

MIT. Bkz. [LICENSE](LICENSE). Barış Can Ateş tarafından oluşturulmuştur.
