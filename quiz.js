// Kelime quizi: havuz secimi, agirliklandirma ve soru kurma.
//
// Tek bir AI istegi harcamaz. Sorulan her sey sozlukte zaten var: anlam, tur,
// kok hali, ornek cumle. Celdiriciler de sozlukteki baska kelimelerden secilir.
// Boylece quiz cevrimdisi calisir ve kota tuketmez.
import * as db from "./db.js";
import { ARALIKLAR, EN_UST_KUTU, bugun, gunEkle, yeniKutu } from "./tekrar.js";

export const TIPLER = {
  entr: {
    baslik: "İngilizce → Türkçe",
    aciklama: "Kelimeyi gör, anlamını seç. En kolayı; tanımayı ölçer."
  },
  tren: {
    baslik: "Türkçe → İngilizce",
    aciklama: "Anlamı gör, kelimeyi seç. Üretim yönü — asıl öğrenme burada."
  },
  bosluk: {
    baslik: "Boşluklu cümle",
    aciklama: "Kelimenin örnek cümlesindeki yeri boşaltılır. Bağlamda kullanımı ölçer."
  },
  kok: {
    baslik: "Kök hâli",
    aciklama: "bought → buy gibi. Yalnızca çekimli kelimeler için çıkar."
  }
};

export const VARSAYILAN_AYAR = {
  tipler: ["entr", "tren", "bosluk"],
  adet: 10,
  kaynak: "agirlikli",      // agirlikli | isaretli | vadesi
  ogrenilenler: false       // kutusu dolmus kelimeler de cikssin mi
};

export const AYAR_ANAHTARI = "quizAyar";

export async function ayarOku() {
  const kayit = (await db.ayarOku(AYAR_ANAHTARI, null)) || {};
  const ayar = { ...VARSAYILAN_AYAR, ...kayit };
  // Bilinmeyen tip ayiklanir; hicbiri kalmazsa varsayilana doner.
  ayar.tipler = (ayar.tipler || []).filter(t => TIPLER[t]);
  if (!ayar.tipler.length) ayar.tipler = [...VARSAYILAN_AYAR.tipler];
  return ayar;
}

export const ayarYaz = (ayar) => db.ayarYaz(AYAR_ANAHTARI, ayar);

// ---------- havuz ----------

// Quize girebilecek kelimeler: anlami olan her sozluk kaydi. Durak kelimeler
// (the, is, my) sozluge hic yazilmadigi icin burada da yok.
export async function havuz() {
  return (await db.tumu("sozluk")).filter(k => k?.kelime && k?.anlam);
}

// Agirlik: hangi kelime once sorulsun. Isaretli kelime en onde, sonra vadesi
// gelenler, sonra hic sorulmamislar. Kutusu dolmus kelime en sona duser —
// bildigi kelimeyi tekrar tekrar sormanin kimseye faydasi yok.
export function agirlik(k) {
  const g = bugun();
  const kutu = k.kutu ?? null;
  let puan = 0;

  if (k.isaretli) puan += 100;
  if (kutu === null) puan += 40;                                  // hic sorulmadi
  else {
    if (!k.sonrakiTarih || k.sonrakiTarih <= g) puan += 50;       // vadesi geldi
    puan += (EN_UST_KUTU - kutu) * 10;                            // kutu dustukce artar
  }
  puan += Math.min((k.quizYanlis || 0), 6) * 6;                   // takildigi kelime
  puan -= Math.min((k.quizDogru || 0), 6) * 2;
  return puan;
}

// Ogrenilmis sayilir: kutusu dolmus ve vadesi gelmemis.
export function ogrenildi(k) {
  return (k.kutu ?? 0) >= EN_UST_KUTU && k.sonrakiTarih && k.sonrakiTarih > bugun();
}

export function havuzSuz(hepsi, ayar) {
  let liste = hepsi;
  if (ayar.kaynak === "isaretli") liste = liste.filter(k => k.isaretli);
  if (ayar.kaynak === "vadesi") {
    liste = liste.filter(k => (k.kutu ?? null) === null || !k.sonrakiTarih || k.sonrakiTarih <= bugun());
  }
  if (!ayar.ogrenilenler) {
    const kalan = liste.filter(k => !ogrenildi(k));
    if (kalan.length >= 4) liste = kalan;   // havuz cok kucukse elemeyi birak
  }
  return liste;
}

// Agirliga gore sirala, esitleri karistir: ayni sirayla tekrar tekrar ayni
// sorular gelmesin ama oncelik de bozulmasin.
export function sirala(liste) {
  return liste
    .map(k => ({ k, p: agirlik(k) + Math.random() * 12 }))
    .sort((a, b) => b.p - a.p)
    .map(x => x.k);
}

// ---------- soru kurma ----------

const karistir = (dizi) => {
  const d = [...dizi];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
};

