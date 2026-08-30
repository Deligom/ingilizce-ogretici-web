# WordNexus — İngilizce Öğrenme PWA

## Bu proje ne?

Türkçe konuşan, **okuduğunu anlayan ama kural bilmeyen** bir yetişkin için İngilizce
öğrenme uygulaması. Kullanıcı paragrafı anlıyor, ama "He always ___ an A grade"
sorusunda `get` mi `gets` mi diye takılıyor. Sorun bilgi eksikliği değil, **fark etme**
eksikliği. Uygulama bunun üzerine kurulu.

Çekirdek etkileşim: her cümlenin, her kelimenin, her sorunun yanında bir **"Neden?"**
düğmesi var. Basınca AI o cümleyi açıklar ve sohbet açılır.

Seviye hedefi: A1 → B1 (lise müfredatı + üniversite seviye tespit sınavı).

## Mimari kararlar

- **Build yok.** `index.html` + ES modülleri + CDN import. Bundler, npm, node yok.
- **Tek sayfa, PWA.** `manifest.json` + service worker (app shell + JSON verileri cache).
- **Depolama: IndexedDB.** `idb-keyval` CDN'den. localStorage sadece tema tercihi için.
- **AI: Gemini.** Model Ayarlar'dan seçilir. Varsayılan `gemini-3.1-flash-lite`;
  bu bir kalite tercihi değil, aritmetik: ücretsiz katmanda günlük hak
  **500'e karşı 20** (3.5 Flash), dakikalık hak 15'e karşı 5. Bir öğrenme oturumu
  kolayca 10-20 istek yiyor, yani 20/gün ile uygulama gün ortasında kapanıyor.
  `gemini-3.5-flash` seçenek olarak duruyor: anlatımı biraz daha iyi, zor bir
  konuyu açıklatmak için saklanmalı. Çıktı `responseMimeType: application/json` +
  `responseSchema` ile yapılandırılır.
- **İki anahtar yolu.** Kullanıcının kendi anahtarı varsa (Ayarlar → IndexedDB)
  tarayıcı doğrudan Google'a gider, sınır yoktur. Yoksa `/api/gemini` proxy'sine
  gider: anahtar `GEMINI_API_KEY` olarak sunucuda durur, tarayıcıya hiç inmez ve
  IP başına günlük sınır işler. Proxy yalnızca Vercel yayınında vardır; GitHub
  Pages kopyasında kendi anahtarın gerekir. Anahtar hiçbir durumda repoya yazılmaz.
- **Müfredatı AI üretmez.** Konu ağacı sabit JSON. AI sadece *anlatım, soru üretimi
  ve sohbet* katmanı — ne öğrenileceğine değil, nasıl anlatılacağına karışır.
- **Soru bankası üç katmanlı** (`data/sorular.json` + IndexedDB):
  `aybu` (100 gerçek sınav sorusu) · `tohum` (82 el yazımı soru, her konuda üç aşamayı doldurur) ·
  `ai` (kullanıcının kendi kotasıyla ürettiği, onaydan geçmiş sorular).
  Uygulama ilk günden soru üretmeden çalışır; üretim bankayı büyütmek içindir.
- **Cache önce.** Aynı kelime/aynı soru için ikinci kez API'ye gidilmez;
  açıklamalar IndexedDB'ye yazılır. Uçuş modunda bile daha önce açılmış her şey çalışır.
- **Kota kullanıcının.** Her AI çağrısı bedava kredi harcar. Bu yüzden: bankadaki hazır
  açıklama önce gösterilir, AI ancak kullanıcı derinleşmek isteyince çağrılır; üretim
  hep tek istekte toplu yapılır ve hep kullanıcının bastığı düğmeyle başlar.

## Dosya düzeni

