# AnyAppAgent Cloud: the plan

A cloud version of AnyAppAgent for **anyone who does not want to install the PC app**. The person
installs only AnyAppAgent on the phone, signs in with Google or a code by email, and makes and
changes apps exactly as today: the chat is in the phone app, the APK or quick update arrives on
the phone. The agent and the builds run on rented cloud machines, one per thread; everything that
must last (accounts, apps, chats, usage, builds, files, signing keys) lives in Convex.

Status: a plan, nothing built. Facts were checked on the web on **12 Nov 2026**; each has its source
link. Not legal advice: section 1 says which answers must come from Anthropic or a lawyer.

The user's answers this plan follows (they override `C:\aa\ideas\cloud-changes.html`): chat in the
AnyAppAgent phone app (Q300 "app"), Google or a code by email (Q301), "we will sell tokens (just use
open router key)" and also let people add their own Claude API key, Convex for most things, one
instabox.sh box per thread, signing keys stored encrypted in Convex, storage free to the person,
inference and machines charged at cost plus 10%, nothing charged to someone who does not use them,
spending limits later.

## 1. The terms question first

**Short version.** Selling tokens through our OpenRouter key while the agent is Claude Code is what
Anthropic's Claude Code terms forbid by name, unless Anthropic agrees in writing. People bringing
their own Anthropic API key is allowed in so many words. Selling usage through a different agent
(not Claude Code) moves us under Anthropic's Commercial Terms and OpenRouter's terms, which allow
building products for end users but also forbid "reselling" access; whether cost plus 10% on tokens
counts as reselling is a question for Anthropic or a lawyer.

### What the texts say (verbatim)

