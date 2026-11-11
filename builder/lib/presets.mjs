// The two kinds of app the builder makes:
//   react-native (default): template/ (Expo / React Native, with Kotlin modules)
//   kotlin:                 template-kotlin/ (native Android: Kotlin, Jetpack Compose, Material 3)
import fs from 'node:fs';
import path from 'node:path';

import { BUILDER_DIR, TEMPLATE_DIR } from './env.mjs';

export const PRESETS = ['react-native', 'kotlin'];
export const DEFAULT_PRESET = 'react-native';

/** The Kotlin template. ANYAPP_KOTLIN_TEMPLATE_DIR overrides it. */
export const KOTLIN_TEMPLATE_DIR = process.env.ANYAPP_KOTLIN_TEMPLATE_DIR
  ? path.resolve(process.env.ANYAPP_KOTLIN_TEMPLATE_DIR)
  : path.resolve(BUILDER_DIR, '..', 'template-kotlin');

/** The file a Kotlin app keeps its preset, slug and package id in (the builder writes it). */
export const KOTLIN_META = 'anyapp.json';

export function checkPreset(preset) {
  const p = preset ?? DEFAULT_PRESET;
  if (!PRESETS.includes(p)) throw new Error(`unknown preset "${preset}" (use ${PRESETS.join(' or ')})`);
  return p;
}

export function templateDirFor(preset) {
  return checkPreset(preset) === 'kotlin' ? KOTLIN_TEMPLATE_DIR : TEMPLATE_DIR;
}

/** Template folders that are never copied (generated, installed or build output), by relative path. */
export function skipFor(preset) {
  return checkPreset(preset) === 'kotlin'
    ? new Set(['build', '.gradle', '.kotlin', '.idea', '.git', 'local.properties', path.join('app', 'build')])
    : new Set(['node_modules', 'build', 'android', 'ios', '.expo', 'dist', '.git']);
}

/** Reads a Kotlin app's anyapp.json, or null. */
export function readKotlinMeta(dir) {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, KOTLIN_META), 'utf8'));
    return meta?.preset === 'kotlin' ? meta : null;
  } catch {
    return null;
  }
}

/** Which preset an existing app folder was made from. */
export function presetOf(dir) {
  if (readKotlinMeta(dir)) return 'kotlin';
  if (fs.existsSync(path.join(dir, 'app.json'))) return 'react-native';
  return null;
}
