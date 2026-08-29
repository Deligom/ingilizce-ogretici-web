// Sinav parcalarini onceden cozumleyip data/cozumler.json'a yazar.
// Boylece uygulama ilk acilistan itibaren bu metinleri cevrimdisi acabilir ve
// kullanicinin kotasindan tek istek bile harcanmaz.
//
// Calistir:  node arac/cozum-uret.js
// Proxy uzerinden gider; anahtar burada durmaz.

const fs = require("fs");
const path = require("path");

const PROXY = process.env.PROXY || "https://ingilizce-ogretici-web.vercel.app/api/gemini";
const MODEL = process.env.MODEL || "gemini-3.1-flash-lite";
const PARTI = 4;          // app.js'teki COZUM_PARTI ile ayni olmali
const BEKLEME = 1500;     // dakikalik sinira takilmamak icin partiler arasi bekleme

const kok = path.join(__dirname, "..");

// --- app.js'teki metniIsle ve kucult ile BIREBIR ayni olmali,
//     yoksa onbellek anahtarlari tutmaz ve cozumler bulunamaz. ---
function cumlelereBol(metin) {
  return String(metin)
    .split(/\n{2,}/)
    .filter(p => p.trim())
    .flatMap(paragraf => paragraf.match(/[^.!?]+[.!?]*\s*/g) || [paragraf])
    .map(c => c.trim())
    .filter(Boolean);
}
const kucult = (s) => String(s).toLowerCase().trim();

const SISTEM = `Sen Türkçe konuşan bir yetişkine İngilizce öğreten bir öğretmensin.
Öğrenci okuduğunu anlıyor ama kuralları bilmiyor; Türkçe dilbilgisi terimlerinde de
zorlanıyor, ama Türkçeyi sezgisel biliyor. Kuralları şöyle anlat:

- Sade Türkçe anlat, terimi parantezde ver.
- Türkçeyle karşılaştır.
- Kural cümlesi en fazla iki cümle olsun.
- Her açıklamada bir tuzak söyle: Türkçe konuşanın burada tipik olarak ne hata yaptığı.
- Asla doldurma cümlesi kurma, doğrudan cevaba gir.`;

const SEMA = {
  type: "object",
  properties: {
    cumleler: {
      type: "array",
      items: {
        type: "object",
        properties: {
          cumle: { type: "string" },
          parcalar: {
            type: "array",
            items: {
              type: "object",
              properties: { metin: { type: "string" }, rol: { type: "string" }, aciklama: { type: "string" } },
              required: ["metin", "rol", "aciklama"]
            }
          },
          turkce: { type: "string" }
        },
        required: ["cumle", "parcalar", "turkce"]
      }
    },
    zorKelimeler: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kelime: { type: "string" }, anlam: { type: "string" }, tur: { type: "string" },
          cumledekiRol: { type: "string" }, ornek: { type: "string" }
        },
        required: ["kelime", "anlam", "tur", "cumledekiRol", "ornek"]
      }
    }
  },
  required: ["cumleler", "zorKelimeler"]
};

