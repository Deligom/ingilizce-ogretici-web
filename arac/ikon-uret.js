// PWA ikonlarini uretir. Calistir: node arac/ikon-uret.js
// PWA ikonlarini uretir. Disaridan kutuphane yok: ham piksel + zlib ile PNG yazar.
// Motif projenin cikis noktasi: "Underline the new words" — duz bir satir,
// altinda fosforlu kalemle isaretlenmis bir satir.
const fs = require("fs");
const zlib = require("zlib");

const MUREKKEP = [0x16, 0x23, 0x3a];
const FOSFORLU = [0xff, 0xe4, 0x5c];
const ACIK = [0xf6, 0xf7, 0xf9];

// --- PNG yazici ---
const crcTablosu = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTablosu[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function parca(tur, veri) {
  const uzunluk = Buffer.alloc(4);
  uzunluk.writeUInt32BE(veri.length);
  const govde = Buffer.concat([Buffer.from(tur, "ascii"), veri]);
  const kontrol = Buffer.alloc(4);
  kontrol.writeUInt32BE(crc32(govde));
  return Buffer.concat([uzunluk, govde, kontrol]);
}

function pngYaz(genislik, yukseklik, piksel) {   // piksel: RGB, satir satir
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(genislik, 0);
  ihdr.writeUInt32BE(yukseklik, 4);
  ihdr[8] = 8;    // bit derinligi
  ihdr[9] = 2;    // renk turu: truecolor RGB
  const satirlar = Buffer.alloc(yukseklik * (1 + genislik * 3));
  for (let y = 0; y < yukseklik; y++) {
    satirlar[y * (1 + genislik * 3)] = 0;   // filtre: yok
    piksel.copy(satirlar, y * (1 + genislik * 3) + 1, y * genislik * 3, (y + 1) * genislik * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    parca("IHDR", ihdr),
    parca("IDAT", zlib.deflateSync(satirlar, { level: 9 })),
    parca("IEND", Buffer.alloc(0))
  ]);
}

// --- cizim ---
function ikon(boyut) {
  const piksel = Buffer.alloc(boyut * boyut * 3);
  const koy = (x, y, renk) => {
    if (x < 0 || y < 0 || x >= boyut || y >= boyut) return;
    const i = (y * boyut + x) * 3;
    piksel[i] = renk[0]; piksel[i + 1] = renk[1]; piksel[i + 2] = renk[2];
  };
  const dikdortgen = (x0, y0, x1, y1, renk, yuvarlak = 0) => {
    const r = yuvarlak * boyut;
    for (let y = Math.round(y0 * boyut); y < Math.round(y1 * boyut); y++) {
      for (let x = Math.round(x0 * boyut); x < Math.round(x1 * boyut); x++) {
        if (r > 0) {
          const kx = Math.min(x - x0 * boyut, x1 * boyut - 1 - x);
          const ky = Math.min(y - y0 * boyut, y1 * boyut - 1 - y);
          if (kx < r && ky < r) {
            const dx = r - kx, dy = r - ky;
            if (dx * dx + dy * dy > r * r) continue;
          }
        }
        koy(x, y, renk);
      }
    }
  };

  // zemin
  dikdortgen(0, 0, 1, 1, MUREKKEP);
  // iki metin satiri
  dikdortgen(0.26, 0.29, 0.74, 0.355, ACIK, 0.032);
  dikdortgen(0.26, 0.45, 0.66, 0.515, ACIK, 0.032);
  // ikincinin altini cizen fosforlu kalem: "Underline the new words"
  dikdortgen(0.26, 0.585, 0.66, 0.675, FOSFORLU, 0.03);

  return pngYaz(boyut, boyut, piksel);
}

const kok = require("path").join(__dirname, "..", "ikon") + require("path").sep;
fs.mkdirSync(kok, { recursive: true });
for (const boyut of [192, 512, 180]) {
  const dosya = kok + "ikon-" + boyut + ".png";
  fs.writeFileSync(dosya, ikon(boyut));
  console.log(dosya, fs.statSync(dosya).size + " bayt");
}
