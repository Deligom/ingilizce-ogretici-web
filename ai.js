// Gemini istemcisi. Tum yapilandirilmis cagrilar responseSchema ile JSON doner.
const KOK = "https://generativelanguage.googleapis.com/v1beta/models/";

// Kullaniciya sunulan iki model. Ayarlar'dan secilir, secim IndexedDB'de durur.
export const MODELLER = [
  {
    ad: "gemini-3.5-flash",
    baslik: "Gemini 3.5 Flash",
    aciklama: "Daha iyi anlatım. Açıklamalar ve soru üretimi için önerilir."
  },
  {
    ad: "gemini-3.1-flash-lite",
    baslik: "Gemini 3.1 Flash Lite",
    aciklama: "Daha hızlı ve hafif. Kota sıkışınca ya da hız istediğinde."
  }
];
export const VARSAYILAN_MODEL = MODELLER[0].ad;

// Anlatim tarzi: bilerek TEK kontrol. "Kac tuzak olsun", "ne kadar ayrintili"
// gibi ayri dugmeler koymuyoruz; her dugme kullaniciya devredilen bir karardir
// ve cogu kisi hicbirine dokunmaz. Varsayilan dogrudan iyi olmali.
export const USLUPLAR = {
  gunluk: {
    baslik: "Günlük",
    aciklama: "Terim yok denecek kadar az, sohbet eder gibi. Yeni başlayan için.",
    ek: "Dilbilgisi terimlerini mümkün olduğunca kullanma; kullanman gerekirse " +
        "parantez içinde ve günlük bir benzetmeyle ver. Kısa cümleler kur."
  },
  dengeli: {
    baslik: "Dengeli",
    aciklama: "Sade anlatım, terim parantez içinde. Çoğu kişi için doğru olan bu.",
    ek: ""
  },
  terimli: {
    baslik: "Terimli",
    aciklama: "Dilbilgisi terimlerini açıkça kullanır. Sınav çalışan için.",
    ek: "Dilbilgisi terimlerini açıkça kullan (present simple, third person singular, " +
        "relative clause gibi) ve Türkçe karşılıklarını da ver. Kural adını söylemekten çekinme."
  }
};

// app.js her cagridan once ayarlardaki secimi buraya yazar.
let secilenModel = VARSAYILAN_MODEL;
let secilenUslup = "dengeli";
export function uslupSec(ad) {
  secilenUslup = USLUPLAR[ad] ? ad : "dengeli";
}
const sistemMetni = () => {
  const ek = USLUPLAR[secilenUslup].ek;
  return ek ? SISTEM + "\n\nAyrıca: " + ek : SISTEM;
};
export function modelSec(ad) {
  secilenModel = MODELLER.some(m => m.ad === ad) ? ad : VARSAYILAN_MODEL;
}
export const modelAdi = () => secilenModel;

export class AiHata extends Error {
  constructor(mesaj, kod) { super(mesaj); this.kod = kod; }
}

// CLAUDE.md'deki anlatim kurallari birebir buraya gecer.
const SISTEM = `Sen Türkçe konuşan bir yetişkine İngilizce öğreten bir öğretmensin.
Öğrenci okuduğunu anlıyor ama kuralları bilmiyor; Türkçe dilbilgisi terimlerinde de
zorlanıyor, ama Türkçeyi sezgisel biliyor. Kuralları şöyle anlat:

- Sade Türkçe anlat, terimi parantezde ver. Doğru: "Fiile -s takılır (geniş zaman,
  3. tekil şahıs)." Yanlış: "Simple present tense'te üçüncü tekil şahısta fiil çekimlenir."
- Türkçeyle karşılaştır. Örnek: "İngilizcede the, Türkçedeki belirtme hâli -i gibi:
  kapıyı aç → open the door."
- Kural cümlesi en fazla iki cümle olsun. Uzun anlatım yerine örnek çoğalt.
- Her açıklamada bir tuzak söyle: Türkçe konuşanın burada tipik olarak ne hata yaptığı.
- Asla "harika bir soru" gibi doldurma cümlesi kurma, doğrudan cevaba gir.
- İngilizce cümleleri olduğu gibi yaz, çevirisini ayrıca verme (istenmedikçe).`;

