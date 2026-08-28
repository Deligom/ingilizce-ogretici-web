// Yonlendirme (hash router) ve gorunum montaji.
import * as db from "./db.js";
import { anahtarTest, AiHata } from "./ai.js";

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

  function ciz() {
    const s = sorular[i];
    ekran.innerHTML = `
      <div class="ilerleme-cubuk"><i style="width:${(i / sorular.length) * 100}%"></i></div>
      <div class="sayac">Blok ${no} · Soru ${i + 1} / ${sorular.length}</div>
      ${s.metin ? `<div class="parca">${kacis(s.metin)}</div>` : ""}
      <p class="soru-metni">${soruGoster(s.soru)}</p>
      <div class="sik-liste">
        ${s.secenekler.map((o, j) => `
          <button class="sik" data-j="${j}">
            <span class="harf">${HARFLER[j]}</span><span>${kacis(o)}</span>
          </button>`).join("")}
      </div>
      <div class="satir">
        <button class="dugme" id="ileri" disabled>${i === sorular.length - 1 ? "Bitir ve haritayı gör" : "Sonraki soru"}</button>
        <button class="dugme ikincil" id="cik">Sonra devam ederim</button>
      </div>
      <p class="kucuk soluk" style="margin-top:14px">Bu bir teşhis; doğru cevabı ve açıklamaları blok bitince topluca göreceksin.</p>
    `;

    ekran.querySelectorAll(".sik").forEach(d => d.addEventListener("click", () => {
      secilen = Number(d.dataset.j);
      ekran.querySelectorAll(".sik").forEach(x => x.classList.remove("secili"));
      d.classList.add("secili");
      ekran.querySelector("#ileri").disabled = false;
    }));

    ekran.querySelector("#ileri").addEventListener("click", ileri);
    ekran.querySelector("#cik").addEventListener("click", () => git("#/"));
  }

  async function ileri() {
    const s = sorular[i];
    durum.cevaplar[i] = { soruId: s.id, konu: s.konu, secilen, dogruMu: secilen === s.cevap };
    i++;
    secilen = null;

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

    ${yanlislar.length ? `<h2>Yanlış yaptıkların</h2>` : ""}
    ${yanlislar.map(c => {
      const s = soruHarita.get(c.soruId);
      if (!s) return "";
      const secilenMetin = s.secenekler[c.secilen];
      const celdirici = s.celdiriciler?.find(t => t.startsWith(secilenMetin));
      return `<div class="kart">
        ${s.metin ? `<div class="kucuk soluk" style="margin-bottom:8px">Metne dayalı soru</div>` : ""}
        <p class="soru-metni" style="font-size:15px;margin-bottom:12px">${soruGoster(s.soru)}</p>
        <p class="kucuk" style="margin:0 0 6px"><span style="color:var(--yanlis)">Senin cevabın:</span>
          <span style="font-family:var(--mono)">${kacis(secilenMetin)}</span></p>
        <p class="kucuk" style="margin:0 0 10px"><span style="color:var(--dogru)">Doğrusu:</span>
          <span style="font-family:var(--mono)"><span class="vurgu">${kacis(s.secenekler[s.cevap])}</span></span></p>
        ${s.neden ? `<p class="kucuk" style="margin:0">${kacis(s.neden)}</p>` : ""}
        ${celdirici ? `<p class="kucuk soluk" style="margin:8px 0 0">${kacis(celdirici)}</p>` : ""}
        ${!s.neden ? `<p class="kucuk soluk" style="margin:8px 0 0">Ayrıntılı açıklama "Neden?" katmanıyla gelecek (Faz 2).</p>` : ""}
      </div>`;
    }).join("")}

    <div class="satir" style="margin-top:20px">
      ${no < BLOK_SAYISI ? `<a class="dugme" href="#/blok/${no + 1}" style="text-decoration:none">Blok ${yonelme(no + 1)} geç</a>` : ""}
      <a class="dugme ikincil" href="#/" style="text-decoration:none">Ana sayfa</a>
    </div>
  `;
  window.scrollTo(0, 0);
}

async function ayarlarEkrani() {
  const anahtar = await db.ayarOku("apiKey", "");
  const hedef = await db.ayarOku("gunlukHedef", 10);

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

    <h2>Veri</h2>
    <div class="kart">
      <p class="kucuk soluk" style="margin-bottom:12px">Tüm ilerlemeyi ve blok cevaplarını siler. Soru bankası korunur.</p>
      <button class="dugme ikincil" id="sifirla">İlerlemeyi sıfırla</button>
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
}

// ---------- yonlendirme ----------
function git(hash) { location.hash = hash; }

async function yonlendir() {
  const yol = location.hash.replace(/^#\/?/, "").split("/");
  try {
    if (yol[0] === "ayarlar") return await ayarlarEkrani();
    if (yol[0] === "blok" && yol[1]) return await blokEkrani(Number(yol[1]));
    if (yol[0] === "sonuc" && yol[1]) return await sonucEkrani(Number(yol[1]));
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
