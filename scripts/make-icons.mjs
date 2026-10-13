// Рисует PNG-иконки (лапка на мятном фоне) без сторонних библиотек.
// Запуск: node scripts/make-icons.mjs — файлы появятся в public/.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [0xD4, 0xF0, 0xDE], INK = [0x2A, 0x1E, 0x12];
// Те же фигуры, что в public/icon.svg, в координатах 512×512.
// Лапка чуть уменьшена к центру, чтобы влезать в «безопасную зону» круглых иконок Android.
const SHAPES = [[256, 318, 92, 78], [138, 218, 38, 48], [374, 218, 38, 48], [202, 132, 36, 46], [310, 132, 36, 46]];

function draw(size, scale) {
  const px = Buffer.alloc(size * size * 4);
  const SS = 4; // сглаживание: 4×4 проверки на пиксель
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const u = ((x + (sx + 0.5) / SS) / size) * 512, v = ((y + (sy + 0.5) / SS) / size) * 512;
        const cu = 256 + (u - 256) / scale, cv = 256 + (v - 256) / scale;
        if (SHAPES.some(([cx, cy, rx, ry]) => ((cu - cx) / rx) ** 2 + ((cv - cy) / ry) ** 2 <= 1)) hits++;
      }
      const a = hits / (SS * SS), i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) px[i + c] = Math.round(BG[c] * (1 - a) + INK[c] * a);
      px[i + 3] = 255;
    }
  }
  return px;
}

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = buf => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, scale) {
  const px = draw(size, scale);
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const out = new URL('../public/', import.meta.url);
writeFileSync(new URL('icon-192.png', out), png(192, 0.8));
writeFileSync(new URL('icon-512.png', out), png(512, 0.8));
writeFileSync(new URL('apple-touch-icon.png', out), png(180, 0.9));
console.log('Иконки готовы: icon-192.png, icon-512.png, apple-touch-icon.png');
