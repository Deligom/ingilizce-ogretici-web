// Gemini istemcisi. Tum yapilandirilmis cagrilar responseSchema ile JSON doner.
const MODEL = "gemini-2.5-flash";
const KOK = "https://generativelanguage.googleapis.com/v1beta/models/";

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

async function cagir(anahtar, govde) {
  let yanit;
  try {
    yanit = await fetch(KOK + MODEL + ":generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": anahtar },
      body: JSON.stringify(govde)
    });
  } catch {
    throw new AiHata("İnternete ulaşılamadı. Bağlantını kontrol et.", "ag");
  }

  if (!yanit.ok) {
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
    systemInstruction: { parts: [{ text: sistem }] },
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

export function aciklaSoru(anahtar, soru, secilenIndex, konu) {
  const siklar = soru.secenekler.map((o, i) => `${i === soru.cevap ? "✓" : " "} ${o}`).join("\n");
  const istek = `Öğrenci bu soruyu yanlış yaptı.

${soru.metin ? "Metin:\n" + soru.metin + "\n\n" : ""}Soru: ${soru.soru}
Şıklar:
${siklar}
Doğru şık: ${soru.secenekler[soru.cevap]}
Öğrencinin seçtiği: ${soru.secenekler[secilenIndex]}

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

// ---------- 3. Serbest sohbet ----------
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
    systemInstruction: { parts: [{ text: SISTEM }] },
    contents: icerik,
    generationConfig: { temperature: 0.4, maxOutputTokens: 800 }
  });
}

// ---------- anahtar testi ----------
export async function anahtarTest(anahtar) {
  const metin = await cagir(anahtar, {
    contents: [{ parts: [{ text: "Sadece 'tamam' yaz." }] }],
    generationConfig: { maxOutputTokens: 16, temperature: 0 }
  });
  return metin.trim();
}
