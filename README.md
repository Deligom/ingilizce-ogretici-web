# WordNexus

Türkçe konuşan biri için İngilizce öğrenme uygulaması. Her cümlenin, her kelimenin,
her sorunun yanında bir **"Neden?"** düğmesi var — sorun bilgi eksikliği değil,
fark etme eksikliği.

Tasarım kararları ve mimari için [CLAUDE.md](CLAUDE.md), yapılacaklar için
[ROADMAP.md](ROADMAP.md).

## Yerelde çalıştırma

Build yok, npm yok. Ama `file://` ile açılmaz — tarayıcı `fetch` ile veri
dosyalarını okuyamaz. Basit bir sunucu yeter:

```bash
python -m http.server 8123
```

Sonra `http://localhost:8123` adresini aç.

## GitHub Pages'e yayınlama

1. GitHub'da yeni bir **public** depo aç (bedava hesapta Pages public depo ister).
2. Bu klasörü depoya gönder:

```bash
git init && git add . && git commit -m "ilk surum" && git branch -M main
```

3. Depoyu uzak adrese bağlayıp gönder (kendi kullanıcı adın ve depo adınla):

```bash
git remote add origin https://github.com/KULLANICI/DEPO.git && git push -u origin main
```

4. Depo sayfasında **Settings → Pages → Source: Deploy from a branch → main / (root)**.
   Bir iki dakika sonra site `https://KULLANICI.github.io/DEPO/` adresinde yayında olur.
5. Telefondan aç, tarayıcı menüsünden **Ana ekrana ekle** de.

Tüm yollar göreli (`./data/...`), o yüzden alt dizinde yayınlanması sorun değil.

## Vercel'e yayınlama (paylaşılan anahtar için)

Uygulama iki şekilde çalışır:

- **Kendi anahtarınla:** Ayarlar'a Gemini anahtarını girersin, tarayıcı doğrudan
  Google'a gider. Günlük sınır yoktur, kota senin hesabından düşer. GitHub Pages
  kopyasında tek seçenek budur.
- **Paylaşılan anahtarla:** Anahtar sunucuda (`GEMINI_API_KEY`) durur, tarayıcıya
  hiç inmez. Kullanıcı hiçbir şey yapmadan uygulamayı kullanır; IP başına günlük
  istek sınırı vardır.

İkincisi için Vercel gerekir. Kurulum, tek seferlik:

1. [vercel.com](https://vercel.com) → GitHub ile giriş yap.
2. **Add New → Project** → `ingilizce-ogretici-web` deposunu seç → **Import**.
3. Framework Preset **Other** kalsın; build ayarlarına dokunma (bu proje derlenmiyor).
4. **Environment Variables** bölümüne ekle:
   - Name: `GEMINI_API_KEY` · Value: Google AI Studio'dan aldığın anahtar
   - (isteğe bağlı) Name: `GUNLUK_SINIR` · Value: `100`
5. **Deploy**. Bir iki dakikada `proje-adi.vercel.app` adresinde yayında olur.

Anahtarı **repoya yazma**; yalnızca Vercel panelinden gir. Her `git push` sonrası
Vercel kendini otomatik günceller.

### Günlük sınır hakkında dürüst not

`api/gemini.js` içindeki sayaç, sunucu örneğinin **belleğinde** tutulur. Vercel yeni
bir örnek başlattığında sıfırlanır ve örnekler arasında paylaşılmaz. Yani kötüye
kullanımı zorlaştıran bir fren, kesin bir sınır değil. Gerçek sınır için bir Redis
(Upstash ücretsiz katmanı yeter) bağlanmalı; değiştirilmesi gereken tek yer
`sayacAl` / `sayacArtir` çiftidir.

## API anahtarı

Gemini anahtarı **repoya yazılmaz**. Uygulama içinde Ayarlar ekranından girilir ve
yalnızca o cihazdaki tarayıcının IndexedDB'sinde saklanır. Anahtarı
[Google AI Studio](https://aistudio.google.com/apikey)'dan ücretsiz alabilirsin.

Faz 1'de anahtar sadece test ediliyor; açıklama ve sohbet Faz 2'de devreye girecek.

## Dosyalar

```
index.html             tek giriş noktası, tüm görünümler ve stiller
app.js                 hash router, ekranlar
db.js                  IndexedDB katmanı (idb-keyval)
ai.js                  Gemini istemcisi
data/konular.json      39 konu: kural, tuzak, blok, çeşitlilik eksenleri
data/sorular.json      182 soru: 100 gerçek sınav + 82 el yazımı, 3 zorluk aşaması
data/teshis-testi.json AYBU sınavının orijinal hâli (sınav provası modu için)
kaynak/                kaynak PDF
```
