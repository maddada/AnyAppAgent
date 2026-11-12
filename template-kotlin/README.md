# Kiwimake Kotlin starter

The native Android starter every Kotlin app is copied from (the "Kotlin" preset of the New app
sheet). Kotlin, Jetpack Compose, Material 3; built by `builder/` into a signed release APK of a
few MB. `AGENTS.md` is written for the app's own agent; `builder/README.md` explains how apps are
created and built.

`__APP_NAME__`, `__APP_SLUG__` and `__APP_PACKAGE__` are filled in by `createApp`
(`app/src/main/res/values/strings.xml` and `anyapp.json`). The launcher icon sizes under
`app/src/main/res/mipmap-*/` are made from `icon.png` by every build.
