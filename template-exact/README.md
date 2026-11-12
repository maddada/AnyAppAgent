# Kiwimake Expo Exact preset (alpha)

The "Expo Exact" choice of the New app sheet. Unlike `template/` and `template-kotlin/`, this is
not a full starter: `builder/lib/exact.mjs` makes the app with Exact's own `exact new <dir> --with
android` from a pinned Exact checkout (`builder/exact/pin.json`, patched for Windows with
`builder/exact/windows.patch` until upstream has the fixes, expo/exact issues 147 to 150), then
adds what is here:

- `AGENTS.md`: Kiwimake's instructions for the app's agent, put above Exact's generated block.

and writes `anyapp.json` (`{ preset: "expo-exact", slug, package }`) and a plain `CLAUDE.md`.

The Exact checkout lives two folders above the apps (`C:\aa\exact` for `C:\aa\apps\<slug>`),
because Exact apps refer to it as `../../exact`. `ANYAPP_EXACT_DIR` overrides it.
