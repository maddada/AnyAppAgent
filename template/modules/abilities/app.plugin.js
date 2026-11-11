// Phone abilities, declared in app.json. Nothing here runs unless the app lists the plugin, so an
// app without widgets, tiles, shortcuts or shares gets none of their manifest entries.
//
//   ["./modules/abilities/app.plugin.js", {
//     "widgets":   [{ "id": "water", "name": "Water today", "description": "Glasses so far", "size": "small" }],
//     "tiles":     [{ "id": "tea", "label": "Tea timer", "icon": "tea", "mode": "run", "action": "start-tea" }],
//     "shortcuts": [{ "id": "log", "label": "Log a glass", "icon": "cup-water", "action": "log-glass", "open": false }],
//     "shares":    ["text", "image"],
//     "iconColor": "#14532D"
//   }]
//
// widgets: up to 4. size "small" (2x2), "wide" (4x2), "tall" (2x3) or "large" (4x3); the person
//   can resize them. name is shown in the widget list.
// tiles: up to 4. mode "run" (default; the action runs in the background), "open" (opens the app
//   with the action) or "toggle" (on and off; the action gets data.on). action defaults to the id.
// shortcuts: up to 4, shown when the app icon is long-pressed. open true opens the app.
// icon: a Material Design Icons name (https://pictogrammers.com/library/mdi/, the same names as
//   `npm run icon -- --search`). iconColor: the shortcut icons' glyph colour (default: the app icon's).
// shares: what the app accepts from the share sheet: "text" (text and links), "image", "video",
//   "file" (any file). Several images at once arrive together.
const fs = require('fs');
const path = require('path');
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

const { hasGlyph, shortcutIcon, vectorDrawable } = require('./glyph');

const ID = /^[a-z][a-z0-9-]{0,39}$/;
const SIZES = {
  small: { w: 2, h: 2 },
  wide: { w: 4, h: 2 },
  tall: { w: 2, h: 3 },
  large: { w: 4, h: 3 },
};
const MODES = ['run', 'open', 'toggle'];
const SHARES = { text: ['text/plain'], image: ['image/*'], video: ['video/*'], file: ['*/*'] };

function fail(msg) {
  throw new Error(`modules/abilities (app.json): ${msg}`);
}

function list(value, what, max) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(`"${what}" must be a list`);
  if (value.length > max) fail(`at most ${max} ${what}`);
  const seen = new Set();
  for (const item of value) {
    if (!item || typeof item !== 'object') fail(`each of "${what}" must be an object`);
    if (!ID.test(item.id ?? '')) fail(`${what} id "${item.id}" must be lowercase letters, digits and dashes`);
    if (seen.has(item.id)) fail(`two ${what} have the id "${item.id}"`);
    seen.add(item.id);
  }
  return value;
}

function checkIcon(icon, where, projectRoot) {
  if (icon === undefined) return;
  if (!hasGlyph(icon, { projectRoot })) fail(`${where}: no icon named "${icon}" (see https://pictogrammers.com/library/mdi/)`);
}

const resName = (icon) => icon.replace(/[^a-z0-9]/g, '_');

function options(raw, projectRoot) {
  const o = raw ?? {};
  const widgets = list(o.widgets, 'widgets', 4);
  for (const w of widgets) {
    if (w.size !== undefined && !SIZES[w.size]) fail(`widget "${w.id}": size must be one of ${Object.keys(SIZES).join(', ')}`);
    if (!w.name) fail(`widget "${w.id}" needs a name`);
  }
  const tiles = list(o.tiles, 'tiles', 4);
  for (const t of tiles) {
    if (!t.label) fail(`tile "${t.id}" needs a label`);
    if (t.mode !== undefined && !MODES.includes(t.mode)) fail(`tile "${t.id}": mode must be run, open or toggle`);
    checkIcon(t.icon, `tile "${t.id}"`, projectRoot);
  }
  const shortcuts = list(o.shortcuts, 'shortcuts', 4);
  for (const s of shortcuts) {
    if (!s.label) fail(`shortcut "${s.id}" needs a label`);
    if (!s.action) fail(`shortcut "${s.id}" needs an action`);
    checkIcon(s.icon, `shortcut "${s.id}"`, projectRoot);
  }
  let shares = o.shares ?? [];
  if (shares === true) shares = ['text', 'image'];
  if (!Array.isArray(shares)) fail('"shares" must be a list like ["text", "image"]');
  for (const s of shares) if (!SHARES[s]) fail(`shares: "${s}" must be one of ${Object.keys(SHARES).join(', ')}`);
  return { widgets, tiles, shortcuts, shares, iconColor: o.iconColor };
}

const escXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const escRes = (s) => escXml(s).replace(/'/g, "\\'");
const meta = (name, value) => ({ $: { 'android:name': name, 'android:value': String(value) } });

function withManifest(config, opts) {
  return withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    const main = AndroidConfig.Manifest.getMainActivityOrThrow(cfg.modResults);
    const ours = (n) => String(n).startsWith('com.anyapp.abilities.');
    app.receiver = (app.receiver ?? []).filter((r) => !ours(r.$['android:name']) || r.$['android:name'].endsWith('ActionReceiver'));
    app.service = (app.service ?? []).filter((s) => !ours(s.$['android:name']));

    opts.widgets.forEach((w, i) => {
      app.receiver.push({
        $: { 'android:name': `com.anyapp.abilities.Widget${i + 1}`, 'android:exported': 'false', 'android:label': w.name },
        'intent-filter': [{ action: [{ $: { 'android:name': 'android.appwidget.action.APPWIDGET_UPDATE' } }] }],
        'meta-data': [
          { $: { 'android:name': 'android.appwidget.provider', 'android:resource': `@xml/anyapp_widget_${i + 1}` } },
          meta('com.anyapp.abilities.widget', w.id),
        ],
      });
    });

    opts.tiles.forEach((t, i) => {
      const mode = t.mode ?? 'run';
      const md = [meta('com.anyapp.abilities.tile', t.id), meta('com.anyapp.abilities.tile.mode', mode), meta('com.anyapp.abilities.tile.action', t.action ?? t.id)];
      if (mode === 'toggle') md.push(meta('android.service.quicksettings.TOGGLEABLE_TILE', true));
      app.service.push({
        $: {
          'android:name': `com.anyapp.abilities.Tile${i + 1}`,
          'android:exported': 'true',
          'android:label': t.label,
          'android:icon': `@drawable/anyapp_tile_${i + 1}`,
          'android:permission': 'android.permission.BIND_QUICK_SETTINGS_TILE',
        },
        'intent-filter': [{ action: [{ $: { 'android:name': 'android.service.quicksettings.action.QS_TILE' } }] }],
        'meta-data': md,
      });
    });

    main['meta-data'] = (main['meta-data'] ?? []).filter((m) => m.$['android:name'] !== 'android.app.shortcuts');
    if (opts.shortcuts.length) main['meta-data'].push({ $: { 'android:name': 'android.app.shortcuts', 'android:resource': '@xml/anyapp_shortcuts' } });

    const SEND = ['android.intent.action.SEND', 'android.intent.action.SEND_MULTIPLE'];
    main['intent-filter'] = (main['intent-filter'] ?? []).filter((f) => !(f.action ?? []).some((a) => SEND.includes(a.$?.['android:name'])));
    if (opts.shares.length) {
      const types = [...new Set(opts.shares.flatMap((s) => SHARES[s]))];
      const data = types.map((t) => ({ $: { 'android:mimeType': t } }));
      const filter = (action) => ({
        action: [{ $: { 'android:name': action } }],
        category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
        data,
      });
      main['intent-filter'].push(filter('android.intent.action.SEND'));
      if (opts.shares.some((s) => s !== 'text')) main['intent-filter'].push(filter('android.intent.action.SEND_MULTIPLE'));
    }
    return cfg;
  });
}

