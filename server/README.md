# Kiwimake PC companion

Pairs with the phone, keeps one Claude Code session per app (over ACP, the way bb does it),
scaffolds and builds apps, does Git and GitHub, and serves the APKs. Contract: `../shared/protocol.ts`.

## Start

```
cd server
npm install
npm start            # or, from the repo root: node server/bin/anyappagent.mjs
```

Node 24 or newer runs the TypeScript sources directly; there is no build step. The terminal shows
the 6-digit pairing code, the addresses the phone can use, and a QR code. The code is also in
`%USERPROFILE%\.anyappagent\pairing-code.txt`. A new code is made at every start; paired phones
stay paired.

## Settings (environment variables)

| Variable                | Default                       | Meaning                                                          |
| ----------------------- | ----------------------------- | ---------------------------------------------------------------- |
| `ANYAPP_PORT`           | `8787`                        | HTTP and WebSocket port                                          |
| `ANYAPP_HOST`           | `0.0.0.0`                     | Bind address                                                     |
| `ANYAPP_STATE_DIR`      | `%USERPROFILE%\.anyappagent`  | Tokens (hashed), apps, chat history, APKs                        |
| `ANYAPP_APPS_DIR`       | `C:\aa\apps`                  | Where app projects are created                                   |
| `ANYAPP_BUILDER`        | `auto`                        | `real` = `../builder/index.mjs`, `fake` = built-in fake, `auto` = real when it exists |
| `ANYAPP_GITHUB`         | `on`                          | `off` skips creating and pushing GitHub repos                    |
| `ANYAPP_ASK_PERMISSIONS` | off                         | `1` (dev and tests only): the session stays in the default mode and every permission request waits in the chat |
| `ANYAPP_ACP_LAUNCH`     | `local`                       | `npx` launches Claude with bb's exact registry command (`npx -y @agentclientprotocol/claude-agent-acp@0.102.0`) |
| `ANYAPP_ADMIN_TOKEN`    | unset                         | The desktop app's secret: accepted on every route, the only key to `/api/admin/*` |
| `ANYAPP_HOST_APK`       | unset                         | The Kiwimake phone app's APK, served at `GET /download/anyappagent.apk` |
| `ANYAPP_TAILCAT_BIN`    | `tools\tailcat\tailcat.exe` | An existing tailcat v0.6.0+ for Easy Connect instead of building one |
| `ANYAPP_STOP_ON_STDIN_END` | unset                      | `1`: stop (and stop the Easy Connect helper) when stdin closes, for a parent process |
| `ANYAPP_FAKE_BUILD_MS`  | `1500`                        | Fake builder: how long a build takes                             |
| `ANYAPP_FAKE_BUILD_FAIL`| unset                         | Fake builder: `always`, or `N` = the first N builds fail          |

## Tests

```
npm test             # unit tests (stream -> ChatItem translation, build retries, helpers)
npm run typecheck
npm run e2e          # real Claude Code session + fake builder, GitHub off, temp dirs, port 8797
node scripts/admin-check.mjs          # the desktop app's admin contract (port 8796)
node scripts/easy-connect-check.mjs   # Easy Connect through the public relay (port 8795)
node scripts/apps-cli-e2e.mjs         # overview.md and `anyapp`: two apps, real Claude Code (port 8811)
node scripts/backfill-overviews.mjs   # one-time draft overview.md for older apps (--state-dir, --write)
```

## Layout

- `src/acp/` – the Claude Code ACP client (bb's code, see `THIRD_PARTY_NOTICES.md`) and the
  `session/update` → `ChatItem` translation.
- `src/apps.ts` – app lifecycle: create, per-app work queue, turns, build-after-turn with up to 3
  fix attempts, Git/GitHub, icons.
- `src/easy-connect/`: Easy Connect (the Tailcat helper, the code, the pairing window and
  allow-list). `easy-connect/`: the phone bridge copied from Ghostex, the Android build script, the
  Kotlin files for the phone app. Design and phone contract: `../docs/EASY-CONNECT.md`.
- `src/playbook.ts` – the instructions every app session gets.
- `src/apps-cli.ts` and `bin/anyapp.mjs` – the `anyapp` command the apps' agents use to see the
  person's other apps (`anyapp apps`, `anyapp overview <app>`, `anyapp path <app>`). The companion
  writes `anyapp` and `anyapp.cmd` launchers into `<state>/bin` at start and puts that folder first
  on every agent session's PATH, with `ANYAPP_CLI_STATE_DIR` and `ANYAPP_CLI_APP`. It reads
  `apps.json` and the app folders directly: no token in the agents' environment, read only.
- `src/http.ts` – routes and WebSocket; `src/auth.ts` – pairing and tokens; `src/store.ts` – JSON
  persistence; `src/builder.ts` – the adapter to `builder/`; `src/fake-builder.ts` – the fake.
