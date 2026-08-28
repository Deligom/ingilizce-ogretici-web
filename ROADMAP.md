# Neden — Yol Haritası

## Faz 0 — Soru bankası ✅ BİTTİ
- [x] `konular.json`: her konuya `blok` (1-8) ve `eksenler[]` alanı eklenir.
      `eksenler` = o konunun ölçülebilir alt tuzakları; hem tohum soruların hem AI
      üretiminin çeşitlilik kontrol listesi budur.
- [x] `data/sorular.json`: birleşik banka. AYBU'nun 100 sorusu buraya taşınır
      (`kaynak: "aybu"`), üstüne **82 tohum soru** yazıldı
      (`kaynak: "tohum"`). Her konuda üç aşamanın hepsi dolu.
- [x] Her soru: `id, konu, eksen, zorluk (1-3), tip, soru, secenekler, cevap, neden, celdiriciler[]`
      (`celdiriciler` = her yanlış şıkkın neden yanlış olduğu — açıklama ekranı da bunu kullanır)
- [x] `teshis-testi.json` bozulmadan kalır: "gerçek sınav provası" modu için orijinal sıra.
- [x] **Aşama sistemi:** zorluk 1 tanı (tek ipuçlu) · 2 ayırt et (ipucu bağlamda) ·
      3 karıştır (birden çok konu iç içe). Kutu 0-1 → aşama 1, 2-3 → aşama 2, 4-5 → aşama 3;
      üstüne manuel Kolay/Orta/Zor seçimi.
- [x] `konular.json` metinleri düzgün Türkçeye çevrildi (kural kartında kullanıcıya gösteriliyor).
- **Sonuç:** 39 konu · 235 eksen · 182 soru (100 aybu + 82 tohum) · doğrulama temiz.

## Faz 1 — İskelet + bloklu teşhis ✅ BİTTİ
- [x] `index.html`, hash router, tasarım tokenları (palet, üç yazı tipi, mobil öncelikli)
- [x] `db.js`: IndexedDB store'ları, ilk açılışta `data/*.json` seed
- [x] Ayarlar ekranı: Gemini API anahtarı girişi, canlı anahtar testi, ilerlemeyi sıfırlama
- [x] **Bloklu teşhis:** 8 blok × 5 konu × 3 soru = 15 soru (~6 dk)
- [x] Blok bitince harita çıkar, zayıf konular (%60 altı) kuyruğa yazılır
- [x] Yarıda bırak-devam et: `sonSoruIndex` ile kaldığı sorudan devam
- [x] Sonuç ekranı: konu bazında oran + yanlışların doğru cevabı ve gerekçesi
- [x] Mobil doğrulandı: 375px'te yatay kaydırma yok, dokunma hedefleri ≥44px
- **Bitti sayılır:** ilk bloğu çözüp 6 dakikada çalışmaya başlayabiliyorum. ✅

## Faz 2 — "Neden?" katmanı ✅ BİTTİ
- [x] `ai.js`: Gemini istemcisi, `responseSchema`, hata/kota yönetimi, günlük kota sayacı
- [x] `aciklaSoru` + açıklama kartı: doğrusu → kural → Türkçeyle → senin şıkkın → tuzak
- [x] Benzer 5 cümle: dokununca cevabı açılan fosforlu kutular
- [x] Açıklama cache'i (`aciklamalar` store), anahtar `soruId:secilenSik` —
      aynı soruda farklı şık farklı anlatım ister. Cache'teki açıklama kota harcamaz.
- [x] Serbest sohbet: soru bağlamıyla devam eden soru-cevap, `sohbetler` store
- [x] Gönderilemeyen mesaj geçmişe yazılmaz, girdide kalır (tekrar denenebilir)
- [x] Ayarlar'da kullanım kartı: bugünkü istek sayısı + önbellekteki açıklama sayısı
- **Bitti sayılır:** yanlış yaptığım her soruda "neden?" deyip tatmin olana kadar sorabiliyorum. ✅

## Faz 3 — Alıştırma, tekrar ve soru üretimi
- [ ] `tekrar.js`: kutu sistemi, `sonrakiTarih` hesabı, günlük kuyruk
- [ ] Konu kartı ekranı (`konular.json`'dan kural + örnek + tuzak)
- [ ] Benzer 5 cümle üretimi ve arka arkaya çözüm modu
- [ ] **Soru üretimi:** Ayarlar'da düğme + slider (3-10, varsayılan 5).
      Prompt'a konu kartı + `eksenler` + tohum sorular (üslup örneği) +
      bankadaki mevcut cümleler ("bunları tekrar etme") girer.
- [ ] **Onay kuyruğu:** üretilen sorular `onayBekleyen` olarak gelir, ✓/✗ ile elenir.
      Yerelde ön eleme: şema kontrolü + mevcut sorulara benzerlik filtresi.
- [ ] Hata bankası ekranı: etikete göre gruplanmış, "bunu tekrar çöz" düğmesi
- [ ] Günlük hedef + seri (streak)
- **Bitti sayılır:** her gün açtığımda bana 10 dakikalık doğru kuyruk geliyor ve
  banka boşalınca tek düğmeyle dolduruyorum.

## Faz 4 — Okuma modu
- [ ] Metin yapıştırma / sınav parçalarından seçme
- [ ] Kelimeye çift tık → `kelimeAnlami`, `sozluk` cache
- [ ] Cümleye uzun bas → `cumleParcala`, cümle şeridi + fosforlu animasyon
- [ ] İşaretlenen kelimeler → kelime kartı kuyruğuna
- **Bitti sayılır:** herhangi bir İngilizce metni açıp takıldığım yeri anında çözebiliyorum.

## Faz 5 — PWA ve cila
- [ ] `manifest.json`, `sw.js`, ana ekrana ekleme
- [ ] Çevrimdışı: seed veriler + cache'lenmiş açıklamalar + üretilmiş sorular çalışır
- [ ] Yedekleme: tüm ilerlemeyi ve üretilmiş soru bankasını JSON olarak dışa/içe aktar
- [ ] Koyu tema
- [ ] Sınav provası modu: `teshis-testi.json`'un orijinal 100 soruluk hali, süreli

## Sonrası (fikir kuyruğu)
- Kendi PDF sınavını yükleyip soru bankasına ekleme (OCR/metin ayrıştırma)
- Sesli okuma (Web Speech API) — telaffuz için
- Yazma alıştırması: Türkçe cümle verilir, İngilizceye çevirirsin, AI hatalarını
  konu etiketleriyle işaretler (bu, zayıf konu haritasını kendi kendine besler)
- Haftalık rapor: hangi konuda kaç hata, hangisi düzeldi
