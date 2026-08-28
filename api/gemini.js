// Gemini proxy. Anahtar sunucuda kalir, tarayiciya hic inmez.
// Vercel Node calisma ortami (CommonJS; package.json gerekmesin diye).
//
// Ortam degiskenleri:
//   GEMINI_API_KEY  (zorunlu)  Vercel panelinden eklenir, repoya yazilmaz.
//   GUNLUK_SINIR    (istege bagli, varsayilan 100) IP basina gunluk istek.

const MODEL = "gemini-2.5-flash";
const KOK = "https://generativelanguage.googleapis.com/v1beta/models/";
const GUNLUK_SINIR = Number(process.env.GUNLUK_SINIR || 100);
const EN_BUYUK_GOVDE = 60000;      // karakter
// gemini-2.5-flash dusunen bir model: cevap yazmadan once "dusunme" tokeni
// harcar ve bu da bu butceden duser. Tavan dar olursa cevap bos doner
// (finishReason: MAX_TOKENS). Uretimde 10 soru istenebiliyor, genis tutuyoruz.
const EN_COK_TOKEN = 8192;

// DIKKAT: bu sayac sunucu ornegi bellegindedir. Vercel yeni bir ornek
// baslattiginda sifirlanir ve ornekler arasinda paylasilmaz, yani kesin bir
// sinir degil, kotuye kullanimi zorlastiran bir frendir. Gercek sinir icin
// buraya bir Redis (Upstash) baglanmali; degistirilecek tek yer asagidaki
// sayacAl/sayacArtir ciftidir.
const sayaclar = new Map();

function bugun() { return new Date().toISOString().slice(0, 10); }

function sayacAl(ip) {
  const k = sayaclar.get(ip);
  return k && k.gun === bugun() ? k.sayi : 0;
}

function sayacArtir(ip) {
  const gun = bugun();
  const k = sayaclar.get(ip);
  const sayi = (k && k.gun === gun ? k.sayi : 0) + 1;
  sayaclar.set(ip, { gun, sayi });
  // Bellek sismesin: gun degisince eski kayitlari at.
  if (sayaclar.size > 5000) {
    for (const [anahtar, deger] of sayaclar) if (deger.gun !== gun) sayaclar.delete(anahtar);
  }
  return sayi;
}

// Istemciden gelen govdeden yalnizca bekledigimiz alanlari geciririz;
// baska parametrelerle proxy baska islere kosulmasin.
function govdeyiSuz(g) {
  if (!g || typeof g !== "object") return null;
  if (!Array.isArray(g.contents) || !g.contents.length) return null;

  const suzulmus = { contents: g.contents };
  if (g.systemInstruction) suzulmus.systemInstruction = g.systemInstruction;

  if (g.generationConfig && typeof g.generationConfig === "object") {
    const c = g.generationConfig;
    suzulmus.generationConfig = {
      ...(c.responseMimeType ? { responseMimeType: c.responseMimeType } : {}),
      ...(c.responseSchema ? { responseSchema: c.responseSchema } : {}),
      ...(typeof c.temperature === "number"
        ? { temperature: Math.max(0, Math.min(2, c.temperature)) } : {}),
      maxOutputTokens: Math.min(Number(c.maxOutputTokens) || EN_COK_TOKEN, EN_COK_TOKEN)
    };
  }
  return suzulmus;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({ hata: "Yalnızca POST kabul edilir." });
  }

  const anahtar = process.env.GEMINI_API_KEY;
  if (!anahtar) {
    return res.status(500).json({
      hata: "Sunucuda GEMINI_API_KEY tanımlı değil. Ayarlar'dan kendi anahtarını girebilirsin.",
      kod: "sunucuanahtaryok"
    });
  }

  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim()
    || req.socket?.remoteAddress || "bilinmeyen";

  if (sayacAl(ip) >= GUNLUK_SINIR) {
    return res.status(429).json({
      hata: `Günlük ${GUNLUK_SINIR} istek sınırına ulaştın. Yarın sıfırlanır; ` +
            `beklemek istemiyorsan Ayarlar'dan kendi Gemini anahtarını girebilirsin.`,
      kod: "gunlukSinir"
    });
  }

  let govde = req.body;
  if (typeof govde === "string") {
    try { govde = JSON.parse(govde); } catch { govde = null; }
  }

  const suzulmus = govdeyiSuz(govde);
  if (!suzulmus) return res.status(400).json({ hata: "Geçersiz istek gövdesi." });

  const metin = JSON.stringify(suzulmus);
  if (metin.length > EN_BUYUK_GOVDE) {
    return res.status(413).json({ hata: "İstek fazla büyük." });
  }

  const kullanilan = sayacArtir(ip);

  try {
    const yanit = await fetch(KOK + MODEL + ":generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": anahtar },
      body: metin
    });

    const veri = await yanit.json().catch(() => null);
    res.setHeader("X-Kalan-Istek", String(Math.max(0, GUNLUK_SINIR - kullanilan)));

    if (!yanit.ok) {
      // Google'in hata metnini oldugu gibi gecirmeyiz; anahtar bilgisi sizabilir.
      const kod = yanit.status === 429 ? "kota" : "sunucu";
      return res.status(yanit.status).json({
        hata: yanit.status === 429
          ? "Paylaşılan günlük kota doldu. Yarın tekrar dene ya da kendi anahtarını gir."
          : `Gemini hatası (${yanit.status}).`,
        kod
      });
    }

    return res.status(200).json(veri);
  } catch {
    return res.status(502).json({ hata: "Gemini'ye ulaşılamadı.", kod: "ag" });
  }
};
