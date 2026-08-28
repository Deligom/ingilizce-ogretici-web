// Yonlendirme (hash router) ve gorunum montaji.
import * as db from "./db.js";
import { anahtarTest, aciklaSoru, soruSor, AiHata } from "./ai.js";

const ekran = document.getElementById("ekran");
const BLOK_SAYISI = 8;
const ZAYIF_ESIK = 0.6; // %60 altinda kalan konu "calisilacak" kuyruguna girer

let KONULAR = [];
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

// Cumledeki ____ bosluklarini fosforlu isaretle gosterir.
function soruGoster(metin) {
  return kacis(metin).replace(/_{3,}/g, '<span class="bosluk-isaret">&nbsp;&nbsp;&nbsp;</span>');
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
async function aiCagir(isle) {
  const anahtar = await db.ayarOku("apiKey", "");
  if (!anahtar) throw new AiHata("Önce Ayarlar'dan Gemini anahtarını gir.", "anahtaryok");
  const sonuc = await isle(anahtar);
  await db.kotaArtir();
  return sonuc;
}

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
    ${a.benzerCumleler?.length ? `<div class="bolum">
      <span class="etiket">Benzer 5 cümle — cevabı görmek için dokun</span>
      <ul class="benzer">
        ${a.benzerCumleler.map(c => `<li>${kacis(c.cumle)}
          <span class="cevap gizli">${kacis(c.cevap)}</span></li>`).join("")}
      </ul></div>` : ""}
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

// Hazir soru onerileri. Yerelde uretilir, kota harcamaz. Tiklayinca kutuya
// yazilir ama GONDERILMEZ: kullanici cumleyi degistirmek isteyebilir.
function oneriListesi(soru, secilen) {
  const oneriler = ["Bu kuralı başka bir örnekle anlatır mısın?"];
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
    kap.querySelectorAll(".benzer .cevap").forEach(e =>
      e.addEventListener("click", () => e.classList.toggle("gizli")));
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
        ${hata.kod === "anahtaryok" ? `<a class="dugme ikincil" href="#/ayarlar" style="text-decoration:none">Ayarlar'a git</a>` : ""}`;
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
               <small>${z.konu.seviye} · ${z.dogru}/${z.dogru + z.yanlis} doğru</small></span>
           </div>`).join("")}
         </div>
         <p class="kucuk soluk">Alıştırma modu Faz 3'te geliyor; şimdilik bu liste teşhisin çıktısı.</p>`}
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
  const konu = konuHarita.get(s.konu);
  const secilen = c.bilmiyorum ? null : c.secilen;
  const secilenMetin = c.bilmiyorum ? null : s.secenekler[c.secilen];
  const celdirici = secilenMetin && s.celdiriciler?.find(t => t.startsWith(secilenMetin));

  ekran.innerHTML = `
    <div class="ilerleme-cubuk"><i style="width:${((i + 1) / yanlislar.length) * 100}%"></i></div>
    <div class="sayac">Blok ${no} · Yanlış ${i + 1} / ${yanlislar.length}
      · <a href="#/sonuc/${no}" style="color:inherit">haritaya dön</a></div>

    <div class="kart">
      ${s.metin ? `<div class="parca" style="max-height:26vh;margin-bottom:12px">${kacis(s.metin)}</div>` : ""}
      <p class="soru-metni" style="font-size:16px;margin-bottom:14px">${soruGoster(s.soru)}</p>

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
    </div>

    <div class="satir" style="margin-top:16px">
      <button class="dugme ikincil" id="onceki" ${i === 0 ? "disabled" : ""}>← Önceki</button>
      ${i === yanlislar.length - 1
        ? `<a class="dugme" href="#/sonuc/${no}" style="text-decoration:none">Bitir</a>`
        : `<button class="dugme" id="sonraki">Sonraki →</button>`}
    </div>
  `;

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