async function partiyiCozumle(parti, deneme = 0) {
  const istek = `Aşağıdaki cümleleri tek tek çözümle. Cümleleri verildiği sırayla ve
"cumle" alanına birebir aynı metinle döndür.

${parti.map((c, i) => `${i + 1}. ${c}`).join("\n")}

Kurallar:
- Parçaları soldan sağa, cümledeki sırayla ver; birleştirince cümlenin tamamı çıksın.
- Kelime kelime bölme; anlam taşıyan öbekleri bir arada tut ("in the morning" tek parça).
- Rol etiketini Türkçe soru kalıbıyla yaz: kim, ne yapıyor, neyi, nerede, ne zaman, nasıl.
  Yardımcı fiil ve edat gibi parçalar için "bağlayıcı" yaz.
- zorKelimeler alanına, bu metinde Türkçe konuşan bir A2 öğrencisini zorlayacak
  kelimeleri koy. Kolay kelimeleri (the, is, my, good gibi) koyma.`;

  const yanit = await fetch(PROXY, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      systemInstruction: { parts: [{ text: SISTEM }] },
      contents: [{ role: "user", parts: [{ text: istek }] }],
      generationConfig: {
        responseMimeType: "application/json", responseSchema: SEMA,
        temperature: 0.2, maxOutputTokens: 8192
      }
    })
  });

  if (!yanit.ok) {
    const govde = await yanit.text().catch(() => "");
    if ((yanit.status === 429 || yanit.status >= 500) && deneme < 3) {
      const bekle = 5000 * (deneme + 1);
      console.log(`    ${yanit.status} geldi, ${bekle / 1000}sn sonra tekrar…`);
      await new Promise(r => setTimeout(r, bekle));
      return partiyiCozumle(parti, deneme + 1);
    }
    throw new Error(`${yanit.status}: ${govde.slice(0, 160)}`);
  }

  const veri = await yanit.json();
  const metin = veri?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!metin) throw new Error("boş cevap");
  return JSON.parse(metin);
}

(async () => {
  const test = JSON.parse(fs.readFileSync(path.join(kok, "data", "teshis-testi.json"), "utf8"));
  const eskiYol = path.join(kok, "data", "cozumler.json");
  const cikti = fs.existsSync(eskiYol) && process.env.SADECE
    ? JSON.parse(fs.readFileSync(eskiYol, "utf8"))
    : { surum: 1, model: MODEL, tarih: new Date().toISOString(), cumleler: {}, kelimeler: {} };

  const sadece = (process.env.SADECE || "").split(",").filter(Boolean);
  for (const parca of test.parcalar.filter(p => !sadece.length || sadece.includes(p.id))) {
    const cumleler = cumlelereBol(parca.metin);
    console.log(`\n${parca.id}: ${cumleler.length} cümle`);

    for (let i = 0; i < cumleler.length; i += PARTI) {
      const parti = cumleler.slice(i, i + PARTI);
      process.stdout.write(`  ${i + 1}-${i + parti.length}… `);
      try {
        const veri = await partiyiCozumle(parti);
        let eslesen = 0;
        const donen = veri.cumleler || [];
        // Model cumleyi bazen kirpiyor (bastaki paragraf numarasi, tirnak isareti).
        // Sayilar tutuyorsa sıraya guvenmek en saglami.
        const sirayaGuven = donen.length === parti.length;
        for (const [n, c] of donen.entries()) {
          const hedef = parti.find(x => x === c.cumle)
            || parti.find(x => x.replace(/\s+/g, " ") === String(c.cumle).replace(/\s+/g, " "))
            || parti.find(x => x.startsWith(String(c.cumle).slice(0, 24)))
            || (sirayaGuven ? parti[n] : null);
          if (!hedef) continue;
          cikti.cumleler[kucult(hedef)] = { parcalar: c.parcalar, turkce: c.turkce };
          eslesen++;
        }
        for (const k of veri.zorKelimeler || []) {
          const a = kucult(k.kelime);
          if (!cikti.kelimeler[a]) {
            cikti.kelimeler[a] = {
              kelime: a, anlam: k.anlam, tur: k.tur,
              cumledekiRol: k.cumledekiRol, ornek: k.ornek
            };
          }
        }
        console.log(`${eslesen}/${parti.length} eşleşti`);
      } catch (hata) {
        console.log(`HATA: ${hata.message}`);
      }
      await new Promise(r => setTimeout(r, BEKLEME));
    }
  }

  const yol = path.join(kok, "data", "cozumler.json");
  fs.writeFileSync(yol, JSON.stringify(cikti, null, 1) + "\n");
  const boyut = (fs.statSync(yol).size / 1024).toFixed(0);
  console.log(`\nyazıldı: data/cozumler.json`);
  console.log(`  ${Object.keys(cikti.cumleler).length} cümle · ${Object.keys(cikti.kelimeler).length} kelime · ${boyut} KB`);
})();
