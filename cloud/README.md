# cloud/: Kiwimake Cloud

The plan is `docs/CLOUD.md`. This folder holds the cloud's own code: the Convex backend
(milestone 1), the runner's line to Convex, the box image's scripts, and the spike's scripts
(milestone 0, below) that proved the risky parts.

## The backend (milestone 1)

| Path | What |
| ---- | ---- |
| `convex/schema.ts` | The data model (docs/CLOUD.md sections 4 and 5). |
| `convex/config.ts` | Prices, credits, allowances, model prices and box timings: one place. |
| `convex/accounts.ts` | The Kiwimake account (`me`), the PC-off switch, PC links. |
| `convex/apps.ts`, `convex/chat.ts` | The phone's side: the grid, making and removing an app, the chat (live), send, stop, permissions, helpers. Rows come back in `shared/protocol.ts` shapes. |
| `convex/runner.ts`, `convex/http.ts` | The box's side: `/runner/hello`, `/runner/take` (long poll) and `/runner/ack`, `/runner/events` (ServerEvents), `/runner/upload-url`, `/runner/build`, the signing routes; Instabox's webhook. |
| `convex/boxes.ts`, `convex/crons.ts` | One box per thread: make, wake, start the runner, pause after 5 minutes, snapshot and delete after an hour, restore, retire; a minute tick and a 10-minute reconcile. |
| `convex/lib/provider.ts`, `convex/lib/instabox.ts` | The box provider interface and Instabox behind it (REST, API key). |
| `convex/lib/credits.ts` | The subscription row, the free monthly grant, ledger and balance. |
| `convex/signing.ts`, `convex/lib/crypto.ts` | App keys sealed (envelope: a data key per key, wrapped by `KEYS_KEK`), one-time signing tickets, the signing log. |
| `runner/convex-link.mjs` | The runner's routes, the 250 ms event batches, take with acknowledge. |
| `runner/runner.mjs` | The box's runner (milestone 2): reads the runner token from stdin, writes the agent's proxy placeholder, sets the companion's cloud config and runs `server/src/cloud-runner.ts`. |
| `box/provision-v1.sh`, `box/agent.sh` | The image `anyapp-box-v1` on top of v0: the `kiwi` group, `/data/apps`, the agent-owned shared caches, the agent's wrapper (`sudo -n -u agent -H /opt/kiwi/agent.sh ...`), the companion's dependencies. |
| `scripts/box.mjs`, `scripts/box-exec.mjs` | A dev box by hand (create, delete, snapshot, upload) and one command on it, for the image. |
| `scripts/m2-proof.mjs`, `scripts/say.mjs`, `scripts/usage-cost.mjs` | The milestone 2 proof (a real app through Convex), one chat message as the proof's stand-in, the AI cost of a runner log at list price. |
| `runner/stub-runner.mjs` | A stand-in runner (no agent): lifecycle tests with `RUNNER_ENTRY=stub-runner.mjs`. |
| `scripts/dev.mjs` | `env`, `deploy`, `bundle` (the runner bundle boxes download), `run`, `codegen` on the dev deployment, secrets on stdin only. |
| `scripts/m1-proof.mjs` | The milestone 1 proof on real boxes. |
| `tests/backend.test.ts` | `npm test`: the functions against convex-test. |

Milestone 1 on real boxes (12 Nov 2026, Instabox Free plan, a stand-in runner, `scripts/m1-proof.mjs`):

| Step | Time |
| ---- | ---- |
| Make an app to the first reply: box made from the image, runner bundle fetched and started | 76 to 125 s (101 s in the last run) |
| A reply on a running box (phone to box to phone) | 2.8 s |
| Pause | 5 s |
| A reply after resume (the box wakes, the runner carries on) | 3.4 s |
| Snapshot and delete (resume, stop, snapshot the stopped box, delete) | 21 s |
| A reply after a restore from the thread's own snapshot | 189 s |
| Remove the app (box and snapshot deleted) | 4 s |

What the real boxes taught: a box says "running" while its create operation still runs (commands
get `409 operation_conflict` until it ends: the provider waits); suspend and the other lifecycle
calls need an `Idempotency-Key`; a paused box cannot be snapshotted; a long poll cut by a pause
loses its answer, so the inbox offers work with a lease and the runner acknowledges it.

