// Where things live, and the environment for Android builds (see docs/ENVIRONMENT.md).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BUILDER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BUILDER_VERSION = '1';

/** The template every app is copied from. ANYAPP_TEMPLATE_DIR overrides it. */
export const TEMPLATE_DIR = process.env.ANYAPP_TEMPLATE_DIR
  ? path.resolve(process.env.ANYAPP_TEMPLATE_DIR)
  : path.resolve(BUILDER_DIR, '..', 'template');

/** Server state and the signing key (never inside the repository). ANYAPP_HOME overrides it. */
export const ANYAPP_HOME = process.env.ANYAPP_HOME
  ? path.resolve(process.env.ANYAPP_HOME)
  : path.join(os.homedir(), '.anyappagent');

export const CACHE_DIR = path.join(ANYAPP_HOME, 'cache');
export const KEYSTORE_DIR = path.join(ANYAPP_HOME, 'keystore');

/** ABIs to build: x86_64 for the emulator, arm64-v8a for phones. */
export const ABIS = 'x86_64,arm64-v8a';

const DEFAULT_JAVA_HOME = 'D:\\tools\\android\\jdk';
const DEFAULT_ANDROID_HOME = 'D:\\tools\\android\\sdk';

function firstExisting(...dirs) {
  return dirs.find((d) => d && fs.existsSync(d));
}

/**
 * The environment for child processes that need the Android toolchain. Uses JAVA_HOME and
 * ANDROID_HOME from the environment when they exist, else this PC's toolchain paths.
 */
export function androidEnv(extra = {}) {
  const javaHome = firstExisting(process.env.ANYAPP_JAVA_HOME, process.env.JAVA_HOME, DEFAULT_JAVA_HOME);
  const sdk = firstExisting(
    process.env.ANYAPP_ANDROID_HOME,
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    DEFAULT_ANDROID_HOME,
  );
  if (!javaHome) throw new Error('No JDK found: set JAVA_HOME (see docs/ENVIRONMENT.md).');
  if (!sdk) throw new Error('No Android SDK found: set ANDROID_HOME (see docs/ENVIRONMENT.md).');
  const sep = path.delimiter;
  const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  const env = { ...process.env };
  delete env[pathKey];
  env.PATH = [
    path.join(javaHome, 'bin'),
    path.join(sdk, 'platform-tools'),
    path.dirname(process.execPath), // node, for Gradle's JS bundling step
    process.env[pathKey] ?? '',
  ].join(sep);
  Object.assign(env, {
    JAVA_HOME: javaHome,
    ANDROID_HOME: sdk,
    ANDROID_SDK_ROOT: sdk,
    CI: '1', // no interactive prompts from Expo CLI
    EXPO_NO_TELEMETRY: '1',
    EXPO_NO_GIT_STATUS: '1',
    EXPO_NO_DOCTOR: '1',
    ...extra,
  });
  return { env, javaHome, sdk };
}

/** Tool binaries inside the JDK / SDK. */
export function tool(dir, ...parts) {
  const p = path.join(dir, ...parts);
  if (process.platform === 'win32' && !path.extname(p)) {
    for (const ext of ['.exe', '.bat']) if (fs.existsSync(p + ext)) return p + ext;
  }
  return p;
}

export function findBuildTool(sdk, name) {
  const root = path.join(sdk, 'build-tools');
  if (!fs.existsSync(root)) return null;
  const versions = fs
    .readdirSync(root)
    .filter((v) => /^\d/.test(v))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const v of versions) {
    const p = tool(root, v, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}
