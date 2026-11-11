# Easy Connect

Easy Connect lets the phone pair with the PC by scanning one QR code and then reach the companion
from anywhere (another Wi-Fi, mobile data), with nothing else to install on either side. It is
copied from Ghostex's Easy Connect (`C:\dev\Ghostex`, same owner). In AnyAppAgent it carries only
the companion's own HTTP and WebSocket port (8787): the app list, the chat, and the APKs. The
same-network path (address plus 6-digit code, `anyappagent://pair?...`) stays exactly as it is and
is what the emulator uses at `10.0.2.2:8787`.

This file has three parts: how Ghostex does it, what AnyAppAgent copies and leaves out, and the
exact contract for the phone side. The phone side can be built from this file alone.

## 1. How Ghostex's Easy Connect works

**The helper is Tailcat.** [Tailcat](https://github.com/tailscale/tailcat) is a small program from
Tailscale that pipes or serves TCP connections over Tailscale's data plane (WireGuard, NAT traversal,
DERP relays) **without** Tailscale's control plane: no account, no login, no tailnet. Ghostex calls
it "the Tailcat helper".

- **Install** (Ghostex `server/src/tailcat/install.rs`): Ghostex downloads a private Go toolchain
  from `https://go.dev/dl/?mode=json` (newest stable archive for the OS and CPU, SHA-256 checked),
  then runs `go install github.com/tailscale/tailcat/cmd/tailcat@v0.6.0` with a private `GOPATH`,
  `GOCACHE`, `GOROOT`, `GOTOOLCHAIN=local`, `CGO_ENABLED=0`, and keeps only the binary. Tailcat
  v0.6.0 or newer is required: v0.6.0 addresses carry a WireGuard pre-shared key that older
  clients cannot complete a handshake with.
- **Key** (`keys.rs`): `tailcat genkey --key=<file> --fixed-region` once. The key *is* the address
  phones dial, so it is never regenerated. `--fixed-region` bakes one DERP relay region into the
  key so the address stays the same across restarts.
- **Serve** (`supervisor.rs`): `tailcat --verbose serve --full-address --key=<file> [--allow=<keys>]
  <ports>` with `TAILCAT_ADDR_FILE=<file>`. The helper writes its address (`tc...`, a base64url
  blob) to that file. `--full-address` embeds the relay's details in the address, so a client needs
  no DERP map download before its first packet (that download failed on mobile networks). Each
  served port is proxied to the same port on `localhost`. Ghostex restarts the helper with backoff
  when it exits, and restarts it on purpose whenever what it serves changes (ports, allow-list).
- **The address.** The `tc...` address names the server's public key, its relay, and a WireGuard
  pre-shared key. Whoever has the address can *try* to connect; the allow-list decides who gets in.
  Ghostex never writes the address to its logs.
- **The relay.** Tailcat clients and servers meet on a DERP relay (the same relays Tailscale uses),
  then try to upgrade to a direct UDP path; if that fails, traffic stays on the relay, end-to-end
  encrypted (WireGuard), so the relay cannot read it. Ghostex has two "lanes":
  1. the **public relays** (Tailscale's, the DERP map at `https://tailcat.dev/derpmap.json`),
     the first address every Ghostex phone holds; and
  2. optionally a second address on **Ghostex's own relay** `relay-eu.ghostex.dev` (a `derper`
     Ghostex runs), or a custom `derper` hostname, made with `genkey --region=<host>` and served
     by a second `tailcat serve`. Phones try that one first and fall back to the public relays.
- **The allow-list** (`supervisor.rs` `served_allow_list`): the helper runs with
  `--allow=<client public keys>` (`nodekey:...`), and an empty list is served as `--allow=none`
  (closed, never open). The list is lifted (no `--allow`, anyone may connect) only during the
  **pairing window**: while the desktop's Show QR sheet is open, and for 60 seconds after.
- **The code** (`server/src/remote_access/pairing_code.rs`, phone `pairingCodes.ts`): the QR holds
  `https://ghostex.dev/pair#GHOSTEX-EC2:<base32>`: the address bytes, a one-time secret, the API
  port, the SSH port, the user and the computer name, each length-prefixed, in RFC 4648 base32 so
  the QR stays in alphanumeric mode. The secret lives 5 minutes and works once.
