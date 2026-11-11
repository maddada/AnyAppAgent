// Camera smarts, switched on in app.json. Without this plugin (or with both parts false) the app
// gets no camera library at all.
//
//   ["./modules/camera/app.plugin.js", { "codes": true, "text": true, "bundled": false }]
//
// codes:   scanCode(), Google's code scanner (QR and barcodes; its screen comes with Google Play
//          services, so no camera permission), and readCodes(picture).
// text:    readText(picture), ML Kit text reading on the phone.
// bundled: false (default): the text and code-reading models come with Google Play services
//          (fetched once, on first use; this needs the Play Store). true puts both models in the
//          app: readText and readCodes then work offline at once and on phones without Google
//          Play services. scanCode always needs Google Play services.
// Measured (Expo SDK 58, arm64 APK): codes and text together +0.35 MB; bundled +9 MB more
// (text model 5.9 MB, code reader about 3.1 MB).
const { AndroidConfig, withAndroidManifest, withGradleProperties } = require('expo/config-plugins');

const KEYS = { anyappCameraCodes: 'codes', anyappCameraText: 'text', anyappCameraBundled: 'bundled' };

module.exports = function withCameraSmarts(config, raw) {
  const o = raw ?? {};
  for (const k of Object.keys(o)) {
    if (!['codes', 'text', 'bundled'].includes(k)) throw new Error(`modules/camera (app.json): unknown option "${k}" (use codes, text, bundled)`);
  }
  config = withGradleProperties(config, (cfg) => {
    cfg.modResults = cfg.modResults.filter((p) => !(p.type === 'property' && KEYS[p.key]));
    for (const [key, opt] of Object.entries(KEYS)) {
      cfg.modResults.push({ type: 'property', key, value: String(!!o[opt]) });
    }
    return cfg;
  });
  return withAndroidManifest(config, (cfg) => {
    // Lets Google Play services fetch the scanner and text parts ahead of first use where it can.
    const parts = [o.codes && 'barcode_ui', o.codes && !o.bundled && 'barcode', o.text && !o.bundled && 'ocr'].filter(Boolean);
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    app['meta-data'] = (app['meta-data'] ?? []).filter((m) => m.$['android:name'] !== 'com.google.mlkit.vision.DEPENDENCIES');
    if (parts.length) app['meta-data'].push({ $: { 'android:name': 'com.google.mlkit.vision.DEPENDENCIES', 'android:value': parts.join(',') } });
    return cfg;
  });
};
