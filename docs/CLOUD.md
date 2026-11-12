# AnyAppAgent Cloud: the plan

A cloud version of AnyAppAgent for **anyone who does not want to install the PC app**. The person
installs only AnyAppAgent on the phone, signs in with Google or a code by email, connects their
GitHub, tops up dollar credit, and makes and changes apps exactly as today: the chat is in the phone
app, the APK or quick update arrives on the phone. The agent and the builds run on rented cloud
machines, one per thread. The app's code lives in a private repo on **the person's own GitHub**;
everything else that must last (accounts, apps, chats, usage, money, builds, files, signing keys)
lives in Convex.

Status: **the agreed plan** (decisions of 12 Nov 2026, section 12), nothing built yet. Facts were
checked on the web on **12 Nov 2026**; each has its source link. Not legal advice: section 1 gives
the texts and the one line that leaves any doubt.

What the user decided (it overrides `C:\aa\ideas\cloud-changes.html` and the first draft of this
file): chat in the AnyAppAgent phone app, Google or a code by email, Convex for most things, one
instabox.sh box per thread behind a small interface, signing keys stored encrypted in Convex,
storage free to the person. **Credit is dollars**: people top up with us from the first version,
and machine time is drawn from it at cost plus 10% even when they use their own Anthropic key.
**AI can be paid from that credit**: the agent runs on the **Claude Agent SDK** (today's agent, the
ACP adapter built on it) with **our own Anthropic API key**, tokens charged **at cost**, our 10% on
machine time and a platform fee (decisions of 12 Nov 2026, second round). **Every change shows an
estimate first** (machine and AI). The code is **never stored by us**: the agent commits and pushes
to the person's GitHub after every change. Each app's chat is an orchestrator on **Opus 5.5 high**
that hands work to helpers on the right model. No email or agreement with Anthropic is sought.

## 1. The terms question first

**Short version.** **An agent built on the Claude Agent SDK, run in our product on our cloud boxes
with our own Anthropic API key, for our end users, who pay us, is allowed.** Fairly sure (about 85 to
90%): every page about the SDK says so in its own words, and Anthropic itself publishes case studies
of exactly this shape. What stays forbidden is offering **Claude Code itself** (the product: the CLI,
its name and look) as a hosted service paid on our key, and offering claude.ai sign-in or plan limits
inside our product. People bringing their own Anthropic API key stays allowed too. Charging for
**machine time** and a **platform fee** is ours to sell; passing tokens through **at cost** keeps us
clear of Commercial Terms D.4's "resell the Services". (Texts read on the live pages on 12 Nov 2026,
below; the one line that leaves doubt is named in "The Agent SDK finding".)

### The Agent SDK finding (12 Nov 2026)

**The question**: may a company run the Claude Agent SDK (TypeScript or Python) inside its own hosted
product, on cloud boxes, for its end users, with the company's own Anthropic API key, and charge
those end users (tokens at cost, a margin on machine time and a platform fee)?

**Answer: allowed.** Not legal advice. Why:

1. **The SDK's own terms name this case.** The overview, both READMEs and the TypeScript LICENSE put
   the SDK under the Commercial Terms, "including when you use it to power products and services that
   you make available to your own customers and end users". The only restriction any SDK page sets is
   on claude.ai login and plan rate limits, and it sends developers to API keys instead.
2. **The legal page tells SDK developers to use their own API key.** Its "Authentication and credential
   use" section is the only place it names the Agent SDK: "Developers building products or services
   that interact with Claude's capabilities, including those using the Agent SDK, should use API key
   authentication through Claude Console". It does not say the end user's key.