## The spike (milestone 0)

| Path | What |
| ---- | ---- |
| `convex/` (in the spike) | The Convex project (dev deployment only): Convex Auth (Google, a 6-digit code by email through Resend, and a dev-only anonymous sign-in), a one-thread chat, the runner's HTTP routes (`/runner/take` long poll, `/runner/post`, `/runner/upload-url`). |
| `runner/spike-runner.mjs` | The box's loop for the spike: takes a prompt from Convex, runs one agent turn over ACP (`claude-agent-acp`, the Claude Agent SDK), posts the reply and its usage, builds with `builder/` (`ANYAPP_SIGN_LATER=1`), uploads the x86_64 APK to Convex storage, posts the build. Milestone 2 replaces it with `server/`'s real runner. |
| `runner/start.sh` | Starts the runner with fixed arguments, so stdin (the secrets) can only reach it. |
| `box/provision-sdk.sh` | Installs the Android SDK pieces `docs/ENVIRONMENT.md` pins, on a box. |
| `box/git-with-token.sh` | Runs one git command with a token from stdin (not used yet: see "Not proven"). |
| `box/Dockerfile` | The same image as an OCI recipe for `instabox snapshot import` (not built yet). |
| `spike/convex.mjs` | Sets the dev deployment's env vars from the secrets file through stdin, deploys, rotates the runner token, runs a function (`run github:createRepo '{...}'`). Starts Convex's CLI with Node, no shell. |
| `spike/github-app.mjs` | The GitHub App: its JWT, installation tokens narrowed to one repo, repo create and delete. |
| `spike/github-secret.mjs` | Mints a one-repo installation token and saves it as an Instabox proxy Secret (stdin only). |
| `convex/github.ts` | The App's OAuth callback (`/github/callback`: code to user token, sealed with `KEYS_KEK`) and `createRepo` with the user token. |
| `spike/run-runner.mjs` | Starts the runner on a box for one prompt, the secrets on stdin (`--instabox-secrets`: only the runner token; the AI key comes from the Secrets proxy). |
| `spike/instabox-secret.mjs` | Saves a value from the secrets file as an Instabox proxy Secret, scoped to named hosts, through the signed-in CLI and stdin. |
| `spike/send.mjs` | A command-line stand-in for the phone: signs in without an account, sends a prompt, prints the chat. |

The phone side of the spike is `app/src/app/cloud-spike.tsx` (opened with
`adb shell am start -d anyappagent://cloud-spike <package>`, only in a build made with
`EXPO_PUBLIC_CONVEX_URL`).

## How to run it again

Keys live in `%USERPROFILE%\.appwin-secrets\cloud-dev.env` and `github-app.pem`; every script reads
them from there and passes values only on stdin.

```
cd cloud && npm install
node spike/convex.mjs env       # once: auth and runner env vars on the dev deployment
node spike/convex.mjs deploy    # push convex/ to the dev deployment
INSTABOX_BIN=<instabox executable> node spike/instabox-secret.mjs ANTHROPIC_API_KEY --ai anthropic   # once, signed-in CLI
instabox create --name spike --snapshot anyapp-box-v0 --secrets ANTHROPIC_API_KEY
INSTABOX_BIN=<instabox executable, not the .cmd shim> node spike/run-runner.mjs spike --instabox-secrets
node spike/send.mjs "Change the subtitle to ..."    # or the phone screen
```

## Spike results (12 Nov 2026)

