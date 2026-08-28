// Soru uretimi: prompt kurma, yerel eleme, onay kuyrugu.
// Yerel eleme API'siz calisir; elenen soru kota harcamaz, sadece atilir.
import * as db from "./db.js";
import { uretSorular } from "./ai.js";

const BENZERLIK_ESIGI = 0.55;   // kelime ortusme orani; ustundekiler elenir
const ORNEK_ADEDI = 3;
const MEVCUT_CUMLE_ADEDI = 25;

// Cumleyi karsilastirmaya hazirlar: kucuk harf, noktalama yok, bosluk isareti yok.
function kelimeKumesi(cumle) {
  return new Set(
    String(cumle).toLowerCase()
      .replace(/_{2,}/g, " ")
      .replace(/[^a-zçğıöşü\s]/gi, " ")
      .split(/\s+/)
      .filter(k => k.length > 2)
  );
}

// Jaccard: iki cumlenin ortak kelime orani.
export function benzerlik(a, b) {
  const x = kelimeKumesi(a), y = kelimeKumesi(b);
  if (!x.size || !y.size) return 0;
  let ortak = 0;
  for (const k of x) if (y.has(k)) ortak++;
  return ortak / (x.size + y.size - ortak);
}

// Sema kontrolu: API'ye gitmeden bariz bozuk sorulari eler.
export function semaTamamMi(s, zorluk) {
  if (!s || typeof s.soru !== "string" || !s.soru.trim()) return "cümle boş";
  if (!Array.isArray(s.secenekler) || s.secenekler.length !== 4) return "şık sayısı 4 değil";
  if (s.secenekler.some(o => !String(o).trim())) return "boş şık var";
  if (new Set(s.secenekler.map(o => String(o).trim().toLowerCase())).size !== 4) return "aynı şık iki kez";
  if (!Number.isInteger(s.cevap) || s.cevap < 0 || s.cevap > 3) return "cevap indeksi geçersiz";
  if (!/_{2,}/.test(s.soru)) return "cümlede boşluk yok";
  if (!Array.isArray(s.celdiriciler) || s.celdiriciler.length !== 3) return "çeldirici açıklaması eksik";
  if (s.celdiriciler.some(c => !String(c).trim())) return "boş çeldirici açıklaması";
  if (!s.neden || !String(s.neden).trim()) return "gerekçe yok";
  // Asama 3 birden cok bosluk ister: tek boslukluysa yanlis zorlukta uretilmis.
  if (zorluk === 3 && (s.soru.match(/_{2,}/g) || []).length < 2 && !s.secenekler.some(o => o.includes("/")))
    return "aşama 3 için tek boşluklu";
  return null;
}

// Uretilenleri eler: sema + bankaya benzerlik + partinin kendi icinde benzerlik.
export function yerelEle(uretilenler, mevcutCumleler, zorluk) {
  const kabul = [], elenen = [];
  const kiyasList = [...mevcutCumleler];

  for (const s of uretilenler || []) {
    const semaHata = semaTamamMi(s, zorluk);
    if (semaHata) { elenen.push({ soru: s?.soru, sebep: semaHata }); continue; }

    const enYakin = kiyasList.reduce((en, c) => Math.max(en, benzerlik(s.soru, c)), 0);
    if (enYakin > BENZERLIK_ESIGI) {
      elenen.push({ soru: s.soru, sebep: `mevcut soruya çok benziyor (%${Math.round(enYakin * 100)})` });
      continue;
    }

    kabul.push(s);
    kiyasList.push(s.soru);   // parti icindeki tekrarlari da yakala
  }
  return { kabul, elenen };
}

// Bir konu icin soru uretir, eler ve onay kuyruguna yazar.
export async function uret(anahtar, konu, adet, zorluk) {
  const bankadaki = await db.konununSorulari(konu.id);
  const ornekler = bankadaki
    .filter(s => s.zorluk === zorluk && s.neden)
    .slice(0, ORNEK_ADEDI);
  const mevcutCumleler = bankadaki.map(s => s.soru).slice(0, MEVCUT_CUMLE_ADEDI);
  const eksenler = konu.eksenler || [];

  const yanit = await uretSorular(
    anahtar, konu, eksenler, ornekler, mevcutCumleler, adet, zorluk
  );

  const { kabul, elenen } = yerelEle(yanit.sorular, mevcutCumleler, zorluk);

  const zaman = Date.now();
  for (const [n, s] of kabul.entries()) {
    const kayit = {
      id: `ai-${konu.id}-${zaman}-${n}`,
      konu: konu.id,
      eksen: s.eksen || null,
      zorluk,
      tip: konu.tur === "kelime" ? "kelime" : "dilbilgisi",
      parca: null,
      soru: s.soru,
      secenekler: s.secenekler,
      cevap: s.cevap,
      neden: s.neden,
      celdiriciler: s.celdiriciler,
      kaynak: "ai",
      uretimTarihi: new Date().toISOString()
    };
    await db.yaz("onayBekleyen", kayit.id, kayit);
  }

  return { kabul: kabul.length, elenen };
}

// Onaylanan soru bankaya gecer, reddedilen silinir.
export async function onayla(id) {
  const s = await db.oku("onayBekleyen", id);
  if (!s) return;
  await db.yaz("sorular", s.id, s);
  await db.sil("onayBekleyen", id);
}

export async function reddet(id) {
  await db.sil("onayBekleyen", id);
}

export async function bekleyenler() {
  return db.tumu("onayBekleyen");
}