// "buy — 2. hâli (düzensiz fiil)" -> "buy"
export function kokMetni(kokHali) {
  const ham = String(kokHali || "").split(/[—\-–(]/)[0].trim();
  return /^[A-Za-z][A-Za-z' ]*$/.test(ham) ? ham.toLowerCase() : "";
}

// Celdirici: once ayni turden, yetmezse herhangi bir kelimeden. Dogru cevapla
// ayni metin asla secilmez — "iki sik da dogru" gibi gorunmesin.
function celdiriciler(hepsi, dogru, alan, kelime, adet = 3) {
  const secilebilir = (k) => {
    const deger = alan(k);
    return deger && deger.toLowerCase() !== String(dogru).toLowerCase()
      && k.kelime !== kelime.kelime;
  };
  const ayniTur = karistir(hepsi.filter(k => k.tur === kelime.tur && secilebilir(k)));
  const digerleri = karistir(hepsi.filter(k => k.tur !== kelime.tur && secilebilir(k)));

  const secilen = [];
  const gorulen = new Set();
  for (const k of [...ayniTur, ...digerleri]) {
    const deger = alan(k);
    if (gorulen.has(deger.toLowerCase())) continue;
    gorulen.add(deger.toLowerCase());
    secilen.push(deger);
    if (secilen.length === adet) break;
  }
  return secilen;
}

// Ornek cumlede kelimenin gectigi yeri bosluga cevirir. Kelime cumlede
// gecmiyorsa bosluklu soru kurulamaz (null doner, baska tipe dusulur).
export function bosluklaAc(cumle, kelime) {
  if (!cumle) return null;
  const desen = new RegExp(`\\b${kelime.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  if (!desen.test(cumle)) return null;
  return cumle.replace(desen, "___");
}

// Tek soru kurar. Istenen tip bu kelime icin kurulamiyorsa (ornegi yok, kok
// hali bos) sirayla digerlerine duser; hicbiri olmazsa null doner.
export function soruKur(kelime, hepsi, tip) {
  const denenecek = [tip, "entr", "tren", "bosluk", "kok"];
  for (const t of denenecek) {
    const soru = tekTip(kelime, hepsi, t);
    if (soru) return soru;
  }
  return null;
}

function tekTip(kelime, hepsi, tip) {
  const paket = (govde) => {
    const yanlislar = govde.yanlislar;
    if (yanlislar.length < 3) return null;
    const secenekler = karistir([govde.dogru, ...yanlislar]);
    return {
      tip,
      kelime: kelime.kelime,
      kayit: kelime,
      soru: govde.soru,
      ipucu: govde.ipucu || "",
      secenekler,
      cevap: secenekler.indexOf(govde.dogru)
    };
  };

  if (tip === "entr") {
    return paket({
      soru: kelime.kelime,
      ipucu: kelime.tur || "",
      dogru: kelime.anlam,
      yanlislar: celdiriciler(hepsi, kelime.anlam, k => k.anlam, kelime)
    });
  }

  if (tip === "tren") {
    return paket({
      soru: kelime.anlam,
      ipucu: kelime.tur ? `${kelime.tur} — İngilizcesi hangisi?` : "İngilizcesi hangisi?",
      dogru: kelime.kelime,
      yanlislar: celdiriciler(hepsi, kelime.kelime, k => k.kelime, kelime)
    });
  }

  if (tip === "bosluk") {
    const cumle = bosluklaAc(kelime.ornek, kelime.kelime);
    if (!cumle) return null;
    return paket({
      soru: cumle,
      ipucu: kelime.anlam,
      dogru: kelime.kelime,
      yanlislar: celdiriciler(hepsi, kelime.kelime, k => k.kelime, kelime)
    });
  }

  if (tip === "kok") {
    const kok = kokMetni(kelime.kokHali);
    if (!kok || kok === kelime.kelime) return null;
    const alan = (k) => kokMetni(k.kokHali) || k.kelime;
    return paket({
      soru: kelime.kelime,
      ipucu: "Bu kelimenin kök (yalın) hâli hangisi?",
      dogru: kok,
      yanlislar: celdiriciler(hepsi, kok, alan, kelime)
    });
  }

  return null;
}

// Bir oturumluk soru listesi. Tipler kelimelere sirayla dagitilir: "karisik"
// secildiginde de her tip esit siklikta cikar, model gibi tekrara dusmez.
export async function oturumKur(ayar) {
  const hepsi = await havuz();
  if (hepsi.length < 4) return { sorular: [], havuzBoyu: hepsi.length };

  const adaylar = sirala(havuzSuz(hepsi, ayar));
  const sorular = [];
  for (const [n, kelime] of adaylar.entries()) {
    if (sorular.length >= ayar.adet) break;
    const tip = ayar.tipler[n % ayar.tipler.length];
    const soru = soruKur(kelime, hepsi, tip);
    if (soru) sorular.push(soru);
  }
  return { sorular, havuzBoyu: hepsi.length };
}

// Cevaptan sonra kelimenin kutusunu gunceller. Konu ilerlemesiyle ayni
// araliklar: dogru cevap kutuyu artirir, yanlis sifira duser.
export async function cevapla(soru, dogruMu) {
  const eski = soru.kayit.kutu ?? 0;
  const kutu = yeniKutu(eski, dogruMu);
  await db.kelimeQuizKaydet(soru.kelime, dogruMu, kutu, gunEkle(ARALIKLAR[kutu]));
  return kutu;
}
