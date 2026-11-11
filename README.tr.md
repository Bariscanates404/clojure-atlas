# clojure-atlas

**Ajanlarla kod geliştirmek için tasarlandı: Clojure kod tabanınızın, yapay zekâ ajanınıza MCP üzerinden sunulan yapısal bir haritası.**

Bir ajan Clojure, ClojureScript veya `.cljc` kodunu düzenlemeden önce fonksiyonu kimin çağırdığını, fonksiyonun hangi parametre kümesini aldığını, her çağıranın hangi map anahtarlarını geçirdiğini ve gövdenin hangilerini okuduğunu; hangi rotaların, re-frame olaylarının ve testlerin ona bağlı olduğunu bilmelidir. clojure-atlas bu haritayı makinenizde [clj-kondo](https://github.com/clj-kondo/clj-kondo) ile oluşturur ve **13 MCP aracı** üzerinden yanıt verir. Her satır `file:line` gösterir ve kanıtlanmış, sezgisel veya bilinmeyen olduğunu belirtir.

![clojure-atlas: sağlayıcı, map parametre kümesi, tüketici; MCP araçlarının arkasında yerel bir graf olarak çağrılar, olaylar, rotalar ve testler](docs/assets/atlas.svg)

[![Sürekli entegrasyon](https://github.com/Bariscanates404/clojure-atlas/actions/workflows/ci.yml/badge.svg)](https://github.com/Bariscanates404/clojure-atlas/actions/workflows/ci.yml)
[![Lisans: MIT](https://img.shields.io/badge/license-MIT-91d5b6?style=flat-square&labelColor=17252b)](LICENSE)
[![Node.js: 22.18+](https://img.shields.io/badge/Node.js-22.18%2B-91d5b6?style=flat-square&labelColor=17252b)](#gereksinimler)
[![MCP: stdio](https://img.shields.io/badge/MCP-stdio-91d5b6?style=flat-square&labelColor=17252b)](#hızlı-başlangıç)
[![Zorunlu npm çalışma zamanı bağımlılığı: 0](https://img.shields.io/badge/npm_runtime_dependencies-0-91d5b6?style=flat-square&labelColor=17252b)](#tasarımı-gereği-yerel)

**Zorunlu npm çalışma zamanı bağımlılığı yok. Yerel analiz.**

**Barış Can Ateş** tarafından geliştirilen kişisel bir proje · MIT lisanslı · clj-kondo üzerine kurulu.

[Neden](#bir-ajan-neden-kullanmalı) · [Parametre kümeleri ve map anahtarları](#sağlayıcı--parametre-kümesi--tüketici) ·
[Desteklenen teknoloji yığını](#dil-ve-framework-desteği) · [Örnekler](#yeniden-çalıştırabileceğiniz-gerçek-örnekler) ·
[Hızlı başlangıç](#hızlı-başlangıç) · [Kanıt sınıfları](#bir-yanıtı-okuma) · [Sınırlamalar](#sınırlamalar) ·
[Ölçümler](#ölçümler) · [Tam kılavuz](docs/GUIDE.md)

[English](README.md) | Türkçe | [Deutsch](README.de.md) | [Español](README.es.md) | [Português (Brasil)](README.pt-BR.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md)

## Bir ajan neden kullanmalı

Metin araması bir yazılışı bulur. Bir çağrıyı callback'ten, bir map anahtarını tesadüfen aynı yazılan bir keyword'den veya re-frame olayı üzerinden ulaşılan bir handler'ı hiç kaydedilmemiş olandan ayıramaz. Tahminle düzenleme yapan bir ajan, hiç görmediği bir çağıranı bozar. Atlas, düzenlemeden önce ilişkileri ve her birinin kanıtını ona verir.

| Ajanın sorusu | Atlas'ın yanıtında sundukları | MCP araçları |
|---|---|---|
| Bunu kim çağırıyor ve değişikliğim nereye ulaşabilir? | Doğrudan çağıranlar, değer olarak kullanımlar ve callback'ler, geçişli bağımlılar | `callers`, `blast_radius` |
| Fonksiyon hangi parametre kümesini alıyor ve her çağıran ne geçiriyor? | Ariteler, destructuring ile çıkarılan anahtarlar, `:or` varsayılanları ve isteğe bağlı anahtarlar, keyword argümanları, her çağrı noktasının geçirdiği anahtarlar | `signature_impact` |
| Bir anahtar ekler, kaldırır veya zorunlu kılarsam hangi çağıranlar etkilenir? | Yeni bir zorunlu anahtarı geçirmeyen, kaldırılmış bir anahtarı hâlâ geçiren veya kaldırılmış bir ariteyi kullanan çağıranlar | `added_keys`, `removed_keys`, `arities` veya `base_graph` ile `signature_impact` |
| Bu map anahtarını kim üretiyor ve kim tüketiyor? | Keyword'ün üretildiği ve tüketildiği noktalar | `key_flow` |
| Bu yapılandırma satırında benzer satırlarda bulunan bir anahtar eksik mi? | Literal bir tabloda, benzer satırların çoğunda bulunan bir anahtarı içermeyen satırlar | `key_siblings` |
| Bu endpoint'i ne işliyor ve izin nerede kontrol ediliyor? | Handler, sıralı middleware, projenin bildirdiği izin kontrolleri | `route_authz`, `permission_routes` |
| Bu re-frame olayı tetiklendiğinde ne oluyor? | Dispatch noktaları, handler, abonelikler, HTTP istekleri | `event_flow` |
| Bu veritabanı özniteliğini kim okuyor veya yazıyor? | Kanıtlanmış okumalar ve yazmalar; kanıtlanmamış referanslar görünür tutulur | `attribute_usage` |
| Hangi testler bu değişiklikle ilişkili? | Statik olarak bağlanan birim testleri ve Playwright testleri, değişen satırlar için inceleme bağlamı | `tests_for`, `tests_covering`, `context_for_change` |
| Bu graf ne biliyor ve neleri kaçırdı? | Kaynak commit, etkin adaptörler, kanıt sayıları, kapsam uyarıları | `graph_info` |

Atlas, bakılacak yeri gösterir. Bunun bir hata olup olmadığına siz ve ajanınız karar verirsiniz.

## Sağlayıcı → parametre kümesi → tüketici

Çoğu aracın inemediği ayrıntı düzeyi budur: yalnızca *`line-total` fonksiyonunu kimin çağırdığı* değil, çağrının hangi anahtarları aktardığı ve fonksiyonun bunlardan hangilerini okuduğu. Örnek, bu depodaki bir fixture'dır: [test/fixtures/keys/src/cart/core.clj](test/fixtures/keys/src/cart/core.clj).

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

Clojure'da bir map parametresi açıktır ve yanıt buna göre oluşturulur:

| Anahtar türü | Anlamı | Atlas nasıl raporlar |
|---|---|---|
| **Zorunlu** | Destructuring ile çıkarılır, `:or` varsayılanı yoktur ve gövde onu ne sınar ne de yerine alternatif bir değer kullanır | Hiçbir çağıran geçirmiyorsa bir bulgudur; yenisi çağıranları "etkilenen" yapar |
| **İsteğe bağlı** | `:or` varsayılanı vardır, varsayılanla okunur (`(get m :k d)`), varlığı sorgulanır (`(contains? m :k)`) veya yalnızca değerin sınandığı ya da alternatif değer kullanıldığı yerlerde kullanılır (`(or k d)`, `(if k …)`, `(when-let [x k] …)`) | Aritede `optional:` olarak listelenir; eksik olması hiçbir zaman bulgu değildir |
| **Fazladan** | Çağıran geçirir, fonksiyon hiç okumaz | `extra keys` altında listelenir. Hiçbir şeyi bozmaz. Yalnızca fonksiyonun okuduğu ve o çağrıda eksik olan bir anahtarın yazım hatasına benziyorsa bulgudur (`:username` yanında `:usrname`); bu durumda HEURISTIC olur |
| **Kanıtlanamayan** | Map iletilir, yerel bir değişkende tutulur veya parametre başka bir fonksiyona aktarılır | Gerekçesiyle birlikte UNKNOWN |

Bir değişikliği yapmadan önce neye yol açacağını sorun:

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

`added_keys`, değişikliğin **zorunlu kılmaya** başladığı anahtarları ifade eder. `base_graph` ile iki graf karşılaştırıldığında, yeni gövdenin yalnızca isteğe bağlı olarak okuduğu bir anahtar hiçbir çağıranı etkilemez.

Ve bir anahtarı proje boyunca takip edin:

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

**Bu düzey neyi ifade eder, neyi etmez:**

- Kaynaktan okunan statik anahtar kullanımıdır. Tip kontrolü veya şema doğrulaması değildir; hiçbir değer incelenmez.
- `key_flow`, **keyword geçişleri** üzerinde çalışır. `:total` kullanan her map'i birleştirir; tek bir map'i oluşturulduğu yerden okunduğu yere kadar izlemez.
- İç içe map'ler yol duyarlı değildir. `{:meta {:count 1}}`, `:meta` ve `:count` anahtarlarını iki ayrı anahtar olarak üretir; `(get-in cart [:meta :count])` ikisini de tüketir. `signature_impact`, iç içe destructuring ve `get-in` için yalnızca **dış anahtarı** kaydeder.
- İletilen, birleştirilen, `keyword` ile oluşturulan veya yerel bir değişkende tutulan map UNKNOWN olur ve yanıt bunu belirtir.

## Dil ve framework desteği

**Diller:** Clojure (`.clj`), ClojureScript (`.cljs`) ve paylaşılan kod (`.cljc`). EDN dosyaları aşağıda listelenen yapılandırma ve veri formlarını sağlar. TypeScript (`.ts`) yalnızca isteğe bağlı Playwright entegrasyonu için okunur; Atlas bir JavaScript veya TypeScript analizörü değildir.

| Alan | Tanınanlar | Elde ettikleriniz | Sınırlamalar |
|---|---|---|---|
| Temel Clojure | Var'lar, çağrılar, değer olarak kullanımlar, callback'ler, multimethod'lar, protokoller, record'lar | Tanımlar ve bağımlılık ilişkileri | Dispatch adayları sezgiseldir; çalışma zamanında çözümlenen var'lar izlenmez |
| Parametre kümeleri | `defn`/`defn-` ariteleri, map destructuring, `:or`, `:as`, `& {:keys […]}`, `schema.core/defn`, clj-kondo yapılandırmanızın `defn` olarak lint ettiği makrolar | Alınan anahtarlar, isteğe bağlı anahtarlar, her çağrı noktasının geçirdiği anahtarlar, imza değişikliğinin etkisi | İç içe kalıplarda yalnızca dış anahtar; parametreleri platforma göre değişen bir `.cljc` fonksiyonuna imza verilmez; makroyla tanımlanmış bir fonksiyona ilişkin bulgular sezgiseldir |
| Map anahtarları | Map literal'ları, `assoc`, `assoc-in`, `update`, `hash-map`, `dissoc`, keyword ile erişim, `get`, `get-in`, `select-keys`, `contains?`, destructuring | Her keyword için üretme, tüketme ve kaldırma noktaları; literal tablolardaki benzer satır eksikleri | Map kimliği değil, keyword geçişleri; threading içindeki konumlar sezgiseldir; listelenmemiş bir binding makrosunda `:keys` içermeyen kalıp literal olarak okunur |
| Makrolar | Projenin `.clj-kondo/config.edn` dosyasındaki `:lint-as` ve hook'lar, ayrıca `.clojure-atlas.edn` içindeki `:lint-as` | clj-kondo'ya öğretilmiş bir makronun içindeki kullanımlar kanıtlanmıştır | Öğretilmemiş bir makronun içindeki kullanımlar sezgiseldir ve hangi makro olduğu belirtilir |
| Frontend durumu | `re-frame.alpha` dahil **re-frame** | Olay ve abonelik kayıtları, dispatch'ler, abonelik girdileri, aboneler | Olay kimliği hesaplanan bir dispatch UNKNOWN olur; `reg-fx` ve cofx handler'larının yaptıkları ve `:fx` sırası izlenmez |
| Backend yönlendirmesi | **Compojure**, **Reitit**, **Pedestal** tablo rotaları | Yollar, bağlanmış rota kopyaları, handler'lar | bidi, compojure-api ve Pedestal ayrıntılı map rotaları okunmaz |
| Middleware | **Ring**, Compojure `wrap-routes`, Reitit rota verileri ve `ring-handler` | Dış sarmalayıcılar dahil sıralı zincirler | Zincirler sezgiseldir; Pedestal service-map interceptor'ları okunmaz; okunamayan sarmalama UNKNOWN olarak raporlanır |
| Rota yetkilendirmesi | Projenizin bildirdiği izin anahtarları, middleware ve fonksiyonlar | Hangi rotaların hangi izni kontrol ettiği | Küçük bir `.clojure-atlas.edn` gerekir; yoksa yanıt "kanıtlanamıyor" olur, asla "yok" olmaz |
| Tarayıcı yönlendirmesi | **Reitit frontend**, **Secretary** | Graftaki istemci rotası düğümleri | Henüz hiçbir MCP aracı bunları listelemez |
| HTTP istekleri | **cljs-ajax**, **cljs-http**, `js/fetch`, istek effect map'leri | Metot ve yola göre backend rotalarıyla birleştirilen istek noktaları | Çalışma zamanında oluşturulan bir URL birleştirilemeyebilir |
| Veri | **Datomic**, **DataScript**, **XTDB v1 / Crux** | Öznitelikler, transaction yazmaları, sorgu ve pull okumaları | Kanıtlanmamış referanslar UNKNOWN satırları olarak tutulur; SQL (next.jdbc, HoneySQL) analizi yoktur |
| Sistem yaşam döngüsü | **Integrant**, **Mount**, **Component** | Sistem anahtarları, kayıtlar, bağımlılık kenarları | Referans içermeyen Integrant sistemleri okunmaz |
| Şemalar | **clojure.spec / cljs.spec**, **Malli** | Kayıtlı spec'ler, var'larda tutulan Malli şemaları | Malli registry'leri okunmaz; şemalar map'lere karşı doğrulanmaz |
| Testler | **clojure.test / cljs.test**, **Playwright**, literal Hiccup seçicileri | Statik test bağlantıları | Playwright için isteğe bağlı TypeScript 5 gerekir; tip argümanı olmadan `test.extend` ile gelen bir fixture'ın sınıfı yoktur, bu yüzden bağlanmaz; koda HTTP veya `resolve` üzerinden ulaşan testler bağlanmaz |
| Proje düzeni | **deps.edn**, **Leiningen**, **shadow-cljs**, **Babashka**, **Boot**, **Polylith** | Kaynak keşfi, bileşene göre gruplama | Build alias'ları ve görevleri analiz edilmez |

Bir adaptör, bir kütüphanenin her kullanımını değil belirli kaynak formlarını tanır. `graph_info`, **sizin** projenizde hangi adaptörlerin etkinleştiğini raporlar. Fulcro, Pathom, HoneySQL ve next.jdbc ölçüm korpusunda yer alır; bu, özel adaptörleri olduğu anlamına gelmez. Eksikler [yol haritasında](ROADMAP.md) listelenir.

## Yeniden çalıştırabileceğiniz gerçek örnekler

Aşağıdaki alıntılar, herkese açık projelerin [corpus.json](corpus.json) içinde sabitlenmiş commit'lerinden oluşturulan ve [`examples/` içine commit edilmiş graflar](examples/) üzerindeki gerçek sunucu çıktılarıdır. `[S]` kanıtlanmış, `[H]` sezgisel, `[?]` bilinmeyen anlamına gelir. Her bloğun ilk satırı, ajanınızın yaptığı MCP araç çağrısıdır. Birini MCP istemcisi olmadan kendiniz çalıştırmak için bu deponun bir klonundan:

```sh
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"signature_impact","arguments":{"fn":"clojure.realworld.user.core/login!","group_by":"none"}}}' \
  | node src/cli.ts mcp --graph examples/polylith-realworld.json.gz \
  | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).result.content[0].text'
```

Yukarıdaki `cart` yanıtları, `node src/cli.ts build test/fixtures/keys -o /tmp/cart.json.gz` komutundan ve `--graph /tmp/cart.json.gz` ile aynı pipe'tan gelir.

### Bir fonksiyonun parametre kümesi ve yanında çağıranların geçirdikleri

polylith-realworld içinde `login!` tek bir map alır ve destructuring ile `:email` ve `:password` anahtarlarını çıkarır:

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

Literal bir map anahtarlarını gösterir. `login-input` olarak geçirilen map bilinmeyen kalır: o satırdaki `[S]`, çalışma zamanındaki bir map'in içeriğini değil çağrıyı kanıtlar.

<details>
<summary><strong><code>login!</code>, <code>:tenant-id</code> anahtarını zorunlu kılmaya başlarsa ne olur?</strong></summary>

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

Literal map geçiren üç çağıran yeni anahtarı içermez. Dördüncüsü `login-input` aktarır; bu yüzden satırı UNKNOWN olur. Hiçbir şey değiştirilmez; bu, henüz yapmadığınız bir değişiklik hakkında bir sorudur.

</details>

<details>
<summary><strong><code>:email</code> üretenler ve tüketenler</strong></summary>

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

`:email` namespace ile nitelenmemiştir; bu yüzden keyword'ü kullanan her map burada gruplanır. Bu, bir üreticinin map'inin bir tüketiciye ulaştığını kanıtlamaz.

</details>

<details>
<summary><strong>Refactoring öncesi çağıranlar</strong></summary>

integrant'tan:

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
<summary><strong>Bir re-frame olayı: dispatch noktaları ve handler</strong></summary>

re-frame'den:

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

Bağlantı bir olay keyword'ü üzerinden kurulur; dolayısıyla adlandırılmış bir fonksiyonun çağıranlarını aramak bunu kaçırır.

</details>

<details>
<summary><strong>Bir endpoint'in önündeki middleware ve kontrol edilemeyenler</strong></summary>

polylith-realworld'den:

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

Handler kanıtlanmıştır. Sarmalayıcılar sırasıyla bulunur ve middleware bileşimi çalışma zamanı kodu olduğundan `[H]` ile işaretlenir. Proje izin kuralı bildirmediği için yanıt "kontrol yok" değil, **çıkarılmadı** olur.

</details>

<details>
<summary><strong>Dürüstçe belirtilen bir eksik: kullanılan ama hiç tanımlanmayan bir ad</strong></summary>

Bir makronun clj-kondo'nun açamadığı fonksiyonları ürettiği next.jdbc'den:

```text
callers {"var": "next.jdbc.types/as-other"}
```

```text
CALLERS next.jdbc.types/as-other — no definition matches "next.jdbc.types/as-other"; used at test/next/jdbc/sql_test.clj:290, test/next/jdbc_test.clj:559 but no definition was found
note: next.jdbc.types/as-other is used at test/next/jdbc/sql_test.clj:290, test/next/jdbc_test.clj:559 but no definition was found: probably defined by a macro clj-kondo cannot expand; add :lint-as for the macro in .clj-kondo/config.edn
note: use a fully qualified name (ns/name)
```

Yanıt, adın nerede kullanıldığını ve nasıl görünür kılınacağını gösterir. Makro için bir `:lint-as` girdisiyle aynı soru kanıtlanmış bir tanım döndürür ([proje yapılandırması](docs/GUIDE.md#project-configuration)). next.jdbc korpustadır, commit edilmiş örnek graflar arasında değildir.

</details>

<details>
<summary><strong>İnceleme bağlamına ve ilgili testlere dönüştürülen değişmiş satırlar</strong></summary>

polylith-realworld'den:

```text
context_for_change {"changes": ["components/article/src/clojure/realworld/article/store.clj:60-80"], "limit": 3}
```

```text
CONTEXT_FOR_CHANGE components/article/src/clojure/realworld/article/store.clj:60-80 — 1 file(s), 3 changed symbol(s), 0 route(s), 0 attribute(s); risk LOW
counts: changed symbols=3 [S3]  callers outside the diff=9 [S9]  tests to run=24 [S24]
[... trimmed ...]
```

Tam yanıt, değişen üç tanımı, diff dışındaki dokuz çağıranı ve ilgili 24 testi listeler ([tam transkript](docs/GUIDE.md#context_for_change)). `LOW`, grafın yapabildiği kontrolleri tanımlar. Bir güvenlik garantisi değildir.

</details>

[Daha fazla transkript](examples/README.md) · [Tam yanıtıyla her araç](docs/GUIDE.md#tools)

## Hızlı başlangıç

**Ön koşullar:** Node.js **22.18+** ve Git. JVM ve Babashka gerekmez.

### 1. Kurun ve bir graf oluşturun

**Analiz etmek istediğiniz Clojure projesinin** kök dizininden:

```sh
npm install --save-dev 'git+https://github.com/Bariscanates404/clojure-atlas.git'
npx clojure-atlas build
```

Paket npm registry'de değildir; Git'ten kurulur ve kurulum CLI'ı derler. İncelediğiniz revizyonu sabitlemek için URL'ye `#<commit-sha>` ekleyin. TypeScript ve Node tip tanımları yalnızca bu derleme adımında gerekir; kurulu CLI'ın zorunlu npm çalışma zamanı bağımlılığı yoktur.

Graf `.clojure-atlas/graph.json.gz` konumuna yazılır. İlk build sabitlenmiş clj-kondo binary'sini indirir ve SHA-256 değerini kontrol eder; sonraki build'ler önbellekteki binary'yi kullanır. `.clojure-atlas/` dizinini `.gitignore` dosyanıza ekleyin.

### 2. MCP istemcinizi bağlayın

Claude Code için önce proje yapılandırmasını önizleyin, ardından yazın:

```sh
npx clojure-atlas init         # preview .mcp.json
npx clojure-atlas init --yes   # write it; existing servers are kept
```

Ardından ajandan `graph_info` çağırmasını ve projenizden tam nitelikli bir `ns/name` üzerinde `callers` çağırmasını isteyin.

<details>
<summary><strong>Başka bir MCP istemcisi</strong></summary>

Atlas, **stdio üzerinden MCP** kullanır. Projenizin kök dizininden başlatın:

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

İstemci sunucuları başka bir yerde başlatıyorsa çalışma dizinini ayarlayın veya CLI, graf ve depo için mutlak yollar kullanın. Yapılandırma biçimleri istemciler arasında farklılık gösterir.

</details>

### 3. Değişikliklerden sonra yeniden oluşturun

```sh
npx clojure-atlas build      # refresh the snapshot
npx clojure-atlas coverage   # resolution counts and unresolved names
```

Watch modu yoktur. `--repo` kullanıldığında çalışma ağacı artık grafla eşleşmiyorsa yanıtlar `STALE` ile başlar. Yeni grafı yüklemesi için yeniden oluşturmadan sonra MCP sunucusunu yeniden başlatın.

**Makrolar ve clj-kondo yapılandırmanız.** Atlas, `:lint-as` ve hook'lar dahil projenin `.clj-kondo/config.edn` yapılandırmasını uygular. `defn` olarak lint edilen makro bir imza alır; clj-kondo'ya öğretilmemiş makronun içindeki kullanımlar sezgisel olur ve yanıt makronun adını belirtir. İsteğe bağlı `.clojure-atlas.edn`, rota makroları ve yetkilendirme kuralları ekler: [proje yapılandırması](docs/GUIDE.md#project-configuration), [yetkilendirme fixture'ı](test/fixtures/authz/.clojure-atlas.edn).

## Bir yanıtı okuma

| İşaret | Anlamı | Nasıl kullanılmalı |
|---|---|---|
| `[S]` `STATIC_PROVEN` | clj-kondo tarafından çözümlenmiş veya literal bir kaynak formundan okunmuş | Gösterilen `file:line` konumuna gidin |
| `[H]` `HEURISTIC` | Bir addan, sarmalayıcıdan, threading konumundan, dispatch adayından veya Atlas'ın içini göremediği bir makrodan çıkarılmış | Buna dayanarak işlem yapmadan önce gösterilen satırı açın |
| `[?]` `UNKNOWN` | Statik olarak belirlenemez | Bunu grafın bildiklerinin sınırı olarak değerlendirin |

**Boş bir yanıt, yokluğun kanıtı değildir.** Atlas, "hiçbiri bulunamadı", "tanım bulunamadı" ve "bu grafta yetenek yok" durumlarını ayırır. `DEGRADED`, analizin bir bölümünün eksik olduğunu; `STALE`, anlık görüntünün eski olduğunu bildirir. Sıfır test, kodun test edilmediği değil, statik bir bağlantı bulunamadığı anlamına gelir.
[Kanıt sınıfları ve yokluk hakkında ayrıntılar](docs/GUIDE.md#bands-and-absence)

## Sınırlamalar

> [!WARNING]
> **Atlas'ın kaçırabilecekleri. Boş bir yanıta güvenmeden önce bunu okuyun.**
>
> - **clj-kondo'ya öğretilmemiş bir makronun oluşturduğu tanımlar.** Projedeki bir `defthing` veya clj-kondo yapılandırması sunmayan bir kütüphane DSL'i, grafın içermediği var'lar tanımlar: çağıranları *çözümlenmemiş* görünür ve böyle bir makronun içindeki kod yalnızca sezgiseldir. DataScript'in korpusta 89.9% çözümleme oranına sahip olmasının nedeni budur. Makroyu clj-kondo'ya öğretin (`.clj-kondo/config.edn` içinde `:lint-as` veya bir hook), yeniden oluşturun; geri gelirler. Yanıt makronun adını belirtir.
> - **Çalışma zamanında belirlenen her şey.** Hesaplanan bir sembolden `resolve` ile bulunan var, bir map'ten seçilen fonksiyon, `apply` veya `partial` arkasındaki argüman sayısı, `keyword` ile oluşturulan anahtar, birleştirilen veya iletilen map. Bunlar UNKNOWN olarak raporlanır, asla tahmin edilmez.
> - **Dispatch.** Multimethod veya protokol çağrısının hedefleri kanıt değil, adaydır.
> - **`ns` formu olmayan betikler** (REPL eğitimleri): day-of-datomic 74.3% çözümleme oranına sahiptir.
> - **clj-kondo'nun ayrıştıramadığı dosyalar ve 2 MB üzerindeki dosyalar.** Tanımları eksik olur; bu durumda her yanıt `DEGRADED` ile başlar ve bu dosyaları adlandırır.

- **Yalnızca statik.** Çalışma zamanında çözümlenen var'lar, veriye göre seçilen fonksiyonlar ve `keyword` ile oluşturulan anahtarlar izlenmez.
- **Map anahtarları keyword geçişleridir** ve iç içe map'ler, [yukarıda](#sağlayıcı--parametre-kümesi--tüketici) anlatıldığı gibi dış anahtarları sağlar. Yol duyarlı veri akışı yoktur.
- **İsteğe bağlı anahtarlar gövdenin yapısından okunur.** Fonksiyon içinde yeniden bağlanan bir ad izlenmez; bu yüzden isteğe bağlı olmayan bir anahtar isteğe bağlı olarak adlandırılabilir. Tersi olmaz.
- **Makrolar.** clj-kondo bir makronun içini yalnızca `:lint-as` girdisi veya hook ile görür. Atlas'ın listelemediği bir binding makrosundaki `:keys` içermeyen binding kalıbı, map literal'ı olarak okunur.
- **Middleware ve izinler.** Zincirler sezgiseldir; rota izinleri `.clojure-atlas.edn` gerektirir.
- **Artımlı build yoktur.** Değişikliklerden sonra yeniden oluşturun.
- **Windows test edilmemiştir.**

Tam liste [kılavuzda](docs/GUIDE.md#limits), planlananlar [yol haritasında](ROADMAP.md) yer alır.

## Tasarımı gereği yerel

Temel CLI'ın **zorunlu npm çalışma zamanı bağımlılığı yoktur**. Node'un standart kütüphanesini, analiz için clj-kondo'yu ve depo meta verileri için Git'i kullanır. Graf makinenizde oluşturulur ve sorgulanır: hesap yok, barındırılan indeks yok, telemetri yok.

### Gereksinimler

| Bileşen | Rol |
|---|---|
| Node.js 22.18+ | CLI'ı ve MCP sunucusunu çalıştırır |
| clj-kondo 2025.10.23 | Yerel analizör; bir kez indirilip önbelleğe alınır, arşiv SHA-256 değeri sabitlenmiştir |
| Git | Git üzerinden kurulum, izlenen dosya kontrolleri, anlık görüntü ve güncellik bilgisi |
| TypeScript 5, isteğe bağlı | Yalnızca Playwright page-object ve test analizi; Atlas'ın yanına `npm i -D typescript@5` |

macOS arm64/x64, Linux arm64/x64 ve Windows x64 için sabitlenmiş binary'ler mevcuttur. Geliştirme ve korpus ölçümleri macOS arm64 üzerinde yapıldı. İndirme mümkün değilse, örneğin proxy arkasında, Atlas `PATH` üzerindeki bir `clj-kondo` kullanmaya geçer. [Platform ve önbellek ayrıntıları](docs/GUIDE.md#requirements)

### Güvenlik

Az bağımlılık saldırı yüzeyini azaltır. Tedarik zinciri garantisi **vermez**.

- İndirilen clj-kondo arşivi sabitlenmiş SHA-256 ile karşılaştırılır ve eşleşmezse reddedilir. `PATH` üzerinden alınan `clj-kondo`, kurduğunuz haliyle güvenilir kabul edilir; bu hash ile karşılaştırılmaz.
- Atlas, analiz edilen uygulamanın JVM'ini, shell betiklerini veya Node kodunu başlatmaz. **Projenin clj-kondo hook'ları clj-kondo tarafından yorumlanır**; dolayısıyla bir depoyu analiz ederken bu yapılandırma güvendiğiniz koddur.
- MCP sunucusu grafı okur; Git hook'ları, filter driver'lar ve fsmonitor devre dışıyken, zaman aşımı sınırlarıyla salt okunur Git kontrolleri çalıştırır.
- Sonuçlar stdio üzerinden yerel olarak sunulur. Yapay zekâ istemcinizin bunlarla ne yaptığı ayrı bir gizlilik sınırıdır.

Bunlar uygulamanın özellikleridir; bir güvenlik denetiminin sonucu değildir.
[Çalıştırma modeli](docs/GUIDE.md#security)

## Ölçümler

Her biri [corpus.json](corpus.json) içinde bir commit'e sabitlenmiş **26 herkese açık depoda** ölçüldü. Tam tablo: [docs/COVERAGE.md](docs/COVERAGE.md).

| Bir bakışta | |
|---|---|
| Grafa dönüştürülebilen depolar | **26 / 26**, çökme yok, 0 düşürülen kenar |
| Okunan içeriğin boyutu | 10,158 kaynak dosyası, 141,604 tanım, 1,927,681 kenar |
| Proje namespace'lerinde tanımına bağlanan var kullanımları | **601,991 / 602,877 (99.85%)**; 886 çözümlenmemiş |
| Depo başına | medyan 100.0%; 24 / 26 depo 99.3% veya üzerinde; altındaki ikisi 89.9% ve 74.3% |
| clj-kondo'nun herhangi bir namespace'e atayamadığı semboller | **18,517**, sayılır ve gösterilir; bağlanmaz ve orana dahil edilmez |
| clj-kondo'nun tam ayrıştıramadığı dosyalar | 24 |
| Yanıtları elle kontrol edilmiş benchmark | 14 / 14 pozitif soru, 7 / 7 yokluk sorusu |

Bu sayılar, bu projelerde kodun *statik* yapısının ne kadarının grafa ulaştığını gösterir. Sizin projeniz için bir vaat değildir: clj-kondo'ya öğretilmemiş makrolar üzerine kurulu bir kod tabanı, yapılandırılana kadar Metabase'den çok DataScript'e yakın olacaktır. `npx clojure-atlas coverage`, projeniz için aynı sayıları yazdırır.

### Yanında sayılarıyla çözümleme oranı

**Çözümleme oranı**, clj-kondo'nun bir proje namespace'ine atadığı var kullanımları için `resolved / (resolved + unresolved)` değeridir. Analizin doğruluğu değildir. Kütüphane kullanımları ve **namespace'i bilinmeyen kullanımlar** bunun dışındadır: clj-kondo'nun herhangi bir namespace'e atayamadığı semboller, bilmediği bir makronun bağladığı yerel değişkenler veya grafın kaçırdığı var kullanımları olabilir. Statik olarak bunları ayırmanın yolu yoktur; bu yüzden ham sayı olarak gösterilir ve hiçbir zaman orana katılmazlar.

| Depo | Çözümlenmiş | Çözümlenmemiş | Çözümleme oranı | Bilinmeyen namespace (ham, oran dışında) |
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
| **26 deponun tamamı** | | | **medyan 100.0%; 24 / 26 depo 99.3% veya üzerinde** | **toplam 18,517** |

† [docs/COVERAGE.md içinde açıklanmıştır](docs/COVERAGE.md#repos-under-95-resolution-rate-or-with-unknown-namespace-usages-above-5-of-resolved)

**Tanımın değişmesi bir iyileşme değildir.** Bu projenin ilk kapsam raporu `resolved + unresolved + unknown` değerine bölüyor ve Babashka'yı 87.0% gösteriyordu. Bugünkü 99.6%, yukarıdaki tanımı kullanır. Bu farkın neredeyse tamamı paydadan kaynaklanır: namespace'i bilinmeyen kullanımlar orandan çıkarıldı, çözümlenmiş hale gelmediler ve 2,176 tanesi hâlâ son sütundadır. İki tanımın oranlarını birbiriyle karşılaştırmayın.

### Çıkarımın gerçekte kazandırdıkları

Atlas'ın okuduklarındaki değişiklikler; her biri bir fixture veya testle, yukarıdaki orandan ayrı tutulmuştur.

| Değişiklik | Ölçülen sonuç | Kanıt |
|---|---|---|
| Map literal'ını binding kalıbından ayırma | Korpustaki 26 depoda: **5,475** üretici noktası kazanıldı (döndürülen vektördeki map'ler, hiccup, rota verileri, `(d/transact conn [{…}])`); **703** keyword değeri artık kanıtlanmış "destructure" tüketicileri olarak listelenmiyor; **5,268** `:keys` / `:as` / `:or` girdisi artık üretilmiş anahtar olarak listelenmiyor | [testler](test/keys-adapter.test.ts), fixture'lar: [authz](test/fixtures/authz/), [veri](test/fixtures/data/), [reframe](test/fixtures/reframe/) |
| Yalnızca clj-kondo'nun aynı parametreleri saydığı yerlerde imza kaydetme | `defn` olarak lint edilen bir form üzerinden tanımlanan **532** fonksiyon imza kazandı (Metabase'de 216); parametreleri platforma göre değişen **22** `.cljc` fonksiyonu artık yanlış imza almıyor (DataScript'in `first-seq` fonksiyonu `[xs xs]` olarak okunuyordu); `s/defn` anotasyonları artık parametre sayılmıyor | [testler](test/signatures.test.ts) |
| Düz bir parametrenin nasıl kullanıldığını okuma | Okumaları tamamen bilinen düz parametreler: **3,496 → 4,184** (parametreyi destructuring ile ayıran bir `let`, `(-> m :k)`, `contains?`) | [testler](test/signatures.test.ts) |
| Dış Ring/Compojure middleware'ini okuma | polylith-realworld: `POST /api/articles` için **0 → 11** middleware girdisi | [benchmark q13](docs/BENCHMARK.md#positive-questions), [fixture](test/fixtures/ring-middleware/) |
| Başka bir namespace'teki frontend rota tablolarını okuma | Logseq: **0 → 17** istemci rotası düğümü | [kapsam](docs/COVERAGE.md), [benchmark q14](docs/BENCHMARK.md#positive-questions) |
| `re-frame.alpha` tanıma | alpha namespace'i üzerinden kayıtlar ve dispatch'ler çıkarılır | [fixture](test/fixtures/reframe/src/app/alpha.cljs) |
| Projenin clj-kondo yapılandırmasını uygulama | Projenin `:lint-as` girdileri ve hook'ları analize katılır | [fixture](test/fixtures/project-config/), [testler](test/config.test.ts) |
| Playwright fixture'larını projenin `node_modules`'ı olmadan tipleme | Page object'lerini `test.extend<…>` fixture'larından alan testler, `@playwright/test` kurulu olmayan bir checkout'ta page object üyelerine bağlanır; fixture'da: **0 → 12** bağlantı | [testler](test/playwright-fixtures.test.ts), [fixture](test/fixtures/browser-fixtures/) |

İlk üç satır, aynı sabitlenmiş commit'lerin değişiklik öncesi ve sonrası graflarını karşılaştırır. Bu karşılaştırmada başka türden hiçbir kenar değişmedi; çözümlenmiş, çözümlenmemiş ve namespace'i bilinmeyen sayıları aynıdır: bunlar çözümleme oranındaki değil, map anahtarları ve parametreler hakkında okunanlardaki değişikliklerdir.

### Benchmark

Kaydedilen benchmark, **14 / 14 pozitif soruyu** (beklenen 40 / 40 satır bulundu) ve **7 / 7 yokluk sorusunu** geçer. Yanıtları kaynakla elle karşılaştırılmış küçük bir regresyon benchmark'ıdır; projeniz için bir doğruluk tahmini değildir. [Sorular, sonuçlar ve yöntem](docs/BENCHMARK.md)

## Atlas nasıl test edilir

Bir ajan kendisine verilene güvenir; bu yüzden yanlış yanıtın maliyeti eksik yanıttan daha yüksektir.

| Kontrol | Durum |
|---|---|
| Otomatik testler | **873**, tamamı geçiyor (`npm test`); düzeltilen her hata, düzeltme olmadan başarısız olan bir test alır |
| Kaynak satırı kapsamı | **99.79%** (`npm run test:coverage`; eşik kontrolü 98% altında başarısız olur) |
| Tip kontrolü | `npm run typecheck` sorunsuz |
| Sürekli entegrasyon | [GitHub Actions](.github/workflows/ci.yml), `main` dalına her push ve her pull request için Linux üzerinde Node.js 22 ve 24 ile tip kontrolünü ve kapsam eşiği kontrolünü çalıştırır |
| Fixture'lar | [test/fixtures](test/fixtures) altında, beklenen her graf satırı elle kontrol edilmiş küçük Clojure kod tabanları |
| Gerçek depolar | Herkese açık 26 proje çökmeden ve 0 düşürülen kenarla oluşturulur |
| Benchmark | Yanıtları elle kontrol edilmiş pozitif sorular ve yokluk soruları ([docs/BENCHMARK.md](docs/BENCHMARK.md)) |
| Bağımsız inceleme | Değişikliği yazmamış incelemeciler, çalıştırılabilir hata örnekleriyle yanlış yanıtları arar; doğrulanan her kusur bir testle düzeltilir |
| Güvenilmeyen depolar | Kötü amaçlı fixture'lar; Git ayarlarının, filter driver'ların, submodule'lerin, projenin TypeScript'inin, tuhaf dosya adlarının ve takılı kalan clj-kondo hook'larının hiçbir şey çalıştırmadığını veya takılı bırakmadığını kontrol eder |

En çok yokluk soruları önem taşır: Atlas'ın, "yok" gibi okunan boş bir liste yerine, gerçeğin bu olduğu durumlarda "bulunamadı", "çıkarılmadı" veya "bozulmuş" dediğini kontrol ederler. Başarılı bir test paketi ve benchmark, bu fixture'lar ve depolar hakkında kanıttır. Sizin deponuzda doğru yanıtı garanti etmezler; her satırdaki kanıt sınıfını okuyun.

## Katkıda bulunma

**Clojure röntgen aracımızı birlikte geliştirelim!**

Yararlı bir katkı küçücük bir Clojure örneği olabilir: "bu kütüphane şu iki şeyi birbirine bağlıyor ve Atlas bunu görmeli." Bir fixture ve beklediğiniz graf satırlarını ekleyin veya adaptörü yazın. İkisi de memnuniyetle karşılanır; Atlas'ın size yanlış veya yanıltıcı yanıt verdiği bir örnek de öyle.

```sh
npm ci
npm test
npm run test:coverage   # 98% source line-coverage gate
npm run typecheck
```

CLI, düz Node olarak dağıtılabilmesi için TypeScript ile yazılmıştır; Clojure analizini clj-kondo yapar.
[Katkıda bulunanlar kılavuzu](CONTRIBUTING.md) · [Yol haritası](ROADMAP.md) · [Araç başvuru kılavuzu](docs/GUIDE.md)

## Emeği geçenler ve lisans

**Barış Can Ateş** tarafından oluşturuldu. Dokümantasyon ve görseller dahil [MIT lisanslıdır](LICENSE). Michiel Borkent'in **[clj-kondo](https://github.com/clj-kondo/clj-kondo)** projesi üzerine kurulmuştur; kodlama ajanlarına arayüz olarak **[MCP](https://modelcontextprotocol.io)** kullanılır. Korpustaki ve örneklerdeki herkese açık projelerin yazarlarına teşekkürler; bu projeler kendi lisanslarını korur.

*Tüm Clojure topluluğu için.*