```
index.html            tek giriş noktası, tüm görünümler
app.js                yönlendirme (hash router), görünüm montajı
db.js                 IndexedDB şeması + CRUD
ai.js                 Gemini istemcisi, prompt sözleşmeleri, cache katmanı
tekrar.js             aralıklı tekrar: kutu, aralık, günlük oturum, soru seçimi
quiz.js               kelime quizi: havuz ağırlıklandırma, dört soru tipi, çeldirici seçimi
uretim.js             soru üretimi: prompt kurma, yerel eleme, onay kuyruğu
data/konular.json     gramer konu ağacı (39 konu) + blok + çeşitlilik eksenleri
data/sorular.json     birleşik soru bankası (aybu + tohum)
data/teshis-testi.json AYBU 2021-22 sınavının orijinal hali — sınav provası modu için
data/cozumler.json    sınav parçalarının hazır çözümleri (105 cümle + 121 kelime)
arac/cozum-uret.js    çözümleri üretir (node arac/cozum-uret.js)
api/gemini.js         Vercel proxy: anahtarı gizler, günlük sınır uygular
arac/ikon-uret.js     PWA ikonlarını üretir (node arac/ikon-uret.js)
ikon/                 üretilmiş PNG ikonlar
sw.js, manifest.json  PWA
```

## Veri modeli (IndexedDB)

| store | anahtar | alanlar |
|---|---|---|
| `ilerleme` | konuId | `dogru`, `yanlis`, `kutu` (0-5), `sonrakiTarih` |
| `sorular` | soruId | `konu`, `eksen`, `zorluk` (1-3), `tip`, `soru`, `metin` (okuma), `secenekler`, `cevap`, `neden`, `celdiriciler`, `kaynak`, `cozuldu` |
| `onayBekleyen` | otomatik | AI'nın ürettiği, kullanıcının henüz ✓/✗ yapmadığı sorular |
| `teshis` | blokNo | `durum` (kilitli/devam/bitti), `sonSoruIndex`, `cevaplar[]` |
| `hatalar` | otomatik | `soruId`, `konuId`, `secilen`, `tarih`, `cozuldu` |
| `sozluk` | kelime | `anlam`, `tur`, `kokHali`, `cumledekiRol`, `ornek`, `tarih`, `isaretli`, `gorulme` + quiz alanları: `kutu` (0-5), `sonrakiTarih`, `quizDogru`, `quizYanlis` |
| `aciklamalar` | `soruId:secilenSik` | AI'nın döndürdüğü açıklama JSON'u |
| `sohbetler` | soruId | `mesajlar[]` (rol, metin) |
| `cumleler` | cümle | cümle şeridi çözümlemesi (parçalar + Türkçesi) |
| `metinler` | id | okuma modunda yapıştırılan metinler |
| `ayarlar` | anahtar | `apiKey`, `model`, `uslup`, `gunlukHedef`, `uretimAdedi`, `oneriler`, `kota`, `seri` |

## Aşama sistemi (zorluk 1-3)

Her sorunun bir `zorluk` değeri var. Aralıklı tekrarla doğrudan eşleşir — kutu
yükseldikçe soru zorlaşır, yoksa beşinci tekrarda hâlâ aynı kolay soru gelir.

| Aşama | Ne ölçer | Nasıl kurulur |
|---|---|---|
| **1 — Tanı** | Tek kural, tek ipucu | Tek boşluk, cevap doğrudan görünür |
| **2 — Ayırt et** | İpucu bağlamda gizli | İkinci cümle olmadan çözülemez, çeldiriciler yakın |
| **3 — Karıştır** | Birden çok konu iç içe | 2-3 boşluk, hepsi doğru olmalı; sınav tarzı uzun bağlam |

Eşleme: kutu 0-1 → aşama 1, kutu 2-3 → aşama 2, kutu 4-5 → aşama 3. Üstüne
kullanıcının manuel seçimi (Kolay / Orta / Zor) gelir ve otomatik eşlemeyi ezer.
AYBU soruları doğası gereği aşama 1'dir (placement testi, tek ipuçlu); tohum
sorular aşama 2 ve 3'ü doldurur. `uretSorular` da `zorluk` parametresi alır ve
o aşamanın tohum sorusunu üslup örneği olarak görür.

## Dört modül

### 1. Teşhis — bloklu, checkpoint'li

