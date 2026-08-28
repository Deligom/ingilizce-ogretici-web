// IndexedDB katmani. idb-keyval CDN'den gelir; her mantiksal store kendi
// veritabaninda tutulur (idb-keyval tek surumde tek store acabildigi icin).
import {
  get, set, del, entries, clear, createStore
} from "https://cdn.jsdelivr.net/npm/idb-keyval@6.2.1/+esm";

const acik = {};
// Not: veritabani adlari "neden-" onekini korur. Uygulama adi WordNexus oldu ama
// bu adlari degistirmek cihazda kayitli ilerlemeyi ve API anahtarini sifirlar.
function depo(ad) {
  if (!acik[ad]) acik[ad] = createStore("neden-" + ad, ad);
  return acik[ad];
}

export const oku  = (ad, anahtar)        => get(anahtar, depo(ad));
export const yaz  = (ad, anahtar, deger) => set(anahtar, deger, depo(ad));
export const sil  = (ad, anahtar)        => del(anahtar, depo(ad));
export const bosalt = (ad)               => clear(depo(ad));
export const ciftler = (ad)              => entries(depo(ad));
export const tumu = async (ad) => (await entries(depo(ad))).map(([, v]) => v);

// --- ayarlar kisayolu ---
export const ayarOku = (anahtar, varsayilan = null) =>
  oku("ayarlar", anahtar).then(v => (v === undefined ? varsayilan : v));
export const ayarYaz = (anahtar, deger) => yaz("ayarlar", anahtar, deger);

// --- seed ---
// data/*.json dosyalarini ilk acilista IndexedDB'ye yazar. Surum degisirse
// soru bankasi yenilenir ama ilerleme, hatalar ve sohbetler korunur.
const SEED_SURUM = 1;

export async function seedGerekliMi() {
  return (await ayarOku("seedSurum", 0)) !== SEED_SURUM;
}

export async function seedYap(sorular) {
  const d = depo("sorular");
  for (const s of sorular) await set(s.id, s, d);
  await ayarYaz("seedSurum", SEED_SURUM);
}

// --- soru bankasi sorgulari ---
export async function konununSorulari(konuId, zorluk = null) {
  const hepsi = await tumu("sorular");
  return hepsi.filter(s => s.konu === konuId && (zorluk === null || s.zorluk === zorluk));
}

// Soru cozuldugunde uzerine yazilir: bir daha ayni soruyu ust uste vermemek ve
// "en uzun sure once cozulen" siralamasini yapabilmek icin.
export async function soruIsaretle(soruId, dogruMu) {
  const s = await oku("sorular", soruId);
  if (!s) return;
  s.sonCozum = new Date().toISOString();
  s.cozulme = (s.cozulme || 0) + 1;
  if (!dogruMu) s.hataSayisi = (s.hataSayisi || 0) + 1;
  await yaz("sorular", soruId, s);
}

// --- ilerleme ---
export async function ilerlemeOku(konuId) {
  return (await oku("ilerleme", konuId)) || { dogru: 0, yanlis: 0, kutu: 0, sonrakiTarih: null };
}

export async function ilerlemeYaz(konuId, veri) {
  return yaz("ilerleme", konuId, veri);
}

// --- okuma modu: sozluk ve cumle onbellegi ---
// Ayni kelime/cumle icin ikinci kez API'ye gidilmez.
const kucult = (s) => String(s).toLowerCase().trim();

export const kelimeOku = (kelime) => oku("sozluk", kucult(kelime));

export async function kelimeYaz(kelime, veri) {
  const mevcut = await kelimeOku(kelime);
  return yaz("sozluk", kucult(kelime), {
    ...veri,
    kelime: kucult(kelime),
    tarih: new Date().toISOString(),
    gorulme: (mevcut?.gorulme || 0) + 1,
    isaretli: mevcut?.isaretli ?? false
  });
}

export async function kelimeIsaretle(kelime, isaretli) {
  const mevcut = await kelimeOku(kelime);
  if (!mevcut) return;
  return yaz("sozluk", kucult(kelime), { ...mevcut, isaretli });
}

export const cumleOku = (cumle) => oku("cumleler", kucult(cumle));
export const cumleYaz = (cumle, veri) => yaz("cumleler", kucult(cumle), veri);

// Okunan metinler: kullanici yapistirdigi metne geri donebilsin.
export const metinler = () => tumu("metinler");
export const metinYaz = (id, veri) => yaz("metinler", id, veri);
export const metinSil = (id) => sil("metinler", id);

// --- gunluk kota sayaci ---
// Bedava kredi sinirli; kac istek attigimizi kullaniciya gosterebilmek icin sayariz.
function bugun() { return new Date().toISOString().slice(0, 10); }

export async function kotaOku() {
  const k = (await oku("ayarlar", "kota")) || { tarih: bugun(), sayi: 0 };
  return k.tarih === bugun() ? k : { tarih: bugun(), sayi: 0 };
}

export async function kotaArtir() {
  const k = await kotaOku();
  k.sayi++;
  await yaz("ayarlar", "kota", k);
  return k;
}

// --- aciklama ve sohbet ---
// Aciklama secilen sikka bagli: ayni soruda farkli sik secilirse farkli anlatim gerekir.
export const aciklamaAnahtari = (soruId, secilen) => `${soruId}:${secilen}`;

export const aciklamaOku = (soruId, secilen) =>
  oku("aciklamalar", aciklamaAnahtari(soruId, secilen));

export const aciklamaYaz = (soruId, secilen, veri) =>
  yaz("aciklamalar", aciklamaAnahtari(soruId, secilen), veri);

export const sohbetOku = async (soruId) => (await oku("sohbetler", soruId)) || [];
export const sohbetYaz = (soruId, mesajlar) => yaz("sohbetler", soruId, mesajlar);

// --- teshis bloklari ---
export async function blokOku(no) {
  return (await oku("teshis", no)) || { durum: "baslamadi", sonSoruIndex: 0, cevaplar: [] };
}

export const blokYaz = (no, veri) => yaz("teshis", no, veri);
