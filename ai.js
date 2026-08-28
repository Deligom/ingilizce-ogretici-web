// Gemini istemcisi. Faz 1'de yalnizca anahtar testi var; aciklama, sohbet ve
// soru uretimi Faz 2-3'te bu dosyaya eklenecek.
const MODEL = "gemini-2.5-flash";
const KOK = "https://generativelanguage.googleapis.com/v1beta/models/";

export class AiHata extends Error {
  constructor(mesaj, kod) { super(mesaj); this.kod = kod; }
}

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
    throw new AiHata("Sunucu hatası (" + yanit.status + "). " + metin.slice(0, 120), "sunucu");
  }
  return yanit.json();
}

// Anahtarin gecerli olup olmadigini en ucuz sekilde dener.
export async function anahtarTest(anahtar) {
  const veri = await cagir(anahtar, {
    contents: [{ parts: [{ text: "Sadece 'tamam' yaz." }] }],
    generationConfig: { maxOutputTokens: 16, temperature: 0 }
  });
  const metin = veri?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return metin.trim();
}
