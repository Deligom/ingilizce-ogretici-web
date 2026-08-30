// Yonlendirme (hash router) ve gorunum montaji.
import * as db from "./db.js";
import { anahtarTest, aciklaSoru, soruSor, kelimeAnlami, cumleKelimeleri,
         benzerCumleler, cumleParcala, metniCozumle, metinUret, metinSohbet,
         AiHata } from "./ai.js";
import * as ai from "./ai.js";
import * as tekrar from "./tekrar.js";
import * as uretim from "./uretim.js";
import * as quiz from "./quiz.js";

const ekran = document.getElementById("ekran");
const BLOK_SAYISI = 8;
const ZAYIF_ESIK = 0.6; // %60 altinda kalan konu "calisilacak" kuyruguna girer

let KONULAR = [];
let TESHIS_PARCALARI = [];
let konuHarita = new Map();

// ---------- yardimcilar ----------
const kacis = (s) => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const HARFLER = ["A", "B", "C", "D", "E"];

// Turkce sayi ekleri: "Blok 2'ye", "Blok 3'u" gibi dogru yazim icin.
const EK_YONELME = { 1: "'e", 2: "'ye", 3: "'e", 4: "'e", 5: "'e", 6: "'ya", 7: "'ye", 8: "'e" };
const EK_BELIRTME = { 1: "'i", 2: "'yi", 3: "'ü", 4: "'ü", 5: "'i", 6: "'yı", 7: "'yi", 8: "'i" };
const yonelme = (n) => n + (EK_YONELME[n] || "'e");
const belirtme = (n) => n + (EK_BELIRTME[n] || "'i");

const SEVIYE_SIRA = { A1: 0, A2: 1, B1: 2 };

const BOSLUK_ISARETI = '<span class="bosluk-isaret">&nbsp;&nbsp;&nbsp;</span>';

// Cumledeki ____ bosluklarini fosforlu isaretle gosterir.
// dokunulur=true ise kelimeler de sarilir: okuma modundaki kelime arama
// soru ekranlarinda da calissin. "bought" gorup "buy"i tanimamak cumleyi
// tamamen cozulemez hale getiriyor.
function soruGoster(metin, dokunulur = false) {
  if (!dokunulur) return kacis(metin).replace(/_{3,}/g, BOSLUK_ISARETI);

  const desen = /(_{3,})|([A-Za-zÀ-ÿ]+(?:['’][A-Za-z]+)?)/g;
  let html = "", son = 0;
  for (const e of metin.matchAll(desen)) {
    html += kacis(metin.slice(son, e.index));
    html += e[1]
      ? BOSLUK_ISARETI
      : `<span class="kelime" data-kelime="${kacis(e[2])}">${kacis(e[2])}</span>`;
    son = e.index + e[0].length;
  }
  return html + kacis(metin.slice(son));
}

// Metinden, kelimenin gectigi cumleyi ayiklar. Okuma parcali sorularda baglam
// koca bir paragraf olabiliyor; toplu kelime cozumlemesi paragrafin tamamini
// degil, dokunulan kelimenin cumlesini kapsasin.
function kelimeninCumlesi(metin, kelime) {
  const tam = String(metin || "");
  if (!tam) return "";
  const cumleler = tam.match(/[^.!?]+[.!?]*/g) || [tam];
  const kacisli = kelime.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const desen = new RegExp("\\b" + kacisli + "\\b", "i");
  return (cumleler.find(c => desen.test(c)) || tam).trim();
}

// Bir kapsayicidaki kelimelere dokunma davranisini baglar.
function kelimeleriBagla(kap, panel, baglam) {
  kap.querySelectorAll(".kelime").forEach(el => el.addEventListener("click", async (e) => {
    e.stopPropagation();
    ekran.querySelectorAll(".kelime.acik").forEach(x => x.classList.remove("acik"));
    el.classList.add("acik");
    await kelimeAc(panel, el.dataset.kelime, kelimeninCumlesi(baglam, el.dataset.kelime));
  }));
}

function blokKonulari(no) {
  return KONULAR.filter(k => k.blok === no);
}

// Teshiste her konudan en fazla 3 soru: once asama 1, yetmezse asama 2.
// Sirasi sabit olmali ki yarida birakip donunce ayni soru gelsin.
async function blokSorulari(no) {
  const secilen = [];
  for (const konu of blokKonulari(no)) {
    const hepsi = await db.konununSorulari(konu.id);
    hepsi.sort((a, b) =>
      a.zorluk - b.zorluk ||
      (a.kaynak === "aybu" ? -1 : 1) - (b.kaynak === "aybu" ? -1 : 1) ||
      a.id.localeCompare(b.id));
    secilen.push(...hepsi.slice(0, 3));
  }
  return secilen;
}

async function blokDurumlari() {
  const liste = [];
  for (let no = 1; no <= BLOK_SAYISI; no++) liste.push({ no, ...(await db.blokOku(no)) });
  return liste;
}

async function zayifKonular() {
  const ciftler = await db.ciftler("ilerleme");
  return ciftler
    .filter(([, v]) => v.zayif)
    .map(([id, v]) => ({ konu: konuHarita.get(id), ...v }))
    .filter(x => x.konu);
}

// ---------- "Neden?" katmani ----------
// Her AI cagrisi bedava krediden yer; sayaci burada tek yerden artiririz.
// Anahtar bossa ai.js proxy'ye gider; kullanicinin bir sey yapmasina gerek yok.
async function aiCagir(isle) {
  const anahtar = await db.ayarOku("apiKey", "");
  ai.modelSec(await db.ayarOku("model", ai.VARSAYILAN_MODEL));
  ai.uslupSec(await db.ayarOku("uslup", "dengeli"));
  const sonuc = await isle(anahtar);
  await db.kotaArtir();
  return sonuc;
}

// Tek benzer cumle satiri. Cevap once gizli; dokununca acilir.
const benzerSatir = (c) => `<li>${kacis(c.cumle)}
  <span class="cevap gizli">${kacis(c.cevap)}</span>${
    c.turkce ? `<small class="benzer-tr">${kacis(c.turkce)}</small>` : ""}</li>`;

function aciklamaKarti(a) {
  const bolum = (etiket, icerik, sinif = "govde") =>
    icerik ? `<div class="bolum"><span class="etiket">${etiket}</span>
      <div class="${sinif}">${kacis(icerik)}</div></div>` : "";

  return `<div class="aciklama">
    ${bolum("Doğrusu", a.dogruSik + " — " + a.neden)}
    ${bolum("Kural", a.kural, "kural-metni")}
    ${bolum("Türkçeyle", a.turkceKarsilastirma)}
    ${bolum("Senin şıkkın", a.secilenNesiYanlis)}
    ${bolum("Tuzak", a.tuzak)}
    <div class="bolum">
      <span class="etiket">Benzer cümleler — cevabı görmek için dokun</span>
      <ul class="benzer" id="benzer-liste">
        ${(a.benzerCumleler || []).map(benzerSatir).join("")}
      </ul>
      <div id="benzer-bildirim"></div>
      <button class="dugme ikincil" id="benzer-uret"
        style="margin-top:10px;min-height:44px;padding:10px 16px">Başka 5 cümle üret</button>
    </div>
  </div>`;
}
// Model bazen markdown yaziyor. Once HTML kacisi yapariz (guvenlik), sonra
// yalnizca iki isareti ceviririz: **kalin** ve satir basindaki * madde imi.
function sohbetMetni(metin) {
  return kacis(metin)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/^\s*\*\s+/gm, "• ");
}

const mesajHtml = (m) =>
  `<div class="mesaj ${m.rol === "kullanici" ? "kullanici" : "ai"}">${
    m.rol === "kullanici" ? kacis(m.metin) : sohbetMetni(m.metin)}</div>`;

// Benzer cumle listesinde cevaba dokununca acilir/kapanir.
function cevaplariBagla(kap) {
  kap.querySelectorAll(".benzer .cevap").forEach(e => {
    if (e.dataset.bagli) return;
    e.dataset.bagli = "1";
    e.addEventListener("click", () => e.classList.toggle("gizli"));
  });
}

// "Baska 5 cumle uret": duz sohbet metni yerine dokunulabilir alistirma.
// Uretilen cumleler aciklama kaydina eklenir; bir daha kota harcanmaz ve
// ucus modunda da acilir.
function benzerUretBagla(kap, a, soru, secilen, konu) {
  const dugme = kap.querySelector("#benzer-uret");
  const liste = kap.querySelector("#benzer-liste");
  const bildirim = kap.querySelector("#benzer-bildirim");
  if (!dugme || !liste) return;

  dugme.addEventListener("click", async () => {
    dugme.disabled = true;
    bildirim.innerHTML = `<p class="yukleniyor" style="margin:8px 0 0">Yeni cümleler yazılıyor</p>`;
    try {
      const mevcut = (a.benzerCumleler || []).map(c => c.cumle);
      const veri = await aiCagir(x => benzerCumleler(x, konu, soru.soru, mevcut, 5));
      const yeniler = (veri.cumleler || []).filter(c => c.cumle && c.cevap);
      a.benzerCumleler = [...(a.benzerCumleler || []), ...yeniler];
      await db.aciklamaYaz(soru.id, secilen, a);
      liste.insertAdjacentHTML("beforeend", yeniler.map(benzerSatir).join(""));
      cevaplariBagla(kap);
      bildirim.innerHTML = "";
      liste.lastElementChild?.scrollIntoView({ block: "nearest" });
    } catch (hata) {
      bildirim.innerHTML = `<div class="bildirim hata" style="margin:8px 0 0">${kacis(hata.message)}</div>`;
    } finally {
      dugme.disabled = false;
    }
  });
}

// Hazir soru onerileri. Yerelde uretilir, kota harcamaz. Tiklayinca kutuya
// yazilir ama GONDERILMEZ: kullanici cumleyi degistirmek isteyebilir.
function oneriListesi(soru, secilen) {
  // "Baska bir ornek" burada yok: o artik sohbet metni degil, aciklama
  // kartindaki "Baska 5 cumle uret" dugmesiyle dokunulabilir alistirma uretiyor.
  const oneriler = [];
  oneriler.push(secilen === null
    ? "Bu soruda en çok hangi şık kandırıyor?"
    : `Neden "${soru.secenekler[secilen]}" olmuyor?`);
  oneriler.push("Türkçede bunun karşılığı ne?");
  oneriler.push("Bunu nasıl aklımda tutarım?");
  return oneriler;
}

function sohbetKarti(mesajlar, oneriler) {
  return `<div class="sohbet">
    <div class="mesajlar">
      ${mesajlar.length === 0
        ? `<p class="kucuk soluk" style="margin:0">Anlamadığın bir yer varsa sor — bu soru bağlamında cevaplar.</p>`
        : mesajlar.map(mesajHtml).join("")}
    </div>
    ${oneriler?.length ? `<div class="oneri-liste">
      ${oneriler.map(o => `<button class="oneri">${kacis(o)}</button>`).join("")}
    </div>` : ""}
    <textarea class="sohbet-girdi" rows="2" placeholder="Aklına takılanı yaz…"></textarea>
    <div class="satir" style="margin-top:8px">
      <button class="dugme sohbet-gonder" style="min-height:44px;padding:10px 18px">Sor</button>
    </div>
  </div>`;
}

// Bir yanlis cevap icin aciklamayi acar: once cache, yoksa AI, sonra sohbet.
async function nedenAc(kap, soru, secilen, konu) {
  const oneriAcik = await db.ayarOku("oneriler", true);

  const cizAciklama = (a, mesajlar) => {
    kap.innerHTML = aciklamaKarti(a) +
      sohbetKarti(mesajlar, oneriAcik ? oneriListesi(soru, secilen) : null);
    cevaplariBagla(kap);
    benzerUretBagla(kap, a, soru, secilen, konu);
    // Oneriye basinca kutuya yazilir, gonderilmez.
    const girdi = kap.querySelector(".sohbet-girdi");
    kap.querySelectorAll(".oneri").forEach(o => o.addEventListener("click", () => {
      girdi.value = o.textContent;
      girdi.focus();
    }));
    sohbetBagla(kap, soru, secilen, konu);
  };

  let aciklama = await db.aciklamaOku(soru.id, secilen);
  if (!aciklama) {
    kap.innerHTML = `<p class="yukleniyor" style="margin:14px 0 0">Açıklama hazırlanıyor</p>`;
    try {
      aciklama = await aiCagir(a => aciklaSoru(a, soru, secilen, konu));
      await db.aciklamaYaz(soru.id, secilen, aciklama);
    } catch (hata) {
      kap.innerHTML = `<div class="bildirim hata" style="margin:14px 0 0">${kacis(hata.message)}</div>
        ${["anahtar", "proxyyok", "sunucuanahtaryok", "gunlukSinir"].includes(hata.kod)
          ? `<a class="dugme ikincil" href="#/ayarlar" style="text-decoration:none">Ayarlar'a git</a>` : ""}`;
      return;
    }
  }
  cizAciklama(aciklama, await db.sohbetOku(soru.id));
}

function sohbetBagla(kap, soru, secilen, konu) {
  const girdi = kap.querySelector(".sohbet-girdi");
  const dugme = kap.querySelector(".sohbet-gonder");
  if (!girdi || !dugme) return;

  async function gonder() {
    const metin = girdi.value.trim();
    if (!metin) return;
    // Mesaj once ekranda gorunur ama diske yalnizca cevap gelince yazilir:
    // cevapsiz kalan kullanici mesaji gecmisi bozar (art arda iki kullanici sirasi).
    const mesajlar = await db.sohbetOku(soru.id);
    mesajlar.push({ rol: "kullanici", metin });

    girdi.value = "";
    dugme.disabled = true;
    const kutu = kap.querySelector(".mesajlar");
    kutu.innerHTML = mesajlar.map(mesajHtml).join("")
      + `<p class="yukleniyor" style="margin:0">Yazıyor</p>`;
    kutu.lastElementChild.scrollIntoView({ block: "nearest" });

    try {
      const baglam = {
        soru: soru.soru, metin: soru.metin,
        secenekler: soru.secenekler,
        dogru: soru.secenekler[soru.cevap],
        secilen: secilen === null ? "(bilmiyorum dedi)" : soru.secenekler[secilen],
        konuAd: konu.ad, konuKural: konu.kural
      };
      const cevap = await aiCagir(a => soruSor(a, baglam, mesajlar));
      mesajlar.push({ rol: "ai", metin: cevap.trim() });
      await db.sohbetYaz(soru.id, mesajlar);
      kutu.innerHTML = mesajlar.map(mesajHtml).join("");
    } catch (hata) {
      mesajlar.pop();                 // gonderilemeyen mesaj gecmise girmesin
      girdi.value = metin;             // yazdigi kaybolmasin, tekrar deneyebilsin
      kutu.querySelector(".yukleniyor")?.remove();
      kutu.insertAdjacentHTML("beforeend",
        `<div class="bildirim hata" style="margin:0">${kacis(hata.message)}</div>`);
    } finally {
      dugme.disabled = false;
      kutu.lastElementChild?.scrollIntoView({ block: "nearest" });
    }
  }

  dugme.addEventListener("click", gonder);
  girdi.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); gonder(); }
  });
}