Box: Instabox Free plan, 4 vCPU / 8 GiB, `agent-browser` template (Debian 13, Node 22.23, OpenJDK
21.0.12, Docker). Times are wall clock from this PC through the CLI (about 1 to 2 s of each is the
CLI's own round trip) unless they say "server".

| What | Measured |
| ---- | -------- |
| Create a box from the stock template | 0.7 s server (createdAt to readyAt), 9 s wall |
| Android SDK install on the box (platforms 37 and 36, build-tools 37 and 36, NDK 27.1, CMake 3.22.1) | 21 s, 2.8 GB |
| ACP adapter install (`@agentclientprotocol/claude-agent-acp@0.102.0`, with the native `claude`) | 8 s, 404 MB |
| Pause / resume | 3.7 s / 4.1 s (memory kept: the Gradle daemon survived) |
| Stop / start | 7.6 s / 7.2 s |
| Snapshot save (the image) | 32 s |
| Image size | 36 GiB logical (the 16 GiB root and 20 GiB `/data` disks); about 16.6 GB of content (SDK 2.8 GB, Gradle cache 3.8 GB, npm global 1.3 GB, builder deps cache 0.5 GB, the template's base system) |
| Create a box from the image snapshot | **69 s server, 75 s wall** (the stock template: under 1 s) |
| Restore a box in place from the snapshot | 83 s |
| First full build, cold Gradle (template app, both ABIs, sign after Gradle) | 370 s (Gradle 365 s, signing 2.6 s), plus 134 s lost to an HTTPS outage (below) |
| Full build of a **new** app on the same box (warm Gradle) | 258 s (while an agent turn ran beside it) |
| Full build of a new app on a **fresh box from the image** | 171 s (Gradle 167 s, signing 1.6 s), app create 19 s |
| Quick update (fast lane, JavaScript only, no Gradle) | 19 s first time (builder 10 s), then 6 to 7 s |
| APK sizes | universal 28.5 MB, x86_64 22.5 MB, arm64-v8a 22.2 MB; quick update zip 1.1 MB |
| APK download box to PC (`instabox pull`, 23.5 MB) | 12 s |
| APK upload box to Convex storage (23.5 MB) | 1.0 to 3.1 s |
| Agent turn 1 (Opus 5.5 high, "change the subtitle") | 46 s; 8 in, 401 out, 31,111 cache write, 92,335 cache read tokens; **$0.182** at list price |
| Agent turn 2, from the phone ("add a line under the name") | 30 s; 10 in, 928 out, 33,070 cache write, 126,547 cache read; **$0.209** |
| Agent turn 3, **key only in Instabox's Secrets proxy** ("change the subtitle") | 23 s; 8 in, 546 out, 22,164 cache write, 110,798 cache read; **$0.144**; the proxy counted 17 requests, 0 denied |
| Phone send to APK link on the phone (turn 2, quick build) | about 38 s |
| Memory | the 8 GiB box sits at 7.4 to 7.9 GiB used (page cache included) through every Gradle build and stays there while the Gradle daemons live; no OOM kill, also with an agent turn and a full build at once |
| Convex deploy (dev) | 6 s |
| GitHub push from a box, token only in the Secrets proxy (55 files, 836 KB) | 1.7 s |
| GitHub clone on a fresh box from the image | 0.8 s; then a full build from the clone (with `npm install`) 208 s |

**Spent**: Anthropic about $0.54 (three turns at list price, from ACP's usage; the Console's own
number was not checked). Instabox $0 (Free plan, 4.5 vCPU-hours of its free
allowance). Convex, Resend, Google, GitHub $0.

### What worked

- The box image built on a box (SDK, warm Gradle, the ACP adapter, `builder/`, the template,
  the runner) and saved with `instabox snapshot save`; a box from it builds a new app in 171 s.
- Gradle never saw the key: with `ANYAPP_SIGN_LATER=1` it made only `app-*-release-unsigned.apk`,
  and the builder signed them afterwards with the app's own key (`apksigner verify` passes, cert
  `CN=AnyAppAgent com.anyappcloud.spike`). The fast lane worked unchanged on Linux.
- Model and effort per ACP session: `session/set_config_option` with `configId: "model"`,
  `value: "claude-opus-5-5"` (shown as `opus`), then `configId: "effort"` (category
  `thought_level`), `value: "high"`. The session's transcript shows `claude-opus-5-5` at `high`.
- **Instabox's Secrets proxy carries the AI key.** Saved with the signed-in CLI (a personal org's
  API key cannot manage Secrets: `missing_scope`, "a personal org's API key cannot carry
  workspace:admin"), scoped to `api.anthropic.com`, selected on a box made from the image. In the
  box `ANTHROPIC_API_KEY` is `ibsec_...` (70 characters); `GET /v1/models` with it answers 200 (a
  wrong key 401); the agent ran a whole turn and a full build on it; a scan of every file on the
  box (all of `/` but `/proc`, `/sys`, `/dev`) found the real key nowhere, before or after.
- **GitHub with a one-repo token through the Secrets proxy.** The App is installed on `maddada`
  ("Only select repositories": `anyapp-cloud-spike-seed`, installation 181146494). A token for
  that one repo (Contents write, 1 hour) went from `spike/github-secret.mjs` straight into an
  Instabox Secret scoped to `github.com` and `api.github.com`; on the box git's credential helper
  returned only the placeholder. The template app was pushed to the seed repo's `main`
  (`00f9e59`), a push to another repo failed, and a fresh box cloned it back and built it.
  (Instabox's per-Secret counter said 0 right after the first box's push and 3 after the clone.)
- **An installation token cannot create a repo on a personal account**: `POST /user/repos` answered
  `403 "Rate Limit Exceeded"` five times over 15 minutes while the token's core limit had 4,998 calls
  left, although GitHub's permissions page lists installation tokens for it. Repos are made with
  the person's user token, as `docs/CLOUD.md` planned.
- **The repo made with the person's user token, and it joins the install.** After the person
  authorized the App, `/github/callback` stored their user token sealed with `KEYS_KEK` (with a
  refresh token, 8 hours). `npx convex run github:createRepo` made `maddada/anyapp-cloud-spike-1`
  (201, private), and it was in the "Only select repositories" install at once
  (`/installation/repositories` lists it; a one-repo installation token for it could be minted).
  The install's own OAuth code had been lost (it reached a callback that did not exist yet), so one
  extra authorization was needed.
- The fallback without a secrets proxy also worked: the runner held the key in memory and served a forwarder on
  127.0.0.1; the agent ran as the Unix user `agent` with a dummy key and
  `ANTHROPIC_BASE_URL` pointing at it. A search of every file the agent could reach for the real
  key found none.
- Convex Auth: Google reaches Google's sign-in page with our client and the
  `https://<name>.convex.site/api/auth/callback/google` redirect (checked with curl); the email code
  goes out through Resend (to Resend's `delivered@resend.dev` test inbox, from the phone);
  the dev-only anonymous sign-in works from the phone.
- One round trip phone -> Convex -> box -> Convex -> phone with the Convex React Native client
  (live queries, no polling), and the APK the box built installs and runs on the emulator with
  the agent's changes (`C:\aa\e2e\cloud-spike\`).

### Not proven (needs the user)

- **Google sign-in to the end** and **the email code to the end**: both need the person's own
  Google account or inbox.
- Two helpers and a build at once (the spike ran one agent session; no `start_worker` helper).
- `box/Dockerfile` and `instabox snapshot import`.

### Surprises

- **The Free plan is narrower than the docs page**: only the `agent-browser`, `android`,
  `omarchy` and `ci` templates (or a snapshot), idle pause fixed at 30 minutes (`--auto-suspend`
  refused), and `maxRunMinutes: 120` on the machine (the limits page says 480).
- **All outbound HTTPS goes through Instabox's TLS-intercepting proxy**, even with no Secrets
  (`NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE` point at its CA; Java's cacerts has it too). During the
  first Gradle build every HTTPS connection failed for about 1.5 minutes ("Remote host terminated
  the handshake", curl "Broken pipe") while plain HTTP worked, then it recovered by itself. The
  runner must retry a build that fails on downloads.
- A box from a snapshot takes about 70 s, not the 1 s of a template, so "snapshot after an hour
  paused" costs the person about a minute on their next message.
- Expo's generated Gradle signs release builds with the debug key when no key is given, so "leave
  signingConfig empty" is not enough: the init script now sets it to `null` when
  `anyappSignLater` is set.
- The agent's template playbook still mentions tools the spike's runner does not offer
  (`describe_change`), and says so to the person; the real runner (milestone 2) brings them.
- A secret was printed once (see the report): on Windows the npm `.cmd` shim of the CLI needs a
  shell, the shell re-split the arguments, the box ran a bare `node`, which evaluated stdin and
  printed it in its error. Fixed by starting the real executable without a shell and a fixed
  `start.sh`; the runner token was rotated.
