# Appwin Automate: the starter

The files that turn a fresh AnyAppAgent React Native app into **Appwin Automate** (automations you
just describe). Design, scope and proof: `docs/AUTOMATE.md`.

`app/` is laid over a new app made from `template/`: it adds `automations/`, `src/automate/`,
`modules/automate/`, `tools/automate-fence.js`, `babel.config.js`, and replaces `AGENTS.md`,
`overview.md`, `index.ts`, `src/App.tsx`, `src/theme.ts`, the screens and `assets/icon.png`. It
never replaces `app.json`, `package.json` or the lockfile (no new libraries).

## Making the app (the normal AnyAppAgent way)

In AnyAppAgent, New app, name **Appwin Automate**, and this as what it should do (use this PC's
path to the repo):

```
Make this app Appwin Automate. Its finished starter is in C:/dev/AnyAppAgent/automate/app: copy
every file from there into this app folder, replacing what is there (keep app.json, package.json,
package-lock.json and node_modules as they are; it needs no new libraries). It already has its own
AGENTS.md and overview.md: read AGENTS.md after copying. Then run npm run check and keep it
building. Do not change anything else and do not add automations yet.
```

The first build is a full one (new native module and icon), about 10 minutes. From then on the
person adds automations from the app's own Change this app, and each one is a quick update.

## Keeping it in step with the template

`AGENTS.md` is the template's with the section "Appwin Automate: read this first" added before
"Stack", and three lines in "Layout". `src/App.tsx` and `src/screens/SettingsScreen.tsx` are the
template's with the extra screens and the Advanced group. When the template changes, carry those
changes over here (an existing Appwin Automate gets them through "Keep my apps healthy" like any app).