// ---------- gorunumler ----------
async function anaSayfa() {
  const bloklar = await blokDurumlari();
  const biten = bloklar.filter(b => b.durum === "bitti").length;
  const devam = bloklar.find(b => b.durum === "devam");
  const sirada = bloklar.find(b => b.durum === "baslamadi");
  const zayif = await zayifKonular();

  const hedef = Number(await db.ayarOku("gunlukHedef", 10));
  const sayac = (await db.ayarOku("gunlukSayac", null)) || { tarih: tekrar.bugun(), cozulen: 0 };
  const bugunCozulen = sayac.tarih === tekrar.bugun() ? sayac.cozulen : 0;
  const seri = (await db.ayarOku("seri", null)) || { sayi: 0, sonGun: null };
  const vadesi = await tekrar.vadesiGelenler();

  let baslangic;
  if (devam) {
    baslangic = `<a class="dugme tam" href="#/blok/${devam.no}">Blok ${yonelme(devam.no)} devam et
      <span class="kucuk" style="font-weight:400;opacity:.8">${devam.sonSoruIndex}/15</span></a>`;
  } else if (sirada) {
    baslangic = `<a class="dugme tam" href="#/blok/${sirada.no}">${biten === 0 ? "Teşhise başla" : `Blok ${belirtme(sirada.no)} çöz`}
      <span class="kucuk" style="font-weight:400;opacity:.8">15 soru · ~6 dk</span></a>`;
  } else {
    baslangic = `<p class="soluk">Sekiz bloğun hepsi çözüldü. Haritan tamamlandı.</p>`;
  }

  ekran.innerHTML = `
    <h1>${biten === 0 ? "Nerede takıldığını bulalım" : "Devam edelim"}</h1>
    <p class="soluk">${biten === 0
      ? "Sekiz kısa bloktan ilki 15 soru sürüyor. Bitirdiğin an o konuların haritası çıkıyor — testin tamamını beklemene gerek yok."
      : `${biten}/${BLOK_SAYISI} blok bitti.`}</p>

    ${vadesi.length ? `
      <div class="kuyruk">
        ${seri.sayi > 1 ? `<span class="seri">🔥 ${seri.sayi} günlük seri</span><br>` : ""}
        <h2>Bugünün kuyruğu</h2>
        <p>${vadesi.length} konu tekrar zamanında${bugunCozulen ? ` · bugün ${bugunCozulen}/${hedef} soru çözdün` : ` · ~${hedef} soru, 10 dakika`}</p>
        <a class="dugme" href="#/calis" style="text-decoration:none">${bugunCozulen >= hedef ? "Devam et" : "Çalışmaya başla"}</a>
      </div>` : ""}

    <div style="margin:20px 0">${baslangic}</div>

    <h2>Blok haritası</h2>
    <div class="harita">
      ${bloklar.map(b => {
        const konular = blokKonulari(b.no);
        const seviye = [...new Set(konular.map(k => k.seviye))].sort((x, y) => SEVIYE_SIRA[x] - SEVIYE_SIRA[y]).join("/");
        const durum = b.durum === "bitti"
          ? `<span class="rozet ${b.zayifSayisi > 0 ? "zayif" : "iyi"}">${b.zayifSayisi > 0 ? b.zayifSayisi + " zayıf konu" : "hepsi iyi"}</span>`
          : b.durum === "devam"
            ? `<span class="rozet">${b.sonSoruIndex}/15</span>`
            : `<span class="rozet">çözülmedi</span>`;
        return `<a class="blok ${b.durum === "bitti" ? "bitti" : ""}" href="#/${b.durum === "bitti" ? "sonuc" : "blok"}/${b.no}"
                   style="text-decoration:none">
          <span class="no">${b.no}</span>
          <span class="govde">
            <span class="ad">${seviye} · ${konular.length} konu</span>
            <span class="alt">${kacis(konular.map(k => k.ad.split(" — ")[0]).join(", "))}</span>
          </span>
          ${durum}
        </a>`;
      }).join("")}
    </div>

    <h2>Çalışılacak konular</h2>
    ${zayif.length === 0
      ? `<div class="kart bos">Henüz zayıf konu yok. Bir blok çözünce burası dolar.</div>`
      : `<div class="kart" style="padding:0">
           ${zayif.map(z => `<div class="konu-satir">
             <span class="ad"><span class="vurgu">${kacis(z.konu.ad)}</span>
               <small>${z.konu.seviye} · ${z.dogru}/${z.dogru + z.yanlis} doğru${
                 z.sonrakiTarih ? (z.sonrakiTarih <= tekrar.bugun() ? " · bugün tekrar" : " · " + z.sonrakiTarih + " tekrar") : ""}</small></span>
             <span class="oran soluk">${z.kutu ?? 0}/5</span>
           </div>`).join("")}
         </div>`}

    <div class="satir" style="margin-top:18px">
      <a class="dugme ikincil" href="#/oku" style="text-decoration:none">Okuma</a>
      <a class="dugme ikincil" href="#/kelimeler" style="text-decoration:none">Kelimelerim</a>
      <a class="dugme ikincil" href="#/quiz" style="text-decoration:none">Kelime quizi</a>
      <a class="dugme ikincil" href="#/hatalar" style="text-decoration:none">Hata bankası</a>
      <a class="dugme ikincil" href="#/ayarlar" style="text-decoration:none">Ayarlar</a>
    </div>
  `;
}

async function blokEkrani(no) {
  const konular = blokKonulari(no);
  if (!konular.length) return git("#/");

  const sorular = await blokSorulari(no);
  let durum = await db.blokOku(no);
  if (durum.durum === "bitti") return git("#/sonuc/" + no);
  if (durum.durum === "baslamadi") {
    durum = { durum: "devam", sonSoruIndex: 0, cevaplar: [] };
    await db.blokYaz(no, durum);
  }

  let i = Math.min(durum.sonSoruIndex, sorular.length - 1);
  let secilen = null;
  let bilmiyorumAktif = false;

  function ciz() {
    const s = sorular[i];
    // Geri gelinen soruda onceki cevap hatirlanir; kullanici fikrini degistirebilsin.
    const mevcut = durum.cevaplar[i];
    secilen = mevcut && !mevcut.bilmiyorum ? mevcut.secilen : null;
    bilmiyorumAktif = !!mevcut?.bilmiyorum;

    ekran.innerHTML = `
      <div class="ilerleme-cubuk"><i style="width:${(i / sorular.length) * 100}%"></i></div>
      <div class="gezinti">
        <button class="ok" id="geri" ${i === 0 ? "disabled" : ""} aria-label="Önceki soru">←</button>
        <span class="sayac" style="margin:0">Blok ${no} · Soru ${i + 1} / ${sorular.length}</span>
      </div>
      ${s.metin ? `<div class="parca">${kacis(s.metin)}</div>` : ""}
      <p class="soru-metni">${soruGoster(s.soru)}</p>
      <div class="sik-liste">
        ${s.secenekler.map((o, j) => `
          <button class="sik ${secilen === j ? "secili" : ""}" data-j="${j}">
            <span class="harf">${HARFLER[j]}</span><span>${kacis(o)}</span>
          </button>`).join("")}
      </div>
      <div class="satir">
        <button class="dugme" id="ileri" ${secilen === null && !bilmiyorumAktif ? "disabled" : ""}>${
          i === sorular.length - 1 ? "Bitir ve haritayı gör" : "Sonraki soru →"}</button>
        <button class="dugme ikincil ${bilmiyorumAktif ? "secili" : ""}" id="bilmiyorum">Bilmiyorum</button>
      </div>
      <p class="kucuk soluk" style="margin-top:14px">
        Emin değilsen tahmin etme, <strong>Bilmiyorum</strong> de — şans eseri tutturduğun soru
        haritanı bozar, o konuyu biliyor sayarız.
      </p>
      <p style="margin-top:10px"><button class="dugme ikincil" id="cik"
        style="min-height:44px;padding:10px 18px">Sonra devam ederim</button></p>
    `;

    ekran.querySelectorAll(".sik").forEach(d => d.addEventListener("click", () => {
      secilen = Number(d.dataset.j);
      bilmiyorumAktif = false;
      ekran.querySelectorAll(".sik").forEach(x => x.classList.remove("secili"));
      d.classList.add("secili");
      ekran.querySelector("#bilmiyorum").classList.remove("secili");
      ekran.querySelector("#ileri").disabled = false;
    }));

    // Sik secilmemis ama daha once bilmiyorum denmisse, ileri o cevabi korur.
    ekran.querySelector("#ileri").addEventListener("click", () => ileri(secilen === null && bilmiyorumAktif));
    ekran.querySelector("#bilmiyorum").addEventListener("click", () => ileri(true));
    ekran.querySelector("#geri").addEventListener("click", geri);
    ekran.querySelector("#cik").addEventListener("click", () => git("#/"));
  }

  // Ekrandaki secimi kayda gecirir. Hem ileri hem geri giderken cagrilir:
  // sik secip ileri basmadan geri donen kullanici secimini kaybetmesin.
  function kaydet(bilmiyorum) {
    if (secilen === null && !bilmiyorum) return;   // hic cevaplanmadiysa yazma
    const s = sorular[i];
    durum.cevaplar[i] = {
      soruId: s.id, konu: s.konu,
      secilen: bilmiyorum ? null : secilen,
      dogruMu: !bilmiyorum && secilen === s.cevap,
      bilmiyorum: !!bilmiyorum
    };
  }

  async function geri() {
    if (i === 0) return;
    kaydet(secilen === null && bilmiyorumAktif);
    i--;
    durum.sonSoruIndex = i;
    await db.blokYaz(no, durum);
    ciz();
    window.scrollTo(0, 0);
  }

  // bilmiyorum = kullanici tahmin etmek yerine bilmedigini soyledi. Yanlis sayilir
  // ama incelemede ayri gosterilir: sasirdigi bir sik yok, aciklamasi da farkli.
  async function ileri(bilmiyorum) {
    kaydet(bilmiyorum);
    i++;

    if (i >= sorular.length) {
      durum.durum = "bitti";
      durum.sonSoruIndex = sorular.length;
      await blokSonuclandir(no, durum);
      return git("#/sonuc/" + no);
    }
    durum.sonSoruIndex = i;
    await db.blokYaz(no, durum);
    ciz();
    window.scrollTo(0, 0);
  }

  ciz();
}

// Blok bitince konu bazinda dogru oranini hesaplar, zayiflari kuyruga yazar.
async function blokSonuclandir(no, durum) {
  const sayim = new Map();
  for (const c of durum.cevaplar) {
    const s = sayim.get(c.konu) || { dogru: 0, yanlis: 0 };
    c.dogruMu ? s.dogru++ : s.yanlis++;
    sayim.set(c.konu, s);
  }

  let zayifSayisi = 0;
  for (const [konuId, s] of sayim) {
    const oran = s.dogru / (s.dogru + s.yanlis);
    const zayif = oran < ZAYIF_ESIK;
    if (zayif) zayifSayisi++;
    await db.ilerlemeYaz(konuId, {
      dogru: s.dogru, yanlis: s.yanlis,
      kutu: 0, zayif,
      sonrakiTarih: zayif ? new Date().toISOString().slice(0, 10) : null
    });
  }

  durum.zayifSayisi = zayifSayisi;
  await db.blokYaz(no, durum);
}

async function sonucEkrani(no) {
  const durum = await db.blokOku(no);
  if (durum.durum !== "bitti") return git("#/blok/" + no);

  const sorular = await blokSorulari(no);
  const soruHarita = new Map(sorular.map(s => [s.id, s]));

  const sayim = new Map();
  for (const c of durum.cevaplar) {
    const s = sayim.get(c.konu) || { dogru: 0, yanlis: 0 };
    c.dogruMu ? s.dogru++ : s.yanlis++;
    sayim.set(c.konu, s);
  }

  const yanlislar = durum.cevaplar.filter(c => !c.dogruMu);
  const bilmiyorumSayisi = yanlislar.filter(c => c.bilmiyorum).length;
  const toplamDogru = durum.cevaplar.length - yanlislar.length;

  ekran.innerHTML = `
    <h1>Blok ${no} haritası</h1>
    <p class="soluk">${toplamDogru}/${durum.cevaplar.length} doğru.
      ${durum.zayifSayisi > 0
        ? `<strong>${durum.zayifSayisi} konu</strong> çalışma kuyruğuna girdi.`
        : "Bu bloktaki konuların hepsi iyi görünüyor."}</p>

    <div class="kart" style="padding:0;margin-top:18px">
      ${blokKonulari(no).map(k => {
        const s = sayim.get(k.id) || { dogru: 0, yanlis: 0 };
        const top = s.dogru + s.yanlis;
        const oran = top ? s.dogru / top : 0;
        const zayif = top && oran < ZAYIF_ESIK;
        return `<div class="konu-satir">
          <span class="ad">${zayif ? `<span class="vurgu">${kacis(k.ad)}</span>` : kacis(k.ad)}
            <small>${k.seviye} · ${kacis(k.kural.split(".")[0])}.</small></span>
          <span class="oran" style="color:${zayif ? "var(--yanlis)" : "var(--dogru)"}">${s.dogru}/${top}</span>
        </div>`;
      }).join("")}
    </div>

    ${yanlislar.length ? `
      <div class="kart" style="margin-top:18px">
        <p style="margin:0 0 4px"><strong>${yanlislar.length} soruyu kaçırdın</strong>
          ${bilmiyorumSayisi ? `<span class="soluk">— ${bilmiyorumSayisi} tanesinde bilmiyorum dedin</span>` : ""}</p>
        <p class="kucuk soluk" style="margin:0 0 12px">Tek tek geçelim: her sayfada bir soru,
          doğrusu, gerekçesi ve istersen "Neden?" ile ayrıntılı anlatım.</p>
        <a class="dugme" href="#/inceleme/${no}/0" style="text-decoration:none">Yanlışları incele</a>
      </div>` : `<div class="kart bos" style="margin-top:18px">Bu blokta hiç yanlışın yok. Temiz geçtin.</div>`}

    <div class="satir" style="margin-top:20px">
      ${no < BLOK_SAYISI ? `<a class="dugme ikincil" href="#/blok/${no + 1}" style="text-decoration:none">Blok ${yonelme(no + 1)} geç</a>` : ""}
      <a class="dugme ikincil" href="#/" style="text-decoration:none">Ana sayfa</a>
    </div>
  `;
  window.scrollTo(0, 0);
}