3. **The end-user-credentials condition is written for Claude Code the product, not the SDK.** "Can
   customers offer Claude Code in their products?" never names the Agent SDK. It is about
   "preinstalling or running Claude Code" as Claude Code: its naming rule lets such products say "that
   it runs Claude Code", while the SDK's branding rules forbid exactly that ("Not permitted: 'Claude
   Code' or 'Claude Code Agent'") and require "Your product should maintain its own branding and not
   appear to be Claude Code". Two opposite branding rules only make sense as two separate regimes:
   hosted Claude Code (end users bring credentials) and products built on the SDK (Commercial Terms,
   developer's key).
4. **The hosting guide cannot work under an end-user-key rule.** Its worked examples are "a site
   builder that hosts a per-user editable site", "a chat bot that handles continuous traffic from a
   platform like Slack" and "a customer support agent", with "the subprocess reads
   `ANTHROPIC_API_KEY` from its environment. Supply it from your secret manager", a "Multi-tenant
   isolation" section, and "Anthropic token cost typically dominates container infrastructure cost".
   A Slack bot's or a support agent's users do not each bring an Anthropic key.
5. **Anthropic publishes customers doing exactly this.** "Anything" (https://claude.com/customers/anything):
   "Anything's AI agent, powered by Claude and the Agent SDK, handles the full build: databases,
   backend logic, ... mobile deployment, App Store submission, and payments", for "1.5 million users
   ... turning ideas into working software products without writing code", who have "built more than
   800,000 apps". Anything sells plans with monthly credits ($19 for 20K credits, $199 for 200K,
   "Can purchase more credits", https://www.createanything.com/pricing); neither page mentions an
   Anthropic key of the user's own.
   That is AnyAppAgent Cloud's shape: an app builder for non-coders, on the SDK, paid from credit.
   Bolt (https://claude.com/customers/bolt) is "Built by StackBlitz and powered by the Claude Agent
   SDK" for its users, "More than 10,000 users have already uploaded their own design systems to
   Bolt".

**The one line that leaves doubt.** The legal page's condition covers "running Claude Code in your
products or services (e.g. in hosted sandboxes or other agent infrastructure)", and the SDK overview
calls the SDK "A library that runs the Claude Code binary" ("The Agent SDK spawns and supervises a
`claude` CLI subprocess", hosting guide). Read word for word, a hosted SDK product does run the
Claude Code binary. No Anthropic page or employee has said in writing "the end-user-credentials
condition does not apply to the SDK": the one open GitHub question near it
(https://github.com/anthropics/claude-agent-sdk-typescript/issues/512, 19 Oct 2026, about
subscription sign-in in an SDK app) has no Anthropic answer, and no issue in the SDK repos or
`anthropics/claude-code` asking about our case was found. Against that literal reading stand points 1
to 5, each more specific to the SDK. The remaining risk is that Anthropic later rewrites the legal page
to name the SDK; the docs' policy pages have changed several times in 2026.

**Conditions we keep, so we stay on the SDK side of the line:**

- The agent is the Agent SDK (today: `@agentclientprotocol/claude-agent-acp`, which runs the native
  `claude` binary from `@anthropic-ai/claude-agent-sdk-<platform>-<arch>`), unmodified, on our Console
  API key.
- **Never call it "Claude Code"** in the product, the store listing or the site. Allowed: "Claude
  Agent", or "AnyAppAgent, powered by Claude". No Claude Code look-alike visuals.
- **No claude.ai sign-in in the cloud** (the ACP adapter offers `--cli auth login --claudeai`: not
  shown in cloud mode). Their own API key is fine.
- Tokens at cost, shown as such; our margin is on machine time and the platform fee (D.4).
- The Usage Policy's AI disclosure: the chat says it is an AI agent.

### What the texts say (verbatim)

Claude Code, Legal and compliance (https://code.claude.com/docs/en/legal-and-compliance), section
"Can customers offer Claude Code in their products?":

> "Unless we've mutually agreed otherwise, preinstalling or running Claude Code in your products or
> services (e.g. in hosted sandboxes or other agent infrastructure) requires agreeing to our
> Commercial Terms of Service and complying with the conditions below:"
>
> "**The Claude Code binary must not be modified.** Claude Code must be installed and run as
> published by Anthropic, and customers may not remove, disable, or restrict any authentication
> method built into it (including methods that permit signing in with a Claude account or the user's
> own API key)."
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
> applicable provider) and is not resold or intermediated as described above. Nor does it prevent an
> end user from signing in to the unmodified Claude Code binary with their own Claude subscription,
> including where a platform hosts Claude Code as described under *Can customers offer Claude Code
> in their products?* above."
>
> "Anthropic reserves the right to take measures to enforce these restrictions and may do so
> without prior notice."

Claude Agent SDK overview (https://code.claude.com/docs/en/agent-sdk/overview):

> "Use of the Claude Agent SDK is governed by Anthropic's Commercial Terms of Service, including when
> you use it to power products and services that you make available to your own customers and end
> users"
>
> "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai
> login or rate limits for their products, including agents built on the Claude Agent SDK. Use the
> API key authentication methods described in the Quickstart instead."

That note restricts **claude.ai login and plan rate limits only**; it points developers to API keys.
The same page describes the SDK as "A library that runs the Claude Code binary", and its branding
rules forbid calling the product "Claude Code": "Not permitted: 'Claude Code' or 'Claude Code Agent'",
"Your product should maintain its own branding and not appear to be Claude Code or any Anthropic
product". The SDK's READMEs say the same as the overview, word for word, under "License and terms"
(https://github.com/anthropics/claude-agent-sdk-typescript, npm `@anthropic-ai/claude-agent-sdk`
0.3.322, license "SEE LICENSE IN README.md"; https://github.com/anthropics/claude-agent-sdk-python,
PyPI `claude-agent-sdk` 0.2.180). The TypeScript LICENSE.md: "© Anthropic PBC. All rights reserved.
Use is subject to Anthropic's Commercial Terms of Service." The Python repo's LICENSE file is MIT (an
open question in its own issues, #971 and #1245, unanswered); the bundled `claude` binary is under
the Commercial Terms either way. Hosting the Agent SDK
(https://code.claude.com/docs/en/agent-sdk/hosting) is written for products serving many users on the
developer's key: "the subprocess reads `ANTHROPIC_API_KEY` from its environment. Supply it from your
secret manager", with a "Multi-tenant isolation" section and examples such as "a site builder that
hosts a per-user editable site". It also points to Managed Agents
(https://platform.claude.com/docs/en/managed-agents/overview), where "Anthropic hosts the agent loop",
on our own API key, as the alternative to self-hosting.

Anthropic Commercial Terms (https://www.anthropic.com/legal/commercial-terms, effective 17 Jun 2025):

> A.1 "Anthropic gives Customer permission to use the Services, including to power products and
> services Customer makes available to its own customers and end users ("Users")"
>
> D.4 "Customer may not and must not attempt to (a) access the Services to build a competing product
> or service, including to train competing AI models or resell the Services except as expressly
> approved by Anthropic"

"Services" there means "Anthropic API keys and any other Anthropic offerings that references these
Terms, as well as all related Anthropic tools, documentation and services", so the SDK (which
references these Terms) and its bundled binary come under them, A.1 included.

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
Terms (its providers API gives `"terms_of_service_url":"https://www.anthropic.com/legal/commercial-terms"`
for Anthropic), so Anthropic's rules reach us through OpenRouter too; 5.5 makes us "solely
responsible for any violation by yourself, your Authorized Users, and your customers".

What others do (12 Nov 2026): Replit, "You're billed at the provider's public API rate, deducted from
your Replit credits" (https://docs.replit.com/billing); Cursor bills third-party models such as
Claude at API list price from its plans' credit; Cline's and Kilo Code's own credits charge Claude at
provider cost with no token markup (Kilo adds a 5% fee on buying credit). These are their own agents,
not Claude Code, and none of them was found adding a markup on the tokens themselves. The hosted
Claude Code services found (Murmell, Droneship) have users bring their own key or plan. GitHub's
Claude agent in Agent HQ is paid from Copilot requests, under a partnership announced with Anthropic.

### What that means for each way of paying for AI

| Way | Agent | What the texts say | Status |
| --- | ----- | ------------------ | ------ |
| **E. Our Anthropic API key, AI paid from credit** | Agent SDK (today's agent: the ACP adapter `claude-agent-acp`, built on it) | Allowed: the SDK is under the Commercial Terms "including when you use it to power products and services that you make available to your own customers and end users"; the legal page tells SDK developers to "use API key authentication through Claude Console"; the hosting guide is written for multi-tenant products on the developer's key; Anthropic's own case studies (Anything, Bolt) are this shape. Doubt: one literal reading of the hosted-Claude-Code line ("The Agent SDK finding" above). | **Chosen** (section 12). In the first version. Tokens at cost. |
| **B. The person's own Anthropic API key** | Agent SDK | Allowed under both regimes: "their own Anthropic API key". | In the first version, next to E. Machines still paid from credit. |
| **A. Claude Code itself on our OpenRouter key** | Claude Code (the product) | "may not pay for, resell, or intermediate". Needs an agreement ("Unless we've mutually agreed otherwise"). | **Dropped**: no email or agreement is sought, and E does the same job. |
| **C. The person's own OpenRouter key** | Agent SDK | OpenRouter is not one of the three named 3P providers, and the SDK hosting guide names only Anthropic, Bedrock and Google Cloud endpoints. | Out. |
| **D. Our credit, a different agent** (for example OpenCode over the API) | Not Claude Code | Allowed under A.1, the same as E. | Not needed now that E is allowed. |
| **F. Claude Pro, Max or Ultra sign-in** | Agent SDK | The SDK overview: "Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK"; "developers may not collect, store, or intermediate Claude.ai credentials or session tokens". | Out. Not offered in cloud mode. |

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
into AnyAppAgent Cloud (way B). Whether our service running the agent with their key counts as
"when you run them yourself" is not settled (no one is asking Anthropic); if not, the key still
works, it is just billed to their Console balance.

### Decided

1. **AI paid from credit runs on the Agent SDK with our own Anthropic API key** (way E): today's
   agent and ACP adapter, unmodified, never called "Claude Code" in the product. Tokens are charged
   **at cost**; our 10% is on machine time and a platform fee (section 12).
2. **Their own Anthropic key** (way B, Ultra and Max credit included) is offered next to it. Machine
   time is paid from their AnyAppAgent credit either way.
3. **No email to Anthropic and no agreement sought.** Ways A, C and F are out.
4. **Instabox** was asked in writing about terms 2(b)(iii) (section 8); that email was sent.

## 2. How people pay

Two things cost money: **machine time** (the cloud box that runs the agent and the builds) and **AI**
(the model's tokens). Settings has two plain cards.

**Your credit** (from the first version, required before the first change):

- Credit is dollars. Top up with Stripe Checkout: smallest **$10**, the card fee added on top
  ("$10 of credit, $10.61 to pay" for a US card), so cost plus 10% holds.
- Machine time is drawn from it at **our cost plus 10%**, whatever pays for the AI. An active person
  uses about 11 cents of machine time a month (section 7).
- The card shows the balance, the last top-ups, and what each app drew this month.
- No free allowance: no credit, no change. Storage stays free.

**Your AI**:

- **My Claude API key** (way B, also in the first version). Pasted once, stored encrypted (section
  6). If they have Max or Ultra, a one-line hint: "Your plan includes monthly API credit: link a Console
  organization, then make a key there." AnyAppAgent shows what each change cost on that key (list
  price, an estimate: Anthropic bills it, not us).
- **Pay for AI from my credit** (way E, the first version): AI runs on our Anthropic key and is drawn
  from the same credit **at cost** (the model's list price, no markup), plus the platform fee
  (section 5). The card shows AI and machine time apart.

Whatever the way, the AI key is never put in a file or an environment variable on the box:
Instabox's Secrets proxy adds it to outgoing HTTPS requests, so the agent cannot print it (section
8, to be proven in the spike).

### Estimates before every change

Before a change runs the person sees what it will likely cost, split the way it is paid:

- **Under the message box**, before sending: "About 1 cent machine (from credit) + about $0.20 AI
  (on your Claude key)". It is the median of this app's last 10 changes of the same size, or the
  defaults in section 7 for a new app.
- **On the plan** (bigger changes are planned first, as today): the orchestrator says which helpers
  it will start and at which level (section 3, "Models"), and the plan card shows the estimate for
  exactly that, with a range (the 25th to 75th percentile of past changes at those levels).
- **Per app**, on its Settings page: "This app: about 4 cents of machine time a month at your pace,
  about $1.20 of AI a month on your key", from its last 30 days, plus what it cost so far.
- **After the change**, the usage line shows the real numbers next to the estimate: "Machine $0.006
  (est. $0.008), AI $0.23 on your key (est. $0.20)".
- A change starts only if the credit covers its machine estimate twice over; otherwise the phone
  offers a top-up. Nothing else asks for confirmation (spending limits come later, as decided).

## 3. The architecture

```
 AnyAppAgent on the phone             Convex (one deployment, US East)        Box provider (Instabox first)
 Sign in (Google / email code) ---->  auth: users, sessions
 Connect GitHub (browser)      ---->  GitHub App: user token (encrypted)
 Home grid, chat, Settings     <===>  live queries + mutations
   (Convex React Native client)       apps, threads, messages, usage, builds
 Estimate under the message box <---  estimates (per app, per level)
 Send a message                ---->  messages.send (mutation, checks credit)
                                      -> scheduler: ensureBox(thread) ----->   create / resume the box
                                                                               runner (Node, from server/)
                                      <-- HTTP actions, runner token <----     chat rows, usage, build state
                                      --> one-repo GitHub token, 1 hour --->   agent: orchestrator + helpers
                                                                               builder + fast lane
                                                                               git push -----------------> person's GitHub
                                      file storage: APKs, quick updates <-     uploads after each build      anyapp-cloud-<slug>
 Install / hand quick update   <----  build row (live) + file URL
                                      keys: wrapped, opened per signing ->     one-time signing ticket
 Top up (Stripe Checkout)      ---->  billing: ledger, balance, Stripe webhook
```

### The phone app

The same AnyAppAgent APK gets a second way in. First run asks **"Make apps in the cloud"** (sign in)
or **"Use my PC"** (today's pairing and Easy Connect). One mode per install in the first version.

- Cloud mode setup is three short steps: sign in, connect GitHub, top up (with "Your AI" key pasted
  at the first change if not before).
- In cloud mode the phone talks only to Convex. The Convex React Native client keeps live queries
  for the app list, each thread's messages and builds, the balance and the estimates; it reconnects
  by itself and retries mutations until they are confirmed. No WebSocket to a PC.
- Everything the phone does with an APK or a quick update stays as it is (`app/src/lib/installer.ts`,
  `app/modules/anyapp-native`, the Reload card, rollback, crash reports): only where the file comes
  from changes (a Convex file URL instead of `GET /api/apps/:id/apk`).
- The screens stay the same. The data layer gets a second implementation of today's calls
  (`app/src/lib/api.ts` `Client` and the `ServerEvent` stream) backed by Convex and returning the
  same `shared/protocol.ts` types, so `shared/chat` renders cloud chats unchanged.
- New screens: sign in, connect GitHub, "Your credit" (balance, top-up), "Your AI", the estimate
  line under the message box and on the plan card, the per-app cost line in the app's Settings.
- **Package names**: cloud apps get their own prefix, **`com.anyappcloud.<slug>`**, so a cloud app
  and a PC app with the same name never fight over one package on the same phone. (The server
  already sets the package name in one place, `server/src/apps.ts`; the runner passes the cloud
  prefix.)

### Convex

Holds everything that must outlive a box except the code: people, apps, threads, chat history,
estimates, usage and money, build records, APK and quick update files, encrypted signing keys, the
person's own AI key and their GitHub token. Its live queries replace the companion's WebSocket. It
runs no agent and no build: its actions only call the box provider, GitHub, Stripe and the key
service (the AI calls go from the box, with the key added by the Secrets proxy), and its HTTP actions are what the box and Stripe call.
Deployment in **US East** (standard price; Instabox is in the US anyway).

### The code lives on the person's GitHub

We do not store code. Each cloud app has a **private repo `anyapp-cloud-<slug>`** on the person's
own GitHub account (the `cloud` in the name keeps it apart from a PC app's `anyapp-<slug>`).

- **Connecting**: a **GitHub App** ("AnyAppAgent Cloud"), not an OAuth app. The person installs it
  on their account from the phone (a browser page, then back to the app). Why a GitHub App:
  - The box only ever gets an **installation token for one repo, Contents write only, that expires
    after 1 hour** (GitHub lets us narrow a token to named repositories and permissions). If the
    agent or a bad library leaks it, it reaches one app's code for under an hour.
  - An OAuth app's token has the `repo` scope: every repo the person has, public and private, with
    no expiry. That must never sit on a box where an agent runs commands.
  - The person sees exactly what it may touch, and can limit or remove it on GitHub at any time.
- **Permissions it asks for**: Contents read and write, Administration read and write (to create
  the repo; GitHub lists `POST /user/repos` under it), Metadata read. No account permissions, no
  webhooks in the first version.
- **Making the repo**: when a cloud app is created, a Convex Node action creates
  `anyapp-cloud-<slug>` (private) with the person's user token from the GitHub App (refreshable,
  stored encrypted like the AI key). If the person installed the App on selected repositories only,
  the spike checks that a repo the App creates joins the installation; if not, the phone asks them
  once to choose "All repositories" or add the new repo.
- **Every change is pushed**: the playbook tells the orchestrator and every helper to commit with a
  plain message and push after each change, as part of finishing the change. The runner checks
  after each turn that `HEAD` is on GitHub and pushes itself if the agent did not, and a build is
  only shown as "saved" once its commit is pushed. If GitHub is down the runner retries and the chat
  says the change is not saved yet.
- **Pushing from the box**: a Git credential helper asks the runner for the current one-repo token
  (the runner asks Convex, which mints it with the App's private key); the spike checks whether
  Instabox's Secrets proxy can carry it instead, so it never reaches the box at all.
- **A new box restores from GitHub**: it clones the repo (full history, which versions and undo
  need), then installs `node_modules` from the warm cache in the image. Snapshots stay a speed-up,
  not the copy that matters.
- **Disconnecting GitHub** stops cloud changes for that person until they reconnect (the chat says
  why); their repos and apps stay as they are.
- **Sharing and publishing releases stay out of the first version.** The GitHub connection is the
  hard part and it will be there, but the PC's sharing code drives the `gh` CLI and would need
  porting to the REST API with the App's tokens, plus the public `-releases` repo, the secrets scan,
  `update.json`, the Testing channel and Pull back from APKs in Convex. That is about 3 more days,
  not nearly free. It is the first thing after the first version.

### One box per thread, behind a small interface

A **thread** is one app's chat with its agent. Helpers run inside the same box (below). Each thread
gets its own machine made from one image.

The runner and Convex talk to the machine provider only through one small TypeScript interface in
`cloud/` (`create`, `start`, `pause`, `resume`, `snapshot`, `restore`, `delete`, `exec`, `upload`,
`download`, `usage`, `setSecret`), with **Instabox** as the first implementation. Fly.io Machines
(the earlier page's pick) or another provider can replace it without touching the runner or the
phone.

- Our own OCI image, imported once with `instabox snapshot import` (amd64 only, which the Android SDK
  needs anyway): Node 22, a JDK (the builder already builds with JDK 21, `docs/ENVIRONMENT.md`, so
  Debian 13's OpenJDK 21 is fine), the Android SDK and NDK as `docs/ENVIRONMENT.md` pins, Gradle with
  a warm cache for the template, the template's `node_modules`, Git, the agent and the **runner**.
- **Lifecycle**: a message resumes the box (from pause "usually takes about a second"). The runner
  holds Instabox's "activity lease" while a turn or a build runs (model calls are silent, and an
  idle box would pause). **5 minutes** after the last work it pauses (memory kept, only disk billed).
  After **1 hour** paused it is snapshotted and deleted (snapshots are free today), and the next
  message restores it from the snapshot. A snapshot unused for 30 days is deleted; the next message
  then makes a fresh box from the image and clones the repo from GitHub (a slower first build). The
  spike measures each of these times.

**The runner** is the companion's work loop without its HTTP server, pairing, Easy Connect or `gh`
(`server/src` minus `http.ts`, `auth.ts`, `easy-connect/`, `github.ts`). It starts the agent over
ACP, keeps the playbook, helpers (`workers.ts`), pages, to-dos, the usage meter, the build after
every turn with up to 3 fix turns (`build-cycle.ts`), versions and undo, and the fast lane. Instead
of broadcasting `ServerEvent`s on a WebSocket it posts them to a Convex HTTP action
(`POST /runner/events`, batched every 250 ms while text streams). It takes its work (new messages,
permission answers, cancel, page answers) from Convex by one long-poll HTTP action. It signs in with
a **runner token**: random, made per box, stored only as a hash in Convex, good for one thread,
revoked when the box is deleted.

### Models: an orchestrator and helpers at three levels

Each app's chat is an **orchestrator on Opus 5.5 at high effort**: it talks with the person, plans,
and hands the real work to helpers (as today's coordinator does with `start_worker`). Its
instructions say which level each piece of work gets:

| Level | Model and effort | For |
| ----- | ---------------- | --- |
| `deep` | Opus 5.5, high | Complex work spanning several areas of the codebase (a new feature that touches screens, storage and alarms; a new app) |
| `focused` | Opus 5.5, medium | Complex work in a few files (a tricky calculation, one screen's logic) |
| `simple` | Sonnet 5.5, high | Simple work in one area (styling, changing text, colours, an icon) |

- `start_worker` gets one new required field, `level`, and the runner starts that helper's ACP
  session with the matching model and effort. The spike checks how `claude-agent-acp` takes a
  model and an effort per session (ACP session model selection, or Claude Code's own model and
  effort settings for that process).
- **Helpers run in the same box**: each is its own Claude Code process with its own ACP session, as
  the `agent` Unix user, in the app's folder. Helpers that change the app take turns (one change
  slot per app, as today); helpers that only read run at once. Builds run after a changing helper's
  turn, as today. The box size (4 vCPU, 8 GiB) fits the orchestrator, two helpers and a Gradle
  build; the spike checks memory with two helpers and a build at once.
- **Costs**: every ACP turn reports its usage with the session's model; the runner prices it with
  that model's list price and tags it with the helper and its level. The change's usage line adds
  them up: "AI $0.31 on your key (orchestrator $0.09, 2 helpers $0.22)", with each helper's own
  line in its row as today. The estimate (section 2) is built from the same tags: the orchestrator's
  share plus the planned helpers' levels, each from the app's (or everyone's) past medians for that
  level. Machine time is the box's, shared by all of them, so it is not split per helper.

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
version from the Git history, as today, so an old APK is never reinstalled). Convex file URLs work
for anyone who has them until the file is deleted; they are only given to the app's owner, and
deleting old builds revokes them. If downloads grow, the `@convex-dev/r2` component moves the files
to Cloudflare R2 (expiring links, no egress fee) without changing the phone. APKs are build output,
not code, so keeping them in Convex does not go against "no code stored".

## 4. The data model in Convex

Field names follow `shared/protocol.ts` where a type already exists. `_id` and `_creationTime` are
Convex's own. Money is stored in millionths of a dollar ("micros"), never floats.

| Table | Fields (short) | Indexes |
| ----- | -------------- | ------- |
| `users` | from Convex Auth (`name`, `email`, `image`), `aiMode` ("ownAnthropic" or "credit"), `githubLogin`, `githubInstallationId`, `stripeCustomerId`, `blocked` | `by_email`, `by_github_installation` |
| `apps` | `userId`, `name`, `slug`, `packageName` (`com.anyappcloud.<slug>`), `repo` (`owner/anyapp-cloud-<slug>`), `pushedCommit`, `preset`, `iconFileId`, `lastBuild`, `status` (`AppStatus`), `health`, `overview` (text of `overview.md`) | `by_user`, `by_package` |
| `threads` | `appId`, `userId`, `boxId`, `boxState` ("none", "starting", "running", "paused", "snapshotted", "deleted"), `runnerTokenHash`, `lastActiveAt`, `agentSessionId` | `by_app`, `by_state_and_active` |
| `messages` | `threadId`, `workerId?`, `item` (a `ChatItem`: text, tool rows, plan, permission, page, build, usage), `seq` | `by_thread_seq` |
| `inbox` | `threadId`, `kind` ("prompt", "permission", "cancel", "page-answers"), `payload`, `takenAt` | `by_thread_untaken` |
| `changes` | `appId`, `threadId`, `messageId`, `estimate` (`machineMicros`, `aiMicros`, `low`, `high`, `levels`), `actual` (`machineMicros`, `aiMicros`), `aiPaidBy` ("ownKey" or "credit"), `state` | `by_app_at`, `by_message` |
| `builds` | `appId`, `number`, `delivery` ("apk" or "quick"), `files` (`{abi, fileId, sizeBytes, sha256}[]`), `otaFileId`, `runtime`, `changes` (`ChangeNotes`), `commit`, `pushed`, `seconds` | `by_app_number` |
| `usage` | `userId`, `appId`, `threadId`, `changeId`, `kind` ("inference" or "machine"), `workerId?`, `level?`, `model?`, `effort?`, `tokens` (`TokenUsage`) or `seconds` and `size`, `costMicros`, `chargeMicros` (0 for AI on their own key), `settled` | `by_user_at`, `by_change`, `by_app_level` |
| `ledger` | `userId`, `kind` ("topup", "charge", "refund", "adjust"), `amountMicros`, `stripePaymentId`, `usageIds` | `by_user_at` |
| `balances` | `userId`, `micros` (always the sum of `ledger`, changed in the same mutation) | `by_user` |
| `keys` | `appId`, `userId`, `packageName`, `certSha256`, `wrappedDataKey`, `ciphertext`, `iv`, `kekVersion`, `lineage?` (never deleted) | `by_app` |
| `signings` | `appId`, `build`, `sha256` of what was signed, `at` | `by_app` |
| `secrets` | `userId`, `kind` ("anthropic", "githubRefresh"), `wrappedDataKey`, `ciphertext`, `iv`, `last4`, `expiresAt?` | `by_user_kind` |
| `boxes` | `threadId`, `provider` ("instabox"), `providerId`, `size`, `startedAt`, `pausedAt`, `snapshotId`, `secondsBilled` | `by_thread`, `by_provider_id` |

Medians for the estimates come from `usage` through the aggregate component (per app and level, and
across everyone for new apps). Files: APKs (per ABI), quick update zips, icons, chat pictures, page
HTML. **No code**, no Git bundles.

## 5. Metering and billing (cost plus 10%)

**What is measured, and from where:**

| What | Live number (shown while it runs) | The number we bill (the truth) |
| ---- | --------------------------------- | ------------------------------ |
| Machine | Seconds the box ran (runner) | The provider's usage. Instabox's per-machine usage endpoint (`GET /v1/machines/{id}/usage`, offered "for billing your own customers"): running seconds by size, plus disk while paused. Drawn from credit at cost plus 10%. |
| AI, own key (first version) | Each ACP turn's `usage` (input, output, cache write, cache read) per session, as the usage meter reads it today (`server/src/usage.ts`), times that model's list price | Never billed by us. Billed by Anthropic to them. Shown so the estimates and the per-app line are honest. |
| AI, from credit (our Anthropic key) | The same ACP usage | The same ACP usage per turn, times that model's list price (our cost: tokens at cost), settled after each turn. The runner stops the change when the balance runs out (below). Checked once a day against our Console usage for the key. |
| Storage in Convex, GitHub | Not shown | Free to the person, as decided (GitHub is theirs) |

**Price**: machine time = our cost times 1.10. AI from credit = the model's list price, **at cost**
(no markup on tokens). Plus a **platform fee**, its size still open (section 12); the cost tables in
section 7 assume 10% of the AI cost to show the order of magnitude.

**Settling**: machine time is settled per change (the box's seconds from the message until the box
pauses, read from the runner and corrected from Instabox's usage once a day), plus paused disk once
a day. Each charge is one `ledger` row and the balance moves in the same mutation.

**Money in**: Stripe Checkout top-ups (the `@convex-dev/stripe` component handles the webhook), in
the first version. Because Stripe's fee (2.9% plus 30 cents for a US card, plus 1% for international
cards, as the earlier page had it) is more than half of a 10% margin on a small top-up:

- The card fee is added on top at checkout, grossed up so we receive the full credit: $10 of credit
  is about **$10.61** to pay with a US card, about **$10.72** with an international one.
- Smallest top-up **$10**.
- Refunds of unused credit by hand (the `refund` ledger row) in the first version; disputes
  block the account until settled.

**Who pays nothing**: someone who makes no change pays nothing beyond what they topped up, and that
credit stays theirs. Storage is free.

**Running out**: a change starts only if the balance covers twice its machine estimate (and, once AI
from credit, its AI estimate). With AI from credit the runner is the hard stop: it adds up each
turn's cost and cancels the ACP session when the change's AI and machine cost reach the balance plus
a small overdraft. A change already
running is allowed to finish even if it goes slightly below zero; the next top-up covers it.
Monthly spending limits come later, as decided.

## 6. Signing keys in Convex ("so never lost")

Each app keeps its own signing key, as on the PC since stage 1 of `docs/DISTRIBUTION.md`. Losing it
means no phone ever takes that app's update again, so it is stored in Convex, encrypted, never
deleted. Leaking it means anyone can make an update phones accept, so it is opened only for one
signing, never where the agent can read it. It is not code and never goes to GitHub.

**Encryption (envelope):**

- One **master key** (key encryption key) that is never in Convex's database: in a cloud key service
  (Google Cloud KMS, about $0.06 a key a month) for launch. For the spike, 32 bytes in a Convex
  environment variable (`KEYS_KEK`), moved to the key service before real users. Convex encrypts
  all data at rest anyway ("All user data in Convex is encrypted at rest"), but an environment
  variable alone only slows down someone with dashboard access.
- Per app a fresh 256-bit **data key**. The PKCS12 file and its password are encrypted with it
  (AES-256-GCM, with the app id and package name as additional data, so a row copied to another app
  does not open). The data key is stored only wrapped by the master key.
- The person's own Anthropic key and their GitHub refresh token are stored the same way in
  `secrets`; Settings shows the last 4 characters of the AI key.
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
it, so anything Gradle can see, a bad prompt or a bad library could print or send away.

**Decided**: signing on the thread's box as a separate Unix user in the first version, then a
**separate signer machine**, where no agent ever runs, as the next step (+2 days).

**Moving between PC and cloud** (after the first version): "Download this app's key" (password
protected, the desktop's key backup format, `builder/lib/keybackup.mjs`), and a PC can upload a key
the same way to move an app into the cloud. The code moves through GitHub.

## 7. Costs

### Per change, with the orchestrator and helpers

Prices (section 8): Opus 5.5 $4 in, $20 out, $5 cache write, $0.20 cache read per million; Sonnet
5.5 half of that. Machine: Instabox 4 vCPU and 8 GiB is 4 x $0.004 + 8 x $0.00225 = **$0.034 an
hour**, for the turns, the build and 5 minutes before the box pauses.

The first draft's numbers were the usage meter's measured run with one agent doing the work
(`docs/TRUST.md`). The orchestrator plus helpers split is **not measured yet**: the numbers below
are that measurement re-cut by hand (the orchestrator's Opus turns about $0.08 to $0.15 per change,
the helper's work at its level's price, high effort a little dearer than medium). Milestone 6
replaces them with real medians, and the estimates use real medians from then on.

| Change | Levels | AI (list, on their key) | Box minutes | Machine cost | Machine charged from credit (+10%) |
| ------ | ------ | ----------------------- | ----------- | ------------ | ---------------------------------- |
| Simple (text, styling), quick update | orchestrator + 1 `simple` | about $0.20 | about 7 | $0.004 | **$0.004** |
| Complex in a few files, full build | orchestrator + 1 `focused` | about $0.43 | about 12 | $0.007 | **$0.008** |
| Complex across areas, full build | orchestrator + 1 or 2 `deep` | about $0.65 | about 15 | $0.009 | **$0.009** |
| New app (plan, helpers, first build) | orchestrator + 2 `deep` | about $0.85 | about 20 | $0.011 | **$0.012** |

With AI from credit the AI part is charged at list (at cost): about $0.20, $0.43, $0.65 and $0.85,
plus the platform fee (about 2, 4, 7 and 9 cents if it is 10% of the AI cost).

### Per month

Assumption: an active person makes 8 changes a month (4 simple, 2 in a few files, 1 across areas, 1
new app). AI about **$3.16** on their own key (list). Machines about 87 box minutes ($0.05) plus
paused disk before the hourly snapshot ($0.01), say **$0.10** with build-fix turns, so **about 11
cents a month** drawn from their credit. A $10 top-up lasts such a person years.

First version (everyone on their own key, we sell machine time only):

| A month | 10 people | 100 people | 1000 people |
| ------- | --------- | ---------- | ----------- |
| Instabox usage | $1 | $10 | $100 |
| Instabox plan | $20 Pro (includes $20 of usage) | $20 Pro | $100 Builder (200 boxes running at once) |
| Convex | $0 Starter | about $3 Starter, pay as you go | about $30 Professional (1 developer, $25) |
| Key service, domain, email codes, GitHub App | about $1 | about $1 | about $1 plus email (not priced) |
| **What we pay** | **about $21** | **about $24** | **about $231** |
| **What people pay us** (machines + 10%; the card fee is passed on) | $1.10 | $11 | $110 |
| **What we keep** | about **minus $20** | about **minus $13** | about **minus $121** |

So the first version costs us roughly the fixed plan fees; cost plus 10% on machines alone never
pays for them. Top-ups are paid in advance, so cash comes in early, but it is the person's money
until used. The business case needs AI from credit and the platform fee (the fee shown here as 10%
of the AI cost, an assumption until it is decided):

| A month, everyone paying AI from credit | 10 people | 100 people | 1000 people |
| ------- | --------- | ---------- | ----------- |
| Inference we buy (list, on our Anthropic key) | $32 | $316 | $3,160 |
| Instabox, Convex, the rest (as above) | $21 | $24 | $231 |
| **What we pay** | **about $53** | **about $340** | **about $3,391** |
| **What people pay us** (inference at cost, machines + 10%, platform fee) | $36 | $359 | $3,586 |
| **What we keep** | about **minus $17** | about **plus $19** | about **plus $195** |

Instabox's paused disk is the one cost that grows fastest if boxes are not snapshotted;
snapshotting after an hour keeps the average under 1 GiB per person.

Numbers used: Instabox "$0.004 per vCPU-hour", "$0.00225 per GiB-hour", disk "$0.08 per GiB-month",
"Snapshots are free", Pro "$20/month + usage" with "$20 of credits" and 200 GiB disk, Builder
"$100/month + usage" (https://instabox.sh/docs/pricing.md). Convex Starter free with 1M function
calls, then $2.20 per million; Professional $25 per developer with 25M calls
(https://www.convex.dev/pricing); about 1,000 to 2,000 calls per change for streaming chat, batched
(estimate). OpenRouter: "5.5% ($0.80 minimum) fee when you purchase credits", "We pass through the
pricing of the underlying model providers without any markup" (https://openrouter.ai/docs/faq).
GitHub Apps and private repos on personal accounts cost nothing.

## 8. The facts checked (12 Nov 2026)

### Instabox (instabox.sh)

- **What**: one Linux machine per AI agent, a Firecracker microVM, Debian 13 amd64 with systemd,
  sudo, apt and Docker. Run by InsForge AI, Inc. (Delaware). First blog post 2 Sep 2026; paid plans
  since 20 Oct 2026; access by waitlist, "Pro users skip the waitlist entirely". SOC 2 Type II
  reported. **No status page found**; SLAs only on Team and above; the terms say no warranty "that a
  Sandbox or its data will not be lost" (one reason the code lives on GitHub and the provider sits
  behind an interface). Sources: https://instabox.sh/docs/limits.md, https://instabox.sh/blog.md,
  https://instabox.sh/blog/workos.md, https://instabox.sh/terms.
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
  (https://instabox.sh/docs/secrets.md). To prove with Claude Code (and the GitHub token) in the
  spike.
- **Terms** (https://instabox.sh/terms, 9 Nov 2026): 2(b)(iii) the customer may not "rent, lease,
  lend, sell, sublicense, or otherwise make the Services available to any third party except as
  expressly permitted", while 4(c) speaks of the customer's "relationship with the end users of
  those services". Our agent working for a person's app in a box is closer to 4(c), but the person's
  prompts do run commands there. Asked in writing (`C:\aa\ideas\cloud-emails.md`).

### GitHub Apps

- **Installation tokens** "expire after 1 hour"; the `repositories` or `repository_ids` body
  parameters limit a token to named repos, and the `permissions` parameter limits what it may do,
  never beyond the App's own permissions
  (https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app).
- **Creating a repo**: `POST /user/repos` is listed under the repository permissions
  "Administration" (write) and "Repository creation" (write), for user and installation tokens
  (https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps). Whether a
  repo it creates joins an installation limited to selected repositories was not found in the docs;
  the spike checks it.

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
  backward-incompatible ways)". Clerk is the fallback with Expo support
  (https://docs.convex.dev/auth/clerk). The React Native Google flow uses `expo-web-browser`; it
  cannot be tested in Expo Go (we never use Expo Go).
- **Actions**: Node actions run up to 10 minutes with 512 MiB; they are not retried. An agent turn
  should not run in an action: the runner on the box pushes batched mutations, the pattern Convex's
  own Agent component uses for streaming.
- **HTTP actions** at `https://<deployment>.convex.site`; request bodies have no set limit (multipart
  20 MiB), responses up to 100 MiB. A service calls them with a shared secret it checks.
- **Components**: rate limiter, Stripe, aggregate, workpool, workflow, R2, Agent.
- **Self-hosting**: FSL Apache 2.0, becomes Apache 2.0 after two years; the way out if needed.
- **Regions**: US East standard (our choice); Ireland, Sydney, Canada at plus 30%; fixed per
  deployment.

### OpenRouter (not used now: AI from credit runs on our own Anthropic key, way E)

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
| `shared/protocol.ts` | Every type the phone renders (`App`, `ChatItem`, `BuildInfo`, `OtaInfo`, `ApkVariant`, `TokenUsage`, `AppUsage`, `ChangeNotes`, `WorkerInfo`, `PageInfo`, `ServerEvent`) | Additive only: `BuildInfo.fileUrls?`, `App.cloud?`, `ChatItem.cost?`, `WorkerInfo.level?` | Runner event, estimate and billing types (`CostEstimate`, `Balance`, `UsageCharge`) |
| `shared/chat`, `shared/theme` | All: rows, build card, usage line, pages, the Workbench look | The usage line shows machine and AI money and the estimate next to it; the plan card shows an estimate | The estimate line under the message box |
| `server/` | `acp/`, `workers.ts`, `playbook.ts`, `pages/`, `todos.ts`, `usage.ts`, `build-cycle.ts`, `history.ts`, `health.ts`, `apk-scan.ts`, `icon.ts`, `secrets.ts`, `git.ts` (commit, history, undo) | A second entry `runner.ts` with no HTTP server; events go to a sink (WebSocket today, Convex in the cloud); `coordinator-playbook.ts` gets the three levels and "commit and push after every change"; `start_worker` gets `level`; ACP sessions start with a model and effort; `usage.ts` prices per model; the package prefix comes from config | `runner/convex-sink.ts`, `runner/inbox.ts`, `runner/signing.ts`, `runner/git-credentials.ts` (the one-repo token), `runner/ai-meter.ts` (the per-change AI stop for AI from credit) |
| `builder/` | `createApp`, `buildApk`, `fastlane.mjs`, `zip.mjs`, `axml.mjs`, `apksign.mjs`, `OtaSign.java`, `keybackup.mjs` | `ANYAPP_SIGN_LATER=1` (Gradle unsigned, then `apksign.mjs`); checked on Linux (it was built on Windows) | Nothing else |
| `template/`, `template-kotlin/` | All, including the updater, Reload card, crash catcher and diary | Nothing for the first version | Later: a cloud feed for shared apps |
| `app/` | Home grid, chat, installer, quick update hand-over, crash forwarding, AI for your apps, Settings | `api.ts`: the `Client` behind an interface with two implementations | Sign in, mode choice, connect GitHub, "Your credit" and top-up, "Your AI", estimates, the Convex client |
| `desktop/` | Not used by the cloud | | Later: "Move this app to the cloud" |
| New `cloud/` | | | The Convex project (schema, functions, HTTP actions, auth, the GitHub App's token minting, Stripe webhook, estimates), the box provider interface and its Instabox implementation, the box image (Dockerfile) |

Not used in the cloud: Easy Connect, pairing codes, the admin token, the desktop onboarding, the
`gh` CLI and `server/src/github.ts` (the GitHub App's REST calls replace them), sharing and
publishing (after the first version), and the `anyapp` CLI's other apps.

## 10. The first version

**In**: cloud mode in the phone app; Google and email code sign-in (Convex Auth); **connect GitHub**
(the GitHub App), a private `anyapp-cloud-<slug>` repo per app, commit and push after every change,
new boxes restored from GitHub; the app grid with `com.anyappcloud.<slug>` packages; one chat per
app as an **Opus 5.5 high orchestrator** with helpers at three levels in the same box; plan first
and pages; builds and quick updates to the phone; versions and undo; What changed; crash reports;
**AI from credit on our Anthropic key through the Agent SDK** (way E, tokens at cost, the platform
fee) or **their own Anthropic API key** (way B); **dollar credit with Stripe top-ups** (smallest $10, card fee
on top; test mode until launch); machine time drawn from credit at cost plus 10%; **estimates**
(under the message box, on the plan card, per app) and actuals per change; signing keys encrypted in
Convex, signed on the box as a separate Unix user; Instabox behind the provider interface.

**Out**: monthly spending limits; Claude sign-in (way F); moving apps between PC and cloud; sharing
and publishing releases (+3 days, the first thing after); the diary (it needs a phone round trip
through Convex); Expo Exact; the separate signer machine (+2 days, next).

| # | Milestone | Days |
| - | --------- | ---- |
| 0 | **Spike**: the box image (Node, JDK 21, Android SDK, warm Gradle, Git, Claude Code, the runner) imported to Instabox; one box creates and builds the template app (full and quick), signs after Gradle, runs one orchestrator turn that starts a `simple` helper, each with its own model and effort, with an Anthropic key through the Secrets proxy; the helper commits and pushes to a test repo with a one-repo GitHub App token, and a fresh box clones it back; measure create, resume, snapshot restore, clone and build times and memory with two helpers and a build; Convex project with Google and email code sign-in from a dev build of the phone app on the emulator | 4 |
| 1 | Convex backend: schema, auth, runner HTTP actions and token, inbox, file uploads, the box provider interface with Instabox behind it, box lifecycle (scheduler, webhooks, pause, snapshot, delete) | 3.5 |
| 2 | Runner: the event sink in `server/`, `runner.ts`, signing tickets and tmpfs signing, levels and per-session model and effort, the playbook's levels and push rule, the push check after each turn | 4 |
| 3 | GitHub: the App, connect flow (browser and back), user token refresh, repo creation, minting one-repo tokens, the credential helper, restore from GitHub, disconnect handling | 3 |
| 4 | Phone: sign in, mode choice, the Convex `Client`, downloads from file URLs, connect GitHub, "Your AI", "Your credit" and top-up, the estimate line, plan card estimate, per-app costs | 5 |
| 5 | Keys and secrets: envelope encryption, the key service, the signing log, the GitHub refresh token | 2 |
| 6 | Credit and metering: usage rows per session and model from ACP and Instabox, settling machine time from the balance, ledger and balances, Stripe Checkout with the fee on top and its webhook (test mode), the credit gate, estimates from medians (aggregate component), real medians replacing section 7's guesses; AI from credit on our key (AI charges and the platform fee in the ledger, the runner's per-change stop) | 5 |
| 7 | Proof and hardening: the Ajman prayer alarm made in cloud mode on the emulator (top-up in Stripe test mode, estimate shown, code on GitHub), a second prompt as a quick update, a box deleted and the app restored from GitHub, rate limits (one change at a time, 5 boxes per person), egress and abuse notes, docs | 3.5 |
| | **First version** | **30 days, about 6 weeks** (the first draft was 22) |
| | Sharing and publishing releases from the cloud | +3 |
| | Separate signer machine | +2 |

Where the 8 extra days come from: GitHub instead of Git bundles (+2.5 net), credit and Stripe live
instead of switched off (+1.5), estimates (+2), the orchestrator's levels and per-model pricing
(+1.5), the provider interface (+0.5).

## 11. Accounts and keys: one task for the user

Do these in order. Put every value into a **1Password item named `AnyAppAgent Cloud (dev)`**, one
field per value (or into the file the coordinator names), and tell the coordinator it is there.
**Never paste a key, secret or private key in a chat.** Steps marked **Spike** are needed before
milestone 0 starts; **Later** can wait.

1. **Instabox's answer** (done: the email in `C:\aa\ideas\cloud-emails.md` was sent to
   support@instabox.sh). Forward the answer to the coordinator when it comes. No email to Anthropic.
2. **Convex** (Spike, Free plan). Sign up at https://dashboard.convex.dev. Create a project named
   `anyappagent-cloud`, region **US East**. Hand over: the deployment URL (`https://<name>.convex.cloud`)
   and a **development deploy key** (project Settings, Deploy keys).
3. **Instabox** (Spike). Sign up at https://dashboard.instabox.sh. The Free plan (one 4 vCPU / 8 GiB
   machine) is enough for the spike if the invite arrives; if the waitlist blocks you, **Pro, $20 a
   month** (skips the waitlist, includes $20 of usage). Create an API key at
   https://dashboard.instabox.sh/dashboard/api-keys with `machines:read`, `machines:write`,
   `machines:delete` and `images:*`. Hand over: the API key (`ibk_...`) and which plan you are on.
4. **Anthropic API key** (Spike, about $5 of credit). At https://platform.claude.com make a key with a
   small credit. It is also the key AI from credit runs on (way E): before real users, a separate
   Console workspace and key for production, with a monthly spend limit, and enough prepaid credit for
   the usage tier we need. If you have Max or Ultra, first link a Console organization to the plan to claim its
   monthly API credit
   (https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-ultra-and-team-plans).
   Hand over: the key (`sk-ant-...`).
5. **GitHub App** (Spike, free). At https://github.com/settings/apps/new create an app:
   - Name `AnyAppAgent Cloud Dev`, homepage `https://github.com/<your login>`.
   - Callback URL `https://<name>.convex.site/github/callback` (the deployment from step 2, with
     `.convex.site`); tick "Expire user authorization tokens" and "Request user authorization
     (OAuth) during installation".
   - Webhook: untick "Active".
   - Repository permissions: Administration read and write, Contents read and write, Metadata read
     only. No account permissions.
   - "Where can this GitHub App be installed?": **Only on this account** (for the spike).
   - After creating it: "Generate a new client secret" and "Generate a private key" (a `.pem` file
     downloads).
   Hand over: the App ID, the app's slug (from its public page URL), the Client ID, the client
   secret, and the `.pem` file attached to the 1Password item (as a file, not as text in a field).
6. **Google OAuth client** (Spike, free). At https://console.cloud.google.com/apis/credentials: a new
   project `anyappagent-cloud`, OAuth consent screen "External" in testing mode with your own Google
   account as a test user, then an OAuth client ID of type "Web application" with the redirect URI
   `https://<name>.convex.site/api/auth/callback/google`. Hand over: the client ID and client
   secret.
7. **Resend** for email codes (Spike, Free plan). At https://resend.com make one API key. Without a
   verified domain it sends only to your own address, which is enough for the spike. Hand over: the
   API key (`re_...`).
8. **Stripe in test mode** (Later: milestone 6, free). Sign up at https://dashboard.stripe.com/register;
   no business details are needed for test mode. Stay in **Test mode**, then Developers, API keys.
   Hand over: the **test** secret key (`sk_test_...`). The webhook signing secret comes later: the
   coordinator will give you the exact webhook URL to add, then you hand over its `whsec_...`.
   Never hand over a live key (`sk_live_...`) until launch.
9. **Google Cloud KMS** (Later: before real users, about $0.06 a key a month). In the same Google
   Cloud project, enable Cloud KMS; the coordinator will give the exact key ring steps then.
10. **A domain** (Later: before real users, for email codes from our own address and the GitHub
    App's homepage). Not needed for the spike.
11. (Dropped: OpenRouter is not needed; AI from credit runs on our Anthropic key.)

12. **Cloudflare** (Later: for Family circles, `docs/CIRCLES.md`, free). A free account holding the
    domain's DNS, and one scoped API token. Needs the final product name and the domain (item 10).
13. **Firebase** (Later: for Family circles' push, free Spark plan). A Firebase project on the
    `anyappagent-cloud` Google Cloud project, an Android app `com.anyappagent`, its
    `google-services.json` and a service account key. Details in `docs/CIRCLES.md` section 10.
14. **Resend domain** (Later: with item 10). Verify the real domain in Resend so email codes reach
    everyone, not only you.

Costs for the spike: nothing, or $20 for Instabox Pro if the waitlist blocks, plus about $5 of
Anthropic credit (none with Max or Ultra credit).

## 12. Decisions (12 Nov 2026)

- **Q1, AI** (second round, 12 Nov 2026, replaces the first): **AI paid from credit runs on the
  Claude Agent SDK** (today's agent and ACP adapter, `claude-agent-acp`) **with our own Anthropic API
  key** (way E), allowed per section 1's finding. Their own key (way B) stays as the other choice.
  **No email to Anthropic** ("they won't answer, we're very small"): no agreement is sought, ways A,
  C and F are dropped.
- **Q12, pricing**: **tokens at cost**; our **10% goes on machine time and a platform fee**, never on
  the tokens.
- **Q3, credit**: credit is dollars, topped up with us from the first version. Machine time is drawn
  from it at cost plus 10% even with their own key; no free fair-use cap. AI can be paid from the
  same credit (Q1), at cost plus the platform fee (Q12). Every change shows an estimate of machine and AI
  cost first, and each app shows its own.
- **Q4, package names**: cloud apps get their own prefix, `com.anyappcloud.<slug>`.
- **Q5, Instabox**: yes, behind a small provider interface.
- **Q6, signing**: on the box as a separate Unix user first, then a separate signer machine.
- **Q7, top-ups**: smallest $10, the card fee added on top, in the first version.
- **Q8, code**: never stored by us. A private repo per app on the person's GitHub through a GitHub
  App; the agent commits and pushes after every change; new boxes restore from GitHub. Sharing and
  publishing releases stay out of the first version (+3 days after).
- **Q9, models**: each app's chat is an orchestrator on Opus 5.5 high; helpers on Opus 5.5 high
  (across areas), Opus 5.5 medium (a few files) or Sonnet 5.5 high (simple, one area), all in the
  same box, their costs shown per helper and added into the estimate and the usage line.
- **Q10, sign-in**: Convex Auth, Clerk if the spike hits a wall.
- **Q11, region**: Convex US East.
- **Q2** (what to do if Anthropic said no to way A) is closed: no one is asking, and way E is
  allowed.

Still open:

- **Q13. The platform fee's size and basis**: 10% of each change's AI cost (what section 7 assumes),
  10% of the whole change, or a flat fee per change or per month? Shown as its own line next to
  "AI at cost" and "machine time".