Claude Code, Legal and compliance (https://code.claude.com/docs/en/legal-and-compliance), section
"Can customers offer Claude Code in their products?":

> "Unless we've mutually agreed otherwise, preinstalling or running Claude Code in your products or
> services (e.g. in hosted sandboxes or other agent infrastructure) requires agreeing to our
> Commercial Terms of Service and complying with the conditions below:"
>
> "**Customers may not pay for, resell, or intermediate Claude usage on their end users' behalf.**
> Each end user must authenticate with their own Anthropic API key, Claude subscription plan
> credentials, or 3P inference provider credential (Amazon Bedrock, Google Cloud's Agent Platform,
> Microsoft Foundry). That usage is billed directly to the end user under their own agreement with
> Anthropic or, for third-party inference providers, with the applicable provider."

Same page, "Authentication and credential use":

> "**Developers** building products or services that interact with Claude's capabilities, including
> those using the Agent SDK, should use API key authentication through Claude Console or a
> supported cloud provider. Anthropic does not permit third-party developers to offer Claude.ai
> login into their own applications, or to route requests through Free, Pro, Max, or Ultra plan
> credentials on behalf of their users."
>
> "This does not restrict how customers provision and manage their own API keys or third-party
> inference provider credentials (...) for use by the customer's own authorized users, provided the
> resulting usage is billed to the key owner under their agreement with Anthropic (or the
> applicable provider) and is not resold or intermediated as described above."
>
> "Anthropic reserves the right to take measures to enforce these restrictions and may do so
> without prior notice."

Claude Agent SDK overview (https://code.claude.com/docs/en/agent-sdk/overview):

> "Use of the Claude Agent SDK is governed by Anthropic's Commercial Terms of Service, including when
> you use it to power products and services that you make available to your own customers and end
> users"

Anthropic Commercial Terms (https://www.anthropic.com/legal/commercial-terms, effective 17 Jun 2025):

> A.1 "Anthropic gives Customer permission to use the Services, including to power products and
> services Customer makes available to its own customers and end users ("Users")"
>
> D.4 "Customer may not and must not attempt to (a) access the Services to build a competing product
> or service, including to train competing AI models or resell the Services except as expressly
> approved by Anthropic"

Anthropic Usage Policy (https://www.anthropic.com/legal/aup, the page says effective 12 Nov 2026,
so it changed today): "Resell, proxy, or otherwise provide access to Claude through unauthorized
means, including services that route requests through consumer subscriptions or misrepresent the
product or client being used", and "All consumer-facing chatbots or AI agents that communicate
directly with external users must disclose to users that they are interacting with AI rather than a
human".

OpenRouter Terms (https://openrouter.ai/terms, updated 31 Aug 2026): prohibited, "access the Site or
Service for purposes of reselling API access to Models or otherwise developing a competing service";
allowed, 5.1 "the Service enables you, your Authorized Users, and your customers (to the extent you
incorporate the Service into your own products and services) access to Models"; and 5.1 "you agree,
and will ensure that your Authorized Users and customers agree, to comply with the applicable terms
for each Model ("Model Terms")". OpenRouter lists Anthropic's Commercial Terms as Anthropic's Model
Terms.

### What that means for each way of paying

| Way | Agent | What the texts say | Needs whose answer |
| --- | ----- | ------------------ | ------------------ |
| **A. Our OpenRouter key, we sell tokens** | Claude Code | "may not pay for, resell, or intermediate". Per-person OpenRouter keys made under our account are still our account and our bill. OpenRouter is also not in the listed 3P providers. Pointing Claude Code at OpenRouter with `ANTHROPIC_BASE_URL` works technically (OpenRouter's own guide) but does not change who pays. | **Anthropic's written agreement** ("Unless we've mutually agreed otherwise"). Without it, not allowed. |
| **B. The person's own Anthropic API key** | Claude Code | Named as allowed: "their own Anthropic API key". | None for the key itself. We charge only for machines. |
| **C. The person's own OpenRouter key** | Claude Code | Billed to them under their own OpenRouter agreement, but OpenRouter is not one of the three named 3P providers. | Anthropic: is OpenRouter an accepted "3P inference provider credential"? |
| **D. Our credit, a different agent** (an open agent loop over the API, for example OpenCode, which speaks ACP) | Not Claude Code | The Claude Code conditions do not apply. Commercial Terms A.1 allows powering products for end users; D.4 forbids reselling "except as expressly approved"; OpenRouter forbids "reselling API access to Models" but allows incorporating it into our product. | **A lawyer, or Anthropic**: is "app changes paid per use at model cost plus 10%" a product (A.1) or resale (D.4)? Pricing per change instead of per token reads more like a product. |
| **E. The Claude Agent SDK with our key** | Agent SDK (it runs Claude Code underneath; our ACP adapter `claude-agent-acp` is built on it) | The SDK page puts it under the Commercial Terms for end-user products, but the legal page names "products or services that interact with Claude's capabilities, including those using the Agent SDK" in the same breath. It is not a clean way around the Claude Code condition. | Anthropic. Treat it like A until they say otherwise. |
| **F. Claude Pro, Max or Ultra sign-in** | Claude Code | Allowed only as the person signing in to the unmodified binary through Anthropic's own flow; "developers may not collect, store, or intermediate Claude.ai credentials or session tokens". Keeping a sign-in alive across boxes looks like storing. | Anthropic. Left out of the first version. |

### "The $200 Claude plan has $200 free"

Mostly true today, with the plans renamed (https://claude.com/pricing and
https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-ultra-and-team-plans):

- The $200 a month plan is now **Ultra**: "$200 a month in API credits, up from $100 on Max". **Max**
  is $100 a month with "$100 a month in API credits". "Free, Pro, and Enterprise plans aren't
  eligible."
- "To claim your credit, you link a Claude Console organization to your plan." "New subscribers can
  claim once they've been on an eligible plan for seven days." "Unused credits expire at the end of
  each billing cycle."
- They do not cover "Interactive Claude Code in the terminal, IDE, desktop, or web", but "API credits
  cover `claude -p` and the Claude Agent SDK when you run them yourself with an API key from your
  linked Claude Console organization".

So an Ultra (or Max) subscriber can make a Console API key that draws on that credit and paste it
into AnyAppAgent Cloud (way B). Open point: whether our service running Claude Code with their key
counts as "when you run them yourself" for the credit. Ask Anthropic; if not, the key still works,
it is just billed to their Console balance.

### Recommendation

1. **Today**: the user writes to Anthropic (https://www.anthropic.com/contact-sales, the link the
   legal page gives) asking for an agreement to run Claude Code for end users on our credit (way A).
   Costs nothing; the answer decides the most.
2. **First version ships way B** (their own Anthropic key, Ultra and Max credit included), which is
   allowed now. We charge machines only.
3. **Credit (selling tokens) is built behind a switch** and turned on only after either Anthropic's
   yes (then way A, Claude Code on per-person OpenRouter keys) or a lawyer's yes on way D (then
   OpenCode over OpenRouter, priced per change).
4. Also needed in writing: **Instabox's** terms (section 8) forbid making the service "available to
   any third party"; ask them to confirm a hosted product where our agent runs the box is fine.

## 2. How people pay for AI in the product

"Your AI" in Settings, three choices, shown plainly:

- **Use my Claude API key** (way B, first version). Pasted once, stored encrypted (section 6). If
  they have Max or Ultra, a one-line hint: "Your plan includes monthly API credit: link a Console
  organization, then make a key there." We charge only the machine time, cost plus 10%.
- **Use my OpenRouter key** (way C, only if Anthropic says OpenRouter counts).
- **Buy credit from AnyAppAgent** (way A or D, only after the answers above). Top up with Stripe;
  each change shows what it cost us and the 10% on top.

Whatever the way, the key is never put in a file or an environment variable on the box: Instabox's
Secrets proxy adds it to outgoing HTTPS requests, so the agent cannot print it (section 8, to be
proven in the spike).

## 3. The architecture

```
 AnyAppAgent on the phone              Convex (one deployment)                 Instabox (one box per thread)
 Sign in (Google / email code) ----->  auth: users, sessions
 Home grid, chat, Settings     <====>  live queries + mutations
   (Convex React Native client)        apps, threads, messages, usage, builds
 Send a message                ----->  messages.send (mutation)
                                       -> scheduler: ensureBox(thread) ------>  create / resume the box
                                                                                runner (Node, from server/)
                                       <-- HTTP actions, runner token <-----    chat rows, usage, build state
                                                                                agent over ACP + builder + fast lane
                                       file storage: APKs, quick updates <--    uploads after each build
 Install / hand quick update   <-----  build row (live) + file URL
                                       keys: wrapped, opened per signing  -->   one-time signing ticket
                                       billing: ledger, Stripe, usage
```

### The phone app

The same AnyAppAgent APK gets a second way in. First run asks **"Make apps in the cloud"** (sign in)
or **"Use my PC"** (today's pairing and Easy Connect). One mode per install in the first version.

- In cloud mode the phone talks only to Convex. The Convex React Native client keeps live queries
  for the app list, each thread's messages and builds, and the balance; it reconnects by itself and
  retries mutations until they are confirmed (Convex docs, section 8). No WebSocket to a PC.
- Everything the phone does with an APK or a quick update stays as it is (`app/src/lib/installer.ts`,
  `app/modules/anyapp-native`, the Reload card, rollback, crash reports): only where the file comes
  from changes (a Convex file URL instead of `GET /api/apps/:id/apk`).
- The screens stay the same. The data layer gets a second implementation of today's calls
  (`app/src/lib/api.ts` `Client` and the `ServerEvent` stream) backed by Convex and returning the
  same `shared/protocol.ts` types, so `shared/chat` renders cloud chats unchanged.
- New screens: sign in, "Your AI" (section 2), "Your balance" (only once credit is on).

### Convex

Holds everything that must outlive a box: people, apps, threads, chat history, usage and money,
build records, APK and quick update files, encrypted signing keys and the person's own AI keys. Its
live queries replace the companion's WebSocket. It runs no agent and no build: its actions only
call Instabox, OpenRouter, Stripe and the key service, and its HTTP actions are what the box calls.

### One Instabox box per thread

A **thread** is one app's chat with its agent. Helpers run inside the same box, as today's workers
run inside the one companion. Each thread gets its own Firecracker microVM made from one image:

- Our own OCI image, imported once with `instabox snapshot import` (amd64 only, which the Android SDK
  needs anyway): Node 22, a JDK (the builder already builds with JDK 21, `docs/ENVIRONMENT.md`, so
  Debian 13's OpenJDK 21 is fine and JDK 17 is not needed), the Android SDK and NDK as
  `docs/ENVIRONMENT.md` pins, Gradle with a warm cache for the template, the template's
  `node_modules`, the agent and the **runner**.
- The app's code lives on the box (a Git repo, as today) and goes to Convex as a Git bundle after
  every build, so losing a box loses nothing.
- **Lifecycle**: a message resumes the box (from pause "usually takes about a second"). The runner
  holds Instabox's "activity lease" while a turn or a build runs (model calls are silent, and an
  idle box would pause). **5 minutes** after the last work it pauses (memory kept, only disk billed).
  After **1 hour** paused it is snapshotted and deleted (snapshots are free today), and the next
  message restores it from the snapshot. A snapshot unused for 30 days is deleted; the code bundle
  in Convex then rebuilds the box from the image (a slower first build). The spike measures each
  of these times.

**The runner** is the companion's work loop without its HTTP server, pairing, Easy Connect or GitHub
(`server/src` minus `http.ts`, `auth.ts`, `easy-connect/`, `github.ts`). It starts the agent over ACP,
keeps the playbook, helpers (`workers.ts`), pages, to-dos, the usage meter, the build after every turn
with up to 3 fix turns (`build-cycle.ts`), versions and undo, and the fast lane. Instead of
broadcasting `ServerEvent`s on a WebSocket it posts them to a Convex HTTP action
(`POST /runner/events`, batched every 250 ms while text streams). It takes its work (new messages,
permission answers, cancel, page answers) from Convex by one long-poll HTTP action. It signs in with
a **runner token**: random, made per box, stored only as a hash in Convex, good for one thread,
revoked when the box is deleted.

**The agent on the box**: Claude Code over ACP (`claude-agent-acp`, as today) for ways A, B and C.
For way D, an open agent that speaks ACP, for example OpenCode (`opencode acp`, MIT,
https://opencode.ai/docs/acp), pointed at OpenRouter: the runner already speaks ACP, so this is a
second launcher next to `server/src/acp/claude-session.ts`, its own playbook wording, and a check of
how its tool calls translate (`translate.ts`), not a new protocol.

**The builder on the box** is `builder/` unchanged in what it builds: `createApp`, `buildApk`, the
fast lane (a JavaScript-only change is a quick build in about 16 s with no Gradle, `docs/FAST-LANE.md`).
One change: in the cloud **Gradle never sees the signing key**. With `ANYAPP_SIGN_LATER=1` the init
script leaves `signingConfig` empty, Gradle builds the release APK unsigned, and the runner signs it
with `apksigner` (as the fast lane's bundle swap already does) and the quick update with
`OtaSign.java`, in a separate step after Gradle has exited (section 6).

**Builds reach the phone without a PC.** After a successful build the runner uploads the
`arm64-v8a` APK (phones), the `x86_64` one (the emulator) and the quick update zip to Convex file
storage (not the universal APK, to save space), then writes the build row. The phone's live query
sees it, downloads its own ABI's file and installs it, or hands the quick update to the app, exactly
as on `apk.ready` today. Convex keeps the last 3 builds' files per app (go back and undo build a new
version, as today, so an old APK is never reinstalled). Convex file URLs work for anyone who has
them until the file is deleted; they are only given to the app's owner, and deleting old builds
revokes them. If downloads grow, the `@convex-dev/r2` component moves the files to Cloudflare R2
(expiring links, no egress fee) without changing the phone.

## 4. The data model in Convex

Field names follow `shared/protocol.ts` where a type already exists. `_id` and `_creationTime` are
Convex's own. Money is stored in millionths of a dollar ("micros"), never floats.

| Table | Fields (short) | Indexes |
| ----- | -------------- | ------- |
| `users` | from Convex Auth (`name`, `email`, `image`), `aiMode` ("ownAnthropic", "ownOpenRouter", "credit"), `openRouterKeyHash` (credit only), `stripeCustomerId`, `blocked` | `by_email` |
| `apps` | `userId`, `name`, `slug`, `packageName`, `preset`, `iconFileId`, `lastBuild`, `status` (`AppStatus`), `health`, `overview` (text of `overview.md`) | `by_user`, `by_package` |
| `threads` | `appId`, `userId`, `boxId`, `boxState` ("none", "starting", "running", "paused", "snapshotted", "deleted"), `runnerTokenHash`, `lastActiveAt`, `codeBundleFileId`, `agentSessionId` | `by_app`, `by_state_and_active` |
| `messages` | `threadId`, `workerId?`, `item` (a `ChatItem`: text, tool rows, plan, permission, page, build, usage), `seq` | `by_thread_seq` |
| `inbox` | `threadId`, `kind` ("prompt", "permission", "cancel", "page-answers"), `payload`, `takenAt` | `by_thread_untaken` |
| `builds` | `appId`, `number`, `delivery` ("apk" or "quick"), `files` (`{abi, fileId, sizeBytes, sha256}[]`), `otaFileId`, `runtime`, `changes` (`ChangeNotes`), `commit`, `seconds` | `by_app_number` |
| `usage` | `userId`, `appId`, `threadId`, `messageId`, `kind` ("inference" or "machine"), `tokens` (`TokenUsage`) or `seconds` and `size`, `costMicros`, `chargeMicros`, `source`, `settled` | `by_user_at`, `by_message` |
| `ledger` | `userId`, `kind` ("topup", "charge", "refund", "adjust"), `amountMicros`, `stripePaymentId`, `usageIds` | `by_user_at` |
| `balances` | `userId`, `micros` (always the sum of `ledger`, changed in the same mutation) | `by_user` |
| `keys` | `appId`, `userId`, `packageName`, `certSha256`, `wrappedDataKey`, `ciphertext`, `iv`, `kekVersion`, `lineage?` (never deleted) | `by_app` |
| `signings` | `appId`, `build`, `sha256` of what was signed, `at` | `by_app` |
| `secrets` | `userId`, `kind` ("anthropic" or "openrouter"), `wrappedDataKey`, `ciphertext`, `iv`, `last4` | `by_user_kind` |
| `boxes` | `threadId`, `instaboxId`, `size`, `startedAt`, `pausedAt`, `snapshotId`, `secondsBilled` | `by_thread`, `by_instabox_id` |

Files: APKs (per ABI), quick update zips, icons, chat pictures, page HTML, code bundles.

## 5. Metering and billing (cost plus 10%)

**What is measured, and from where:**

| What | Live number (shown while it runs) | The number we bill (the truth) |
| ---- | --------------------------------- | ------------------------------ |
| Inference, credit | Each ACP turn's `usage` (input, output, cache write, cache read), as the usage meter reads it today (`server/src/usage.ts`), times the model's price | OpenRouter: one key per person made with the Management API (formerly "provisioning keys"), so each key's own usage is that person's cost. Read after each turn and settled. Its `limit` is set to the person's balance, so OpenRouter itself stops a runaway change when the money is gone. |
| Inference, own key | The same ACP usage, shown, never billed | Billed by Anthropic or OpenRouter to them |
| Machine | Seconds the box ran (runner) | Instabox's per-machine usage endpoint (`GET /v1/machines/{id}/usage`, offered "for billing your own customers"): running seconds by size, plus disk while paused |
| Storage in Convex | Not shown | Free to the person, as decided |

**Price**: charge = our cost times 1.10, where our cost is the model's list price plus OpenRouter's
5.5% credit fee (credit only) plus the machine. Each change shows one line: "This change: $0.25
(our cost $0.23 + 10%)".

**Money in**: Stripe Checkout top-ups (the `@convex-dev/stripe` component handles the webhook). Two
rules make cost plus 10% hold up, because Stripe's fee (2.9% plus 30 cents for a US card, plus 1%
for international cards, per the earlier page) is more than half of a 10% margin on a $5 top-up:

- The card fee is added on top at checkout ("$10 credit, $10.59 to pay").
- Smallest top-up $10.

**Who pays nothing**: someone who makes no change. Storage is free. With their own AI key the only
charge is machine time, about 10 cents a month for an active person (section 7), so the first
version can leave it free under a fair-use cap (Q3).

**Running out**: a change starts only with a balance above its estimate; the OpenRouter key's limit
is the hard stop. Spending limits per month come later, as decided.

## 6. Signing keys in Convex ("so never lost")

Each app keeps its own signing key, as on the PC since stage 1 of `docs/DISTRIBUTION.md`. Losing it
means no phone ever takes that app's update again, so it is stored in Convex, encrypted, never
deleted. Leaking it means anyone can make an update phones accept, so it is opened only for one
signing, never where the agent can read it.

**Encryption (envelope):**

- One **master key** (key encryption key) that is never in Convex's database: in a cloud key service
  (Google Cloud KMS, about $0.06 a key a month) for launch. For the spike, 32 bytes in a Convex
  environment variable (`KEYS_KEK`), moved to the key service before real users. Convex encrypts
  all data at rest anyway ("All user data in Convex is encrypted at rest"), but an environment
  variable alone only slows down someone with dashboard access.
- Per app a fresh 256-bit **data key**. The PKCS12 file and its password are encrypted with it
  (AES-256-GCM, with the app id and package name as additional data, so a row copied to another app
  does not open). The data key is stored only wrapped by the master key.
- The person's own Anthropic or OpenRouter key is stored the same way in `secrets`; Settings shows
  the last 4 characters.
- "Never lost" also needs the master key never lost: the key service never destroys its versions,
  Convex backups cover the rows, and the owner keeps a sealed offline copy of an exported wrapping
  key.

**Where a key is made and used:**

1. A new app's key is made by the runner with `keytool` (as `builder/lib/keystore.mjs` does), before
   the agent starts on that app, in a folder only the runner's Unix user can read. The runner
   encrypts it to a public key from Convex, uploads it, checks it was stored, and deletes it.
2. **Signing is its own step after Gradle and the agent's turn have ended.** The agent and Gradle
   run as the Unix user `agent` (no sudo); the runner runs as `runner`. The runner asks Convex for a
   **one-time signing ticket** for that build; a Convex Node action unwraps the data key and returns
   the key encrypted to a fresh key the runner made for this one request. The runner writes it to a
   `tmpfs` file only `runner` can read, runs `apksigner` (and `OtaSign.java`) with the password from
   the environment as today, checks the result (`checkSigning`), and wipes the file. The key is on
   the box for seconds and out of the agent's reach.
3. Every signing is written to `signings` and shown in the app's Settings.

Why not sign inside Gradle as on the PC: in the cloud the agent writes `build.gradle` and Gradle runs
it, so anything Gradle can see, a bad prompt or a bad library could print or send away. A separate
signer machine, where no agent ever runs, is stronger still; it is the step after the first version
(Q6).

**Moving between PC and cloud** (after the first version): "Download this app's key" (password
protected, the desktop's key backup format, `builder/lib/keybackup.mjs`), and a PC can upload a key
the same way to move an app into the cloud.

## 7. Costs

### Per change (Opus 5.5)

Token counts are the usage meter's real run (`docs/TRUST.md`), priced on the earlier page; OpenRouter
charges the same as Anthropic's list (Opus 5.5 $4 in, $20 out, $5 cache write, $0.20 cache read per
million). Machine: Instabox 4 vCPU and 8 GiB is 4 x $0.004 + 8 x $0.00225 = **$0.034 an hour**, for
the turn, the build and 5 minutes before the box pauses.

| Change | Model (list) | Our cost with OpenRouter's 5.5% | Box minutes | Machine | Charged (cost + 10%) |
| ------ | ------------ | ------------------------------- | ----------- | ------- | -------------------- |
| Small change, quick update | $0.21 | $0.222 | about 6 | $0.004 | **$0.25** |
| Small change, full build | $0.21 | $0.222 | about 10 | $0.006 | **$0.25** |
| Bigger change (agent reads the whole app) | $0.46 | $0.485 | about 12 | $0.007 | **$0.54** |
| New app (plan, then build with helpers, first build of a new project) | $0.70 | $0.739 | about 19 | $0.011 | **$0.82** |

On Sonnet 5.5 the model part is half. With the person's own key only the machine is charged: under
a cent per change.

### Per month

Assumption (the earlier page's): an active person makes 8 changes a month (6 small, 70% of them
quick updates, 1 bigger, 1 new app). Model cost $2.42 list, $2.55 with OpenRouter's fee; machines
about 75 box minutes plus paused disk, about **$0.06**, say $0.10 with build-fix turns.

| A month | 10 people | 100 people | 1000 people |
| ------- | --------- | ---------- | ----------- |
| Inference we buy (credit, everyone on credit) | $25.50 | $255 | $2,550 |
| Instabox usage (machines and paused disk) | $1 | $10 | $100 |
| Instabox plan | $20 Pro (includes $20 usage) | $20 Pro | $100 Builder (200 boxes running at once) |
| Convex | $0 Starter | about $3 Starter, pay as you go | about $30 Professional (1 developer, $25) |
| Key service, domain, email codes | about $1 | about $1 | about $1 plus email (not priced) |
| **What we pay** (Instabox usage inside the Pro plan's $20 credit at 10 and 100) | **about $47** | **about $279** | **about $2,781** |
| **What people pay** (cost + 10% on inference and machines; the card fee added on top) | $29 | $292 | $2,915 |
| **What we keep** | about **minus $18** | about **plus $12** | about **plus $134** |

With everyone on their own key instead: we pay about $21, $24 and $231 a month, and the 10% on
machines brings in under $1, $1 and $10. So own-key people cost us roughly the fixed plan fees.
Instabox's paused disk is the one cost that grows fastest if boxes are not snapshotted; snapshotting
after an hour keeps the average under 1 GiB per person.

Numbers used: Instabox "$0.004 per vCPU-hour", "$0.00225 per GiB-hour", disk "$0.08 per GiB-month",
"Snapshots are free", Pro "$20/month + usage" with "$20 of credits" and 200 GiB disk, Builder
"$100/month + usage" (https://instabox.sh/docs/pricing.md). Convex Starter free with 1M function
calls, then $2.20 per million; Professional $25 per developer with 25M calls
(https://www.convex.dev/pricing); about 1,000 to 2,000 calls per change for streaming chat, batched
(estimate). OpenRouter: "5.5% ($0.80 minimum) fee when you purchase credits", "We pass through the
pricing of the underlying model providers without any markup" (https://openrouter.ai/docs/faq).

## 8. The facts checked (12 Nov 2026)

### Instabox (instabox.sh)

- **What**: one Linux machine per AI agent, a Firecracker microVM, Debian 13 amd64 with systemd,
  sudo, apt and Docker. Run by InsForge AI, Inc. (Delaware). First blog post 2 Sep 2026; paid plans
  since 20 Oct 2026; access by waitlist, "Pro users skip the waitlist entirely". SOC 2 Type II
  reported. **No status page found**; SLAs only on Team and above; the terms say no warranty "that a
  Sandbox or its data will not be lost". Sources: https://instabox.sh/docs/limits.md,
  https://instabox.sh/blog.md, https://instabox.sh/blog/workos.md, https://instabox.sh/terms.
- **API**: REST at `https://api.instabox.sh` (OpenAPI at https://api.instabox.sh/v1/openapi.json),
  TypeScript SDK `@insforge/instabox-sdk`, Python SDK, CLI, MCP. Keys `ibk_...` with scopes
  (`machines:read|write|delete`, `images:*`). `POST /v1/machines`, then `start`, `stop`, `suspend`,
  `resume`, `restore`; `exec` up to 10 minutes or in the background with SSE streaming; file upload
  and download; `port publish` gives an HTTPS URL; webhooks for state changes; per-machine usage
  for billing. https://instabox.sh/docs/api.md, https://instabox.sh/docs/machines.md,
  https://instabox.sh/docs/billing.md.
- **Sizes**: Free 4 vCPU / 8 GiB only, one machine; Pro 2/4, 4/8, 8/16; Builder up to 16/32. `/data`
  20 GiB by default, up to 200 GiB on Pro. No GPUs, no nested virtualisation (fine: we build, we do
  not run an emulator there).
- **Times**: resume from pause "usually takes about a second"; cold reboot "back in about 20
  seconds"; a create or a start from stopped is not published (the spike measures it).
- **Android**: "Debian 13 has no `openjdk-17` package"; it ships OpenJDK 21, and "Gradle and the
  Android Gradle plugin run on 21". Our builder already builds with JDK 21. Custom images:
  `instabox snapshot import <docker image>`, amd64 only (https://instabox.sh/docs/custom-images.md).
- **Persistence**: stop keeps files, pause keeps memory too; "No forced TTL" for paused machines and
  snapshots.
- **Limits**: Pro 500 machines, 100 running, 30 starts a minute; idle pause 5 to 30 minutes on paid
  plans; an "activity lease" keeps a box awake during silent model calls; upload about 50 Mbit/s per
  machine; no documented outbound allowlist; automatic abuse checks can lock a box for 24 hours.
- **Secrets proxy**: adds API keys to outgoing HTTPS headers so the real key never enters the box
  (https://instabox.sh/docs/secrets.md). To prove with Claude Code and OpenRouter in the spike.
- **Terms** (https://instabox.sh/terms, 9 Nov 2026): 2(b)(iii) the customer may not "rent, lease,
  lend, sell, sublicense, or otherwise make the Services available to any third party except as
  expressly permitted", while 4(c) speaks of the customer's "relationship with the end users of
  those services". Our agent working for a person's app in a box is closer to 4(c), but the person's
  prompts do run commands there. Ask Instabox in writing.

### Convex

- **Plans** (https://www.convex.dev/pricing): Free and Starter $0 (pay as you go above 1M function
  calls, 0.5 GB database, 1 GB files, 1 GB egress, 20 GB-hours of actions); Professional $25 per
  developer a month (25M calls, 50 GB database, 100 GB files, 50 GB egress). Serving files counts as
  egress ($0.132 a GB above the allowance on Starter, $0.12 on Professional). Outside US East, 1.3
  times the price.
- **Files** (https://docs.convex.dev/file-storage/upload-files): "The file size is not limited, but
  upload POST request has a 2 minute timeout" (fine from a box; a 30 MB APK needs about 2 Mbit/s).
  `getUrl()` gives a URL "anyone with the URL can access" until the file is deleted.
- **Auth** (https://labs.convex.dev/auth): Convex Auth supports React Native, OTP by email (with
  Resend) and Google OAuth, but "is in beta (it isn't complete and may change in
  backward-incompatible ways)". Clerk is the well-trodden alternative with Expo support
  (https://docs.convex.dev/auth/clerk). The React Native Google flow uses `expo-web-browser`; it
  cannot be tested in Expo Go (we never use Expo Go).
- **Actions**: Node actions run up to 10 minutes with 512 MiB; they are not retried. An agent turn
  should not run in an action: the runner on the box pushes batched mutations, the pattern Convex's
  own Agent component uses for streaming.
- **HTTP actions** at `https://<deployment>.convex.site`; request bodies have no set limit (multipart
  20 MiB), responses up to 100 MiB. A service calls them with a shared secret it checks.
- **Components**: rate limiter, Stripe, aggregate, workpool, workflow, R2, Agent.
- **Self-hosting**: FSL Apache 2.0, becomes Apache 2.0 after two years; the way out if needed.
- **Regions**: US East standard; Ireland, Sydney, Canada at plus 30%; fixed per deployment.

### OpenRouter

- **Prices** equal Anthropic's list on the global endpoints (Opus 5.5 $4 / $20, Sonnet 5.5 $2 / $10,
  Fable 5.2 $8 / $40 per million; caching passed through). Regional endpoints cost 10% more.
  https://openrouter.ai/api/v1/models.
- **Fee**: 5.5% when buying credits ($0.80 minimum), 5% with crypto, never per request; BYOK free up
  to $25,000 a month. https://openrouter.ai/pricing, https://openrouter.ai/docs/faq.
- **Anthropic-compatible endpoint**: yes, `POST https://openrouter.ai/api/v1/messages`. Claude Code
  guide (https://openrouter.ai/docs/cookbook/coding-agents/claude-code-integration):
  `ANTHROPIC_BASE_URL=https://openrouter.ai/api`, the OpenRouter key as `ANTHROPIC_AUTH_TOKEN`,
  `ANTHROPIC_API_KEY` blank; "only guaranteed to work with the Anthropic first-party provider".
- **Per-person keys**: the Management API creates keys "for each customer instance", each with a
  credit `limit` (optionally reset daily, weekly or monthly).
  https://openrouter.ai/docs/guides/overview/auth/management-api-keys.

## 9. What is reused and what is new

| Part | Reused as it is | Changed | New |
| ---- | --------------- | ------- | --- |
| `shared/protocol.ts` | Every type the phone renders (`App`, `ChatItem`, `BuildInfo`, `OtaInfo`, `ApkVariant`, `TokenUsage`, `AppUsage`, `ChangeNotes`, `WorkerInfo`, `PageInfo`, `ServerEvent`) | Additive only: `BuildInfo.fileUrls?`, `App.cloud?`, `ChatItem.cost?` | Runner event and billing types (`Balance`, `UsageCharge`) |
| `shared/chat`, `shared/theme` | All: rows, build card, usage line, pages, the Workbench look | The usage line can show money | Nothing |
| `server/` | `acp/`, `workers.ts`, `playbook.ts`, `coordinator-playbook.ts`, `pages/`, `todos.ts`, `usage.ts`, `build-cycle.ts`, `history.ts`, `health.ts`, `apk-scan.ts`, `icon.ts`, `secrets.ts` | A second entry `runner.ts` with no HTTP server; events go to a sink (WebSocket today, Convex in the cloud); `git.ts` without GitHub | `runner/convex-sink.ts`, `runner/inbox.ts`, `runner/signing.ts`, later the OpenCode launcher |
| `builder/` | `createApp`, `buildApk`, `fastlane.mjs`, `zip.mjs`, `axml.mjs`, `apksign.mjs`, `OtaSign.java`, `keybackup.mjs` | `ANYAPP_SIGN_LATER=1` (Gradle unsigned, then `apksign.mjs`); checked on Linux (it was built on Windows) | Nothing else |
| `template/`, `template-kotlin/` | All, including the updater, Reload card, crash catcher and diary | Nothing for the first version | Later: a cloud feed for shared apps |
| `app/` | Home grid, chat, installer, quick update hand-over, crash forwarding, AI for your apps, Settings | `api.ts`: the `Client` behind an interface with two implementations | Sign in, mode choice, "Your AI", balance, the Convex client |
| `desktop/` | Not used by the cloud | | Later: "Move this app to the cloud" |
| New `cloud/` | | | The Convex project (schema, functions, HTTP actions, auth), the box image (Dockerfile), the Instabox client, the Stripe webhook |

Not used in the cloud: Easy Connect, pairing codes, the admin token, the desktop onboarding, GitHub
repos (Q8), and the `anyapp` CLI's other apps (the runner can serve it from Convex later).

## 10. The first version

**In**: cloud mode in the phone app; Google and email code sign-in; the app grid; one chat per app
with helpers in the same box; plan first and pages; builds and quick updates to the phone; versions
and undo; What changed; crash reports; the usage line per change; **their own Anthropic API key**
(way B); machine time metered (free under a cap, Q3); signing keys encrypted in Convex.

**Built but switched off until the answers**: credit (per-person OpenRouter keys, ledger, Stripe
top-ups, cost plus 10%).

**Out**: monthly spending limits; Claude sign-in (way F); moving apps between PC and cloud; sharing
and publishing to GitHub releases; the diary (it needs a phone round trip through Convex); Expo
Exact; a separate signer machine.

| # | Milestone | Days |
| - | --------- | ---- |
| 0 | **Spike**: the box image (Node, JDK 21, Android SDK, warm Gradle, Claude Code, the runner) imported to Instabox; one box creates and builds the template app (full and quick), signs after Gradle, and runs one Claude Code turn with an Anthropic key through the Secrets proxy; measure create, resume, snapshot restore and build times; Convex project with Google and email code sign-in from a dev build of the phone app on the emulator | 3 |
| 1 | Convex backend: schema, auth, runner HTTP actions and token, inbox, file uploads, box lifecycle (scheduler, webhooks, pause, snapshot, delete) | 3 |
| 2 | Runner: the event sink in `server/`, `runner.ts`, signing tickets and tmpfs signing, code bundles and restore | 4 |
| 3 | Phone: sign in, mode choice, the Convex `Client`, downloads from file URLs, "Your AI" | 4 |
| 4 | Keys and secrets: envelope encryption, the key service, the signing log | 2 |
| 5 | Metering: usage rows from ACP and Instabox, the cost line per change, the fair-use cap; credit behind its switch (OpenRouter keys with limits, ledger, Stripe Checkout and webhook) | 3 |
| 6 | Proof and hardening: the Ajman prayer alarm made in cloud mode on the emulator, a second prompt as a quick update, rate limits (one change at a time, 5 boxes per person), egress and abuse notes, docs | 3 |
| | **First version** | **22 days, about 4.5 weeks** |
| | If way D is chosen: OpenCode launcher, playbook wording, tool-call translation checks | +4 |
| | Separate signer machine | +2 |

## 11. Accounts and keys for the first spike (one task for the user)

Nothing here costs money except Instabox Pro if the free plan's waitlist blocks us, and $10 of
OpenRouter credit only if credit is to be tested.

1. **Convex**: sign up at https://dashboard.convex.dev (Free plan). Create a project named
   `anyappagent-cloud`, US East region (standard price). Hand over: the deployment URL and a
   **development deploy key** (project Settings, Deploy keys).
2. **Instabox**: sign up at https://dashboard.instabox.sh. Free plan (one 4 vCPU / 8 GiB machine) is
   enough for the spike if the invite arrives; otherwise **Pro, $20 a month** (skips the waitlist,
   includes $20 of usage). Create an API key at https://dashboard.instabox.sh/dashboard/api-keys with
   `machines:read`, `machines:write`, `machines:delete` and `images:*`. Also email
   support@instabox.sh asking whether terms 2(b)(iii) allows a product where our agent runs a box per
   end user's app.
3. **Anthropic API key** for way B: https://platform.claude.com, a key with a small credit (about $5).
   If the user has Max or Ultra, link a Console organization to the plan to claim its monthly API
   credit (https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-ultra-and-team-plans).
4. **Google OAuth client**: https://console.cloud.google.com/apis/credentials. New project, OAuth
   consent screen "External" in testing mode with the user's own Google account as a test user,
   then an OAuth client ID of type "Web application" with the redirect URI
   `https://<deployment>.convex.site/api/auth/callback/google`. Free. Hand over the client ID and
   secret.
5. **Resend** for email codes: https://resend.com, free plan, one API key. Without a verified domain
   it can only send to the account's own address, which is enough for the spike (price and limits
   not checked here).
6. **OpenRouter** (only to test credit, not needed for the first version):
   https://openrouter.ai, $10 of credit ($10.80 with the fee), one API key with a $10 limit, and a
   Management API key (https://openrouter.ai/docs/guides/overview/auth/management-api-keys).
7. **Anthropic**: write to https://www.anthropic.com/contact-sales about way A (and ask about ways C,
   E, F and whether the Max and Ultra credit applies to a hosted service).

Later, not for the spike: Stripe (test mode is free), Google Cloud KMS (same Google Cloud project),
a domain.

## 12. Open questions for the user

- **Q1. Selling tokens.** Ask Anthropic for the agreement (way A) now, and ship their-own-key (way
  B) first while waiting? Recommended: yes to both.
- **Q2. If Anthropic says no**: offer credit through a different agent (way D, OpenCode over
  OpenRouter, priced per change, after a lawyer's look), or keep the cloud own-key only?
- **Q3. Machine time with their own key** is about 10 cents a month for an active person: free under
  a fair-use cap (recommended), or billed (needs a card for cents)?
- **Q4. Package names**: a cloud app named "Tally" and a PC app named "Tally" would both be
  `com.anyapp.tally` with different keys, so one cannot install over the other on the same phone.
  Use `com.anyapp.<slug>` and refuse a clash on the phone, or give cloud apps their own prefix?
- **Q5. Instabox is two months old** (no status page, no SLA below Team, waitlist). Go ahead with it
  behind a small interface so Fly.io Machines (the earlier page's pick) can replace it?
- **Q6. Signing**: on the thread's box as a separate Unix user after Gradle (first version), then a
  separate signer machine (+2 days)? Or the signer machine from the start?
- **Q7. Top-ups** (once credit is on): smallest $10, the card fee added on top. OK?
- **Q8. Code backup**: cloud apps without GitHub in the first version (code as Git bundles in
  Convex, downloadable later)?
- **Q9. Model**: Opus 5.5 by default with Sonnet 5.5 as the cheaper choice in "Your AI"?
- **Q10. Sign-in**: Convex Auth (beta, all inside Convex) or Clerk (mature, Expo support, its own
  account)? Recommended: Convex Auth, Clerk if the spike hits a wall.
- **Q11. Region**: Convex US East (standard price; Instabox is in the US anyway) or Europe (plus
  30%)?
