// Builds a tiny on-screen keyboard (package com.anyappagent.testkeyboard) for proving keyboard
// layouts on an emulator whose hardware keyboard makes Gboard float instead of docking. It is a
// real input method: a plain 280 dp panel docked at the bottom, which pushes the app up exactly
// like a phone's keyboard does. Typing still comes from `adb shell input text`.
//
//   node dev/make-test-keyboard.mjs                      -> dev/tmp/test-keyboard.apk
//   adb -s <serial> install -r dev/tmp/test-keyboard.apk
//   adb -s <serial> shell ime enable com.anyappagent.testkeyboard/.TestKeyboard
//   adb -s <serial> shell ime set com.anyappagent.testkeyboard/.TestKeyboard
//   (afterwards) adb -s <serial> shell ime set com.google.android.inputmethod.latin/com.android.inputmethod.latin.LatinIME
import { mkdirSync, rmSync, writeFileSync, copyFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { KEYSTORE, ensureKeystore, javaTool, run, tool, toolchain } from "./make-test-apk.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const work = join(here, "tmp", "work", "test-keyboard");
const out = join(here, "tmp", "test-keyboard.apk");

const tc = toolchain();
if (!tc) throw new Error("Android build-tools not found (set ANDROID_HOME).");
ensureKeystore();
rmSync(work, { recursive: true, force: true });
const src = join(work, "src", "com", "anyappagent", "testkeyboard");
mkdirSync(src, { recursive: true });
mkdirSync(join(work, "res", "xml"), { recursive: true });
mkdirSync(join(work, "classes"), { recursive: true });
mkdirSync(join(work, "dex"), { recursive: true });

writeFileSync(
  join(work, "AndroidManifest.xml"),
  `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.anyappagent.testkeyboard">
  <application android:label="Kiwimake test keyboard">
    <service android:name=".TestKeyboard" android:label="Kiwimake test keyboard"
        android:permission="android.permission.BIND_INPUT_METHOD" android:exported="true">
      <intent-filter><action android:name="android.view.InputMethod"/></intent-filter>
      <meta-data android:name="android.view.im" android:resource="@xml/method"/>
    </service>
  </application>
</manifest>`,
);
writeFileSync(join(work, "res", "xml", "method.xml"), `<input-method xmlns:android="http://schemas.android.com/apk/res/android"/>`);
writeFileSync(
  join(src, "TestKeyboard.java"),
  `package com.anyappagent.testkeyboard;

import android.inputmethodservice.InputMethodService;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

public class TestKeyboard extends InputMethodService {
  @Override public View onCreateInputView() {
    TextView v = new TextView(this);
    v.setText("Test keyboard");
    v.setGravity(Gravity.CENTER);
    v.setBackgroundColor(0xFFC9CED8);
    v.setTextColor(0xFF333333);
    v.setTextSize(20);
    int h = (int) (280 * getResources().getDisplayMetrics().density);
    v.setLayoutParams(new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, h));
    v.setMinHeight(h);
    return v;
  }
  @Override public boolean onEvaluateInputViewShown() { return true; }
  @Override public boolean onEvaluateFullscreenMode() { return false; }
}
`,
);

const javac = javaTool("javac");
run(javac, ["--release", "11", "-classpath", tc.androidJar, "-d", join(work, "classes"), join(src, "TestKeyboard.java")]);
const bt = dirname(tc.aapt2);
const d8 = tool(bt, "d8");
const classes = readdirSync(join(work, "classes", "com", "anyappagent", "testkeyboard")).map((f) => join(work, "classes", "com", "anyappagent", "testkeyboard", f));
run(d8, ["--lib", tc.androidJar, "--min-api", "24", "--output", join(work, "dex"), ...classes]);

const flat = join(work, "res.zip");
run(tc.aapt2, ["compile", "--dir", join(work, "res"), "-o", flat]);
const unsigned = join(work, "unsigned.apk");
run(tc.aapt2, ["link", "-o", unsigned, "-I", tc.androidJar, "--manifest", join(work, "AndroidManifest.xml"), "--min-sdk-version", "24", "--target-sdk-version", "34", flat]);
// Add classes.dex to the APK (zip "store" via the JDK's jar tool keeps it simple).
copyFileSync(join(work, "dex", "classes.dex"), join(work, "classes.dex"));
run(javaTool("jar"), ["uf", unsigned, "-C", work, "classes.dex"]);
const aligned = join(work, "aligned.apk");
run(tc.zipalign, ["-f", "-p", "4", unsigned, aligned]);
copyFileSync(aligned, out);
run(tc.apksigner, ["sign", "--v4-signing-enabled", "false", "--ks", KEYSTORE, "--ks-pass", "pass:mockmock", "--key-pass", "pass:mockmock", "--ks-key-alias", "mock", out]);
console.log(out);
