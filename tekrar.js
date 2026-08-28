// Araliklarli tekrar. Kutu konuya aittir, soruya degil: burada ogrenilen sey
// "bu soruyu hatirlamak" degil, "bu kurali fark etmek".
import * as db from "./db.js";

export const ARALIKLAR = [0, 1, 3, 7, 16, 35]; // kutu 0-5 icin gun
export const EN_UST_KUTU = ARALIKLAR.length - 1;

export const bugun = () => new Date().toISOString().slice(0, 10);

export function gunEkle(gun, tarih = new Date()) {
  const d = new Date(tarih);
  d.setDate(d.getDate() + gun);
  return d.toISOString().slice(0, 10);
}

// Dogru cevap kutuyu bir artirir, yanlis sifira dusurur.
export function yeniKutu(kutu, dogruMu) {
  return dogruMu ? Math.min(kutu + 1, EN_UST_KUTU) : 0;
}

// Kutu yukseldikce soru zorlasir; yoksa besinci tekrarda ayni kolay soru gelir.
export function kutuZorlugu(kutu) {
  if (kutu <= 1) return 1;
  if (kutu <= 3) return 2;
  return 3;
}

// Bir konu icin sirada hangi soru gelmeli: once dogru zorlukta, en uzun sure
// once cozulmus olan. Zorluk tutmazsa bir kademe yakinina, o da yoksa herhangi
// birine duser — banka kucukken de akis tikanmasin.
export async function konuIcinSoru(konuId, kutu, kullanilan = new Set()) {
  const hedefZorluk = kutuZorlugu(kutu);
  const hepsi = (await db.konununSorulari(konuId)).filter(s => !kullanilan.has(s.id));
  if (!hepsi.length) return null;

  const sirala = (liste) => liste.sort((a, b) =>
    (a.sonCozum || "").localeCompare(b.sonCozum || "") || a.id.localeCompare(b.id));

  return sirala(hepsi.filter(s => s.zorluk === hedefZorluk))[0]
      || sirala(hepsi.filter(s => Math.abs(s.zorluk - hedefZorluk) === 1))[0]
      || sirala(hepsi)[0]
      || null;
}

// Vadesi gelmis konular: en zayif (kutusu dusuk) once.
export async function vadesiGelenler() {
  const g = bugun();
  return (await db.ciftler("ilerleme"))
    .filter(([, v]) => v.sonrakiTarih && v.sonrakiTarih <= g)
    .sort((a, b) => a[1].kutu - b[1].kutu || (a[1].sonrakiTarih || "").localeCompare(b[1].sonrakiTarih || ""))
    .map(([konuId, ilerleme]) => ({ konuId, ilerleme }));
}

// Gunluk oturum: konu konu ilerler. Her konu icin once kural karti, ardindan
// o konudan en fazla KONU_BASINA soru. Ayni konuyu ust uste calismak
// (blok calisma) kural kartinin ise yaramasi icin gerekli.
const KONU_BASINA = 2;

export async function gunlukOturum(hedef) {
  const vadesi = await vadesiGelenler();
  const adimlar = [];
  const kullanilan = new Set();
  let soruSayisi = 0;

  for (const { konuId, ilerleme } of vadesi) {
    if (soruSayisi >= hedef) break;
    const konununSorulari = [];

    for (let n = 0; n < KONU_BASINA && soruSayisi < hedef; n++) {
      const soru = await konuIcinSoru(konuId, ilerleme.kutu, kullanilan);
      if (!soru) break;
      kullanilan.add(soru.id);
      konununSorulari.push(soru);
      soruSayisi++;
    }

    if (!konununSorulari.length) continue;
    adimlar.push({ tip: "kart", konuId, kutu: ilerleme.kutu });
    for (const soru of konununSorulari) adimlar.push({ tip: "soru", konuId, soru });
  }

  return { adimlar, soruSayisi, konuSayisi: new Set(adimlar.map(a => a.konuId)).size };
}

// Cevaptan sonra konunun kutusunu ve sonraki tarihini gunceller.
export async function cevapla(konuId, soru, dogruMu) {
  const ilerleme = await db.ilerlemeOku(konuId);
  const kutu = yeniKutu(ilerleme.kutu ?? 0, dogruMu);

  await db.ilerlemeYaz(konuId, {
    ...ilerleme,
    dogru: (ilerleme.dogru || 0) + (dogruMu ? 1 : 0),
    yanlis: (ilerleme.yanlis || 0) + (dogruMu ? 0 : 1),
    kutu,
    zayif: kutu < 2,
    sonrakiTarih: gunEkle(ARALIKLAR[kutu])
  });

  await db.soruIsaretle(soru.id, dogruMu);
  return kutu;
}

// Gunluk sayac ve seri. Seri: hedefi tutturdugun ust uste gun sayisi.
export async function gunuKaydet(cozulenArtis, hedef) {
  const g = bugun();
  const sayac = (await db.ayarOku("gunlukSayac", null)) || { tarih: g, cozulen: 0 };
  if (sayac.tarih !== g) { sayac.tarih = g; sayac.cozulen = 0; }
  sayac.cozulen += cozulenArtis;
  await db.ayarYaz("gunlukSayac", sayac);

  if (sayac.cozulen >= hedef) {
    const seri = (await db.ayarOku("seri", null)) || { sonGun: null, sayi: 0 };
    if (seri.sonGun !== g) {
      seri.sayi = seri.sonGun === gunEkle(-1) ? seri.sayi + 1 : 1;
      seri.sonGun = g;
      await db.ayarYaz("seri", seri);
    }
  }
  return sayac;
}