function withResources(config, opts) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const root = cfg.modRequest.projectRoot;
      const res = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res');
      const write = (rel, text) => {
        const p = path.join(res, rel);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, text);
      };
      const strings = [];

      opts.widgets.forEach((w, i) => {
        const s = SIZES[w.size ?? 'small'];
        const dp = (cells) => 70 * cells - 30;
        strings.push(`  <string name="anyapp_widget_${i + 1}_description">${escRes(w.description ?? w.name)}</string>`);
        write(
          `xml/anyapp_widget_${i + 1}.xml`,
          `<?xml version="1.0" encoding="utf-8"?>
<!-- Widget "${escXml(w.id)}" (modules/abilities, from app.json). -->
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
  android:minWidth="${dp(s.w)}dp"
  android:minHeight="${dp(s.h)}dp"
  android:minResizeWidth="${dp(2)}dp"
  android:minResizeHeight="${dp(2)}dp"
  android:targetCellWidth="${s.w}"
  android:targetCellHeight="${s.h}"
  android:resizeMode="horizontal|vertical"
  android:updatePeriodMillis="3600000"
  android:initialLayout="@layout/anyapp_widget"
  android:description="@string/anyapp_widget_${i + 1}_description"
  android:widgetCategory="home_screen" />
`,
        );
      });

      opts.tiles.forEach((t, i) => {
        write(`drawable/anyapp_tile_${i + 1}.xml`, vectorDrawable(t.icon ?? 'gesture-tap', { projectRoot: root }));
      });

      if (opts.shortcuts.length) {
        const pkg = cfg.android?.package;
        if (!pkg) fail('expo.android.package is missing');
        const color = opts.iconColor ?? cfg.android?.adaptiveIcon?.backgroundColor ?? '#1E2023';
        const items = opts.shortcuts.map((s, i) => {
          const icon = `anyapp_shortcut_${resName(s.icon ?? 'gesture-tap')}`;
          write(`drawable/${icon}.xml`, vectorDrawable(s.icon ?? 'gesture-tap', { projectRoot: root, color }));
          write(`drawable-v26/${icon}.xml`, shortcutIcon(s.icon ?? 'gesture-tap', { projectRoot: root, color, background: '#FFF4F3EF' }));
          strings.push(`  <string name="anyapp_shortcut_${i + 1}_short">${escRes(s.label)}</string>`);
          strings.push(`  <string name="anyapp_shortcut_${i + 1}_long">${escRes(s.longLabel ?? s.label)}</string>`);
          return `  <shortcut
    android:shortcutId="${escXml(s.id)}"
    android:enabled="true"
    android:icon="@drawable/${icon}"
    android:shortcutShortLabel="@string/anyapp_shortcut_${i + 1}_short"
    android:shortcutLongLabel="@string/anyapp_shortcut_${i + 1}_long">
    <intent
      android:action="com.anyapp.abilities.SHORTCUT"
      android:targetPackage="${pkg}"
      android:targetClass="com.anyapp.abilities.ActionActivity">
      <extra android:name="action" android:value="${escXml(s.action)}" />
      <extra android:name="id" android:value="${escXml(s.id)}" />
      <extra android:name="open" android:value="${s.open ? 'true' : 'false'}" />
    </intent>
  </shortcut>`;
        });
        write(
          'xml/anyapp_shortcuts.xml',
          `<?xml version="1.0" encoding="utf-8"?>
<!-- App shortcuts (modules/abilities, from app.json). -->
<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">
${items.join('\n')}
</shortcuts>
`,
        );
      }

      if (strings.length) write('values/anyapp_abilities.xml', `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n${strings.join('\n')}\n</resources>\n`);
      return cfg;
    },
  ]);
}

module.exports = function withAbilities(config, raw) {
  const opts = options(raw, config._internal?.projectRoot ?? process.cwd());
  return withResources(withManifest(config, opts), opts);
};