39 konu seviyeye göre (A1→A2→B1) **8 bloğa** ayrılmıştır; blok numarası
`konular.json`'daki `blok` alanında durur. Her blok **5 konu × 3 soru = 15 soru**,
yaklaşık 6 dakika. Bir konudan teşhiste en fazla 3 soru sorulur; bankadaki kalan
sorular alıştırmaya ayrılır.

Blok bitince **sadece o 5 konunun** haritası çıkar: doğru oranı %60 altındakiler
"çalışılacak" kuyruğuna girer, `ilerleme.kutu = 0` yazılır. Kullanıcı **o an
çalışmaya başlayabilir** — testin tamamını bitirmek zorunda değildir. Sıradaki blok
açılır ama zorunlu değildir; canı istediğinde döner.

Yarıda bırakılırsa `teshis.sonSoruIndex` sayesinde kaldığı sorudan devam eder,
asla başa dönmez. Sonuç ekranı liste değil harita: konular seviyeye göre dizilir,
çözülmemiş bloklar gri, zayıf konular fosforlu.

### 2. Alıştırma

Kuyruktan konu seçilir → `konular.json`'daki kural kartı gösterilir → o konudan sorular
gelir. Yanlış cevapta:

1. Doğru şık işaretlenir, kuralın ilgili kısmı fosforlu kalemle çizilir (animasyon).
2. Sorunun kendi `neden` ve `celdiriciler` alanları hemen gösterilir (API'siz).
3. "Daha fazla" denirse AI'dan **5 benzer cümle** istenir, arka arkaya çözülür.
4. Soru `hatalar` store'una yazılır.

Aralıklı tekrar (`tekrar.js`): kutu 0→5, aralıklar `[0, 1, 3, 7, 16, 35]` gün.
Doğru cevap kutuyu 1 artırır, yanlış cevap 0'a düşürür.

### 3. Okuma

Kullanıcı metin yapıştırır, sınav parçalarından seçer ya da **AI'ya metin
yazdırır** (seviye + uzunluk + konu).

**Sınav parçaları hazır gelir.** `data/cozumler.json` repoda; ilk açılışta
IndexedDB'ye tohumlanır. Bu altı metin ilk andan itibaren çevrimdışı çalışır ve
kullanıcının kotasından tek istek harcanmaz. Çözümlerin kendi sürüm bayrağı var
(`cozumSurum`), kullanıcının kendi çözümlerinin üzerine yazmaz.

**Kendi metninde: önce çözümle, sonra oku.** Metin açılınca tek düğme çıkar: "Metni çözümle".
Tüm cümleler 4'erli partiler hâlinde tek seferde çözümlenip IndexedDB'ye yazılır;
aynı istekte metnin zor kelimeleri de sözlüğe düşer. Bundan sonra her dokunma
anlık ve çevrimdışı çalışır. Cümle cümle istek atmak hem yavaştı hem de uçak
modunda metni kullanılmaz bırakıyordu.

Metnin altında **metin sohbeti** var: metnin tamamını görür, "şu cümlede bu yapı
neden var?" gibi sorular sorulur.

- **Kelimeye dokun** → anlam, türü, kök hâli, cümledeki rolü, örnek cümle.
  Sıra: yerel durak kelime listesi → `sozluk` cache'i → AI. İlk ikisi kotasız ve anlık.

  **Bir dokunuş, bir istek, bütün cümle.** Kelime önbellekte yoksa yalnızca o kelime
  değil, **cümlenin tüm içerik kelimeleri** tek istekte çözülüp sözlüğe yazılır
  (`cumleKelimeleri`). Bir paragrafta 15 kelimeye bakmak 15 istek yerine birkaç istek
  eder. `the, is, my` gibi ~70 işlev kelimesi (`DURAK_KELIMELER`) hiç API'ye gitmez:
  karşılıkları gömülü, anlamları bağlama göre değişmiyor. Bunlar sözlüğe de yazılmaz —
  quiz havuzunu doldurmasınlar.

  Panelde tek bir istek numarası tutulur (`sonKelimeIstegi`). Bunsuz: A kelimesine
  dokunup beklerken B'ye dokununca A'nın geç gelen cevabı B'nin üzerine yazıyordu.

Kelime arama yalnızca okumada değil, **cevabın göründüğü her yerde** var:
yanlış incelemesinde (`#/inceleme`) ve alıştırmada cevap verildikten sonra.
Teşhis bloklarında kapalı — orada ölçüyoruz, öğretmiyoruz; alıştırmada da
cevaptan önce açık olsaydı kelime sorularının cevabını doğrudan vermiş olurduk.
- **Cümleye uzun bas** (masaüstünde çift tık) → cümle mono yazıyla kelime bloklarına
  ayrılır, her bloğun altında rolü yazar (kim / ne yapıyor / neyi / nerede-ne zaman).
  Bloğa dokununca fosforlu kalem soldan sağa geçer.
- "Bunu bilmiyorum" denen kelimeler `#/kelimeler` ekranında birikir.

### 4. Kelime quizi (`quiz.js`)

Okurken ve soru çözerken sözlükte biriken kelimeleri sorar. **Tek AI isteği harcamaz:**
soru gövdesi de çeldiriciler de kayıtlı verilerden kurulur, o yüzden uçuş modunda çalışır.

Dört soru tipi. Birden fazla seçilirse kelimelere sırayla dağıtılır; bir kelime seçilen
tipi desteklemiyorsa (örnek cümlesi yok, kök hâli boş) sessizce başka tipe düşer:

| Tip | Soru | Çeldirici |
|---|---|---|
| `entr` | kelime → Türkçe anlamı | aynı türden başka kelimelerin anlamları |
| `tren` | Türkçe anlam → kelime | aynı türden başka kelimeler |
| `bosluk` | kelimenin `ornek` cümlesi, kelime yeri `___` | aynı türden başka kelimeler |
| `kok` | çekimli kelime → kök hâli (`bought` → `buy`) | başka kelimelerin kök hâlleri |

**Ağırlıklandırma** (`agirlik`): "bunu bilmiyorum" denen kelime +100, hiç sorulmamış +40,
vadesi gelmiş +50, kutu düştükçe +10/kademe, quizde takıldıkça +6/hata, bildikçe -2.
Eşit puanlılar karıştırılır ki her tur aynı sırayla gelmesin. Kutusu dolmuş ve vadesi
gelmemiş kelime havuzdan çıkar — bildiği kelimeyi tekrar sormanın faydası yok.

Kutu ve aralıklar konu ilerlemesiyle aynı (`tekrar.js` `ARALIKLAR`): doğru cevap kutuyu
bir artırır, yanlış sıfıra düşürür. Kelime kutusu `sozluk` kaydında durur, yedeklemeye
dahildir.

Ayarlar quiz ekranının kendisinde: basit (kaç soru, hangi kelimeler) + Gelişmiş
(soru tipleri, öğrenilenler de çıksın mı). `ayarlar.quizAyar`'da saklanır.

## AI sözleşmeleri (`ai.js`)

Dördü de `responseSchema` ile JSON döner:

1. `aciklaSoru(soru, secilenSik, konuKarti)` → `{ dogruSik, neden, kural,
   turkceKarsilastirma, secilenNesiYanlis, tuzak, benzerCumleler: [{cumle, cevap}] }`
2. `kelimeAnlami(kelime, cumle)` → `{ anlam, tur, kokHali, cumledekiRol, ornek }`
   `kokHali`: çekimli hâllerde kök ve çekim türü — *"buy — 2. hâli (düzensiz fiil)"*.
   Öğrencinin en çok takıldığı yer: `bought` görüp `buy`ı tanıyamamak.
   **Tek kelime yolu artık yedek.** Normalde 2b çalışır; bu, modelin dokunulan
   kelimeyi listeden atlaması hâlinde devreye girer.
2b. `cumleKelimeleri(cumle, kelimeler)` → `{ kelimeler: [{kelime, anlam, tur, kokHali,
   cumledekiRol, ornek}] }` — bir kelimeye dokununca **o cümlenin tüm içerik kelimeleri
   tek istekte** çözülür. 15 kelimeye 15 istek yerine 1 istek; kalan kelimeler artık
   anlık ve çevrimdışı açılır. Model burada liste *uydurmuyor*, verilen listeyi
   dolduruyor — soru üretimindeki tekrara düşme riski burada yok.
2c. `benzerCumleler(konu, ornekCumle, kacinilacak, adet)` → `{ cumleler: [{cumle, cevap,
   turkce}] }` — "Başka 5 cümle üret" düğmesi. Cevap düz sohbet metni değil,
   dokun-cevabı-gör listesi olarak çizilir ve açıklama kaydına eklenir (kalıcı, kotasız).
3. `cumleParcala(cumle)` → `{ parcalar: [{ metin, rol, aciklama }] }`
4. `uretSorular(konuKarti, eksenler, ornekSorular, mevcutCumleler, adet, zorluk)` →
   `{ sorular: [{ eksen, soru, secenekler, cevap, neden, celdiriciler }] }`

Ayrıca serbest sohbet: `soruSor(baglam, mesajlar)` — bağlam olarak cümle, şıklar,
kullanıcının seçtiği şık ve konu kartı gönderilir.

### Anlatım kuralları (sistem prompt'una birebir geçir)

- **Sade Türkçe anlat, terimi parantezde ver.** Doğru: "Fiile `-s` takılır (geniş zaman,
  3. tekil şahıs)." Yanlış: "Simple present tense'te üçüncü tekil şahısta fiil çekimlenir."
