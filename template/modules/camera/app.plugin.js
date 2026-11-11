// Camera smarts, switched on in app.json. Without this plugin (or with both parts false) the app
// gets no camera library at all.
//
//   ["./modules/camera/app.plugin.js", { "codes": true, "text": true, "bundled": false }]
//
// codes:   scanCode(), Google's code scanner (QR and barcodes). Its screen comes with Google Play
//          services, so no camera permission. About 0.2 MB.
// text:    readText(picture), ML Kit text reading on the phone.
// bundled: false (default) uses the Google Play services text model (downloaded once on first use,
//          about 0.3 MB in the app). true puts the model in the app (works without Google Play
//          services, offline from the first use), about 4 MB more per CPU type.
const { AndroidConfig, withAndroidManifest, withGradleProperties } = require('expo/config-plugins');

const KEYS = { anyappCameraCodes: 'codes', anyappCameraText: 'text', anyappCameraTextBundled: 'bundled' };

module.exports = function withCameraSmarts(config, raw) {
  const o = raw ?? {};
  for (const k of Object.keys(o)) {
    if (!['codes', 'text', 'bundled'].includes(k)) throw new Error(`modules/camera (app.json): unknown option "${k}" (use codes, text, bundled)`);
  }
  config = withGradleProperties(config, (cfg) => {
    cfg.modResults = cfg.modResults.filter((p) => !(p.type === 'property' && KEYS[p.key]));
    for (const [key, opt] of Object.entries(KEYS)) {
      cfg.modResults.push({ type: 'property', key, value: String(opt === 'bundled' ? !!o.bundled && !!o.text : !!o[opt]) });
    }
    return cfg;
  });
  return withAndroidManifest(config, (cfg) => {
    // Lets Google Play services fetch the scanner and text parts ahead of first use where it can.
    const parts = [o.codes && 'barcode_ui,barcode', o.text && !o.bundled && 'ocr'].filter(Boolean);
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    app['meta-data'] = (app['meta-data'] ?? []).filter((m) => m.$['android:name'] !== 'com.google.mlkit.vision.DEPENDENCIES');
    if (parts.length) app['meta-data'].push({ $: { 'android:name': 'com.google.mlkit.vision.DEPENDENCIES', 'android:value': parts.join(',') } });
    return cfg;
  });
};
