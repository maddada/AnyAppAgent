// The kinds of app the builder makes:
//   react-native (default): template/ (Expo / React Native, with Kotlin modules)
//   kotlin:                 template-kotlin/ (native Android: Kotlin, Jetpack Compose, Material 3)
//   expo-exact (alpha):     `exact new` from a pinned Expo Exact checkout, plus template-exact/ (lib/exact.mjs)
//   web:                    template-web/ (Vite, React, TypeScript; a static site, lib/web.mjs)
//   game:                   template-kotlin/ with template-game/ on top (a Kotlin and Compose
//                           Multiplatform game: game/ plus the Android app/; built like kotlin)
import fs from 'node:fs';
import path from 'node:path';

import { BUILDER_DIR, TEMPLATE_DIR } from './env.mjs';

export const PRESETS = ['react-native', 'kotlin', 'expo-exact', 'web', 'game'];
export const DEFAULT_PRESET = 'react-native';

/** The Kotlin template. ANYAPP_KOTLIN_TEMPLATE_DIR overrides it. */
export const KOTLIN_TEMPLATE_DIR = process.env.ANYAPP_KOTLIN_TEMPLATE_DIR
  ? path.resolve(process.env.ANYAPP_KOTLIN_TEMPLATE_DIR)
  : path.resolve(BUILDER_DIR, '..', 'template-kotlin');

/** The web template. ANYAPP_WEB_TEMPLATE_DIR overrides it. */
export const WEB_TEMPLATE_DIR = process.env.ANYAPP_WEB_TEMPLATE_DIR
  ? path.resolve(process.env.ANYAPP_WEB_TEMPLATE_DIR)
  : path.resolve(BUILDER_DIR, '..', 'template-web');

/** The game template, laid over the Kotlin one. ANYAPP_GAME_TEMPLATE_DIR overrides it. */
export const GAME_TEMPLATE_DIR = process.env.ANYAPP_GAME_TEMPLATE_DIR
  ? path.resolve(process.env.ANYAPP_GAME_TEMPLATE_DIR)
  : path.resolve(BUILDER_DIR, '..', 'template-game');

/**
 * How a game app is made from the Kotlin template before template-game/ is copied on top: the
 * Kotlin AGENTS.md becomes ANDROID.md (the guide to the Android app around the game), and the
 * starter screen the game replaces is left out.
 */
export const GAME_FROM_KOTLIN = {
  rename: { 'AGENTS.md': 'ANDROID.md' },
  drop: new Set([path.join('app', 'src', 'main', 'java', 'com', 'anyapp', 'app', 'ui', 'HomeScreen.kt'), 'README.md']),
};

/** Kotlin and game apps: one Gradle project with the Android app in app/, built the same way. */
export function isKotlinLike(preset) {
  return preset === 'kotlin' || preset === 'game';
}

/** The file a Kotlin, Expo Exact or web app keeps its preset, slug and package id in (the builder writes it). */
export const KOTLIN_META = 'anyapp.json';

export function checkPreset(preset) {
  const p = preset ?? DEFAULT_PRESET;
  if (!PRESETS.includes(p)) throw new Error(`unknown preset "${preset}" (use ${PRESETS.join(' or ')})`);
  return p;
}

export function templateDirFor(preset) {
  const p = checkPreset(preset);
  return p === 'kotlin' ? KOTLIN_TEMPLATE_DIR : p === 'game' ? GAME_TEMPLATE_DIR : p === 'web' ? WEB_TEMPLATE_DIR : TEMPLATE_DIR;
}

/** Template folders that are never copied (generated, installed or build output), by relative path. */
export function skipFor(preset) {
  const p = checkPreset(preset);
  if (p === 'web') return new Set(['node_modules', 'build', 'dist', '.git']);
  if (p === 'game') return new Set(['build', '.gradle', '.kotlin', '.idea', '.git', 'local.properties', path.join('app', 'build'), path.join('game', 'build')]);
  return p === 'kotlin'
    ? new Set(['build', '.gradle', '.kotlin', '.idea', '.git', 'local.properties', path.join('app', 'build')])
    : new Set(['node_modules', 'build', 'android', 'ios', '.expo', 'dist', '.git']);
}

/** Reads an app's anyapp.json ({ preset, slug, package }), or null. */
export function readAppMeta(dir) {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, KOTLIN_META), 'utf8'));
    return PRESETS.includes(meta?.preset) ? meta : null;
  } catch {
    return null;
  }
}

/** Reads a Kotlin (or game) app's anyapp.json, or null. */
export function readKotlinMeta(dir) {
  const meta = readAppMeta(dir);
  return isKotlinLike(meta?.preset) ? meta : null;
}

/** Which preset an existing app folder was made from. */
export function presetOf(dir) {
  const meta = readAppMeta(dir);
  if (meta) return meta.preset;
  if (fs.existsSync(path.join(dir, 'app.json'))) return 'react-native';
  return null;
}