// Sayfa sayfa yanlis incelemesi: her ekranda tek soru. Uzun kaydirmada yerini
// kaybetme sorununu cozer; index hash'te durdugu icin geri tusu de calisir.
async function incelemeEkrani(no, index) {
  const durum = await db.blokOku(no);
  if (durum.durum !== "bitti") return git("#/blok/" + no);

  const sorular = await blokSorulari(no);
  const soruHarita = new Map(sorular.map(s => [s.id, s]));
  const yanlislar = durum.cevaplar.filter(c => !c.dogruMu);
  if (!yanlislar.length) return git("#/sonuc/" + no);

  const i = Math.max(0, Math.min(index, yanlislar.length - 1));
  const c = yanlislar[i];
  const s = soruHarita.get(c.soruId);
  // Soru bankadan kalkmis olabilir (silinmis AI sorusu, degismis banka surumu).
  // Cokmek yerine o yanlisi atlayalim.
  if (!s) {
    if (yanlislar.length === 1) return git("#/sonuc/" + no);
    return git(`#/inceleme/${no}/${i + 1 < yanlislar.length ? i + 1 : i - 1}`);
  }
  const konu = konuHarita.get(s.konu);
  const secilen = c.bilmiyorum ? null : c.secilen;
  const secilenMetin = c.bilmiyorum ? null : s.secenekler[c.secilen];
  const celdirici = secilenMetin && s.celdiriciler?.find(t => t.startsWith(secilenMetin));

  ekran.innerHTML = `
    <div class="ilerleme-cubuk"><i style="width:${((i + 1) / yanlislar.length) * 100}%"></i></div>
    <div class="sayac">Blok ${no} · Yanlış ${i + 1} / ${yanlislar.length}
      · <a href="#/sonuc/${no}" style="color:inherit">haritaya dön</a></div>

    <div class="kart">
      ${s.metin ? `<div class="parca" style="max-height:26vh;margin-bottom:12px">${soruGoster(s.metin, true)}</div>` : ""}
      <p class="soru-metni" style="font-size:16px;margin-bottom:14px">${soruGoster(s.soru, true)}</p>

      ${c.bilmiyorum
        ? `<p class="kucuk soluk" style="margin:0 0 6px">Bilmiyorum dedin — iyi yaptın, tahmin etmedin.</p>`
        : `<p class="kucuk" style="margin:0 0 6px"><span style="color:var(--yanlis)">Senin cevabın:</span>
             <span style="font-family:var(--mono)">${kacis(secilenMetin)}</span></p>`}
      <p class="kucuk" style="margin:0 0 10px"><span style="color:var(--dogru)">Doğrusu:</span>
        <span style="font-family:var(--mono)"><span class="vurgu">${kacis(s.secenekler[s.cevap])}</span></span></p>

      ${s.neden ? `<p class="kucuk" style="margin:0">${kacis(s.neden)}</p>` : ""}
      ${celdirici ? `<p class="kucuk soluk" style="margin:8px 0 0">${kacis(celdirici)}</p>` : ""}

      <button class="dugme ikincil" id="neden-dugme"
              style="min-height:44px;padding:10px 18px;margin-top:12px">Neden?</button>
      <div class="neden-alani"></div>
      <div class="kelime-panel"></div>
      <p class="kucuk soluk" style="margin:10px 0 0">Bilmediğin kelimeye dokun.</p>
    </div>

    <div class="satir" style="margin-top:16px">
      <button class="dugme ikincil" id="onceki" ${i === 0 ? "disabled" : ""}>← Önceki</button>
      ${i === yanlislar.length - 1
        ? `<a class="dugme" href="#/sonuc/${no}" style="text-decoration:none">Bitir</a>`
        : `<button class="dugme" id="sonraki">Sonraki →</button>`}
    </div>
  `;

  kelimeleriBagla(ekran, ekran.querySelector(".kelime-panel"), s.metin || s.soru);

  const dugme = ekran.querySelector("#neden-dugme");
  const kap = ekran.querySelector(".neden-alani");
  if (await db.aciklamaOku(s.id, secilen)) dugme.textContent = "Neden? (hazır)";
  dugme.addEventListener("click", async () => {
    if (kap.innerHTML) { kap.innerHTML = ""; dugme.textContent = "Neden?"; return; }
    dugme.textContent = "Gizle";
    await nedenAc(kap, s, secilen, konu);
  });

  ekran.querySelector("#onceki")?.addEventListener("click", () => git(`#/inceleme/${no}/${i - 1}`));
  ekran.querySelector("#sonraki")?.addEventListener("click", () => git(`#/inceleme/${no}/${i + 1}`));
  window.scrollTo(0, 0);
}

// ---------- Alistirma ----------
// Teshisten farki: burada cevap aninda gosterilir ve ogretilir. Teshis olcer,
// alistirma ogretir. Kutu her cevapta guncellenir.
async function calisEkrani() {
  const hedef = Number(await db.ayarOku("gunlukHedef", 10));
  const oturum = await tekrar.gunlukOturum(hedef);

  if (!oturum.soruSayisi) {
    const vadesi = await tekrar.vadesiGelenler();
    ekran.innerHTML = `
      <h1>Bugünlük bu kadar</h1>
      <p class="soluk">${vadesi.length === 0
        ? "Vadesi gelen konu yok. Yeni bir teşhis bloğu çözersen kuyruk dolar."
        : "Bu konularda soru kalmadı. Ayarlar'dan yeni soru üretebilirsin."}</p>
      <div class="satir" style="margin-top:16px">
        <a class="dugme" href="#/" style="text-decoration:none">Ana sayfa</a>
        <a class="dugme ikincil" href="#/ayarlar" style="text-decoration:none">Ayarlar</a>
      </div>`;
    return;
  }

  let i = 0;
  let dogruSayisi = 0, yanlisSayisi = 0;
  const gorulen = new Set();

  function ciz() {
    if (i >= oturum.adimlar.length) return bitir();
    const adim = oturum.adimlar[i];
    const konu = konuHarita.get(adim.konuId);
    const kalanSoru = oturum.adimlar.slice(i).filter(a => a.tip === "soru").length;
    const cozulen = oturum.soruSayisi - kalanSoru;

    const ustBilgi = `
      <div class="ilerleme-cubuk"><i style="width:${(cozulen / oturum.soruSayisi) * 100}%"></i></div>
      <div class="sayac">Alıştırma · ${cozulen} / ${oturum.soruSayisi} soru
        · <a href="#/" style="color:inherit">çık</a></div>`;

    if (adim.tip === "kart") {
      ekran.innerHTML = ustBilgi + `
        <div class="kart konu-kart">
          <span class="etiket">${konu.seviye} · kutu ${adim.kutu}/5</span>
          <h1 style="font-size:23px;margin:6px 0 12px">${kacis(konu.ad)}</h1>
          <p class="kural-metni" style="margin-bottom:14px">${kacis(konu.kural)}</p>
          <div class="yapi">${kacis(konu.yapi)}</div>
          <div class="ornek">
            <div class="en">${kacis(konu.ornek.en)}</div>
            <div class="tr soluk">${kacis(konu.ornek.tr)}</div>
          </div>
          <div class="tuzak-kutu">
            <span class="etiket">Tuzak</span>
            <p style="margin:2px 0 0;font-size:14.5px">${kacis(konu.tuzak)}</p>
          </div>
        </div>
        <button class="dugme tam" id="basla">Hazırım, soruya geç →</button>`;
      ekran.querySelector("#basla").addEventListener("click", () => { i++; ciz(); window.scrollTo(0, 0); });
      return;
    }

    // --- soru adimi ---
    const s = adim.soru;
    let secilen = null, cevaplandi = false;

    ekran.innerHTML = ustBilgi + `
      <div class="sayac" style="margin-top:-4px">${kacis(konu.ad)}</div>
      ${s.metin ? `<div class="parca">${kacis(s.metin)}</div>` : ""}
      <p class="soru-metni">${soruGoster(s.soru)}</p>
      <div class="sik-liste">
        ${s.secenekler.map((o, j) => `
          <button class="sik" data-j="${j}">
            <span class="harf">${HARFLER[j]}</span><span>${kacis(o)}</span>
          </button>`).join("")}
      </div>
      <div id="geribildirim"></div>`;

    ekran.querySelectorAll(".sik").forEach(d => d.addEventListener("click", async () => {
      if (cevaplandi) return;
      cevaplandi = true;
      secilen = Number(d.dataset.j);
      const dogruMu = secilen === s.cevap;
      dogruMu ? dogruSayisi++ : yanlisSayisi++;
      gorulen.add(adim.konuId);

      ekran.querySelectorAll(".sik").forEach((x, j) => {
        x.disabled = true;
        if (j === s.cevap) x.classList.add("dogru");
        else if (j === secilen) x.classList.add("yanlis");
      });

      const yeniKutuNo = await tekrar.cevapla(adim.konuId, s, dogruMu);
      const celdirici = !dogruMu && s.celdiriciler?.find(t => t.startsWith(s.secenekler[secilen]));

      ekran.querySelector("#geribildirim").innerHTML = `
        <div class="kart" style="border-color:${dogruMu ? "var(--dogru)" : "var(--yanlis)"}">
          <p style="margin:0 0 6px;font-weight:600;color:${dogruMu ? "var(--dogru)" : "var(--yanlis)"}">
            ${dogruMu ? "Doğru" : "Yanlış"}
            <span class="soluk" style="font-weight:400;font-size:14px">— kutu ${yeniKutuNo}/5</span>
          </p>
          ${!dogruMu ? `<p class="kucuk" style="margin:0 0 8px">Doğrusu:
            <span style="font-family:var(--mono)"><span class="vurgu">${kacis(s.secenekler[s.cevap])}</span></span></p>` : ""}
          ${s.neden ? `<p class="kucuk" style="margin:0">${kacis(s.neden)}</p>` : ""}
          ${celdirici ? `<p class="kucuk soluk" style="margin:8px 0 0">${kacis(celdirici)}</p>` : ""}
          <div class="satir" style="margin-top:12px">
            <button class="dugme" id="devam">${i === oturum.adimlar.length - 1 ? "Oturumu bitir" : "Devam →"}</button>
            <button class="dugme ikincil" id="neden-dugme"
              style="min-height:44px;padding:10px 18px">Neden?</button>
          </div>
          <div class="neden-alani"></div>
          <div class="kelime-panel"></div>
        </div>`;

      // Cevap verildikten sonra kelimeler dokunulur olur. Once acsaydik
      // kelime sorularinin cevabini dogrudan vermis olurduk.
      const soruAlani = ekran.querySelector(".soru-metni");
      soruAlani.innerHTML = soruGoster(s.soru, true);
      const parcaAlani = ekran.querySelector(".parca");
      if (parcaAlani) parcaAlani.innerHTML = soruGoster(s.metin, true);
      kelimeleriBagla(ekran, ekran.querySelector(".kelime-panel"), s.metin || s.soru);

      const kap = ekran.querySelector(".neden-alani");
      const nedenDugme = ekran.querySelector("#neden-dugme");
      if (await db.aciklamaOku(s.id, secilen)) nedenDugme.textContent = "Neden? (hazır)";
      nedenDugme.addEventListener("click", async () => {
        if (kap.innerHTML) { kap.innerHTML = ""; nedenDugme.textContent = "Neden?"; return; }
        nedenDugme.textContent = "Gizle";
        await nedenAc(kap, s, secilen, konu);
      });

      ekran.querySelector("#devam").addEventListener("click", () => { i++; ciz(); window.scrollTo(0, 0); });
      ekran.querySelector("#geribildirim").scrollIntoView({ block: "nearest", behavior: "smooth" });
    }));
  }

  async function bitir() {
    const sayac = await tekrar.gunuKaydet(dogruSayisi + yanlisSayisi, hedef);
    const seri = (await db.ayarOku("seri", null)) || { sayi: 0 };
    const hedefTuttu = sayac.cozulen >= hedef;

    ekran.innerHTML = `
      <h1>${hedefTuttu ? "Günlük hedef tamam" : "Oturum bitti"}</h1>
      <p class="soluk">${dogruSayisi} doğru, ${yanlisSayisi} yanlış ·
        bugün toplam ${sayac.cozulen}/${hedef} soru${seri.sayi > 1 ? ` · ${seri.sayi} günlük seri` : ""}</p>
      <div class="kart" style="padding:0;margin-top:18px">
        ${[...gorulen].map(id => {
          const k = konuHarita.get(id);
          return `<div class="konu-satir"><span class="ad">${kacis(k.ad)}
            <small>${k.seviye}</small></span></div>`;
        }).join("")}
      </div>
      <div class="satir" style="margin-top:20px">
        <a class="dugme" href="#/calis" style="text-decoration:none">Devam et</a>
        <a class="dugme ikincil" href="#/" style="text-decoration:none">Ana sayfa</a>
      </div>`;
  }

  ciz();
  window.scrollTo(0, 0);
}

// ---------- Okuma modu ----------
// Metin bir kez cozumlenir, sonrasi anlik ve cevrimdisi. Tek tek istek atmak
// hem yavas hem de ucak modunda cumleyi tamamen kullanilmaz birakiyordu.
const COZUM_PARTI = 4;   // tek istekte kac cumle (kisa tut: uzun istek zaman asimina ugruyor)

async function metniCozumleVeKaydet(cumleler, ilerlemeyiBildir) {
  const eksik = [];
  for (const c of cumleler) if (!(await db.cumleOku(c))) eksik.push(c);
  if (!eksik.length) return { cozulen: 0, zorKelime: 0 };

  let cozulen = 0, zorKelime = 0;
  const partiSayisi = Math.ceil(eksik.length / COZUM_PARTI);

  for (let p = 0; p < partiSayisi; p++) {
    const parti = eksik.slice(p * COZUM_PARTI, (p + 1) * COZUM_PARTI);
    ilerlemeyiBildir?.(p + 1, partiSayisi);
    const veri = await aiCagir(a => metniCozumle(a, parti));

    // Model cumleyi bazen kirpiyor (bastaki paragraf numarasi, tirnak isareti).
    // Sayilar tutuyorsa siraya guvenmek en saglami.
    const donen = veri.cumleler || [];
    const sirayaGuven = donen.length === parti.length;
    for (const [n, c] of donen.entries()) {
      const hedef = parti.find(x => x === c.cumle)
        || parti.find(x => x.replace(/\s+/g, " ").trim() === String(c.cumle).replace(/\s+/g, " ").trim())
        || parti.find(x => x.startsWith(String(c.cumle).slice(0, 24)))
        || (sirayaGuven ? parti[n] : null);
      if (!hedef) continue;
      await db.cumleYaz(hedef, { parcalar: c.parcalar, turkce: c.turkce });
      cozulen++;
    }
    for (const k of veri.zorKelimeler || []) {
      if (await db.kelimeOku(k.kelime)) continue;
      await db.kelimeYaz(k.kelime, {
        anlam: k.anlam, tur: k.tur, cumledekiRol: k.cumledekiRol, ornek: k.ornek
      });
      zorKelime++;
    }
  }
  return { cozulen, zorKelime };
}

