#!/usr/bin/env node
/**
 * Rasterize scripts/icon.svg into the four PNGs the PWA manifest expects.
 * Run with: node scripts/generate-icons.mjs
 *
 * Why: vite.config.ts manifest references pwa-192x192.png, pwa-512x512.png,
 * pwa-512x512-maskable.png, and apple-touch-icon.png — none of which exist
 * in public/. Without them iOS Add-to-Home-Screen falls back to a screenshot
 * thumbnail (ugly), and Android PWA install gets a broken icon. The maskable
 * variant has 12% extra padding so it survives Android's circular/squircle
 * masking.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(__dirname);
const SRC = join(ROOT, 'scripts/icon.svg');
const OUT = join(ROOT, 'public');

const svg = await readFile(SRC);

async function render(size, fileName, options = {}) {
  const { padding = 0, backgroundColor } = options;
  if (padding === 0) {
    const buf = await sharp(svg, { density: 384 }).resize(size, size).png().toBuffer();
    await writeFile(join(OUT, fileName), buf);
  } else {
    // Maskable: shrink the artwork so the brand color extends to the edges
    // and still has a safe zone after the platform's circular crop.
    const inner = Math.round(size * (1 - padding * 2));
    const offset = Math.round((size - inner) / 2);
    const innerBuf = await sharp(svg, { density: 384 }).resize(inner, inner).png().toBuffer();
    const buf = await sharp({
      create: { width: size, height: size, channels: 4, background: backgroundColor },
    })
      .composite([{ input: innerBuf, left: offset, top: offset }])
      .png()
      .toBuffer();
    await writeFile(join(OUT, fileName), buf);
  }
  console.log(`wrote ${fileName} (${size}x${size}${padding ? ` padding ${padding * 100}%` : ''})`);
}

await render(192, 'pwa-192x192.png');
await render(512, 'pwa-512x512.png');
await render(512, 'pwa-512x512-maskable.png', { padding: 0.12, backgroundColor: '#0b3b5e' });
await render(180, 'apple-touch-icon.png');

console.log('done');
