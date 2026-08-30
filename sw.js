// Service worker. Amac: uygulama kabugu ve veri dosyalari cevrimdisi acilsin.
// AI cagrilari asla onbelleklenmez; onlarin onbellegi zaten IndexedDB'de.
const SURUM = "wordnexus-v4";

// Goreli yollar: site alt dizinde yayinlanabilir (GitHub Pages).
const KABUK = [
  "./",
  "./index.html",
  "./app.js",
  "./db.js",
  "./ai.js",
  "./tekrar.js",
  "./uretim.js",
  "./quiz.js",
  "./manifest.json",
  "./data/konular.json",
  "./data/sorular.json",
  "./data/teshis-testi.json",
  "./data/cozumler.json",
  "./ikon/ikon-192.png",
  "./ikon/ikon-512.png"
];

self.addEventListener("install", (olay) => {
  olay.waitUntil((async () => {
    const onbellek = await caches.open(SURUM);
    // Tek tek ekleriz: bir dosya bulunamazsa kurulumun tamami cokmesin.
    await Promise.all(KABUK.map(yol =>
      onbellek.add(new Request(yol, { cache: "reload" })).catch(() => null)));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (olay) => {
  olay.waitUntil((async () => {
    const adlar = await caches.keys();
    await Promise.all(adlar.filter(a => a !== SURUM).map(a => caches.delete(a)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (olay) => {
  const istek = olay.request;
  if (istek.method !== "GET") return;

  const url = new URL(istek.url);

  // AI proxy'si asla onbelleklenmez.
  if (url.pathname.startsWith("/api/")) return;

  // Gezinme: once agi dene, olmazsa onbellekteki kabugu ver.
  // Boylece yeni surum yayinlaninca kullanici eski surumde takili kalmaz.
  if (istek.mode === "navigate") {
    olay.respondWith((async () => {
      try {
        const yanit = await fetch(istek);
        const onbellek = await caches.open(SURUM);
        onbellek.put("./index.html", yanit.clone());
        return yanit;
      } catch {
        return (await caches.match("./index.html")) || Response.error();
      }
    })());
    return;
  }

  // Kendi kodumuz ve verimiz: once ag, olmazsa onbellek. Boylece yeni surum
  // yayinlanir yayinlanmaz gorunur; cevrimdisiyken de calismaya devam eder.
  // (Onbellek-once olsaydi kullanici guncellemeyi bir acilis geriden gorurdu.)
  const bizim = url.origin === location.origin;

  olay.respondWith((async () => {
    if (bizim) {
      try {
        const yanit = await fetch(istek);
        if (yanit && yanit.ok) {
          caches.open(SURUM).then(o => o.put(istek, yanit.clone())).catch(() => {});
        }
        return yanit;
      } catch {
        return (await caches.match(istek)) || Response.error();
      }
    }

    // Disaridan gelenler (yazi tipleri, CDN modulleri): onbellek once, arkada tazele.
    const onbellekteki = await caches.match(istek);
    const agdan = fetch(istek).then(yanit => {
      if (yanit && yanit.ok) {
        caches.open(SURUM).then(o => o.put(istek, yanit.clone())).catch(() => {});
      }
      return yanit;
    }).catch(() => null);

    return onbellekteki || (await agdan) || Response.error();
  })());
});