// Metin kelime kelime isaretlenir: kelimeye dokun -> anlam, cumleye uzun bas ->
// cumle seridi. Ikisi de once IndexedDB onbellegine bakar, kota harcamaz.

// Metni cumlelere, cumleleri kelimelere boler. Noktalama kelimeden ayri tutulur
// ki "door." ile "door" ayni sozluk kaydina dussun.
function metniIsle(metin) {
  const cumleler = String(metin)
    .split(/\n{2,}/)
    .flatMap(paragraf => ({ paragraf, cumleler: paragraf.match(/[^.!?]+[.!?]*\s*/g) || [paragraf] }))
    .filter(p => p.paragraf.trim());
  return cumleler;
}

const KELIME_DESENI = /([A-Za-zÀ-ÿ]+(?:['’][A-Za-z]+)?)/g;

function cumleHtml(cumle, cumleIndex) {
  let html = "";
  let son = 0;
  for (const eslesme of cumle.matchAll(KELIME_DESENI)) {
    html += kacis(cumle.slice(son, eslesme.index));
    html += `<span class="kelime" data-kelime="${kacis(eslesme[1])}">${kacis(eslesme[1])}</span>`;
    son = eslesme.index + eslesme[1].length;
  }
  html += kacis(cumle.slice(son));
  return `<span class="cumle" data-i="${cumleIndex}">${html}</span>`;
}

async function okumaEkrani(metinId) {
  const kayitlar = await db.metinler();

  // --- metin secilmediyse: yapistirma ekrani ---
  if (!metinId) {
    const parcalar = TESHIS_PARCALARI;
    ekran.innerHTML = `
      <h1>Okuma</h1>
      <p class="soluk">Bir metin yapıştır ya da sınav parçalarından birini seç.
        Kelimeye dokununca anlamı, cümleye uzun basınca cümlenin iskeleti çıkar.</p>

      <div class="kart">
        <h2 style="margin:0 0 4px;font-size:18px">AI ile metin üret</h2>
        <p class="kucuk soluk" style="margin:0 0 12px">
          Seviyene uygun, istediğin konuda okuma metni yazdırır. Üretilen metin
          kaydedilir; sonra çözümleyip çevrimdışı da kullanabilirsin.
        </p>
        <div class="satir" style="gap:10px;margin-bottom:10px">
          <select id="uret-seviye" style="flex:1;min-width:110px">
            <option value="A1">A1 — başlangıç</option>
            <option value="A2" selected>A2 — orta</option>
            <option value="B1">B1 — ileri</option>
          </select>
          <select id="uret-uzunluk" style="flex:1;min-width:110px">
            <option value="90">Kısa (~90 kelime)</option>
            <option value="160" selected>Orta (~160 kelime)</option>
            <option value="260">Uzun (~260 kelime)</option>
          </select>
        </div>
        <input type="text" id="uret-konu" placeholder="Konu (boş bırakılabilir): kahve, uzay, taşınmak…">
        <div id="uret-bildirim" style="margin-top:10px"></div>
        <button class="dugme" id="metin-uret" style="margin-top:4px">Metin üret</button>
      </div>

      <div class="kart">
        <label for="metin-girdi">Metin yapıştır</label>
        <textarea id="metin-girdi" rows="6" placeholder="İngilizce bir metin yapıştır…"></textarea>
        <div class="satir" style="margin-top:10px">
          <button class="dugme" id="metin-ac">Oku</button>
        </div>
      </div>

      ${kayitlar.length ? `
        <h2>Kaldığın metinler</h2>
        <div class="kart" style="padding:0">
          ${kayitlar.slice().reverse().map(m => `<div class="konu-satir">
            <a class="ad" href="#/oku/${kacis(m.id)}" style="color:inherit;text-decoration:none">
              ${kacis(m.baslik)}
              <small>${new Date(m.tarih).toLocaleDateString("tr-TR")} · ${m.metin.split(/\s+/).length} kelime</small>
            </a>
            <button class="ok metin-sil" data-id="${kacis(m.id)}" aria-label="Sil">×</button>
          </div>`).join("")}
        </div>` : ""}

      <h2>Sınav parçaları</h2>
      <div class="kart" style="padding:0">
        ${parcalar.map((p, i) => `<a class="konu-satir" href="#/oku/parca-${i}"
            style="color:inherit;text-decoration:none">
          <span class="ad">${kacis(p.metin.slice(0, 60))}…
            <small>${p.metin.split(/\s+/).length} kelime</small></span>
        </a>`).join("")}
      </div>`;

    ekran.querySelector("#metin-uret").addEventListener("click", async (e) => {
      const bildirim = ekran.querySelector("#uret-bildirim");
      const seviye = ekran.querySelector("#uret-seviye").value;
      const uzunluk = Number(ekran.querySelector("#uret-uzunluk").value);
      const konu = ekran.querySelector("#uret-konu").value.trim();
      e.target.disabled = true;
      bildirim.innerHTML = `<p class="yukleniyor" style="margin:0">Metin yazılıyor</p>`;
      try {
        const veri = await aiCagir(a => metinUret(a, seviye, konu, uzunluk));
        const id = "m" + Date.now();
        await db.metinYaz(id, {
          id, metin: veri.metin, baslik: veri.baslik || "Üretilen metin",
          seviye, uretilmis: true, tarih: new Date().toISOString()
        });
        git("#/oku/" + id);
      } catch (hata) {
        bildirim.innerHTML = `<div class="bildirim hata">${kacis(hata.message)}</div>`;
      } finally {
        e.target.disabled = false;
      }
    });

    ekran.querySelector("#metin-ac").addEventListener("click", async () => {
      const metin = ekran.querySelector("#metin-girdi").value.trim();
      if (!metin) return;
      const id = "m" + Date.now();
      await db.metinYaz(id, {
        id, metin,
        baslik: metin.slice(0, 50).replace(/\s+/g, " ") + (metin.length > 50 ? "…" : ""),
        tarih: new Date().toISOString()
      });
      git("#/oku/" + id);
    });

    ekran.querySelectorAll(".metin-sil").forEach(d => d.addEventListener("click", async (e) => {
      e.preventDefault();
      await db.metinSil(d.dataset.id);
      yonlendir();
    }));
    return;
  }

  // --- metin gorunumu ---
  let metin;
  if (metinId.startsWith("parca-")) {
    const p = TESHIS_PARCALARI[Number(metinId.slice(6))];
    if (!p) return git("#/oku");
    metin = p.metin;
  } else {
    const kayit = await db.metinYaz && (await db.oku("metinler", metinId));
    if (!kayit) return git("#/oku");
    metin = kayit.metin;
  }

  const paragraflar = metniIsle(metin);
  let sayac = 0;
  const cumleListesi = [];
  const govde = paragraflar.map(p =>
    `<p class="okuma-paragraf">${p.cumleler.map(c => {
      cumleListesi.push(c.trim());
      return cumleHtml(c, sayac++);
    }).join("")}</p>`).join("");

  ekran.innerHTML = `
    <div class="sayac"><a href="#/oku" style="color:inherit">← metinler</a>
      · ${cumleListesi.length} cümle · ${metin.split(/\s+/).length} kelime</div>

    <div class="kart" id="cozum-kart" style="margin-bottom:14px">
      <div id="cozum-durum"></div>
    </div>

    <div class="okuma-govde">${govde}</div>
    <div id="okuma-panel"></div>

    <div class="kart" id="metin-sohbet">
      <h2 style="margin:0 0 4px;font-size:18px">Metin hakkında sor</h2>
      <p class="kucuk soluk" style="margin:0 0 12px">
        Anlamadığın cümleyi, yapıyı ya da kelimeyi sor. Metnin tamamını görüyor.
      </p>
      <div class="mesajlar" id="metin-mesajlar"></div>
      <div class="oneri-liste" id="metin-oneriler"></div>
      <textarea class="sohbet-girdi" id="metin-girdi-sohbet" rows="2"
        placeholder="Örnek: üçüncü cümlede 'have been' neden var?"></textarea>
      <div class="satir" style="margin-top:8px">
        <button class="dugme" id="metin-sor" style="min-height:44px;padding:10px 18px">Sor</button>
      </div>
    </div>

    <p class="kucuk soluk" style="margin-top:18px">
      Kelimeye <strong>dokun</strong> → anlamı. Cümleye <strong>uzun bas</strong> → cümle şeridi.
    </p>`;

  const panel = ekran.querySelector("#okuma-panel");

  // --- cozumleme durumu ve dugmesi ---
  const cozumDurum = ekran.querySelector("#cozum-durum");

  async function cozumDurumunuCiz() {
    let hazir = 0;
    for (const c of cumleListesi) if (await db.cumleOku(c)) hazir++;
    const tamam = hazir === cumleListesi.length;

    cozumDurum.innerHTML = tamam
      ? `<p style="margin:0;font-size:14.5px"><strong style="color:var(--dogru)">Metin çözümlendi.</strong>
           <span class="soluk">Artık internet olmadan da çalışır.</span></p>`
      : `<p style="margin:0 0 4px;font-size:14.5px"><strong>${cumleListesi.length - hazir} cümle çözümlenmedi</strong>
           ${hazir ? `<span class="soluk">· ${hazir} hazır</span>` : ""}</p>
         <p class="kucuk soluk" style="margin:0 0 12px">
           Hepsini bir kerede çözümlersen dokunduğun her cümle anında açılır ve
           uçak modunda da çalışır.
         </p>
         <button class="dugme" id="cozumle">Metni çözümle</button>`;

    const dugme = cozumDurum.querySelector("#cozumle");
    if (!dugme) return;
    dugme.addEventListener("click", async () => {
      dugme.disabled = true;
      try {
        const sonuc = await metniCozumleVeKaydet(cumleListesi, (n, toplam) => {
          cozumDurum.innerHTML =
            `<p class="yukleniyor" style="margin:0">Çözümleniyor — ${n}/${toplam} bölüm</p>`;
        });
        await cozumDurumunuCiz();
        if (sonuc.zorKelime) {
          cozumDurum.insertAdjacentHTML("beforeend",
            `<p class="kucuk soluk" style="margin:8px 0 0">${sonuc.zorKelime} zor kelime de kaydedildi.</p>`);
        }
      } catch (hata) {
        cozumDurum.innerHTML = `<div class="bildirim hata" style="margin:0">${kacis(hata.message)}</div>`;
        const yeniden = document.createElement("button");
        yeniden.className = "dugme ikincil";
        yeniden.textContent = "Tekrar dene";
        yeniden.addEventListener("click", cozumDurumunuCiz);
        cozumDurum.appendChild(yeniden);
      }
    });
  }
  await cozumDurumunuCiz();

  // --- metin sohbeti ---
  const sohbetAnahtari = "metin:" + (metinId || "?");
  const mesajKutusu = ekran.querySelector("#metin-mesajlar");
  const sohbetGirdi = ekran.querySelector("#metin-girdi-sohbet");
  const sorDugmesi = ekran.querySelector("#metin-sor");

  async function sohbetiCiz() {
    const mesajlar = await db.sohbetOku(sohbetAnahtari);
    mesajKutusu.innerHTML = mesajlar.length
      ? mesajlar.map(mesajHtml).join("")
      : `<p class="kucuk soluk" style="margin:0">Henüz soru sormadın.</p>`;

    const oneriKutusu = ekran.querySelector("#metin-oneriler");
    if (await db.ayarOku("oneriler", true)) {
      const oneriler = [
        "Bu metnin ana fikri ne?",
        "Metindeki en zor cümleyi açıklar mısın?",
        "Burada hangi zamanlar kullanılmış?"
      ];
      oneriKutusu.innerHTML = oneriler.map(o => `<button class="oneri">${kacis(o)}</button>`).join("");
      oneriKutusu.querySelectorAll(".oneri").forEach(o => o.addEventListener("click", () => {
        sohbetGirdi.value = o.textContent;
        sohbetGirdi.focus();
      }));
    } else {
      oneriKutusu.innerHTML = "";
    }
  }
  await sohbetiCiz();

  sorDugmesi.addEventListener("click", async () => {
    const soru = sohbetGirdi.value.trim();
    if (!soru) return;
    const mesajlar = await db.sohbetOku(sohbetAnahtari);
    mesajlar.push({ rol: "kullanici", metin: soru });
    sohbetGirdi.value = "";
    sorDugmesi.disabled = true;
    mesajKutusu.innerHTML = mesajlar.map(mesajHtml).join("")
      + `<p class="yukleniyor" style="margin:0">Yazıyor</p>`;
    try {
      const cevap = await aiCagir(a => metinSohbet(a, metin, mesajlar));
      mesajlar.push({ rol: "ai", metin: cevap.trim() });
      await db.sohbetYaz(sohbetAnahtari, mesajlar);
      await sohbetiCiz();
    } catch (hata) {
      mesajlar.pop();
      sohbetGirdi.value = soru;
      await sohbetiCiz();
      mesajKutusu.insertAdjacentHTML("beforeend",
        `<div class="bildirim hata" style="margin:8px 0 0">${kacis(hata.message)}</div>`);
    } finally {
      sorDugmesi.disabled = false;
    }
  });

  // --- kelimeye dokunma ---
  ekran.querySelectorAll(".kelime").forEach(el => {
    el.addEventListener("click", async (e) => {
      e.stopPropagation();
      ekran.querySelectorAll(".kelime.acik").forEach(x => x.classList.remove("acik"));
      el.classList.add("acik");
      const kelime = el.dataset.kelime;
      const cumle = cumleListesi[Number(el.closest(".cumle").dataset.i)] || "";
      await kelimeAc(panel, kelime, cumle);
    });
  });

  // --- cumleye uzun basma (ve masaustunde cift tiklama) ---
  ekran.querySelectorAll(".cumle").forEach(el => {
    let zamanlayici = null;
    const basla = () => {
      zamanlayici = setTimeout(async () => {
        zamanlayici = null;
        ekran.querySelectorAll(".cumle.acik").forEach(x => x.classList.remove("acik"));
        el.classList.add("acik");
        await cumleAc(panel, cumleListesi[Number(el.dataset.i)]);
      }, 450);
    };
    const iptal = () => { if (zamanlayici) { clearTimeout(zamanlayici); zamanlayici = null; } };
    el.addEventListener("pointerdown", basla);
    el.addEventListener("pointerup", iptal);
    el.addEventListener("pointerleave", iptal);
    el.addEventListener("pointercancel", iptal);
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    el.addEventListener("dblclick", async () => {
      iptal();
      ekran.querySelectorAll(".cumle.acik").forEach(x => x.classList.remove("acik"));
      el.classList.add("acik");
      await cumleAc(panel, cumleListesi[Number(el.dataset.i)]);
    });
  });

  window.scrollTo(0, 0);
}

// Cok sik gecen islev kelimeleri. Bunlar icin API'ye gitmenin anlami yok:
// anlamlari baglama gore degismiyor ve toplu istekte 15 kelimelik listeyi
// gereksiz sisiriyorlar. Sozluge de yazilmazlar — quiz havuzunu doldurmasinlar.
const DURAK_KELIMELER = new Map(Object.entries({
  the: ["belirli bir şeyi işaret eder", "artikel", "Türkçedeki belirtme hâli '-i' gibi: kapıyı aç → open the door."],
  a: ["bir", "artikel", "Herhangi bir tane demek: a book → bir kitap."],
  an: ["bir", "artikel", "Sesli harfle başlayan kelimeden önce 'a' yerine kullanılır: an apple."],
  is: ["-dir, -dır", "yardımcı fiil", "Tekil özneyle 'olmak': She is happy → O mutlu(dur)."],
  am: ["-im, -ım", "yardımcı fiil", "Yalnızca 'I' ile: I am tired → Yorgunum."],
  are: ["-dir (çoğul)", "yardımcı fiil", "Çoğul özneyle ve 'you' ile: They are ready → Onlar hazır."],
  was: ["-di (tekil)", "yardımcı fiil", "'is/am' fiilinin geçmiş hâli: He was here → O buradaydı."],
  were: ["-di (çoğul)", "yardımcı fiil", "'are' fiilinin geçmiş hâli: They were late → Geç kalmışlardı."],
  be: ["olmak", "fiil", "'am/is/are' fiilinin yalın hâli: I want to be a teacher."],
  been: ["olmuş", "fiil", "'be' fiilinin 3. hâli: I have been there → Oraya gitmişliğim var."],
  do: ["yapmak / soru yardımcısı", "fiil", "Soru ve olumsuzda taşıyıcıdır: Do you know? / I do not know."],
  does: ["yapar / soru yardımcısı (3. tekil)", "fiil", "he, she, it ile: Does she know?"],
  did: ["yaptı / geçmiş soru yardımcısı", "fiil", "Geçmiş zamanda soru ve olumsuz: Did you go?"],
  have: ["sahip olmak / -miş yardımcısı", "fiil", "I have a car → Arabam var."],
  has: ["sahip (3. tekil)", "fiil", "he, she, it ile: She has a car."],
  had: ["sahipti", "fiil", "'have' fiilinin geçmiş hâli."],
  not: ["değil", "olumsuzluk", "Türkçedeki '-ma/-me' ekinin karşılığı: I am not → değilim."],
  and: ["ve", "bağlaç", ""],
  or: ["veya", "bağlaç", ""],
  but: ["ama", "bağlaç", ""],
  in: ["içinde, -de", "edat", "Kapalı alan ve büyük yerler: in the box, in Turkey."],
  on: ["üstünde, -de", "edat", "Yüzey ve günler: on the table, on Monday."],
  at: ["-de (nokta)", "edat", "Belirli nokta ve saat: at home, at 5 o'clock."],
  to: ["-e, -a", "edat", "Yönelme: to school → okula."],
  of: ["-in, -nin", "edat", "Aitlik: the door of the house → evin kapısı."],
  for: ["için", "edat", ""],
  with: ["ile, -le", "edat", ""],
  from: ["-den, -dan", "edat", ""],
  by: ["tarafından, ile", "edat", ""],
  this: ["bu", "işaret", ""],
  that: ["şu, o / ki", "işaret", "Bağlaç olarak da gelir: I know that he is here."],
  these: ["bunlar", "işaret", ""],
  those: ["şunlar, onlar", "işaret", ""],
  it: ["o (cansız)", "zamir", "Türkçede karşılığı çoğu zaman söylenmez."],
  he: ["o (erkek)", "zamir", ""],
  she: ["o (kadın)", "zamir", ""],
  they: ["onlar", "zamir", ""],
  we: ["biz", "zamir", ""],
  you: ["sen, siz", "zamir", ""],
  i: ["ben", "zamir", "Her zaman büyük harfle yazılır."],
  my: ["benim", "iyelik", ""],
  your: ["senin, sizin", "iyelik", ""],
  his: ["onun (erkek)", "iyelik", ""],
  her: ["onun (kadın) / ona", "iyelik", ""],
  their: ["onların", "iyelik", ""],
  our: ["bizim", "iyelik", ""],
  there: ["orada / var", "zarf", "'There is a book' → Bir kitap var."],
  here: ["burada", "zarf", ""],
  very: ["çok", "zarf", ""],
  too: ["de, da / fazla", "zarf", "Cümle sonunda 'de/da', sıfat önünde 'fazla': too hot → fazla sıcak."],
  also: ["ayrıca, de", "zarf", ""],
  can: ["-ebilmek", "kip", "I can swim → Yüzebilirim."],
  will: ["-ecek", "kip", "Gelecek zaman: I will go → Gideceğim."],
  would: ["-erdi", "kip", "'will' fiilinin geçmiş/kibar hâli."],
  some: ["biraz, birkaç", "belirteç", "Olumlu cümlede kullanılır."],
  any: ["hiç, herhangi", "belirteç", "Soru ve olumsuzda 'some' yerine gelir."],
  all: ["hepsi, bütün", "belirteç", ""],
  more: ["daha çok", "karşılaştırma", ""],
  most: ["en çok", "karşılaştırma", ""],
  than: ["-den (karşılaştırmada)", "edat", "bigger than me → benden büyük."],
  as: ["kadar / olarak", "edat", ""],
  if: ["eğer", "bağlaç", ""],
  when: ["ne zaman, -diğinde", "bağlaç", ""],
  because: ["çünkü", "bağlaç", ""],
  what: ["ne", "soru", ""],
  who: ["kim", "soru", ""],
  which: ["hangi", "soru", ""],
  how: ["nasıl", "soru", ""],
  why: ["neden", "soru", ""],
  where: ["nerede", "soru", ""]
}));

const durakKelime = (kelime) => {
  const k = DURAK_KELIMELER.get(String(kelime).toLowerCase().trim());
  return k ? { anlam: k[0], tur: k[1], cumledekiRol: k[2], kokHali: "", ornek: "", yerel: true } : null;
};

// Bir cumlenin AI'ya sorulacak kelimeleri: durak kelimeler ve zaten sozlukte
// olanlar elenir. Tek kelime icin 15 istek yerine tek istek atmanin yolu bu.
const CUMLE_KELIME_SINIRI = 20;

async function cozulecekKelimeler(cumle, oncelikli) {
  const gorulen = new Set();
  const liste = [];
  for (const e of String(cumle).matchAll(KELIME_DESENI)) {
    const k = e[1].toLowerCase();
    if (gorulen.has(k) || durakKelime(k)) continue;
    gorulen.add(k);
    if (await db.kelimeOku(k)) continue;
    liste.push(e[1]);
  }
  // Dokunulan kelime her zaman listede ve basta olsun.
  const sirali = liste.filter(k => k.toLowerCase() !== oncelikli.toLowerCase());
  return [oncelikli, ...sirali].slice(0, CUMLE_KELIME_SINIRI);
}

// Panele en son hangi dokunusun yazacagini belirler. Bunsuz: A kelimesine
// dokunup beklerken B'ye dokununca A'nin gec gelen cevabi B'nin uzerine
// yaziliyordu — "aciklama bir sure sonra degisiyor" sikayetinin sebebi buydu.
let sonKelimeIstegi = 0;

async function kelimeAc(panel, kelime, cumle) {
  const istek = ++sonKelimeIstegi;
  const gecerli = () => istek === sonKelimeIstegi;

  const ciz = (k, not) => {
    if (!gecerli() || !k) return;
    panel.innerHTML = `
      <div class="kart okuma-panel-kart">
        <div class="satir" style="justify-content:space-between;align-items:baseline">
          <span class="panel-baslik">${kacis(kelime)}</span>
          <span class="kucuk soluk">${kacis(k.tur || "")}${not ? " · " + kacis(not) : ""}</span>
        </div>
        <p style="margin:8px 0 10px;font-size:16px"><span class="vurgu">${kacis(k.anlam)}</span></p>
        ${k.kokHali ? `<p class="kucuk" style="margin:0 0 8px"><strong>Kök hâli:</strong>
          <span style="font-family:var(--mono)">${kacis(k.kokHali)}</span></p>` : ""}
        ${k.cumledekiRol ? `<p class="kucuk" style="margin:0 0 8px"><strong>Bu cümlede:</strong> ${kacis(k.cumledekiRol)}</p>` : ""}
        ${k.ornek ? `<p class="kucuk" style="margin:0 0 12px;font-family:var(--mono)">${kacis(k.ornek)}</p>` : ""}
        <div class="satir">
          ${k.yerel ? "" : `<button class="dugme ikincil ${k.isaretli ? "secili" : ""}" id="isaretle"
            style="min-height:44px;padding:10px 16px">
            ${k.isaretli ? "İşaretli — quizde öne çıkar" : "Bunu bilmiyorum"}
          </button>
          <a class="dugme ikincil" href="#/quiz" style="min-height:44px;padding:10px 16px;text-decoration:none">Quiz</a>`}
          <button class="dugme ikincil" id="panel-kapat" style="min-height:44px;padding:10px 16px">Kapat</button>
        </div>
      </div>`;

    panel.querySelector("#panel-kapat").addEventListener("click", () => {
      panel.innerHTML = "";
      ekran.querySelectorAll(".kelime.acik,.cumle.acik").forEach(x => x.classList.remove("acik"));
    });
    panel.querySelector("#isaretle")?.addEventListener("click", async () => {
      await db.kelimeIsaretle(kelime, !k.isaretli);
      k.isaretli = !k.isaretli;
      ciz(k, "kayıtlı");
    });
  };

  const yerel = durakKelime(kelime);
  if (yerel) return ciz(yerel, "sık kullanılan kelime");

  const kayitli = await db.kelimeOku(kelime);
  if (kayitli) return ciz(kayitli, "kayıtlı");

  if (!gecerli()) return;
  panel.innerHTML = `<div class="kart"><p class="yukleniyor" style="margin:0">${kacis(kelime)} aranıyor</p></div>`;

  // Tek kelime yerine cumlenin tamami cozulur: 15 kelimeye 15 istek atmak
  // yerine tek istek. Kalan kelimeler artik anlik ve cevrimdisi acilir.
  const hedefler = cumle ? await cozulecekKelimeler(cumle, kelime) : [kelime];
  try {
    if (hedefler.length > 1) {
      const veri = await aiCagir(a => cumleKelimeleri(a, cumle, hedefler));
      await db.kelimeleriYaz(veri.kelimeler || []);
    }
    let sonuc = await db.kelimeOku(kelime);
    if (!sonuc) {                    // model dokunulan kelimeyi atladiysa tek tek sor
      const tek = await aiCagir(a => kelimeAnlami(a, kelime, cumle));
      await db.kelimeYaz(kelime, tek);
      sonuc = await db.kelimeOku(kelime);
    }
    const digerleri = hedefler.length - 1;
    ciz(sonuc, digerleri > 0 ? `bu cümleden ${digerleri} kelime daha kaydedildi` : null);
  } catch (hata) {
    if (!gecerli()) return;
    panel.innerHTML = `<div class="bildirim hata">${kacis(hata.message)}</div>`;
  }
}

async function cumleAc(panel, cumle) {
  const ciz = (veri, onbellekten) => {
    panel.innerHTML = `
      <div class="kart okuma-panel-kart">
        <div class="satir" style="justify-content:space-between;align-items:baseline">
          <span class="panel-baslik">Cümle şeridi</span>
          <span class="kucuk soluk">${onbellekten ? "kayıtlı" : ""}</span>
        </div>
        <div class="serit">
          ${veri.parcalar.map((p, i) => `
            <div class="serit-blok" data-i="${i}" tabindex="0">
              <span class="serit-metin">${kacis(p.metin.trim())}</span>
              <span class="serit-rol">${kacis(p.rol)}</span>
            </div>`).join("")}
        </div>
        <div id="serit-aciklama" class="kucuk soluk" style="min-height:1.6em;margin-top:10px">
          Bir bloğa dokun, ne işe yaradığını yazsın.
        </div>
        ${veri.turkce ? `<p class="kucuk" style="margin:12px 0 0"><strong>Türkçesi:</strong> ${kacis(veri.turkce)}</p>` : ""}
        <div class="satir" style="margin-top:12px">
          <button class="dugme ikincil" id="panel-kapat" style="min-height:44px;padding:10px 16px">Kapat</button>
        </div>
      </div>`;

    const yazi = panel.querySelector("#serit-aciklama");
    panel.querySelectorAll(".serit-blok").forEach(blok => {
      const goster = () => {
        panel.querySelectorAll(".serit-blok").forEach(b => b.classList.remove("cizili"));
        blok.classList.add("cizili");
        yazi.textContent = veri.parcalar[Number(blok.dataset.i)].aciklama;
      };
      blok.addEventListener("click", goster);
      blok.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); goster(); } });
    });
    panel.querySelector("#panel-kapat").addEventListener("click", () => {
      panel.innerHTML = "";
      ekran.querySelectorAll(".kelime.acik,.cumle.acik").forEach(x => x.classList.remove("acik"));
    });
  };

  const kayitli = await db.cumleOku(cumle);
  if (kayitli) return ciz(kayitli, true);

  panel.innerHTML = `<div class="kart"><p class="yukleniyor" style="margin:0">Cümle çözümleniyor</p></div>`;
  try {
    const veri = await aiCagir(a => cumleParcala(a, cumle));
    await db.cumleYaz(cumle, veri);
    ciz(veri, false);
  } catch (hata) {
    panel.innerHTML = `<div class="bildirim hata">${kacis(hata.message)}</div>`;
  }
}

