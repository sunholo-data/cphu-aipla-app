#!/usr/bin/env node
/**
 * Assert every home-screen icon is OPAQUE to its corners.
 *
 * This exists because the PWA shipped (v0.1.18, 2026-08-13) with icons
 * generated from the rounded `aipla-mark.svg`, so their corners were
 * rgba(0,0,0,0). iOS requires an opaque square for `apple-touch-icon` — it
 * applies its own rounding — and given transparency it composites against
 * black or drops the icon in favour of a screenshot of the page. The symptom
 * is silent: you only find out when someone adds it to their home screen and
 * gets a blank tile.
 *
 * Nothing in lint, typecheck or the test suite can see inside a PNG, so the
 * check reads the pixels. Pure Node — decodes the PNG's IHDR + IDAT far enough
 * to sample the four corners, no dependency and no browser.
 *
 * Run: node scripts/check-pwa-icons.mjs   (also `make check-pwa-icons`)
 */
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "frontend/public/images/logo");

/** Icons that land on a home screen or launcher. The favicon is excluded on
 *  purpose: transparency is correct in a browser tab. */
const ICONS = ["apple-touch-icon.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png"];

function decode(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`unsupported colour type ${colorType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  // Undo the per-scanline PNG filters.
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[y * stride + x - channels] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? out[(y - 1) * stride + x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + x] = v & 0xff;
    }
  }
  return { width, height, channels, pixels: out, hasAlpha: colorType === 4 || colorType === 6 };
}

function alphaAt(img, x, y) {
  if (!img.hasAlpha) return 255;
  const i = y * img.width * img.channels + x * img.channels;
  return img.pixels[i + img.channels - 1];
}

let failed = 0;
for (const name of ICONS) {
  let img;
  try {
    img = decode(readFileSync(join(dir, name)));
  } catch (err) {
    console.error(`FAIL ${name}: ${err.message}`);
    failed++;
    continue;
  }
  const { width: w, height: h } = img;
  const corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]].map(([x, y]) => alphaAt(img, x, y));
  const min = Math.min(...corners);
  if (min < 255) {
    console.error(
      `FAIL ${name}: corner alpha ${min}/255 — transparent corners. iOS rounds the icon ` +
      `itself; a transparent apple-touch-icon shows as a blank tile. Run scripts/generate-pwa-icons.sh.`,
    );
    failed++;
  } else {
    console.log(`ok   ${name} ${w}x${h} — opaque to the corners`);
  }
}

if (failed) {
  console.error(`\n${failed} icon(s) would render blank on a home screen.`);
  process.exit(1);
}
console.log("\nAll home-screen icons are opaque.");