// Iki yol var:
//  - Kullanicinin kendi anahtari varsa dogrudan Gemini'ye gidilir, sinir yoktur.
//  - Yoksa /api/gemini proxy'sine gidilir; anahtar sunucuda durur, gunluk sinir isler.
// Proxy yalnizca Vercel yayininda vardir; GitHub Pages kopyasinda kendi anahtarin gerekir.
export const PROXY_YOLU = "/api/gemini";

export let kalanIstek = null;   // proxy her yanitta bildirir, arayuz gosterir

async function cagir(anahtar, govde) {
  const proxy = !anahtar;
  let yanit;
  try {
    yanit = await fetch(proxy ? PROXY_YOLU : KOK + secilenModel + ":generateContent", {
      method: "POST",
      headers: proxy
        ? { "Content-Type": "application/json" }
        : { "Content-Type": "application/json", "x-goog-api-key": anahtar },
      // Proxy modelini govdeden ogrenir; kendi anahtarinda model URL'de gider.
      body: JSON.stringify(proxy ? { ...govde, model: secilenModel } : govde)
    });
  } catch {
    throw new AiHata("İnternete ulaşılamadı. Bağlantını kontrol et.", "ag");
  }

  if (proxy) {
    const kalan = yanit.headers.get("X-Kalan-Istek");
    if (kalan !== null) kalanIstek = Number(kalan);
  }

  if (!yanit.ok) {
    // Proxy kendi hata mesajini Turkce ve kodlu doner; oldugu gibi kullaniriz.
    if (proxy) {
      const veri = await yanit.json().catch(() => null);
      if (veri?.hata) throw new AiHata(veri.hata, veri.kod || "sunucu");
      // 502/504: sunucu yaniti JSON degil, ag gecidi hatasi. Istek fazla uzun
      // surmus demektir; kullaniciya "anahtar yok" demek yaniltici olur.
      if (yanit.status === 502 || yanit.status === 504)
        throw new AiHata("İstek çok uzun sürdü. Tekrar dene — kaldığı yerden devam eder.", "sure");
      // Statik barindirmada (GitHub Pages) /api yoktur: POST'a 404 ya da 405 doner
      // ve govde JSON degildir. Kullaniciya dogru yolu gosterelim.
      if (!veri || yanit.status === 404 || yanit.status === 405)
        throw new AiHata("Bu kopyada paylaşılan anahtar yok. Ayarlar'dan kendi Gemini anahtarını gir.", "proxyyok");
      throw new AiHata("Sunucu hatası (" + yanit.status + ").", "sunucu");
    }
    const metin = await yanit.text().catch(() => "");
    if (yanit.status === 400 || yanit.status === 401 || yanit.status === 403)
      throw new AiHata("Anahtar geçersiz ya da bu model için yetkisiz.", "anahtar");
    if (yanit.status === 429)
      throw new AiHata("Günlük kota doldu. Yarın tekrar dene.", "kota");
    if (yanit.status >= 500)
      throw new AiHata("Google tarafında geçici bir sorun var. Az sonra dene.", "sunucu");
    throw new AiHata("Sunucu hatası (" + yanit.status + "). " + metin.slice(0, 120), "sunucu");
  }

  const veri = await yanit.json();
  const aday = veri?.candidates?.[0];
  if (aday?.finishReason === "SAFETY")
    throw new AiHata("Model bu içeriğe cevap vermedi.", "guvenlik");
  const metin = aday?.content?.parts?.[0]?.text;
  if (!metin) throw new AiHata("Model boş cevap döndü. Tekrar dene.", "bos");
  return metin;
}