- **Türkçeyle karşılaştır.** Kullanıcı Türkçe dilbilgisi terimlerinde de zorlanıyor,
  ama dili sezgisel biliyor. "İngilizcede `the`, Türkçedeki belirtme hâli `-i` gibi:
  *kapıyı aç* → *open the door*."
- Kural cümlesi **en fazla iki cümle**. Uzun anlatım yerine örnek çoğalt.
- Her açıklamada **bir tuzak** söyle: Türkçe konuşanın burada tipik olarak ne hata yaptığı.
- Kullanıcıya asla "harika bir soru" gibi doldurma cümlesi kurma, doğrudan cevaba gir.

## Soru üretimi — çeşitlilik ve doğrulama (`uretim.js`)

Bir modelden tek istekte liste istenince kendi ilk cevabını tekrar eder
("My brother gets...", "My sister gets..."). Üç kaldıraçla önlenir:

1. **Eksen listesi.** "10 soru yaz" denmez; konunun `eksenler` dizisindeki farklı
   alt tuzaklar tek tek dağıtılır ("bu soru olumsuz `doesn't` yapısını ölçsün").
   Model liste doldurmaz, kontrol listesi çözer. Dönen her soru hangi ekseni
   ölçtüğünü yazar.
2. **Negatif bağlam.** Bankadaki mevcut cümleler prompt'a "bunları tekrar etme" diye
   girer. Tohum sorular ayrıca üslup örneği (few-shot) olarak gönderilir.