// Isaretlenen kelimeler burada birikir: gun sonunda kelime kartina donusur.
async function kelimelerEkrani() {
  const hepsi = await db.tumu("sozluk");
  const isaretli = hepsi.filter(k => k.isaretli);
  const digerleri = hepsi.filter(k => !k.isaretli);

  // Kutu: quizde ne kadar oturdugu. Hic sorulmamis kelimede tire.
  const satir = (k) => `<div class="konu-satir">
    <span class="ad"><strong>${kacis(k.kelime)}</strong>
      <small>${kacis(k.tur || "")} · ${kacis(k.anlam)}</small></span>
    <span class="oran soluk">${(k.kutu ?? null) === null ? "–" : k.kutu + "/" + tekrar.EN_UST_KUTU}</span>
  </div>`;

  ekran.innerHTML = `
    <h1>Kelimelerim</h1>
    ${hepsi.length === 0
      ? `<div class="kart bos">Henüz kelime yok. Okuma modunda bir kelimeye dokununca burası dolar.</div>`
      : `
        <h2>Bilmediğim kelimeler (${isaretli.length})</h2>
        ${isaretli.length
          ? `<div class="kart" style="padding:0">${isaretli.map(satir).join("")}</div>`
          : `<div class="kart bos">Hiç işaretlemedin. Okurken "Bunu bilmiyorum" de.</div>`}
        <h2>Baktıklarım (${digerleri.length})</h2>
        ${digerleri.length ? `<div class="kart" style="padding:0">${digerleri.map(satir).join("")}</div>` : ""}`}
    <div class="satir" style="margin-top:18px">
      ${hepsi.length >= 4 ? `<a class="dugme" href="#/quiz" style="text-decoration:none">Quiz çöz</a>` : ""}
      <a class="dugme ikincil" href="#/oku" style="text-decoration:none">Okumaya dön</a>
      <a class="dugme ikincil" href="#/" style="text-decoration:none">Ana sayfa</a>
    </div>`;
  window.scrollTo(0, 0);
}