- **Pairing** (`pair_device.rs`, phone `pairing.ts`): the phone loads its tailcat client key
  (`UseClientKeyFile`, kept for good), opens a forward to the address and the API port
  (`StartForward`, which returns a `127.0.0.1` port), and `POST`s `/api/pairDevice` through it with
  the secret, its client key, an SSH key and a P-256 device key. The computer shows three words;
  the owner approves with Touch ID or similar; the phone polls `/api/pairingStatus` (signed with
  the device key) until it gets a device token. The phone's client key goes on the allow-list and
  the helper restarts with it; the phone reconnects by itself.
- **The phone** (`apps/mobile/tailcat-bridge/bridge.go`, built with `gomobile bind` into an Android
  library): the tailcat client runs in the app's own process and exposes each paired computer as a
  `127.0.0.1:<port>` listener, so the rest of the app (SSH, HTTP) dials localhost as if it were the
  computer. Android needs a Java network-interface lister (`GhostexTailcatInterfaces.kt`) because
  Android 11+ forbids Go's netlink interface lookup.

**What makes it secure.** WireGuard end to end (the relay sees only ciphertext); a pre-shared key
inside the address; the allow-list of client keys, closed when empty and lifted only while the owner
shows a QR; a one-time secret that lives 5 minutes; and, in Ghostex, a second approval on the
computer (three words) before any token is issued. Removing a device takes its key off the
allow-list, so it cannot even reach the computer any more.

## 2. What AnyAppAgent copies, and what it leaves out

| Part | AnyAppAgent | Where |
| --- | --- | --- |
| Tailcat helper v0.6.0, installed by building it with a private Go toolchain | Copied (same method, same module and version) into `%USERPROFILE%\.anyappagent\tools\tailcat\` | `server/src/easy-connect/tailcat.ts` |
| One server key, `genkey --fixed-region`, never regenerated | Copied | `%USERPROFILE%\.anyappagent\easy-connect\server.private.json` |
| `tailcat --verbose serve --full-address --key=... [--allow=...] <port>`, `TAILCAT_ADDR_FILE`, restart with backoff | Copied; serves **only** the companion's port | `tailcat.ts` `TailcatServer` |
| Allow-list, `none` when empty, lifted only during the pairing window | Copied | `tailcat.ts` `allowArgument` |
| One-time secret, 5 minutes, single use | Copied | `server/src/easy-connect/controller.ts` |
| Compact base32 code | Copied, without the SSH fields, prefix `ANYAPP-EC1:` | `server/src/easy-connect/code.ts` |
| Phone bridge `bridge.go` + `interfaces.go`, `go.mod`/`go.sum` pins | Copied byte for byte | `server/easy-connect/tailcat-bridge/` |
| Android interface lister | Copied | `server/easy-connect/android/EasyConnectInterfaces.kt` |
| The public relays (tailcat's default DERP map) | Copied: AnyAppAgent's only relay | |
| Ghostex's own relay `relay-eu.ghostex.dev` (second lane) | **Left out** (see below) | |
| SSH, terminals, SFTP, computer-to-computer pairing | **Left out**: the tunnel carries only port 8787 | |
| Three-word approval, P-256 device keys, signed status polls | **Left out** (see below) | |
| The `https://ghostex.dev/pair#...` link around the code | **Left out**: AnyAppAgent has no web domain; the QR is the bare code | |

**The relay.** Ghostex's own relay is a `derper` that Ghostex operates for Ghostex
(`relay-eu.ghostex.dev`, its infrastructure and its bill). Pointing AnyAppAgent at it would borrow
another product's infrastructure without its operator's say, so AnyAppAgent uses the path Ghostex
itself falls back to and that every Ghostex phone holds first: the public relays from tailcat's
default DERP map (`https://tailcat.dev/derpmap.json`, Tailscale-run, no account, no key, no secret).
No Ghostex secret or key is in this repository. If the user later wants their own relay, the
Ghostex recipe is: run Tailscale's `derper` on a host, make a second key with
`tailcat genkey --key=<file> --region=<host>`, serve it with a second `tailcat serve` on the same
port and allow-list, and put both addresses in the code (phones try the own relay first).

**The approval.** Ghostex added the three-word approval because its tunnel opens SSH and terminals
on the computer. AnyAppAgent's tunnel reaches only the companion, and the desktop app shows the QR
only when the user asks for it, so a scan of a live code pairs at once, like the same-network
6-digit code does. What still protects it: the code is in the QR only, lives 5 minutes, works
once, the allow-list is lifted only while a code is live, failed attempts are rate-limited (10 a
minute, shared with the 6-digit code), and the desktop lists every paired device and can remove it
(its token stops working and its key leaves the allow-list at once).

