# Over-the-air updates for the phone app

The phone app (`app/`, Expo, `com.anyappagent`) downloads new JavaScript from
`https://ota.kiwimake.ai` instead of waiting for a new APK. This folder is that server: a
Cloudflare Worker (`src/worker.js`) with one R2 bucket, speaking the
[Expo Updates protocol v1](https://docs.expo.dev/technical-specs/expo-updates-1/) that the app's
`expo-updates` client uses. It is copied from Ghostex's `tooling/release-mobile/ota-server`
(read only, never imported), for Android only. It is separate from the website's Worker
(`website/wrangler.jsonc`), which needs no storage.

## How an update reaches phones

1. A release builds the APK with `npm run apk -- --clean --release` (`app/scripts/build-apk.mjs`),
   which turns updates on (`KIWIMAKE_RELEASE=1`, `app/app.config.js`) and writes the runtime version
   into the APK.
2. `node app/scripts/ota-export.mjs <dir>` exports the same commit's JavaScript with the same runtime
   version, and `node app/scripts/ota-publish.mjs publish <dir>` signs the manifest with the private
   key and uploads the files and the signed manifest here (`docs/RELEASING.md` has the steps).
3. A phone checks at every launch and when Kiwimake comes back to the front (at most every 30
   minutes). It downloads the update in the background and runs it at the next launch, or at once
   when the person taps **Restart now** (the home screen's notice, or Settings, Updates).

An update only reaches a phone whose APK has the **same runtime version**: a hash of everything
that ends up as native code (the native modules, native dependencies, `app.json` without its
version fields, the icons and fonts, the Easy Connect bridge sources; the exact list is in
`app/scripts/ota-runtime-version.js`). A release that changes any of those needs a new APK; phones
on the old APK keep their last update until they install it. The in-app APK updater
(`app/src/lib/appUpdate.ts`) offers the new APK only in that case: it asks `/v1/status` whether the
newest release already reached this APK over the air.

## Security

- The release PC signs every manifest and directive with an RSA key. The app carries only the
  certificate (`app/certs/certificate.pem`, valid until 2056) and refuses anything unsigned or signed
  by another key, before it downloads a single file.
- The private key lives only on the release PC, at
  `~/.anyappagent-release/ota-signing/private-key.pem` (folder `700`, file `600`), and in the
  owner's password manager. It is never in Git.
- The Worker never sees the private key. The upload token lets the release PC write to the bucket,
  but a stolen token cannot make phones run anything without the key.
- `ota-publish.mjs` checks every signature against the app's certificate before it uploads, so a
  wrong key fails there instead of reaching phones.

If the key is lost, updates stop until every phone installs an APK with a new certificate. If it
leaks together with the upload token, someone could ship JavaScript to every phone: rotate it then
(new key and certificate with `npx expo-updates codesigning:generate`, then a new APK).

## One-time setup (done on 2026-11-17)

Live: the Worker `kiwimake-ota` on the custom domain `https://ota.kiwimake.ai`, with the R2 bucket
`kiwimake-ota` and the secret `UPLOAD_TOKEN`, in the Cloudflare account that owns the `kiwimake.ai`
zone (the website's account). The upload token is in `~/.anyappagent-release/ota-upload-token`
(mode 600). The token, the signing key, its public key and the certificate are backed up in the
1Password item "Kiwimake OTA" (vault Personal); `bash ~/.appwin-secrets/restore-secrets.sh ota`
puts them back on a new PC. Redeploy after a change to `src/worker.js` with
`npx --yes wrangler@4.161.0 deploy` from this folder.

How it was set up, for a new account:

From this folder, logged in to the Cloudflare account that owns the `kiwimake.ai` zone. R2 has a
free tier (10 GB stored, no egress fees), but Cloudflare asks for a payment method on the account
before R2 can be used the first time:

```sh
npx --yes wrangler@4.161.0 r2 bucket create kiwimake-ota
npx --yes wrangler@4.161.0 deploy          # creates the ota.kiwimake.ai custom domain too
umask 077; openssl rand -hex 32 > ~/.anyappagent-release/ota-upload-token
npx --yes wrangler@4.161.0 secret put UPLOAD_TOKEN < ~/.anyappagent-release/ota-upload-token
curl -sS -o /dev/null -w '%{http_code}\n' https://ota.kiwimake.ai/v1/status/production/android/x   # 404: it answers
```

`wrangler secret put` reads the token from the file, so it never appears on a command line.

## Day to day

```sh
node app/scripts/ota-runtime-version.js                 # this checkout's runtime version
node app/scripts/ota-publish.mjs status                 # what phones on it are served
curl https://ota.kiwimake.ai/v1/status/production/android/<runtime-version>
```

## When an update is bad

Run these from `app/` on the release PC:

```sh
# Phones on that runtime drop their downloaded update and run the code inside the APK.
node scripts/ota-publish.mjs rollback-to-embedded --runtime <rv>

# Or serve an earlier update again (it gets a new id and date, so phones take it).
node scripts/ota-publish.mjs history --runtime <rv>
node scripts/ota-publish.mjs republish --runtime <rv> --from <history-name>
```

expo-updates also protects phones on its own: an update that crashes before its first screen is
rolled back to the one before at the next launch.

## Testing locally

`dev/local.mjs` runs `src/worker.js` unchanged in Node, with the bucket in a folder
(`dev/bucket.mjs`); `npm test` runs `dev/worker.test.mjs` against it.

```sh
export KIWIMAKE_OTA_UPLOAD_TOKEN="$(openssl rand -hex 32)"
node dev/local.mjs --port 8791 --data /tmp/kiwimake-ota      # never 8787, the companion's port
```

Build a test APK with its own package and the local servers (the emulator reaches this PC at
`10.0.2.2`), and the stand-in for the GitHub release (`app/dev/release-feed.mjs`) for the APK
updater:

```sh
cd app
ANYAPP_ANDROID_PACKAGE=com.anyappagent.selfupdate KIWIMAKE_APP_VERSION=0.3.3 \
KIWIMAKE_OTA_SERVER=http://10.0.2.2:8791 KIWIMAKE_RELEASE_FEED=http://10.0.2.2:8792/releases/latest \
  node scripts/build-apk.mjs --release --out /tmp/kiwimake-old
```

Export with the same variables (`ota-export.mjs <dir> --allow-dirty` for a test change), then
publish. The publisher reaches the server at `127.0.0.1`, the emulator at `10.0.2.2`, so the asset
addresses in the manifest come from `KIWIMAKE_OTA_PUBLIC_URL`:

```sh
KIWIMAKE_OTA_SERVER=http://127.0.0.1:8791 KIWIMAKE_OTA_PUBLIC_URL=http://10.0.2.2:8791 \
KIWIMAKE_OTA_SIGNING_KEY_FILE=<key> node scripts/ota-publish.mjs publish <dir> --new-runtime
```
