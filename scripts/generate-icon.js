/**
 * Generates media/agenticproxy.png (128x128 RGBA) — the AgenticProxy marketplace icon.
 * Pure Node (zlib), no external deps.
 *
 * Run: node scripts/generate-icon.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 128;

// RGBA canvas, transparent
const pixels = Buffer.alloc(SIZE * SIZE * 4, 0);

function blend(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  const d = pixels[i + 3] / 255;
  const sa = a / 255;
  const outA = sa + d * (1 - sa);
  if (outA <= 0) { pixels[i + 3] = 0; return; }
  pixels[i] = Math.round((r * sa + pixels[i] * d * (1 - sa)) / outA);
  pixels[i + 1] = Math.round((g * sa + pixels[i + 1] * d * (1 - sa)) / outA);
  pixels[i + 2] = Math.round((b * sa + pixels[i + 2] * d * (1 - sa)) / outA);
  pixels[i + 3] = Math.round(outA * 255);
}

function roundedRectFilled(x0, y0, w, h, rr, r, g, b, a) {
  for (let y = Math.floor(y0); y < y0 + h; y++) {
    for (let x = Math.floor(x0); x < x0 + w; x++) {
      const dx = Math.max(x0 + rr - x, 0, x - (x0 + w - 1 - rr));
      const dy = Math.max(y0 + rr - y, 0, y - (y0 + h - 1 - rr));
      if (dx * dx + dy * dy <= rr * rr + rr) blend(x, y, r, g, b, a);
    }
  }
}

function circleFilled(cx, cy, radius, r, g, b, a) {
  const r2 = radius * radius;
  for (let y = Math.floor(cx - radius); y <= cy + radius; y++) {
    for (let x = Math.floor(cx - radius); x <= cx + radius; x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= r2 + 0.5) blend(x, y, r, g, b, a);
    }
  }
}

function thickLine(x0, y0, x1, y1, w, r, g, b, a) {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const minX = Math.floor(Math.min(x0, x1) - w), maxX = Math.ceil(Math.max(x0, x1) + w);
  const minY = Math.floor(Math.min(y0, y1) - w), maxY = Math.ceil(Math.max(y0, y1) + w);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x - x0, py = y - y0;
      const t = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)));
      const cx = x0 + t * dx, cy = y0 + t * dy;
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (d <= w) blend(x, y, r, g, b, a);
    }
  }
}

// ---------- Draw ----------
// Background: rounded square, vertical gradient #0e639c -> #1a4a7a
for (let y = 4; y < SIZE - 4; y++) {
  for (let x = 4; x < SIZE - 4; x++) {
    const rr = 28, x0 = 4, y0 = 4, w = SIZE - 8, h = SIZE - 8;
    const dx = Math.max(x0 + rr - x, 0, x - (x0 + w - 1 - rr));
    const dy = Math.max(y0 + rr - y, 0, y - (y0 + h - 1 - rr));
    if (dx * dx + dy * dy <= rr * rr) {
      const t2 = (y - y0) / (h - 1);
      const r = Math.round(0x0e + (0x1a - 0x0e) * t2);
      const g = Math.round(0x63 + (0x4a - 0x63) * t2);
      const b = Math.round(0x9c + (0x7a - 0x9c) * t2);
      blend(x, y, r, g, b, 255);
    }
  }
}

// Plug body
roundedRectFilled(38, 36, 52, 58, 8, 255, 255, 255, 255);
// Prongs (top)
roundedRectFilled(46, 14, 10, 22, 3, 255, 255, 255, 255);
roundedRectFilled(72, 14, 10, 22, 3, 255, 255, 255, 255);
// Ground prong (bottom)
roundedRectFilled(56, 94, 16, 18, 4, 255, 255, 255, 255);

// Cable (soft white)
thickLine(64, 112, 40, 122, 4, 230, 236, 245, 220);

// Connection dots
circleFilled(20, 64, 8, 255, 255, 255, 255);
circleFilled(108, 64, 8, 255, 255, 255, 255);

// Connection lines
thickLine(32, 64, 64, 64, 3, 255, 255, 255, 255);
thickLine(64, 64, 108, 64, 3, 255, 255, 255, 255);

// ---------- PNG encode ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // RGBA
ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

const stride = SIZE * 4 + 1;
const raw = Buffer.alloc(stride * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * stride] = 0; // filter: none
  pixels.copy(raw, y * stride + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0))
]);

const outPath = path.join(__dirname, '..', 'media', 'agenticproxy.png');
fs.writeFileSync(outPath, png);
console.log('Written', outPath, `(${png.length} bytes)`);