// ---------- Kelime quizi ----------
// Sozlukte biriken kelimeleri aralikli tekrarla sorar. Tek AI istegi
// harcamaz: sorular da celdiriciler de kayitli verilerden kurulur.

const QUIZ_TIP_ETIKET = {
  entr: "İngilizce → Türkçe",
  tren: "Türkçe → İngilizce",
  bosluk: "Boşluklu cümle",
  kok: "Kök hâli"
};

async function quizEkrani() {
  const ayar = await quiz.ayarOku();
  const hepsi = await quiz.havuz();
  const isaretli = hepsi.filter(k => k.isaretli).length;
  const vadesi = hepsi.filter(k => (k.kutu ?? null) === null
    || !k.sonrakiTarih || k.sonrakiTarih <= tekrar.bugun()).length;
  const ogrenilen = hepsi.filter(quiz.ogrenildi).length;

  if (hepsi.length < 4) {
    ekran.innerHTML = `
      <h1>Kelime quizi</h1>
      <div class="kart bos">Quiz için en az 4 kelime lazım, şu an ${hepsi.length} tane var.
        Okuma modunda ya da soru ekranlarında bilmediğin kelimelere dokun — havuz kendiliğinden dolar.</div>
      <div class="satir" style="margin-top:18px">
        <a class="dugme" href="#/oku" style="text-decoration:none">Okumaya git</a>
        <a class="dugme ikincil" href="#/" style="text-decoration:none">Ana sayfa</a>
      </div>`;
    window.scrollTo(0, 0);
    return;
  }

  ekran.innerHTML = `
    <h1>Kelime quizi</h1>
    <p class="soluk">Bildiğin kelime seyrekleşir, takıldığın kelime sık çıkar.
      Hiç internet gerekmez, AI kotandan da tek istek harcanmaz.</p>

    <div class="kart">
      <div class="quiz-sayilar">
        <div><strong>${hepsi.length}</strong><small>havuzda</small></div>
        <div><strong>${isaretli}</strong><small>bilmediğim</small></div>
        <div><strong>${vadesi}</strong><small>tekrar zamanı</small></div>
        <div><strong>${ogrenilen}</strong><small>öğrenildi</small></div>
      </div>
    </div>

    <div class="kart">
      <label for="quiz-adet">Kaç soru</label>
      <select id="quiz-adet">
        ${[5, 10, 15, 20, 30].map(n =>
          `<option value="${n}" ${ayar.adet === n ? "selected" : ""}>${n} soru</option>`).join("")}
      </select>

      <label for="quiz-kaynak" style="margin-top:12px">Hangi kelimeler</label>
      <select id="quiz-kaynak">
        <option value="agirlikli" ${ayar.kaynak === "agirlikli" ? "selected" : ""}>Hepsi — bilmediklerim ağırlıklı</option>
        <option value="isaretli" ${ayar.kaynak === "isaretli" ? "selected" : ""}>Sadece "bunu bilmiyorum" dediklerim</option>
        <option value="vadesi" ${ayar.kaynak === "vadesi" ? "selected" : ""}>Tekrar zamanı gelenler</option>
      </select>

      <details class="quiz-gelismis" ${ayar.tipler.length !== quiz.VARSAYILAN_AYAR.tipler.length ? "open" : ""}>
        <summary>Gelişmiş</summary>

        <p class="kucuk soluk" style="margin:10px 0 8px">Soru tipleri — birden çok seçersen sırayla dağıtılır.</p>
        ${Object.entries(quiz.TIPLER).map(([id, t]) => `
          <label class="secenek-satir" for="tip-${id}">
            <input type="checkbox" id="tip-${id}" data-tip="${id}" ${ayar.tipler.includes(id) ? "checked" : ""}>
            <span><strong>${kacis(t.baslik)}</strong><br>
              <small class="soluk">${kacis(t.aciklama)}</small></span>
          </label>`).join("")}

        <label class="secenek-satir" for="quiz-ogrenilenler" style="margin-top:10px">
          <input type="checkbox" id="quiz-ogrenilenler" ${ayar.ogrenilenler ? "checked" : ""}>
          <span><strong>Öğrenilenler de çıksın</strong><br>
            <small class="soluk">Kutusu dolmuş kelimeler normalde vadesi gelene kadar sorulmaz.</small></span>
        </label>
      </details>

      <div id="quiz-bildirim" style="margin-top:12px"></div>
      <button class="dugme tam" id="quiz-basla" style="margin-top:12px">Quize başla</button>
    </div>

    <div class="satir" style="margin-top:18px">
      <a class="dugme ikincil" href="#/kelimeler" style="text-decoration:none">Kelimelerim</a>
      <a class="dugme ikincil" href="#/" style="text-decoration:none">Ana sayfa</a>
    </div>`;

  const ayarToparla = () => ({
    ...ayar,
    adet: Number(ekran.querySelector("#quiz-adet").value),
    kaynak: ekran.querySelector("#quiz-kaynak").value,
    ogrenilenler: ekran.querySelector("#quiz-ogrenilenler").checked,
    tipler: [...ekran.querySelectorAll("[data-tip]")].filter(x => x.checked).map(x => x.dataset.tip)
  });

  ekran.querySelector("#quiz-basla").addEventListener("click", async () => {
    const yeni = ayarToparla();
    const bildirim = ekran.querySelector("#quiz-bildirim");
    if (!yeni.tipler.length) {
      bildirim.innerHTML = `<div class="bildirim hata">En az bir soru tipi seç.</div>`;
      return;
    }
    await quiz.ayarYaz(yeni);
    const { sorular } = await quiz.oturumKur(yeni);
    if (!sorular.length) {
      bildirim.innerHTML = `<div class="bildirim hata">Bu ayarlarla soru kurulamadı.
        "Hangi kelimeler" seçimini genişletmeyi dene.</div>`;
      return;
    }
    quizOturumu(sorular);
  });

  window.scrollTo(0, 0);
}