3. **Yerel eleme, API'siz.** Şema kontrolü (tam 4 şık, şıklar birbirinden farklı,
   cevap indeksi geçerli, cümlede boşluk var) + mevcut sorulara kelime örtüşmesi
   filtresi. Elenen soru sessizce atılır, kota harcanmaz.

**Cevap anahtarı hatası en tehlikeli hatadır** — yanlış öğretir. Bu yüzden şemada her
çeldirici için "bu şık neden yanlış" alanı zorunludur; model üç çeldiriciyi de
gerekçelendiremiyorsa soru zaten kötüdür ve elenir. Bu alanlar boşa gitmez, yanlış
cevap ekranında birebir kullanılır.

**Akış:** Ayarlar → konu seç → slider (3-10, varsayılan 5) → tek istek → yerel eleme →
`onayBekleyen` kuyruğu → kullanıcı ✓/✗ → banka. Güven oluşunca `otomatikOnay` açılır.
Üretim sıcaklığı yüksek (~1.0), açıklama sıcaklığı düşük (~0.3).

## Tasarım yönü

Konu, kelimenin altını çizmek. Sınavın 20. sorusu bile bu: *Underline the new words.*
Görsel dil oradan geliyor — **fosforlu kalem ve mürekkep**, ama defter estetiğine
kaçmadan; zemin sakin, tek bir yerde cesur.

