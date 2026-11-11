// Kotlin preset specifics: filling in a new app, the launcher icon sizes, and warming the shared
// Gradle caches so the first build of a new Kotlin app does not download or compile from scratch.
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { CACHE_DIR } from './env.mjs';
import { decodePng, encodePng, resizeSquare } from './png.mjs';
import { KOTLIN_META } from './presets.mjs';
import { makeAppTree, templateHash } from './template.mjs';

/** THE icon of a Kotlin app: 1024x1024 PNG at the project root. */
export const KOTLIN_ICON = 'icon.png';

/** Adaptive icon foreground sizes (108 dp) per density. */
const DENSITIES = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
const RES = path.join('app', 'src', 'main', 'res');
const ICON_STAMP = path.join('build', '.anyapp-icon');

/** Android string resource escaping (strings.xml). */
function xmlString(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/@/g, '\\@')
    .replace(/\?/g, '\\?');
}

/** Writes the app's name, slug and package id into a fresh Kotlin app. */
export async function fillKotlinPlaceholders(dir, { name, slug, packageName }) {
  const metaPath = path.join(dir, KOTLIN_META);
  const meta = JSON.parse(await fsp.readFile(metaPath, 'utf8'));
  meta.preset = 'kotlin';
  meta.slug = slug;
  meta.package = packageName;
  await fsp.writeFile(metaPath, JSON.stringify(meta, null, 2) + '\n');

  const stringsPath = path.join(dir, RES, 'values', 'strings.xml');
  const xml = await fsp.readFile(stringsPath, 'utf8');
  await fsp.writeFile(stringsPath, xml.replace('__APP_NAME__', () => xmlString(name)));
}

/**
 * Makes the launcher icon sizes (res/mipmap-<density>/ic_launcher_foreground.png) from icon.png
 * whenever icon.png changed. Throws a plain Error when icon.png cannot be used.
 */
export async function syncKotlinIcon(dir, say = () => {}) {
  const src = path.join(dir, KOTLIN_ICON);
  if (!fs.existsSync(src)) throw new Error(`${KOTLIN_ICON} is missing: the app needs a 1024x1024 PNG icon at the project root (node scripts/make-icon.mjs makes one).`);
  const buf = await fsp.readFile(src);
  const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
  const stampPath = path.join(dir, ICON_STAMP);
  const outs = Object.keys(DENSITIES).map((d) => path.join(dir, RES, `mipmap-${d}`, 'ic_launcher_foreground.png'));
  const have = fs.existsSync(stampPath) ? fs.readFileSync(stampPath, 'utf8').trim() : null;
  if (have === hash && outs.every((o) => fs.existsSync(o))) return false;

  let img;
  try {
    img = decodePng(buf);
  } catch (e) {
    throw new Error(`${KOTLIN_ICON} could not be read (${e.message}). Write a square 8-bit PNG, 1024x1024.`);
  }
  if (img.width !== img.height) throw new Error(`${KOTLIN_ICON} is ${img.width}x${img.height}; it must be square (1024x1024).`);
  for (const [density, size] of Object.entries(DENSITIES)) {
    const out = path.join(dir, RES, `mipmap-${density}`, 'ic_launcher_foreground.png');
    await fsp.mkdir(path.dirname(out), { recursive: true });
    await fsp.writeFile(out, encodePng(resizeSquare(img, size)));
  }
  await fsp.mkdir(path.dirname(stampPath), { recursive: true });
  await fsp.writeFile(stampPath, hash);
  say('Made the launcher icon sizes from icon.png.');
  return true;
}

/**
 * Builds a throwaway Kotlin app once per template version, so Gradle's shared caches (the
 * dependency cache and the local build cache in %USERPROFILE%\.gradle, both safe for concurrent
 * use by design) hold everything a new Kotlin app's first build needs.
 */
export async function warmKotlin(spareRoot, log = () => {}) {
  const hash = templateHash('kotlin');
  const marker = path.join(CACHE_DIR, `kotlin-warm-${hash}`);
  if (fs.existsSync(marker)) return;
  const dir = path.join(spareRoot, `warm-${crypto.randomBytes(4).toString('hex')}`);
  const t0 = Date.now();
  try {
    await makeAppTree(dir, log, 'kotlin');
    await fillKotlinPlaceholders(dir, { name: 'Warm up', slug: 'warmup', packageName: 'com.anyapp.warmup' });
    log('Warming the Gradle caches for Kotlin apps (one build of a throwaway app)…');
    const { buildApk } = await import('../index.mjs');
    await buildApk({ dir, buildNumber: 1 });
    await fsp.mkdir(CACHE_DIR, { recursive: true });
    await fsp.writeFile(marker, new Date().toISOString());
    log(`Kotlin caches warm in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (e) {
    log(`Kotlin warm-up build failed (a new app's first build will just be slower): ${e.message}`);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }).catch(() => {});
  }
}
