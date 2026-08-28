# Neden

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
