# Bright Eye branding

The approved Kiwimake identity is **01 Bright Eye**, the happy Dumpling kiwi selected on the
Ghostex review page (Q446, no requested changes). It has a slightly pear-shaped green body,
tiny feet, a level apricot beak and a dark eye with a large cream highlight.

## Source assets

The masters in `assets/brand/` are the approved SVGs, including outlined lettering:

- `kiwimake-icon.svg`: transparent full mark.
- `kiwimake-icon-small.svg`: simplified single eye for 16 and 24 px.
- `kiwimake-monochrome.svg`: one-colour silhouette and transparent eye.
- `kiwimake-wordmark.svg` and `kiwimake-wordmark-dark.svg`: the complete logo lockups.
- `kiwimake-lettering.svg`: outlined Kiwimake name without the bird.

The lettering uses Bricolage Grotesque, whose font licence is in `shared/theme/fonts/`.
Do not re-type or redraw the approved wordmark when regenerating platform assets.

## Generate platform assets

From the repository root:

```powershell
python shared/theme/tools/sync-brand.py
node shared/theme/tools/render-assets.mjs --puppeteer <folder-with-node_modules> --chrome <chrome.exe>
node shared/theme/tools/build-pages.mjs
```

The renderer needs `puppeteer-core` in the specified folder. The existing
`shared/theme/tools/make-wordmark.py` command forwards to the same SVG sync step.

Android uses the approved cream background (`#FFF5DB`). The adaptive foreground occupies
54 units inside a 108-unit layer. Android displays its central 72 units, so the bird occupies
75% of the masked icon, matching the round and squircle review previews. Legacy launchers use
the same cream plate and proportions. The generator writes all five Android densities,
adaptive foreground/background/monochrome layers and white notification glyphs.

Windows uses a transparent bird. The ICO contains 16, 20, 24, 32, 40, 48, 64 and 256 px frames.
At 16, 20 and 24 px the frame uses the small SVG. Tray PNGs and its multi-frame ICO use the
simple eye at every display scale. Electron's window, taskbar and NSIS installer already point
to these shared assets, so they must be regenerated together.

Phone welcome, connection and home screens use the transparent native lockup PNGs, including
the cream lettering in dark mode. The desktop's shared `Wordmark` component uses the approved
bird and outlined lettering, switching lettering assets for light and dark backgrounds.

## Local verification

Build the signed phone APKs and Windows installer using `docs/ENVIRONMENT.md` and
`docs/RELEASING.md`. Android prebuild must run after changing the launcher assets. The phone
build script upgrades Expo's default Gradle heap to the documented 4 GB / 1 GB metaspace.

To check branding without an emulator, inspect the built APK's launcher resources, render its
adaptive foreground through round and squircle masks, and extract the icon groups from the
built desktop EXE and installer as PE resource data. Check the 16 and 24 px frames at native
size on light and dark backgrounds. Use a separate desktop user-data folder, state folder,
tools folder and port for any UI proof. Never restart the person's running desktop app for an
icon check. Building these assets does not change package IDs, state paths or release versions.
