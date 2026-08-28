// IndexedDB katmani. idb-keyval CDN'den gelir; her mantiksal store kendi
// veritabaninda tutulur (idb-keyval tek surumde tek store acabildigi icin).
import {
  get, set, del, entries, clear, createStore
} from "https://cdn.jsdelivr.net/npm/idb-keyval@6.2.1/+esm";

const acik = {};
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

// --- ilerleme ---
export const ARALIKLAR = [0, 1, 3, 7, 16, 35]; // kutu 0-5, gun

export async function ilerlemeOku(konuId) {
  return (await oku("ilerleme", konuId)) || { dogru: 0, yanlis: 0, kutu: 0, sonrakiTarih: null };
}

export async function ilerlemeYaz(konuId, veri) {
  return yaz("ilerleme", konuId, veri);
}

// --- teshis bloklari ---
export async function blokOku(no) {
  return (await oku("teshis", no)) || { durum: "baslamadi", sonSoruIndex: 0, cevaplar: [] };
}

export const blokYaz = (no, veri) => yaz("teshis", no, veri);
