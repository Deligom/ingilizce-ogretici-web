# WordNexus — Yol Haritası

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
- [x] **Bilmiyorum düğmesi:** teşhiste tahmin etmek yerine bilmediğini söyleyebilirsin.
      Şans eseri tutturulan soru konuyu yanlışlıkla "biliniyor" göstermesin diye.
- [x] **Sayfalı yanlış incelemesi:** her ekranda tek soru, ileri/geri, ilerleme çubuğu.
      Uzun kaydırmada yerini kaybetme sorunu çözüldü; index hash'te, geri tuşu çalışıyor.
- [x] **Blokta geri tuşu:** yanlış şıkka ya da Bilmiyorum'a yanlışlıkla basınca ← ile dönüp
      cevabını değiştirebilirsin. Önceki cevap işaretli gelir; şık seçip ileri basmadan
      geri dönsen bile seçim kaydedilir.
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
- [x] Sohbette hazır soru önerileri: yerelde üretilir (kota harcamaz), biri bağlamsaldır
      (seçtiğin şıkkı kullanır). Dokununca kutuya yazılır, **gönderilmez** — düzenleyebilirsin.
      Ayarlar'dan kapatılabilir.
- [x] Sohbet cevaplarındaki markdown (**kalın**, * madde) düzgün çiziliyor;
      HTML kaçışı önce yapıldığı için model sayfaya kod enjekte edemez.
- **Bitti sayılır:** yanlış yaptığım her soruda "neden?" deyip tatmin olana kadar sorabiliyorum. ✅

## Faz 3 — Alıştırma, tekrar ve soru üretimi ✅ BİTTİ
- [x] `tekrar.js`: kutu 0-5, aralıklar 0/1/3/7/16/35 gün, günlük kuyruk
- [x] Kutu **konuya** ait, soruya değil — öğrenilen şey bir soruyu hatırlamak değil,
      bir kuralı fark etmek. Kutu yükseldikçe aşama yükselir (0-1→1, 2-3→2, 4-5→3).
- [x] Soru seçimi: önce doğru zorlukta, en uzun süre önce çözülmüş olan.
      Zorluk tutmazsa bir kademe yakınına düşer; banka küçükken akış tıkanmaz.
- [x] Konu kartı ekranı: kural, yapı, örnek (en/tr), tuzak kutusu
- [x] Alıştırma ekranı (`#/calis`): cevap anında gösterilir, banka gerekçesi çıkar,
      "Neden?" hazır bekler. Teşhis ölçer, alıştırma öğretir.
- [x] Günlük hedef + seri (streak), ana sayfada "Bugünün kuyruğu" kutusu
- [x] Hata bankası (`#/hatalar`): konuya göre gruplanmış, en çok hata üstte
- [x] **Soru üretimi** (`uretim.js`): Ayarlar → Gelişmiş'te konu + aşama + slider (3-10)
- [x] Yerel eleme (API'siz): şema kontrolü + bankaya benzerlik + parti içi tekrar.
      Elenen soru kota harcamaz. Jaccard eşiği %55.
- [x] Onay kuyruğu (`#/onay`): tek tek gözden geçirilir, onaylanan bankaya girer
- [x] **Ayarlar Basit / Gelişmiş** olarak ikiye ayrıldı; varsayılan Basit
- **Bitti sayılır:** her gün açtığımda bana 10 dakikalık doğru kuyruk geliyor ve
  banka boşalınca tek düğmeyle dolduruyorum. ✅
## Faz 4 — Okuma modu ✅ BİTTİ
- [x] Metin yapıştırma, kaydedilen metinlere geri dönme, sınav parçalarından seçme
- [x] Kelimeye dokun → anlam, tür, cümledeki rolü, örnek. Önce `sozluk` önbelleği.
- [x] Cümleye uzun bas (masaüstünde çift tık) → cümle şeridi + fosforlu kalem darbesi
- [x] Şerit blokları: kim / ne yapıyor / neyi / nerede; bloğa dokununca ne işe yaradığı
- [x] `cumleParcala` sözleşmesi + Türkçe karşılık
- [x] İşaretlenen kelimeler → `#/kelimeler` (Bilmediklerim / Baktıklarım)
- [x] Model seçimi: Gemini 3.5 Flash / 3.1 Flash Lite (Ayarlar → Basit)
- [x] 503 (model yoğun) için sunucuda yeniden deneme — canlı testte yakalandı
- **Bitti sayılır:** herhangi bir İngilizce metni açıp takıldığım yeri anında çözebiliyorum. ✅
## Faz 5 — PWA ve cila
- [ ] `manifest.json`, `sw.js`, ana ekrana ekleme
- [ ] Çevrimdışı: seed veriler + cache'lenmiş açıklamalar + üretilmiş sorular çalışır
- [ ] Yedekleme: tüm ilerlemeyi ve üretilmiş soru bankasını JSON olarak dışa/içe aktar
- [ ] Koyu tema
- [ ] **Anlatım tarzı ayarı** — tek kontrol, üç kademe: Günlük / Dengeli / Terimli.
      Sistem prompt'una bir cümle ekler. Bilinçli olarak *tek* kontrol: tuzak sayısı,
      ayrıntı düzeyi, örnek adedi gibi ayrı düğmeler eklemiyoruz. Her düğme kullanıcıya
      verilmiş bir karar yüküdür; çoğu kişi hiç dokunmaz ve arayüz anlaşılmaz hâle gelir.
      Varsayılan doğrudan iyi olmalı, ayar istisna olmalı.
- [ ] Sınav provası modu: `teshis-testi.json`'un orijinal 100 soruluk hali, süreli

## Sonrası (fikir kuyruğu)
- Kendi PDF sınavını yükleyip soru bankasına ekleme (OCR/metin ayrıştırma)
- Sesli okuma (Web Speech API) — telaffuz için
- Yazma alıştırması: Türkçe cümle verilir, İngilizceye çevirirsin, AI hatalarını
  konu etiketleriyle işaretler (bu, zayıf konu haritasını kendi kendine besler)
- Haftalık rapor: hangi konuda kaç hata, hangisi düzeldi