// Bir quiz oturumu bastan sona burada donuyor: soru -> cevap -> sonraki.
function quizOturumu(sorular) {
  let i = 0;
  const gecmis = [];

  const ciz = () => {
    const s = sorular[i];
    const monoSoru = s.tip !== "tren";     // Turkce sorulan tipte mono yazi yanlis durur
    ekran.innerHTML = `
      <div class="ilerleme-cubuk"><i style="width:${(i / sorular.length) * 100}%"></i></div>
      <div class="sayac">${i + 1} / ${sorular.length} · ${kacis(QUIZ_TIP_ETIKET[s.tip] || "")}
        · <a href="#/quiz" style="color:inherit">çık</a></div>

      ${s.ipucu ? `<p class="kucuk soluk" style="margin:0 0 6px">${kacis(s.ipucu)}</p>` : ""}
      <div class="soru-metni ${monoSoru ? "" : "duz"}" id="quiz-soru">${soruGoster(s.soru)}</div>

      <div class="sik-liste quiz" id="quiz-sikler">
        ${s.secenekler.map((sec, n) => `
          <button class="sik" data-n="${n}">
            <span class="harf">${HARFLER[n]}</span>
            <span class="${s.tip === "tren" || s.tip === "kok" || s.tip === "bosluk" ? "sik-en" : ""}">${kacis(sec)}</span>
          </button>`).join("")}
      </div>

      <div id="quiz-sonrasi"></div>`;

    ekran.querySelectorAll("#quiz-sikler .sik").forEach(dugme =>
      dugme.addEventListener("click", () => cevapla(Number(dugme.dataset.n))));
    window.scrollTo(0, 0);
  };

  const cevapla = async (secilen) => {
    const s = sorular[i];
    const dogruMu = secilen === s.cevap;
    gecmis.push({ soru: s, secilen, dogruMu });

    ekran.querySelectorAll("#quiz-sikler .sik").forEach(d => {
      const n = Number(d.dataset.n);
      d.disabled = true;
      if (n === s.cevap) d.classList.add("dogru");
      else if (n === secilen) d.classList.add("yanlis");
    });

    const kutu = await quiz.cevapla(s, dogruMu);
    const k = s.kayit;
    ekran.querySelector("#quiz-sonrasi").innerHTML = `
      <div class="kart quiz-kart">
        <div class="satir" style="justify-content:space-between;align-items:baseline">
          <span class="panel-baslik">${kacis(k.kelime)}</span>
          <span class="kucuk soluk">${kacis(k.tur || "")} · kutu ${kutu}/${tekrar.EN_UST_KUTU}</span>
        </div>
        <p style="margin:8px 0 10px;font-size:16px"><span class="vurgu">${kacis(k.anlam)}</span></p>
        ${k.kokHali ? `<p class="kucuk" style="margin:0 0 8px"><strong>Kök hâli:</strong>
          <span style="font-family:var(--mono)">${kacis(k.kokHali)}</span></p>` : ""}
        ${k.ornek ? `<p class="kucuk" style="margin:0 0 10px;font-family:var(--mono)">${kacis(k.ornek)}</p>` : ""}
        <button class="dugme tam" id="quiz-sonraki">
          ${i + 1 < sorular.length ? "Sonraki" : "Bitir"}</button>
      </div>`;

    const sonraki = ekran.querySelector("#quiz-sonraki");
    sonraki.addEventListener("click", () => {
      i++;
      if (i < sorular.length) ciz(); else bitir();
    });
    sonraki.focus();
    sonraki.scrollIntoView({ block: "nearest" });
  };

  const bitir = () => {
    const dogru = gecmis.filter(g => g.dogruMu).length;
    const yanlislar = gecmis.filter(g => !g.dogruMu);

    ekran.innerHTML = `
      <h1>${dogru} / ${gecmis.length} doğru</h1>
      <p class="soluk">${yanlislar.length === 0
        ? "Hepsi doğru. Bu kelimeler bir süre karşına çıkmayacak."
        : `${yanlislar.length} kelime kutu 0'a döndü, yarın yine sorulacak.`}</p>

      ${yanlislar.length ? `
        <h2>Takıldıkların</h2>
        <div class="kart" style="padding:0">
          ${yanlislar.map(g => `<div class="konu-satir">
            <span class="ad"><strong>${kacis(g.soru.kayit.kelime)}</strong>
              <small>${kacis(g.soru.kayit.anlam)}</small></span>
            <span class="oran soluk">${kacis(g.soru.secenekler[g.secilen] || "")}</span>
          </div>`).join("")}
        </div>` : ""}

      <div class="satir" style="margin-top:18px">
        <button class="dugme" id="quiz-tekrar">Yeni tur</button>
        <a class="dugme ikincil" href="#/kelimeler" style="text-decoration:none">Kelimelerim</a>
        <a class="dugme ikincil" href="#/" style="text-decoration:none">Ana sayfa</a>
      </div>`;

    ekran.querySelector("#quiz-tekrar").addEventListener("click", () => quizEkrani());
    window.scrollTo(0, 0);
  };

  ciz();
}

// ---------- Tema ----------
// Tercih localStorage'da: IndexedDB asenkron, tema ise sayfa cizilmeden once lazim.
const TEMALAR = { otomatik: "Cihazla aynı", acik: "Açık", koyu: "Koyu" };

function temaOku() {
  try { return localStorage.getItem("tema") || "otomatik"; } catch { return "otomatik"; }
}

function temaUygula(secim) {
  const koyu = secim === "koyu" ||
    (secim === "otomatik" && matchMedia("(prefers-color-scheme: dark)").matches);
  if (koyu) document.documentElement.dataset.tema = "koyu";
  else delete document.documentElement.dataset.tema;
  const renk = document.querySelector('meta[name="theme-color"]');
  if (renk) renk.content = koyu ? "#0E1626" : "#16233A";
}

function temaYaz(secim) {
  try {
    if (secim === "otomatik") localStorage.removeItem("tema");
    else localStorage.setItem("tema", secim);
  } catch {}
  temaUygula(secim);
}

// ---------- Yedekleme ----------
// Tum kullanici verisi tek JSON'da. Soru bankasindan yalnizca uretilmis ve
// cozulmus durumu tasiriz; 182 tohum/aybu sorusu zaten dosyadan geliyor.
const YEDEK_DEPOLARI = ["ilerleme", "teshis", "aciklamalar", "sohbetler", "sozluk",
                        "cumleler", "metinler", "onayBekleyen", "ayarlar"];

async function yedekAl() {
  const veri = { surum: 1, tarih: new Date().toISOString(), depolar: {} };
  for (const ad of YEDEK_DEPOLARI) {
    veri.depolar[ad] = await db.ciftler(ad);
  }
  // Sorulardan yalnizca uretilmis olanlar ve cozulme izleri
  const sorular = await db.tumu("sorular");
  veri.depolar.sorular = sorular
    .filter(s => s.kaynak === "ai" || s.sonCozum || s.hataSayisi)
    .map(s => [s.id, s]);
  // API anahtari yedege girmez: cihazda kalmali.
  veri.depolar.ayarlar = veri.depolar.ayarlar.filter(([k]) => k !== "apiKey");
  return veri;
}

async function yedekYukle(veri) {
  if (!veri || veri.surum !== 1 || !veri.depolar) throw new Error("Yedek dosyası tanınmadı.");
  let sayi = 0;
  for (const [ad, ciftler] of Object.entries(veri.depolar)) {
    if (!Array.isArray(ciftler)) continue;
    for (const [anahtar, deger] of ciftler) {
      await db.yaz(ad, anahtar, deger);
      sayi++;
    }
  }
  return sayi;
}

// ---------- Sinav provasi ----------
// AYBU sinavinin orijinal hali: 100 soru, sirasiyla, geri bildirim yok, sureli.
// Alistirmadan farki bu: burada ogrenmiyorsun, olcuyorsun.
async function provaEkrani() {
  const test = await (await fetch("./data/teshis-testi.json")).json();
  const sorular = test.sorular;
  const parcaHarita = new Map(test.parcalar.map(p => [p.id, p.metin]));
  let durum = (await db.oku("teshis", "prova")) || null;

  if (!durum) {
    ekran.innerHTML = `
      <h1>Sınav provası</h1>
      <p class="soluk">AYBU 2021-22 seviye tespit sınavının tamamı: <strong>100 soru</strong>,
        orijinal sırasıyla, geri bildirim yok. Bitince puanın ve konu dağılımın çıkar.</p>
      <div class="kart">
        <p class="kucuk" style="margin:0 0 6px"><strong>Alıştırmadan farkı:</strong> burada öğrenmiyorsun, ölçüyorsun.
          Doğru cevaplar ancak sonda görünür, kutu sistemine de dokunmaz.</p>
        <p class="kucuk soluk" style="margin:0">Süre tutulur ama kesmez. Yarıda bırakırsan kaldığın yerden devam edersin.</p>
      </div>
      <div class="satir">
        <button class="dugme" id="basla">Başla</button>
        <a class="dugme ikincil" href="#/" style="text-decoration:none">Ana sayfa</a>
      </div>`;
    ekran.querySelector("#basla").addEventListener("click", async () => {
      await db.yaz("teshis", "prova", { durum: "devam", i: 0, cevaplar: [], baslangic: Date.now() });
      yonlendir();
    });
    return;
  }

  if (durum.durum === "bitti") return provaSonucu(durum, sorular);

  let i = Math.min(durum.i, sorular.length - 1);
  let secilen = null;

  function ciz() {
    const s = sorular[i];
    const gecen = Math.round((Date.now() - durum.baslangic + (durum.gecenSure || 0)) / 60000);
    secilen = durum.cevaplar[i] ?? null;

    ekran.innerHTML = `
      <div class="ilerleme-cubuk"><i style="width:${(i / sorular.length) * 100}%"></i></div>
      <div class="gezinti">
        <button class="ok" id="geri" ${i === 0 ? "disabled" : ""} aria-label="Önceki">←</button>
        <span class="sayac" style="margin:0">Prova · ${i + 1} / ${sorular.length} · ${gecen} dk</span>
      </div>
      ${s.parca ? `<div class="parca">${kacis(parcaHarita.get(s.parca) || "")}</div>` : ""}
      <p class="soru-metni">${soruGoster(s.soru)}</p>
      <div class="sik-liste">
        ${s.secenekler.map((o, j) => `
          <button class="sik ${secilen === j ? "secili" : ""}" data-j="${j}">
            <span class="harf">${HARFLER[j]}</span><span>${kacis(o)}</span>
          </button>`).join("")}
      </div>
      <div class="satir">
        <button class="dugme" id="ileri">${i === sorular.length - 1 ? "Bitir" : "Sonraki →"}</button>
        <button class="dugme ikincil" id="cik">Sonra devam ederim</button>
      </div>
      <p class="kucuk soluk" style="margin-top:12px">Boş bırakabilirsin; cevaplamadan da ilerleyebilirsin.</p>`;

    ekran.querySelectorAll(".sik").forEach(d => d.addEventListener("click", () => {
      secilen = Number(d.dataset.j);
      ekran.querySelectorAll(".sik").forEach(x => x.classList.remove("secili"));
      d.classList.add("secili");
    }));
    ekran.querySelector("#ileri").addEventListener("click", () => git2(1));
    ekran.querySelector("#geri").addEventListener("click", () => git2(-1));
    ekran.querySelector("#cik").addEventListener("click", async () => {
      durum.cevaplar[i] = secilen;
      durum.i = i;
      durum.gecenSure = (durum.gecenSure || 0) + (Date.now() - durum.baslangic);
      durum.baslangic = Date.now();
      await db.yaz("teshis", "prova", durum);
      git("#/");
    });
  }

  async function git2(yon) {
    durum.cevaplar[i] = secilen;
    i += yon;
    if (i >= sorular.length) {
      durum.durum = "bitti";
      durum.gecenSure = (durum.gecenSure || 0) + (Date.now() - durum.baslangic);
      await db.yaz("teshis", "prova", durum);
      return provaSonucu(durum, sorular);
    }
    durum.i = i;
    await db.yaz("teshis", "prova", durum);
    ciz();
    window.scrollTo(0, 0);
  }

  ciz();
  window.scrollTo(0, 0);
}

async function provaSonucu(durum, sorular) {
  let dogru = 0, bos = 0;
  const konuSayim = new Map();
  sorular.forEach((s, n) => {
    const c = durum.cevaplar[n];
    if (c === null || c === undefined) bos++;
    const d = c === s.cevap;
    if (d) dogru++;
    const k = konuSayim.get(s.konu) || { dogru: 0, toplam: 0 };
    k.toplam++; if (d) k.dogru++;
    konuSayim.set(s.konu, k);
  });
  const dakika = Math.round((durum.gecenSure || 0) / 60000);
  const zayif = [...konuSayim.entries()]
    .filter(([, k]) => k.dogru / k.toplam < 0.6)
    .sort((a, b) => a[1].dogru / a[1].toplam - b[1].dogru / b[1].toplam);

  ekran.innerHTML = `
    <h1>Prova sonucu</h1>
    <p class="soluk">${dogru}/100 doğru · ${bos} boş · ${dakika} dakika</p>
    <div class="kart">
      <p style="margin:0;font-family:var(--display);font-size:34px;font-weight:600">${dogru}<span class="soluk" style="font-size:20px">/100</span></p>
    </div>
    <h2>Zayıf konular (${zayif.length})</h2>
    ${zayif.length ? `<div class="kart" style="padding:0">
      ${zayif.map(([id, k]) => {
        const konu = konuHarita.get(id);
        return `<div class="konu-satir">
          <span class="ad"><span class="vurgu">${kacis(konu ? konu.ad : id)}</span>
            <small>${konu ? konu.seviye : ""}</small></span>
          <span class="oran" style="color:var(--yanlis)">${k.dogru}/${k.toplam}</span>
        </div>`;
      }).join("")}
    </div>` : `<div class="kart bos">Hiçbir konuda %60 altına düşmedin.</div>`}
    <div class="satir" style="margin-top:18px">
      <button class="dugme ikincil" id="sifirla">Provayı sıfırla</button>
      <a class="dugme ikincil" href="#/" style="text-decoration:none">Ana sayfa</a>
    </div>
    <p class="kucuk soluk" style="margin-top:12px">
      Prova kutu sistemine dokunmaz; günlük kuyruğun bundan etkilenmez.
    </p>`;

  ekran.querySelector("#sifirla").addEventListener("click", async () => {
    if (!confirm("Prova cevapların silinecek. Emin misin?")) return;
    await db.sil("teshis", "prova");
    yonlendir();
  });
  window.scrollTo(0, 0);
}

async function ayarlarEkrani(sekme = "basit") {
  const anahtar = await db.ayarOku("apiKey", "");
  const hedef = await db.ayarOku("gunlukHedef", 10);
  const oneriAcik = await db.ayarOku("oneriler", true);
  const secilenModel = await db.ayarOku("model", ai.VARSAYILAN_MODEL);
  const secilenTema = temaOku();
  const secilenUslup = await db.ayarOku("uslup", "dengeli");
  const kota = await db.kotaOku();
  const aciklamaSayisi = (await db.ciftler("aciklamalar")).length;
  const bekleyenSayisi = (await uretim.bekleyenler()).length;
  const uretimAdedi = Number(await db.ayarOku("uretimAdedi", 5));
  const gelismis = sekme === "gelismis";

  const basitPanel = `
    <div class="kart">
      <label for="anahtar">Kendi Gemini anahtarın <span class="soluk" style="font-weight:400">— isteğe bağlı</span></label>
      <input id="anahtar" type="password" value="${kacis(anahtar)}" placeholder="AIza…" autocomplete="off" spellcheck="false">
      <p class="kucuk soluk" style="margin:10px 0 14px">
        ${anahtar
          ? "Kendi anahtarınla çalışıyorsun: günlük sınır yok, kota senin hesabından düşüyor."
          : "Şu an paylaşılan anahtarla çalışıyorsun; günlük bir istek sınırı var. Sınıra takılmak istemezsen kendi anahtarını gir — sınır kalkar, kota kendi hesabından düşer."}
        Anahtar yalnızca bu cihazdaki tarayıcıda saklanır.
        <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a>'dan ücretsiz alabilirsin.
      </p>
      <div id="bildirim"></div>
      <div class="satir">
        <button class="dugme" id="kaydet">Kaydet ve test et</button>
        <button class="dugme ikincil" id="temizle">Anahtarı sil</button>
      </div>
    </div>

    <div class="kart">
      <label for="model">Yapay zekâ modeli</label>
      <select id="model">
        ${ai.MODELLER.map(m => `<option value="${m.ad}" ${m.ad === secilenModel ? "selected" : ""}>${m.baslik}</option>`).join("")}
      </select>
      <p class="kucuk soluk" style="margin:10px 0 0">
        ${ai.MODELLER.map(m => `<strong>${m.baslik}:</strong> ${m.aciklama}`).join("<br>")}
      </p>
    </div>

    <div class="kart">
      <label for="hedef">Günlük hedef (soru)</label>
      <input id="hedef" type="text" inputmode="numeric" value="${Number(hedef)}">
      <p class="kucuk soluk" style="margin:10px 0 0">Bugünün kuyruğu bu sayı kadar soru getirir.</p>
    </div>

    <div class="kart">
      <label for="tema">Görünüm</label>
      <select id="tema">
        ${Object.entries(TEMALAR).map(([k, v]) =>
          `<option value="${k}" ${k === secilenTema ? "selected" : ""}>${v}</option>`).join("")}
      </select>
    </div>

    <div class="kart">
      <label for="uslup">Anlatım tarzı</label>
      <select id="uslup">
        ${Object.entries(ai.USLUPLAR).map(([k, v]) =>
          `<option value="${k}" ${k === secilenUslup ? "selected" : ""}>${v.baslik}</option>`).join("")}
      </select>
      <p class="kucuk soluk" style="margin:10px 0 0">${ai.USLUPLAR[secilenUslup]?.aciklama || ""}</p>
    </div>

    <div class="kart">
      <label class="secenek-satir" for="oneriler">
        <input type="checkbox" id="oneriler" ${oneriAcik ? "checked" : ""}>
        <span>Sohbette hazır soru önerileri</span>
      </label>
      <p class="kucuk soluk" style="margin:8px 0 0">
        Sohbet kutusunun üstünde hazır sorular çıkar. Dokununca kutuya yazılır,
        göndermeden önce değiştirebilirsin.
      </p>
    </div>

    <div class="kart">
      <p style="margin:0 0 4px"><strong>${kota.sayi}</strong> AI isteği <span class="soluk">— bugün</span>${
        !anahtar && ai.kalanIstek !== null ? ` <span class="soluk">· paylaşılan kotadan ${ai.kalanIstek} hakkın kaldı</span>` : ""}</p>
      <p class="kucuk soluk" style="margin:0">
        Önbellekte <strong>${aciklamaSayisi}</strong> açıklama var; bunlar tekrar açıldığında
        istek harcamıyor ve çevrimdışı da çalışıyor.
      </p>
    </div>`;

  const konuSecenekleri = KONULAR.map(k =>
    `<option value="${kacis(k.id)}">${kacis(k.ad)} (${k.seviye})</option>`).join("");

  const gelismisPanel = `
    <div class="kart">
      <h2 style="margin:0 0 4px;font-size:18px">Soru üret</h2>
      <p class="kucuk soluk" style="margin:0 0 14px">
        Bir konu için yeni sorular üretir. Tek istekte hepsi birden gelir, sonra
        onayına sunulur. Onayladıkların bankaya kalıcı yazılır, ikinci kez kota harcamaz.
      </p>

      <label for="uretim-konu">Konu</label>
      <select id="uretim-konu">${konuSecenekleri}</select>

      <label for="uretim-zorluk" style="margin-top:14px">Aşama</label>
      <select id="uretim-zorluk">
        <option value="1">1 — Tanı (tek ipucu)</option>
        <option value="2" selected>2 — Ayırt et (ipucu bağlamda)</option>
        <option value="3">3 — Karıştır (birden çok konu)</option>
      </select>

      <label for="uretim-adet" style="margin-top:14px">Kaç soru: <strong id="adet-yazi">${uretimAdedi}</strong></label>
      <input type="range" id="uretim-adet" min="3" max="10" step="1" value="${uretimAdedi}">
      <p class="kucuk soluk" style="margin:6px 0 14px">
        Az sayıda istemek çeşitliliği artırır. Her üretim bir AI çağrısıdır.
      </p>

      <div id="uretim-bildirim"></div>
      <button class="dugme" id="uret">Üret</button>
    </div>

    <div class="kart">
      <h2 style="margin:0 0 4px;font-size:18px">Onay kuyruğu</h2>
      <p class="kucuk soluk" style="margin:0 0 12px">
        Üretilen sorular buraya düşer. Onayladıkların bankaya girer, reddettiklerin silinir.
      </p>
      <a class="dugme ${bekleyenSayisi ? "" : "ikincil"}" href="#/onay" style="text-decoration:none">
        ${bekleyenSayisi ? bekleyenSayisi + " soru onay bekliyor" : "Kuyruk boş"}
      </a>
    </div>

    <div class="kart">
      <h2 style="margin:0 0 4px;font-size:18px">Sınav provası</h2>
      <p class="kucuk soluk" style="margin:0 0 12px">
        AYBU sınavının tamamı: 100 soru, orijinal sırasıyla, geri bildirim yok.
        Kutu sistemine dokunmaz.
      </p>
      <a class="dugme ikincil" href="#/prova" style="text-decoration:none">Provaya git</a>
    </div>

    <div class="kart">
      <h2 style="margin:0 0 4px;font-size:18px">Yedekleme</h2>
      <p class="kucuk soluk" style="margin:0 0 12px">
        İlerlemen, açıklamaların, sohbetlerin, kelimelerin ve ürettiğin sorular tek
        dosyada iner. API anahtarı yedeğe girmez.
      </p>
      <div id="yedek-bildirim"></div>
      <div class="satir">
        <button class="dugme ikincil" id="yedek-al">Yedek indir</button>
        <button class="dugme ikincil" id="yedek-yukle">Yedekten yükle</button>
        <input type="file" id="yedek-dosya" accept="application/json,.json" hidden>
      </div>
    </div>

    <div class="kart">
      <h2 style="margin:0 0 4px;font-size:18px">Veri</h2>
      <p class="kucuk soluk" style="margin:0 0 12px">
        Sıfırlama ilerlemeni ve blok cevaplarını siler; soru bankası korunur.
      </p>
      <div class="satir">
        <button class="dugme ikincil" id="sifirla">İlerlemeyi sıfırla</button>
        <button class="dugme ikincil" id="cache-sil">Açıklama önbelleğini sil</button>
      </div>
    </div>`;

  ekran.innerHTML = `
    <h1>Ayarlar</h1>
    <div class="sekmeler">
      <a class="sekme ${gelismis ? "" : "aktif"}" href="#/ayarlar">Basit</a>
      <a class="sekme ${gelismis ? "aktif" : ""}" href="#/ayarlar/gelismis">Gelişmiş</a>
    </div>
    ${gelismis ? gelismisPanel : basitPanel}
  `;

  if (gelismis) return gelismisBagla();

  const bildirim = ekran.querySelector("#bildirim");
  const goster = (tur, metin) => { bildirim.innerHTML = `<div class="bildirim ${tur}">${kacis(metin)}</div>`; };

  ekran.querySelector("#kaydet").addEventListener("click", async (e) => {
    const deger = ekran.querySelector("#anahtar").value.trim();
    if (!deger) return goster("hata", "Önce anahtarı yapıştır.");
    e.target.disabled = true;
    goster("ok", "Test ediliyor…");
    try {
      await anahtarTest(deger);
      await db.ayarYaz("apiKey", deger);
      goster("ok", "Anahtar çalışıyor ve kaydedildi.");
    } catch (hata) {
      goster("hata", hata instanceof AiHata ? hata.message : "Beklenmeyen hata: " + hata.message);
    } finally {
      e.target.disabled = false;
    }
  });

  ekran.querySelector("#temizle").addEventListener("click", async () => {
    await db.ayarYaz("apiKey", "");
    ekran.querySelector("#anahtar").value = "";
    goster("ok", "Anahtar silindi.");
  });

  ekran.querySelector("#tema").addEventListener("change", (e) => temaYaz(e.target.value));

  ekran.querySelector("#uslup").addEventListener("change", async (e) => {
    await db.ayarYaz("uslup", e.target.value);
    yonlendir();
  });

  ekran.querySelector("#model").addEventListener("change", (e) => {
    db.ayarYaz("model", e.target.value);
  });

  ekran.querySelector("#oneriler").addEventListener("change", (e) => {
    db.ayarYaz("oneriler", e.target.checked);
  });

  ekran.querySelector("#hedef").addEventListener("change", (e) => {
    const n = Math.max(1, Math.min(200, parseInt(e.target.value, 10) || 10));
    e.target.value = n;
    db.ayarYaz("gunlukHedef", n);
  });

  function gelismisBagla() {
    const kaydirak = ekran.querySelector("#uretim-adet");
    const yazi = ekran.querySelector("#adet-yazi");
    const bildirim2 = ekran.querySelector("#uretim-bildirim");
    const goster2 = (tur, metin) => { bildirim2.innerHTML = `<div class="bildirim ${tur}">${metin}</div>`; };

    kaydirak.addEventListener("input", () => {
      yazi.textContent = kaydirak.value;
      db.ayarYaz("uretimAdedi", Number(kaydirak.value));
    });

    ekran.querySelector("#uret").addEventListener("click", async (e) => {
      const konu = konuHarita.get(ekran.querySelector("#uretim-konu").value);
      const zorluk = Number(ekran.querySelector("#uretim-zorluk").value);
      const adet = Number(kaydirak.value);
      e.target.disabled = true;
      goster2("ok", `<span class="yukleniyor">${adet} soru üretiliyor</span>`);
      try {
        const sonuc = await aiCagir(a => uretim.uret(a, konu, adet, zorluk));
        const elenenMetni = sonuc.elenen.length
          ? `<br><span class="soluk">${sonuc.elenen.length} tanesi elendi: ${
              kacis(sonuc.elenen.map(x => x.sebep).join(", "))}</span>`
          : "";
        goster2(sonuc.kabul ? "ok" : "hata",
          `${sonuc.kabul} soru onay kuyruğuna eklendi.${elenenMetni}`);
      } catch (hata) {
        goster2("hata", kacis(hata instanceof AiHata ? hata.message : hata.message));
      } finally {
        e.target.disabled = false;
      }
    });

    const yedekBildirim = ekran.querySelector("#yedek-bildirim");
    const yedekGoster = (tur, metin) => {
      yedekBildirim.innerHTML = `<div class="bildirim ${tur}">${kacis(metin)}</div>`;
    };

    ekran.querySelector("#yedek-al").addEventListener("click", async () => {
      try {
        const veri = await yedekAl();
        const bag = URL.createObjectURL(new Blob([JSON.stringify(veri)], { type: "application/json" }));
        const a = document.createElement("a");
        a.href = bag;
        a.download = `wordnexus-yedek-${tekrar.bugun()}.json`;
        a.click();
        URL.revokeObjectURL(bag);
        const adet = Object.values(veri.depolar).reduce((t, c) => t + c.length, 0);
        yedekGoster("ok", `${adet} kayıt indirildi.`);
      } catch (hata) {
        yedekGoster("hata", "Yedek alınamadı: " + hata.message);
      }
    });

    const dosyaGirdi = ekran.querySelector("#yedek-dosya");
    ekran.querySelector("#yedek-yukle").addEventListener("click", () => dosyaGirdi.click());
    dosyaGirdi.addEventListener("change", async () => {
      const dosya = dosyaGirdi.files?.[0];
      if (!dosya) return;
      if (!confirm("Yedekteki kayıtlar mevcutların üzerine yazılacak. Devam edilsin mi?")) return;
      try {
        const sayi = await yedekYukle(JSON.parse(await dosya.text()));
        yedekGoster("ok", `${sayi} kayıt yüklendi. Sayfayı yenile.`);
      } catch (hata) {
        yedekGoster("hata", hata.message);
      } finally {
        dosyaGirdi.value = "";
      }
    });

    ekran.querySelector("#sifirla").addEventListener("click", async () => {
      if (!confirm("Tüm blok cevapların ve konu ilerlemen silinecek. Emin misin?")) return;
      await db.bosalt("teshis");
      await db.bosalt("ilerleme");
      goster2("ok", "İlerleme sıfırlandı.");
    });

    ekran.querySelector("#cache-sil").addEventListener("click", async () => {
      if (!confirm("Kayıtlı açıklamalar ve sohbetler silinecek; tekrar açmak kota harcar. Emin misin?")) return;
      await db.bosalt("aciklamalar");
      await db.bosalt("sohbetler");
      goster2("ok", "Önbellek temizlendi.");
    });
  }
}

// Uretilen sorular tek tek onaydan gecer: yanlis cevap anahtari yanlis ogretir.
async function onayEkrani() {
  const bekleyen = await uretim.bekleyenler();

  if (!bekleyen.length) {
    ekran.innerHTML = `
      <h1>Onay kuyruğu boş</h1>
      <p class="soluk">Ayarlar → Gelişmiş'ten yeni sorular üretebilirsin.</p>
      <a class="dugme" href="#/ayarlar/gelismis" style="text-decoration:none">Ayarlar'a git</a>`;
    return;
  }

  const s = bekleyen[0];
  const konu = konuHarita.get(s.konu);

  ekran.innerHTML = `
    <div class="sayac">Onay bekleyen: ${bekleyen.length} soru</div>
    <h1 style="font-size:23px">${kacis(konu ? konu.ad : s.konu)}</h1>
    <p class="kucuk soluk" style="margin-bottom:14px">Aşama ${s.zorluk}${s.eksen ? " · " + kacis(s.eksen) : ""}</p>

    <div class="kart">
      <p class="soru-metni" style="font-size:16px">${soruGoster(s.soru)}</p>
      <div class="sik-liste">
        ${s.secenekler.map((o, j) => `
          <div class="sik ${j === s.cevap ? "dogru" : ""}" style="cursor:default">
            <span class="harf">${HARFLER[j]}</span><span>${kacis(o)}</span>
          </div>`).join("")}
      </div>
      <p class="kucuk" style="margin:0 0 8px"><strong>Gerekçe:</strong> ${kacis(s.neden)}</p>
      ${s.celdiriciler.map(c => `<p class="kucuk soluk" style="margin:0 0 4px">${kacis(c)}</p>`).join("")}
    </div>

    <div class="satir">
      <button class="dugme" id="onayla">Bankaya ekle</button>
      <button class="dugme ikincil" id="reddet">Sil</button>
      <a class="dugme ikincil" href="#/ayarlar/gelismis" style="text-decoration:none">Sonra</a>
    </div>
    <p class="kucuk soluk" style="margin-top:12px">
      Cevap anahtarını ve gerekçeleri kontrol et. Birden fazla şık doğruysa ya da
      gerekçe tutmuyorsa sil — yanlış soru yanlış öğretir.
    </p>`;

  ekran.querySelector("#onayla").addEventListener("click", async () => {
    await uretim.onayla(s.id); yonlendir();
  });
  ekran.querySelector("#reddet").addEventListener("click", async () => {
    await uretim.reddet(s.id); yonlendir();
  });
  window.scrollTo(0, 0);
}

