#!/usr/bin/env node
// Generates a 128x128 PNG icon for the ContractKit VSCode extension.
// Replicates the geometry in assets/logo-icon.svg (64x64 viewBox, scaled 2x).
const zlib = require('node:zlib');
const fs   = require('node:fs');
const path = require('node:path');

const W = 128, H = 128;
const img = new Uint8ClampedArray(W * H * 4); // RGBA, transparent

function blendPixel(x, y, r, g, b, alpha) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 4;
  const sa = alpha / 255;
  const da = img[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa < 0.001) return;
  img[i]     = Math.round((r * sa + img[i]     * da * (1 - sa)) / oa);
  img[i + 1] = Math.round((g * sa + img[i + 1] * da * (1 - sa)) / oa);
  img[i + 2] = Math.round((b * sa + img[i + 2] * da * (1 - sa)) / oa);
  img[i + 3] = Math.round(oa * 255);
}

// Filled anti-aliased rounded rectangle
function fillRoundedRect(x, y, w, h, rx, r, g, b) {
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) {
      const cx = Math.max(x + rx, Math.min(x + w - rx, px + 0.5));
      const cy = Math.max(y + rx, Math.min(y + h - rx, py + 0.5));
      const dist = Math.hypot((px + 0.5) - cx, (py + 0.5) - cy);
      const alpha = Math.max(0, Math.min(1, rx - dist + 0.5)) * 255;
      if (alpha > 0) blendPixel(px, py, r, g, b, alpha);
    }
  }
}

// Distance from point to line segment
function distToSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

// Anti-aliased polyline stroke with round caps
function strokePolyline(points, thickness, r, g, b) {
  const half = thickness / 2;
  const segs = points.slice(1).map((p, i) => [points[i][0], points[i][1], p[0], p[1]]);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x1, y1, x2, y2] of segs) {
    minX = Math.min(minX, x1, x2);
    minY = Math.min(minY, y1, y2);
    maxX = Math.max(maxX, x1, x2);
    maxY = Math.max(maxY, y1, y2);
  }
  const pad = Math.ceil(half) + 2;
  for (let py = Math.max(0, Math.floor(minY - pad)); py <= Math.min(H - 1, Math.ceil(maxY + pad)); py++) {
    for (let px = Math.max(0, Math.floor(minX - pad)); px <= Math.min(W - 1, Math.ceil(maxX + pad)); px++) {
      let minDist = Infinity;
      for (const [x1, y1, x2, y2] of segs) {
        minDist = Math.min(minDist, distToSeg(px + 0.5, py + 0.5, x1, y1, x2, y2));
      }
      const alpha = Math.max(0, Math.min(1, half - minDist + 0.5)) * 255;
      if (alpha > 0) blendPixel(px, py, r, g, b, alpha);
    }
  }
}

// Anti-aliased filled circle
function fillCircle(cx, cy, radius, r, g, b) {
  const pad = Math.ceil(radius) + 2;
  for (let py = Math.floor(cy - pad); py <= Math.ceil(cy + pad); py++) {
    for (let px = Math.floor(cx - pad); px <= Math.ceil(cx + pad); px++) {
      const dist = Math.hypot((px + 0.5) - cx, (py + 0.5) - cy);
      const alpha = Math.max(0, Math.min(1, radius - dist + 0.5)) * 255;
      if (alpha > 0) blendPixel(px, py, r, g, b, alpha);
    }
  }
}

// ── Render (64×64 SVG coords scaled ×2 to 128×128) ──────────────────────────

// Background: #1e1b4b  rx=14 → 28
fillRoundedRect(0, 0, 128, 128, 28, 30, 27, 75);

// Left brace {  — #e0e7ff = rgb(224, 231, 255), stroke-width 3.5 → 7
strokePolyline([[58,20],[42,20],[42,42],[26,64],[42,86],[42,108],[58,108]], 7, 224, 231, 255);

// Right brace } — same color
strokePolyline([[70,20],[86,20],[86,42],[102,64],[86,86],[86,108],[70,108]], 7, 224, 231, 255);

// Center "ck" monogram — #818cf8 = rgb(129, 140, 248)
// Drawn as geometric strokes matching the brace style, stroke-width 3
// "c": three sides of a rectangle (top, left, bottom), open on the right
//   x: 49–62, y: 56–72
strokePolyline([[62,56],[49,56],[49,72],[62,72]], 3, 129, 140, 248);
// "k": vertical + two diagonals from midpoint
//   x: 66–80, y: 56–72
strokePolyline([[66,56],[66,72]], 3, 129, 140, 248);
strokePolyline([[66,64],[80,56]], 3, 129, 140, 248);
strokePolyline([[66,64],[80,72]], 3, 129, 140, 248);

// ── PNG encode ───────────────────────────────────────────────────────────────

function crc32(data) {
  if (!crc32.table) {
    crc32.table = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      crc32.table[i] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < data.length; i++) crc = crc32.table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([len, typeBytes, data, crcBuf]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA

const raw = Buffer.alloc(H * (1 + W * 4));
for (let y = 0; y < H; y++) {
  raw[y * (1 + W * 4)] = 0; // filter None
  for (let x = 0; x < W; x++) {
    const si = (y * W + x) * 4;
    const di = y * (1 + W * 4) + 1 + x * 4;
    raw.set(img.slice(si, si + 4), di);
  }
}

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  pngChunk('IHDR', ihdr),
  pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  pngChunk('IEND', Buffer.alloc(0)),
]);

const outPath = path.resolve(__dirname, '../apps/vscode-extension/images/icon.png');
fs.writeFileSync(outPath, png);
console.log(`Icon written to ${outPath}`);