## 3. The PC side (built, in `server/`)

- `POST /api/admin/easy-connect {"enabled": true}` (desktop app, admin token) turns it on. The
  state goes `starting` (with `detail`, a plain sentence such as "Building the Easy Connect helper.
  This can take a few minutes...") then `ready`. The first time, the helper is built into
  `%USERPROFILE%\.anyappagent\tools` (about 2.5 minutes on this PC; Go is kept in `tools\go` for
  later rebuilds). `ANYAPP_TAILCAT_BIN` may point at an existing tailcat v0.6.0+ instead. The
  setting is remembered (`easy-connect\settings.json`) and comes back on at the next start, for
  the phones already paired (same key, so the same address), but without a code: the allow-list
  stays closed until the desktop asks for a code with `POST /api/admin/pairing/new`. Turning it on
  with `POST /api/admin/easy-connect` makes the first code at once.
- When ready, `AdminState.easyConnect.code` is the string the QR encodes and `expiresAt` its end.
  While that code is live, the helper runs without `--allow` (the pairing window). When the code is
  used, 3 seconds later (so the phone's answer gets back), or when it expires, the helper restarts
  with `--allow=<every paired phone's client key>` or `--allow=none`. A used or expired code
  disappears from the state; `POST /api/admin/pairing/new` makes a new 6-digit code and a new Easy
  Connect code together.
- `DELETE /api/admin/devices/:id` removes the device's token and its client key; the helper
  restarts without it.
- Nothing about Easy Connect is logged except plain events ("Easy Connect helper starting
  (allowListRestored; 1 device(s) allowed)"); the address and the secret never are.

## 4. The contract for the phone side

### 4.1 The code (what the QR contains)

The desktop app shows a QR whose text is exactly `AdminState.easyConnect.code`:

```
ANYAPP-EC1:<BASE32>
```

- Prefix `ANYAPP-EC1:`; compare case-insensitively (a QR reader may lowercase).
- `<BASE32>`: RFC 4648 base32, alphabet `ABCDEFGHIJKLMNOPQRSTUVWXYZ234567`, **no padding**; read it
  case-insensitively. Decoding: take 5 bits per character, emit a byte per 8 bits, drop leftover
  bits.
- The decoded bytes are, in order (every length and the port are big-endian unsigned 16-bit):

  | Field | Encoding | Meaning |
  | --- | --- | --- |
  | address | `u16 length` + bytes | The tailcat address: the string `"tc"` followed by these bytes in base64url **without padding** |
  | secret | `u16 length` + bytes | The one-time pairing secret: these bytes in base64url without padding |
  | port | `u16` | The companion's port inside the tunnel (8787) |
  | name | `u16 length` + UTF-8 | The PC's name, to show the user |

  Ignore any bytes after `name` (later fields may be added there).
- Reject the code if any field is cut short, `address` or `secret` is empty, or the prefix differs.
- The reference reader is `decodeEasyConnectCode` in `server/src/easy-connect/code.ts` (about 40
  lines, no dependencies besides `Buffer`; for React Native write the base32 and base64url parts
  by hand like Ghostex's `pairingCodes.ts` does, or copy that file's `decodeBase32` and
  `encodeBase64Url`).
- A real code is about 350 characters (QR version 11 to 12 in alphanumeric mode).

The scanner should accept both kinds of QR: `anyappagent://pair?url=...&code=...` (same network)
and `ANYAPP-EC1:...` (Easy Connect). Also offer "paste a code" for the Easy Connect text.

### 4.2 What the phone app embeds

1. **The tailcat bridge**, built from `server/easy-connect/tailcat-bridge/` (Ghostex's
   `bridge.go` and `interfaces.go`, unchanged) with gomobile:
   ```
   node server/easy-connect/build-android-bridge.mjs
   ```
   (needs `ANDROID_HOME` with an NDK, and `JAVA_HOME`; on this PC
   `ANDROID_HOME=D:\tools\android\sdk`, `JAVA_HOME=D:\tools\android\jdk`). It installs gomobile
   and gobind at Ghostex's pin `v0.0.0-20260821190718-4776eadac327` with the private Go in
   `%USERPROFILE%\.anyappagent\tools`, runs
   `gomobile bind -target=android -androidapi 24 -javapkg dev.anyappagent -o tailcatbridge.aar .`,
   and writes, outside the repository:
   - `%USERPROFILE%\.anyappagent\tools\tailcatbridge\tailcatbridge.aar`
   - `...\tailcatbridge\staged\libs\tailcatbridge.jar`
   - `...\tailcatbridge\staged\jniLibs\{arm64-v8a,armeabi-v7a,x86,x86_64}\libgojni.so`

   Built and checked on this PC on 2026-11-10 (about 10 minutes the first time): the jar has
   `dev.anyappagent.tailcatbridge.Tailcatbridge` with `useClientKeyFile(String)`,
   `startForward(String, String, long)`, `stopForward(String)`, `stopAll()`, `lastError(String)`,
   `forwardPath(String)`, `ping(String, long)` and `setInterfaceLister(InterfaceLister)`, and the
   interface `dev.anyappagent.tailcatbridge.InterfaceLister`. Each `libgojni.so` is about 36 MB
   uncompressed, so limit the app to the ABIs it needs (`ndk { abiFilters "arm64-v8a", "x86_64" }`:
   phones and the emulator) to keep the APK small.

   Do it the Ghostex way inside an Expo native module: copy `tailcatbridge.jar` to
   `<module>/android/libs/` with `implementation files("libs/tailcatbridge.jar")` in the module's
   `build.gradle`, and the `.so` files to `<module>/android/src/main/jniLibs/<abi>/` (AGP refuses a
   local `.aar` inside a library module). The `.jar` and `.so` are build output: keep them out of
   Git (or commit them deliberately; Ghostex does not). The Java entry point is
   `dev.anyappagent.tailcatbridge.Tailcatbridge`.
2. **R8 keep rules** (consumer rules of the module), or release builds break the JNI callbacks:
   ```
   -keep class go.** { *; }
   -keep class dev.anyappagent.tailcatbridge.** { *; }
   ```
3. **The two Kotlin files** in `server/easy-connect/android/`: `EasyConnectInterfaces.kt`
   (Ghostex's interface lister) and `EasyConnect.kt` (init, client key, start, stop). Change their
   `package` line to the module's package. Call `EasyConnect.init(context)` from the module's
   `OnCreate`, before any JavaScript can ask for a tunnel. Expose to JavaScript:
   - `easyConnectClientKey(): Promise<string>`: `"nodekey:<64 hex>"`.
   - `easyConnectStart(address: string, port: number): Promise<{ localPort: number }>`: blocking
     in Go for up to about 20 seconds on a cold start, so run it on a background executor.
   - `easyConnectStop(): Promise<void>`.
4. **Network permissions**: `INTERNET`, and cleartext HTTP to `127.0.0.1` allowed (the app
   already allows cleartext to the PC; make sure `127.0.0.1` and `localhost` are included if the
   network security config lists domains).

### 4.3 How the phone dials and pairs

1. Scan or paste the code, decode it (4.1).
2. `easyConnectClientKey()` gives `clientKey`.
3. `easyConnectStart(address, port)` gives `localPort`. Base URL: `http://127.0.0.1:<localPort>`.
   If it fails ("tailcat: cannot reach paired machine: ..."), say in plain words that the PC could
   not be reached and to keep the AnyAppAgent desktop app open, and offer to try again.
4. `POST http://127.0.0.1:<localPort>/api/pair/easy-connect` with JSON
   `{ "secret": <code.secret>, "deviceName": <phone model>, "clientKey": <clientKey> }`
   (`EasyConnectPairRequest` in `shared/protocol.ts`). Answers:
   - `200 { token, serverName }` (`PairResponse`): paired.
   - `401 { error }`: the code is used up or older than 5 minutes; ask the user to show a new QR.
   - `429 { error }`: too many attempts; wait a minute.
   - `400 { error }`: the client key was missing or malformed.
5. Save, in secure storage: `token`, `address` (the `tc...` string, it is the only way back in; it
   is a secret, never log it), `port`, `serverName`, and that this PC uses Easy Connect. Do not
   save the secret: it is spent.
6. **Reconnect once after pairing.** About 3 seconds after the pairing answer the PC restarts its
   helper with the phone's key on the allow-list, which drops the tunnel. Call
   `easyConnectStart(address, port)` again (the bridge probes the tunnel it has and rebuilds it
   when it no longer answers) and use the `localPort` it returns. Proven on this PC: about 6
   seconds after the restart the reconnect succeeds.

### 4.4 Using the normal protocol over the tunnel

Everything in `shared/protocol.ts` works unchanged; only the base URL differs:

- HTTP: `http://127.0.0.1:<localPort>/api/...` with `Authorization: Bearer <token>`.
- WebSocket: `ws://127.0.0.1:<localPort>/ws?token=<token>`.
- APK download: `GET http://127.0.0.1:<localPort>/api/apps/:id/apk?abi=<abi>` (Range and If-Range
  work; the phone resumes a cut download where it stopped).
- `localPort` changes whenever `easyConnectStart` is called again; never cache it across app
  starts.

**When to call `easyConnectStart` again:** at app start, when the app comes back to the foreground,
when the network changes, and whenever a request or the WebSocket fails with a connection error. It
is cheap when the tunnel is healthy (it probes and reuses it). A good order when the phone has both
paths saved: try the same-network URL first if one is saved and answers `GET /api/health` within
2 seconds, otherwise use Easy Connect.

**Long transfers in the background.** The tunnel lives in the app's process. Keep downloads of an
APK in the foreground, or run them from a foreground service, so Android does not freeze the
process mid-transfer.

### 4.5 What the phone must never do

- Never log or display the `tc...` address or the secret.
- Never send the token anywhere but `127.0.0.1:<localPort>` or the saved same-network URL.
- Never create a new client key when one exists: the key on the PC's allow-list is the one in
  `filesDir/tailcat/client.key`. Clearing app data means pairing again.

## 5. Proof on this PC (without a phone)

`node server/scripts/easy-connect-check.mjs` starts a real companion, turns Easy Connect on, and
runs `ecclient` (built from the same bridge code the phone embeds, `cmd/ecclient` in the bridge
folder, calling `UseClientKeyFile` and `StartForward` exactly like `EasyConnect.kt`) with
`TS_DEBUG_ALWAYS_USE_DERP=true`, which turns off direct UDP in that client so every packet goes
through the public DERP relay. The run on 2026-11-10:

```
   1.3s OK   Easy Connect ready: code issued
   1.3s OK   code ANYAPP-EC1:… (354 chars, expires 2026-11-10T04:34:19.666Z) decodes: port 8795, name "M7-Desktop", address 232 chars, secret 32 chars
   1.3s OK   neither the address, the secret nor the admin token is in the companion's log
   1.8s OK   phone stand-in dialed the Easy Connect address (TS_DEBUG_ALWAYS_USE_DERP=true): LOCALPORT 3291
   5.3s link: PATH {"path":"relay","relay":"tc303a.ipn.dev","latencyMs":200}
   5.3s OK   the link runs through the DERP relay, not a direct path
   5.7s OK   through the tunnel: GET /api/health -> 200
   6.2s OK   through the tunnel without a token: GET /api/apps -> 401
   6.4s OK   pairing with a wrong secret -> 401
   6.6s OK   POST /api/pair/easy-connect with the code's secret -> 200, token received, serverName "M7-Desktop"
   6.8s OK   the same code a second time -> 401 (single use)
  10.0s OK   helper restarted with the allow-list holding exactly the new phone
  15.9s OK   paired phone reconnects through the relay: LOCALPORT 3549
  16.6s OK   through the tunnel with the token: GET /api/apps -> 200 []
  17.0s OK   through the tunnel: WebSocket /ws -> {"type":"hello","serverName":"M7-Desktop","protocol":1}
  17.2s OK   through the tunnel: POST /api/apps, then app.updated (creating) and the user's chat.item arrive on the socket
  17.6s OK   admin state lists "Tunnel test phone" as connected
  20.3s OK   after a restart Easy Connect is back on (ready) with no code, serving only the paired phone
  25.8s OK   the paired phone reconnects after the restart: LOCALPORT 4643
  26.4s OK   through the tunnel after the restart: GET /api/apps -> 200
  46.5s OK   a client whose key is not on the allow-list cannot reach the companion (ERROR tailcat: cannot reach paired machine: context deadline exceeded)
  47.3s OK   unpair the phone on the PC -> 204
  72.8s OK   after unpairing, the same phone cannot reach the companion any more (ERROR tailcat: cannot reach paired machine: context deadline exceeded)
  73.5s OK   POST /api/admin/pairing/new makes a fresh Easy Connect code and opens the pairing window
  73.5s OK   same-network pairing with the 6-digit code still works -> 200
  75.3s OK   POST /api/admin/easy-connect {enabled:false} -> off, helper stopped
  77.3s EASY CONNECT CHECK PASSED
```