// Hata bankasi: yanlis yapilan sorular konuya gore gruplanir, en cok hata ustte.
async function hatalarEkrani() {
  const hepsi = await db.tumu("sorular");
  const hatalilar = hepsi.filter(s => (s.hataSayisi || 0) > 0);

  if (!hatalilar.length) {
    ekran.innerHTML = `
      <h1>Hata bankası</h1>
      <div class="kart bos">Henüz hata yok. Alıştırma yaptıkça burası dolar.</div>
      <a class="dugme ikincil" href="#/" style="text-decoration:none">Ana sayfa</a>`;
    return;
  }

  const gruplar = new Map();
  for (const s of hatalilar) {
    if (!gruplar.has(s.konu)) gruplar.set(s.konu, []);
    gruplar.get(s.konu).push(s);
  }
  const toplamHata = (liste) => liste.reduce((t, s) => t + s.hataSayisi, 0);
  const sirali = [...gruplar.entries()].sort((a, b) => toplamHata(b[1]) - toplamHata(a[1]));

  ekran.innerHTML = `
    <h1>Hata bankası</h1>
    <p class="soluk">${hatalilar.length} soruda takıldın. En çok hata yaptığın konu üstte.</p>
    ${sirali.map(([konuId, sorular]) => {
      const k = konuHarita.get(konuId);
      return `<div class="kart" style="padding:0">
        <div class="konu-satir" style="border-bottom:1px solid var(--cizgi)">
          <span class="ad"><strong>${kacis(k ? k.ad : konuId)}</strong>
            <small>${k ? k.seviye : ""} · ${toplamHata(sorular)} hata</small></span>
        </div>
        ${sorular.map(s => `<div class="konu-satir">
          <span class="ad" style="font-family:var(--mono);font-size:13.5px">${soruGoster(s.soru)}
            <small style="font-family:var(--govde)">doğrusu: ${kacis(s.secenekler[s.cevap])}</small></span>
          <span class="oran soluk">${s.hataSayisi}×</span>
        </div>`).join("")}
      </div>`;
    }).join("")}
    <a class="dugme ikincil" href="#/" style="text-decoration:none">Ana sayfa</a>`;
  window.scrollTo(0, 0);
}
// ---------- yonlendirme ----------
function git(hash) { location.hash = hash; }

async function yonlendir() {
  const yol = location.hash.replace(/^#\/?/, "").split("/");
  try {
    if (yol[0] === "ayarlar") return await ayarlarEkrani(yol[1]);
    if (yol[0] === "onay") return await onayEkrani();
    if (yol[0] === "hatalar") return await hatalarEkrani();
    if (yol[0] === "oku") return await okumaEkrani(yol[1] || null);
    if (yol[0] === "kelimeler") return await kelimelerEkrani();
    if (yol[0] === "quiz") return await quizEkrani();
    if (yol[0] === "prova") return await provaEkrani();
    if (yol[0] === "calis") return await calisEkrani();
    if (yol[0] === "blok" && yol[1]) return await blokEkrani(Number(yol[1]));
    if (yol[0] === "sonuc" && yol[1]) return await sonucEkrani(Number(yol[1]));
    if (yol[0] === "inceleme" && yol[1]) return await incelemeEkrani(Number(yol[1]), Number(yol[2]) || 0);
    return await anaSayfa();
  } catch (hata) {
    ekran.innerHTML = `<div class="bildirim hata">Bir şeyler ters gitti: ${kacis(hata.message)}</div>
      <a class="dugme" href="#/" style="text-decoration:none">Ana sayfaya dön</a>`;
    console.error(hata);
  }
}

async function baslat() {
  try {
    KONULAR = (await (await fetch("./data/konular.json")).json()).konular;
    TESHIS_PARCALARI = (await (await fetch("./data/teshis-testi.json")).json()).parcalar || [];
    konuHarita = new Map(KONULAR.map(k => [k.id, k]));

    if (await db.seedGerekliMi()) {
      ekran.innerHTML = `<p class="soluk">Soru bankası hazırlanıyor…</p>`;
      const banka = (await (await fetch("./data/sorular.json")).json()).sorular;
      await db.seedYap(banka);

    }

    // Sinav parcalarinin hazir cozumleri. Kendi surum bayragi var: soru
    // bankasindan bagimsiz, zaten kurulu cihazlara da gelir.
    if (await db.cozumGerekliMi()) {
      ekran.innerHTML = `<p class="soluk">Metin çözümleri yükleniyor…</p>`;
      try {
        const cozumler = await (await fetch("./data/cozumler.json")).json();
        await db.cozumleriTohumla(cozumler);
      } catch { /* cozumler olmasa da uygulama calisir */ }
    }
  } catch (hata) {
    ekran.innerHTML = `<div class="bildirim hata">Veri yüklenemedi: ${kacis(hata.message)}
      <br><br>Bu sayfa <code>file://</code> ile açıldıysa çalışmaz; bir sunucudan (GitHub Pages ya da yerel sunucu) açman gerekir.</div>`;
    return;
  }

  temaUygula(temaOku());
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (temaOku() === "otomatik") temaUygula("otomatik");
  });

  // Service worker yalnizca guvenli baglamda calisir (https ya da localhost).
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  window.addEventListener("hashchange", yonlendir);
  yonlendir();
}

baslat();