async function ayarlarEkrani() {
  const anahtar = await db.ayarOku("apiKey", "");
  const hedef = await db.ayarOku("gunlukHedef", 10);
  const kota = await db.kotaOku();
  const aciklamaSayisi = (await db.ciftler("aciklamalar")).length;
  const oneriAcik = await db.ayarOku("oneriler", true);

  ekran.innerHTML = `
    <h1>Ayarlar</h1>
    <div class="kart">
      <label for="anahtar">Gemini API anahtarı</label>
      <input id="anahtar" type="password" value="${kacis(anahtar)}" placeholder="AIza…" autocomplete="off" spellcheck="false">
      <p class="kucuk soluk" style="margin:10px 0 14px">
        Anahtar yalnızca bu cihazdaki tarayıcıda saklanır, hiçbir yere gönderilmez.
        <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a>'dan ücretsiz alabilirsin.
      </p>
      <div id="bildirim"></div>
      <div class="satir">
        <button class="dugme" id="kaydet">Kaydet ve test et</button>
        <button class="dugme ikincil" id="temizle">Anahtarı sil</button>
      </div>
    </div>

    <div class="kart">
      <label for="hedef">Günlük hedef (soru)</label>
      <input id="hedef" type="text" inputmode="numeric" value="${Number(hedef)}">
      <p class="kucuk soluk" style="margin:10px 0 0">Alıştırma kuyruğu Faz 3'te bu sayıyı kullanacak.</p>
    </div>

    <div class="kart">
      <label class="secenek-satir" for="oneriler">
        <input type="checkbox" id="oneriler" ${oneriAcik ? "checked" : ""}>
        <span>Sohbette hazır soru önerileri</span>
      </label>
      <p class="kucuk soluk" style="margin:8px 0 0">
        Sohbet kutusunun üstünde "Neden bu olmuyor?" gibi hazır sorular çıkar.
        Dokununca kutuya yazılır, göndermeden önce değiştirebilirsin.
      </p>
    </div>

    <h2>Kullanım</h2>
    <div class="kart">
      <p style="margin:0 0 4px"><strong>${kota.sayi}</strong> AI isteği <span class="soluk">— bugün</span></p>
      <p class="kucuk soluk" style="margin:0">
        Önbellekte <strong>${aciklamaSayisi}</strong> açıklama var; bunlar tekrar açıldığında
        istek harcamıyor ve çevrimdışı da çalışıyor.
      </p>
    </div>

    <h2>Veri</h2>
    <div class="kart">
      <p class="kucuk soluk" style="margin-bottom:12px">Tüm ilerlemeyi ve blok cevaplarını siler. Soru bankası korunur.</p>
      <div class="satir">
        <button class="dugme ikincil" id="sifirla">İlerlemeyi sıfırla</button>
        <button class="dugme ikincil" id="cache-sil">Açıklama önbelleğini sil</button>
      </div>
    </div>
  `;

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

  ekran.querySelector("#oneriler").addEventListener("change", (e) => {
    db.ayarYaz("oneriler", e.target.checked);
  });

  ekran.querySelector("#hedef").addEventListener("change", (e) => {
    const n = Math.max(1, Math.min(200, parseInt(e.target.value, 10) || 10));
    e.target.value = n;
    db.ayarYaz("gunlukHedef", n);
  });

  ekran.querySelector("#sifirla").addEventListener("click", async () => {
    if (!confirm("Tüm blok cevapların ve konu ilerlemen silinecek. Emin misin?")) return;
    await db.bosalt("teshis");
    await db.bosalt("ilerleme");
    goster("ok", "İlerleme sıfırlandı.");
  });

  ekran.querySelector("#cache-sil").addEventListener("click", async () => {
    if (!confirm("Kayıtlı açıklamalar ve sohbetler silinecek; tekrar açmak kota harcar. Emin misin?")) return;
    await db.bosalt("aciklamalar");
    await db.bosalt("sohbetler");
    goster("ok", "Önbellek temizlendi.");
  });
}

// ---------- yonlendirme ----------
function git(hash) { location.hash = hash; }

async function yonlendir() {
  const yol = location.hash.replace(/^#\/?/, "").split("/");
  try {
    if (yol[0] === "ayarlar") return await ayarlarEkrani();
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
    konuHarita = new Map(KONULAR.map(k => [k.id, k]));

    if (await db.seedGerekliMi()) {
      ekran.innerHTML = `<p class="soluk">Soru bankası hazırlanıyor…</p>`;
      const banka = (await (await fetch("./data/sorular.json")).json()).sorular;
      await db.seedYap(banka);
    }
  } catch (hata) {
    ekran.innerHTML = `<div class="bildirim hata">Veri yüklenemedi: ${kacis(hata.message)}
      <br><br>Bu sayfa <code>file://</code> ile açıldıysa çalışmaz; bir sunucudan (GitHub Pages ya da yerel sunucu) açman gerekir.</div>`;
    return;
  }

  window.addEventListener("hashchange", yonlendir);
  yonlendir();
}

baslat();
