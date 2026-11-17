// app.json holds the config. This adds what a build chooses from its environment:
//
// - A test build with its own Android package, so a thread can install its copy on the shared
//   emulator without replacing com.anyappagent:
//     ANYAPP_ANDROID_PACKAGE=com.anyappagent.pages npm run apk -- --clean
//
// - Updates (docs/RELEASING.md, "Updates of the phone app"), the way Ghostex does it: release builds
//   (KIWIMAKE_RELEASE=1, which `npm run apk -- --release` and scripts/ota-export.mjs set) look for
//   a newer APK on the GitHub release and install it themselves, and take over-the-air updates of
//   their JavaScript (expo-updates) from Kiwimake's own update server, a Cloudflare Worker with R2 at
//   ota.kiwimake.ai (website/ota-server). Every update is signed with a key that stays on the
//   release PC; the APK carries only the certificate (certs/certificate.pem). Debug and test builds
//   keep both off, so Metro always wins and a debug-signed copy never offers the release APK.
//
// For a local proof (website/ota-server/README.md, "Testing locally"):
//   KIWIMAKE_OTA_SERVER     another update server (default https://ota.kiwimake.ai)
//   KIWIMAKE_RELEASE_FEED   another newest-release feed, shaped like GitHub's releases/latest
//   KIWIMAKE_APP_VERSION    another version (MAJOR.MINOR.PATCH; versionCode follows it)
const { otaRuntimeVersion } = require("./scripts/ota-runtime-version");

const OTA_SERVER = (process.env.KIWIMAKE_OTA_SERVER || "https://ota.kiwimake.ai").replace(/\/+$/, "");
const RELEASE_FEED = process.env.KIWIMAKE_RELEASE_FEED || "https://api.github.com/repos/maddada/Kiwimake/releases/latest";

/** `0.3.3` -> 303 (docs/RELEASING.md: major * 10000 + minor * 100 + patch). */
function versionCode(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`KIWIMAKE_APP_VERSION must be MAJOR.MINOR.PATCH, got ${version}`);
  return Number(match[1]) * 10000 + Number(match[2]) * 100 + Number(match[3]);
}

module.exports = ({ config }) => {
  const pkg = process.env.ANYAPP_ANDROID_PACKAGE;
  const release = process.env.KIWIMAKE_RELEASE === "1";
  const version = process.env.KIWIMAKE_APP_VERSION || config.version;
  const android = {
    ...config.android,
    ...(pkg ? { package: pkg } : {}),
    ...(process.env.KIWIMAKE_APP_VERSION ? { versionCode: versionCode(version) } : {}),
    runtimeVersion: release ? otaRuntimeVersion() : "dev",
  };
  return {
    ...config,
    ...(pkg ? { name: `${config.name} (${pkg.split(".").pop()})` } : {}),
    version,
    android,
    extra: {
      ...config.extra,
      // The in-app APK updater (src/lib/appUpdate.ts): only release builds, signed with the release key.
      selfUpdate: release,
      releaseFeed: RELEASE_FEED,
    },
    updates: release
      ? {
          enabled: true,
          url: `${OTA_SERVER}/v1/manifest/production`,
          // Check at every launch without waiting: the app starts on what it has, the download runs
          // in the background, and the update applies at the next launch or on Restart.
          checkAutomatically: "ON_LOAD",
          fallbackToCacheTimeout: 0,
          codeSigningCertificate: "./certs/certificate.pem",
          codeSigningMetadata: { keyid: "main", alg: "rsa-v1_5-sha256" },
          // The server sends whole bundles; there is no patch to ask for.
          enableBsdiffPatchSupport: false,
        }
      : { enabled: false },
  };
};