**Palet**

```
--murekkep   #16233A   metin, başlıklar
--zemin      #F6F7F9   sayfa
--kart       #FFFFFF   kart yüzeyi
--fosforlu   #FFE45C   sadece açıklanan kural/kelime üzerinde
--dogru      #1F8A70
--yanlis     #D93F4C
--soluk      #6B7280   yardımcı metin
```

**Tipografi**

- Display: **Fraunces** (değişken serif, opsz ekseni) — ekran başlıkları, soru sayısı.
- Gövde/arayüz: **Instrument Sans** — Türkçe glifleri tam.
- İngilizce cümleler ve kelime blokları: **JetBrains Mono** — İngilizce metni Türkçe
  arayüzden ayırır, cümleyi "incelenen nesne" gibi gösterir.

**İmza öğesi — cümle şeridi.** İngilizce cümle mono yazıyla kelime bloklarına ayrılır.
Bir bloğa dokununca fosforlu kalem darbesi soldan sağa o kelimenin üzerinden geçer
(`prefers-reduced-motion` varsa anında görünür) ve altında rolü belirir. Cesaret burada
harcanır; kalan her şey sessiz ve disiplinli kalır.

**Kalite tabanı:** mobil öncelikli (asıl kullanım telefon), klavye odağı görünür,
dokunma hedefleri ≥44px, koyu tema opsiyonel.

**Metin dili:** düğmeler ne yapıyorsa onu yazar — "Cevabı gör", "Neden?", "Benzer 5 cümle".
Boş ekran davet eder: "Henüz hata yok. Teşhis testini çözünce burası dolar."

## Şu an nerede

**Faz 0-5 bitti. Uygulama tamam.**

- **Yayın:** https://ingilizce-ogretici-web.vercel.app (paylaşılan anahtar + günlük sınır)
- **Yedek yayın:** https://deligom.github.io/ingilizce-ogretici-web (kendi anahtarın gerekir)

| Modül | Durum |
|---|---|
| Veri | 39 konu, 235 eksen, 182+ soru, üç zorluk aşaması |
| Teşhis | 8 blok, geri tuşu, Bilmiyorum, sayfalı yanlış incelemesi |
| "Neden?" | açıklama kartı, benzer 5 cümle, sohbet, hazır öneriler — hepsi önbellekli |
| Alıştırma | günlük kuyruk, konu kartı, kutu sistemi, seri |
| Üretim | Ayarlar → Gelişmiş, yerel eleme, onay kuyruğu |
| Okuma | metin yapıştırma, kelimeye dokun (cümle bazlı toplu çözümleme), cümle şeridi, kelime defteri |
| Quiz | 4 soru tipi, ağırlıklı havuz, kelime bazlı aralıklı tekrar, AI'sız |
| PWA | manifest, service worker, çevrimdışı, koyu tema, yedekleme, sınav provası |

Ekranlar: `#/` · `#/blok/:n` · `#/sonuc/:n` · `#/inceleme/:n/:i` · `#/calis` ·
`#/oku` · `#/oku/:id` · `#/kelimeler` · `#/quiz` · `#/prova` · `#/hatalar` · `#/onay` ·
`#/ayarlar` · `#/ayarlar/gelismis`

### Sonraki adım fikirleri

- Gerçek kullanım sonrası: hangi konu kartları anlaşılmıyor, hangi açıklama uzun
- Yazma alıştırması: Türkçe cümle → İngilizce çeviri, AI hataları konu etiketiyle işaretler
- Gerçek IP sınırı için Upstash Redis (`api/gemini.js` içinde `sayacAl`/`sayacArtir`)