async function json(anahtar, { sistem, istek, sema, sicaklik = 0.3 }) {
  const metin = await cagir(anahtar, {
    systemInstruction: { parts: [{ text: sistem === SISTEM ? sistemMetni() : sistem }] },
    contents: [{ role: "user", parts: [{ text: istek }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: sema,
      temperature: sicaklik
    }
  });
  try {
    return JSON.parse(metin);
  } catch {
    throw new AiHata("Model bozuk JSON döndü. Tekrar dene.", "ayristirma");
  }
}

// ---------- 1. Soru aciklamasi ----------
const SEMA_ACIKLAMA = {
  type: "object",
  properties: {
    dogruSik: { type: "string", description: "Doğru şıkkın metni, olduğu gibi" },
    neden: { type: "string", description: "Doğru şıkkın neden doğru olduğu, tek cümle" },
    kural: { type: "string", description: "Kural, en fazla iki cümle, sade Türkçe" },
    turkceKarsilastirma: { type: "string", description: "Türkçeyle karşılaştırma, tek cümle" },
    secilenNesiYanlis: { type: "string", description: "Öğrencinin seçtiği şık neden yanlış" },
    tuzak: { type: "string", description: "Türkçe konuşanın burada yaptığı tipik hata" },
    benzerCumleler: {
      type: "array",
      description: "Aynı kuralı ölçen 5 kısa İngilizce cümle, boşluk ___ ile",
      items: {
        type: "object",
        properties: {
          cumle: { type: "string" },
          cevap: { type: "string" }
        },
        required: ["cumle", "cevap"]
      }
    }
  },
  required: ["dogruSik", "neden", "kural", "turkceKarsilastirma", "secilenNesiYanlis", "tuzak", "benzerCumleler"]
};

// secilenIndex null ise ogrenci tahmin etmek yerine "bilmiyorum" demistir:
// sasirdigi bir sik yok, o yuzden en cazip celdiriciyi ele almasini isteriz.
export function aciklaSoru(anahtar, soru, secilenIndex, konu) {
  const bilmiyor = secilenIndex === null || secilenIndex === undefined;
  const siklar = soru.secenekler.map((o, i) => `${i === soru.cevap ? "✓" : " "} ${o}`).join("\n");
  const istek = `${bilmiyor
    ? "Öğrenci bu soruyu hiç bilmediğini söyledi ve boş bıraktı; tahmin etmedi.\nBu yüzden konuyu sıfırdan anlat."
    : "Öğrenci bu soruyu yanlış yaptı."}

${soru.metin ? "Metin:\n" + soru.metin + "\n\n" : ""}Soru: ${soru.soru}
Şıklar:
${siklar}
Doğru şık: ${soru.secenekler[soru.cevap]}
${bilmiyor
  ? "Öğrencinin cevabı: yok (bilmiyorum dedi). secilenNesiYanlis alanına, bu soruda\nen çok kandıran şıkkın hangisi olduğunu ve neden yanlış olduğunu yaz."
  : "Öğrencinin seçtiği: " + soru.secenekler[secilenIndex]}

Konu kartı:
- Konu: ${konu.ad}
- Kural: ${konu.kural}
- Yapı: ${konu.yapi}
- Bilinen tuzak: ${konu.tuzak}

Bu soruyu açıkla. benzerCumleler alanına aynı kuralı ölçen, birbirinden farklı
5 kısa cümle yaz; boşluğu ___ ile göster ve cevabı ayrı alanda ver.`;

  return json(anahtar, { sistem: SISTEM, istek, sema: SEMA_ACIKLAMA, sicaklik: 0.3 });
}

// ---------- 2. Kelime anlami ----------
const SEMA_KELIME = {
  type: "object",
  properties: {
    anlam: { type: "string" },
    tur: { type: "string", description: "isim, fiil, sıfat gibi" },
    cumledekiRol: { type: "string" },
    ornek: { type: "string" }
  },
  required: ["anlam", "tur", "cumledekiRol", "ornek"]
};

export function kelimeAnlami(anahtar, kelime, cumle) {
  return json(anahtar, {
    sistem: SISTEM,
    istek: `"${kelime}" kelimesini şu cümledeki kullanımına göre açıkla:\n${cumle}`,
    sema: SEMA_KELIME,
    sicaklik: 0.2
  });
}

// ---------- 3. Cumle parcalama (cumle seridi) ----------
// Cumle kelime bloklarina ayrilir, her blogun altinda rolu yazar.
// Roller Turkce soru kaliplariyla verilir: "kim", "ne yapiyor", "neyi", "nerede".
const SEMA_PARCA = {
  type: "object",
  properties: {
    parcalar: {
      type: "array",
      items: {
        type: "object",
        properties: {
          metin: { type: "string", description: "Cümlenin bu parçası, olduğu gibi" },
          rol: { type: "string", description: "Kısa rol etiketi: kim / ne yapıyor / neyi / nerede / ne zaman / nasıl" },
          aciklama: { type: "string", description: "Bu parça ne işe yarıyor, tek kısa cümle" }
        },
        required: ["metin", "rol", "aciklama"]
      }
    },
    turkce: { type: "string", description: "Cümlenin doğal Türkçe karşılığı" }
  },
  required: ["parcalar", "turkce"]
};

export function cumleParcala(anahtar, cumle) {
  return json(anahtar, {
    sistem: SISTEM,
    istek: `Bu İngilizce cümleyi anlamlı parçalara ayır:

${cumle}

Kurallar:
- Parçaları soldan sağa, cümledeki sırayla ver. Birleştirince cümlenin tamamı çıksın.
- Kelime kelime bölme; anlam taşıyan öbekleri bir arada tut ("in the morning" tek parça).
- Rol etiketini Türkçe soru kalıbıyla yaz: kim, ne yapıyor, neyi, nerede, ne zaman, nasıl.
- Yardımcı fiil ve edat gibi parçalar için rolü "bağlayıcı" ya da "zaman eki" gibi yaz.`,
    sema: SEMA_PARCA,
    sicaklik: 0.2
  });
}

// ---------- 4. Soru uretimi ----------
const SEMA_URETIM = {
  type: "object",
  properties: {
    sorular: {
      type: "array",
      items: {
        type: "object",
        properties: {
          eksen: { type: "string", description: "Verilen eksen listesinden hangisini ölçtüğü" },
          soru: { type: "string", description: "Boşluk ___ ile gösterilmiş İngilizce cümle" },
          secenekler: { type: "array", items: { type: "string" }, description: "Tam 4 şık" },
          cevap: { type: "integer", description: "Doğru şıkkın 0-3 arası indeksi" },
          neden: { type: "string", description: "Doğru şıkkın gerekçesi, sade Türkçe, tek cümle" },
          celdiriciler: {
            type: "array", items: { type: "string" },
            description: "Üç yanlış şık için 'şıkmetni: neden yanlış' biçiminde üç açıklama"
          }
        },
        required: ["eksen", "soru", "secenekler", "cevap", "neden", "celdiriciler"]
      }
    }
  },
  required: ["sorular"]
};

const ZORLUK_TARIFI = {
  1: "Aşama 1 (tanı): tek kural, tek ipucu. Tek boşluk, cevap doğrudan görünür.",
  2: "Aşama 2 (ayırt et): ipucu ikinci cümlede gizli olsun, cümle tek başına çözülemesin. Çeldiriciler birbirine yakın olsun.",
  3: "Aşama 3 (karıştır): iki ya da üç boşluk, birden çok konu iç içe. Her şık boşlukların hepsini birden doldursun, hepsi doğru olmalı."
};

// Tek istekte liste isteyince model kendi ilk cevabini tekrar eder. Uc kaldirac:
// (1) eksen listesi dagitilir, (2) mevcut cumleler "tekrar etme" diye verilir,
// (3) tohum sorular uslup ornegi olarak gonderilir. Sicaklik da yuksek tutulur.
export function uretSorular(anahtar, konu, eksenler, ornekSorular, mevcutCumleler, adet, zorluk) {
  const ornekMetni = ornekSorular.slice(0, 3).map(s =>
    `Cümle: ${s.soru}\nŞıklar: ${s.secenekler.join(" | ")}\nDoğru: ${s.secenekler[s.cevap]}\nGerekçe: ${s.neden || "-"}`
  ).join("\n\n");

  const istek = `Bir İngilizce sorusu bankası için ${adet} yeni çoktan seçmeli soru yaz.

KONU KARTI
- Konu: ${konu.ad} (${konu.seviye})
- Kural: ${konu.kural}
- Yapı: ${konu.yapi}
- Türkçe konuşanın tuzağı: ${konu.tuzak}

ZORLUK
${ZORLUK_TARIFI[zorluk] || ZORLUK_TARIFI[1]}

ÖLÇÜLECEK EKSENLER
Aşağıdaki eksenlerden ${adet} FARKLI tanesini seç ve her soruda birini ölç.
Aynı ekseni iki kez kullanma. Hangi ekseni ölçtüğünü "eksen" alanına yaz.
${eksenler.map((e, i) => `${i + 1}. ${e}`).join("\n")}

ÜSLUP ÖRNEĞİ (bu bankadaki mevcut sorular — biçimi taklit et, içeriği değil)
${ornekMetni || "(örnek yok)"}

BUNLARI TEKRAR ETME
Aşağıdaki cümleler bankada zaten var. Aynı özneyi, aynı fiili ve aynı kalıbı
tekrar kullanma; farklı bağlamlar kur (iş, seyahat, yemek, spor, okul, aile).
${mevcutCumleler.slice(0, 25).map(c => "- " + c).join("\n")}

KURALLAR
- Boşluğu ___ (üç alt çizgi) ile göster.
- Tam 4 şık yaz, hepsi birbirinden farklı olsun.
- Yalnızca BİR şık doğru olsun. Bundan emin ol: diğer üçünün her biri için
  "neden yanlış" yazabiliyor olmalısın. Yazamıyorsan o şıkkı değiştir.
- celdiriciler alanına üç açıklama yaz, her biri şıkkın metniyle başlasın.
- Gerekçeler sade Türkçe olsun, terimi parantezde ver.`;

  return json(anahtar, {
    sistem: SISTEM, istek, sema: SEMA_URETIM, sicaklik: 1.0
  });
}

// ---------- 4. Serbest sohbet ----------
// Duz metin doner; baglam olarak soru, siklar, secilen sik ve konu karti gider.
export async function soruSor(anahtar, baglam, mesajlar) {
  const baglamMetni = `Konuştuğumuz soru:
${baglam.metin ? "Metin: " + baglam.metin + "\n" : ""}${baglam.soru}
Şıklar: ${baglam.secenekler.join(" / ")}
Doğru cevap: ${baglam.dogru}
Öğrencinin seçtiği: ${baglam.secilen}
Konu: ${baglam.konuAd} — ${baglam.konuKural}

Öğrenci bu soru hakkında sorular soracak. Kısa ve doğrudan cevap ver.`;

  const icerik = [
    { role: "user", parts: [{ text: baglamMetni }] },
    { role: "model", parts: [{ text: "Anladım, sorusunu bekliyorum." }] },
    ...mesajlar.map(m => ({
      role: m.rol === "kullanici" ? "user" : "model",
      parts: [{ text: m.metin }]
    }))
  ];

  return cagir(anahtar, {
    systemInstruction: { parts: [{ text: sistemMetni() }] },
    contents: icerik,
    generationConfig: { temperature: 0.4, maxOutputTokens: 800 }
  });
}

// ---------- 5. Toplu metin cozumleme ----------
// Cumle cumle istemek yerine hepsini tek istekte cozumleriz: hem bekleme
// dagilmaz hem de metin bir kez cozumlenince tamamen cevrimdisi calisir.
const SEMA_METIN_COZUM = {
  type: "object",
  properties: {
    cumleler: {
      type: "array",
      items: {
        type: "object",
        properties: {
          cumle: { type: "string", description: "Çözümlenen cümle, verilen hâliyle birebir" },
          parcalar: {
            type: "array",
            items: {
              type: "object",
              properties: {
                metin: { type: "string" },
                rol: { type: "string", description: "kim / ne yapıyor / neyi / nerede / ne zaman / nasıl / bağlayıcı" },
                aciklama: { type: "string", description: "Bu parça ne işe yarıyor, tek kısa cümle" }
              },
              required: ["metin", "rol", "aciklama"]
            }
          },
          turkce: { type: "string", description: "Cümlenin doğal Türkçe karşılığı" }
        },
        required: ["cumle", "parcalar", "turkce"]
      }
    },
    zorKelimeler: {
      type: "array",
      description: "Metindeki, A2 üstü sayılabilecek en fazla 12 kelime",
      items: {
        type: "object",
        properties: {
          kelime: { type: "string", description: "Kelimenin metindeki hâli, küçük harfle" },
          anlam: { type: "string" },
          tur: { type: "string", description: "isim, fiil, sıfat gibi" },
          cumledekiRol: { type: "string" },
          ornek: { type: "string", description: "Kısa İngilizce örnek cümle" }
        },
        required: ["kelime", "anlam", "tur", "cumledekiRol", "ornek"]
      }
    }
  },
  required: ["cumleler", "zorKelimeler"]
};

export function metniCozumle(anahtar, cumleler) {
  const istek = `Aşağıdaki cümleleri tek tek çözümle. Cümleleri verildiği sırayla ve
"cumle" alanına birebir aynı metinle döndür.

${cumleler.map((c, i) => `${i + 1}. ${c}`).join("\n")}

Kurallar:
- Parçaları soldan sağa, cümledeki sırayla ver; birleştirince cümlenin tamamı çıksın.
- Kelime kelime bölme; anlam taşıyan öbekleri bir arada tut ("in the morning" tek parça).
- Rol etiketini Türkçe soru kalıbıyla yaz: kim, ne yapıyor, neyi, nerede, ne zaman, nasıl.
  Yardımcı fiil ve edat gibi parçalar için "bağlayıcı" yaz.
- zorKelimeler alanına, bu metinde Türkçe konuşan bir A2 öğrencisini zorlayacak
  kelimeleri koy. Kolay kelimeleri (the, is, my, good gibi) koyma.`;

  return json(anahtar, { sistem: SISTEM, istek, sema: SEMA_METIN_COZUM, sicaklik: 0.2 });
}

// ---------- 6. Metin uretimi ----------
const SEMA_METIN = {
  type: "object",
  properties: {
    baslik: { type: "string", description: "Kısa Türkçe başlık" },
    metin: { type: "string", description: "İngilizce metin, paragraflar \\n\\n ile ayrılmış" }
  },
  required: ["baslik", "metin"]
};

export function metinUret(anahtar, seviye, konu, kelimeSayisi) {
  const istek = `${seviye} seviyesinde, yaklaşık ${kelimeSayisi} kelimelik bir İngilizce
okuma metni yaz.

Konu: ${konu || "günlük hayattan ilgi çekici bir konu seç"}

Kurallar:
- Metin İngilizce olsun; Türkçe çeviri ekleme.
- ${seviye} seviyesini aşan yapı kullanma ama kuru olmasın; bir hikâyesi olsun.
- 2-3 paragraf, paragraflar arasında boş satır bırak.
- Cümleler ne çok kısa ne çok uzun olsun; okurken akmalı.
- baslik alanına Türkçe kısa bir başlık yaz.`;

  return json(anahtar, { sistem: SISTEM, istek, sema: SEMA_METIN, sicaklik: 0.9 });
}

// ---------- 7. Metin sohbeti ----------
// Soru sohbetinden farki: baglam tek cumle degil, metnin tamami.
export async function metinSohbet(anahtar, metin, mesajlar) {
  const baglamMetni = `Öğrenci şu İngilizce metni okuyor:

${metin}

Bu metin hakkında sorular soracak: bir cümleyi anlamadığı, bir yapının neden öyle
kurulduğu, bir kelimenin ne demek olduğu gibi. Kısa ve doğrudan cevap ver.
Cevabında metinden alıntı yapabilirsin.`;

  const icerik = [
    { role: "user", parts: [{ text: baglamMetni }] },
    { role: "model", parts: [{ text: "Metni okudum, sorunu bekliyorum." }] },
    ...mesajlar.map(m => ({
      role: m.rol === "kullanici" ? "user" : "model",
      parts: [{ text: m.metin }]
    }))
  ];

  return cagir(anahtar, {
    systemInstruction: { parts: [{ text: sistemMetni() }] },
    contents: icerik,
    generationConfig: { temperature: 0.4, maxOutputTokens: 1200 }
  });
}

// ---------- anahtar testi ----------
export async function anahtarTest(anahtar) {
  const metin = await cagir(anahtar, {
    contents: [{ parts: [{ text: "Sadece 'tamam' yaz." }] }],
    generationConfig: { maxOutputTokens: 256, temperature: 0 }
  });
  return metin.trim();
}
