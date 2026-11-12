# Kiwimake Cloud: the plan

A cloud version of Kiwimake for **anyone who does not want to install the PC app**. The person
installs only Kiwimake on the phone, signs in with Google or a code by email, connects their
GitHub, tops up dollar credit, and makes and changes apps exactly as today: the chat is in the phone
app, the APK or quick update arrives on the phone. The agent and the builds run on rented cloud
machines, one per thread. The app's code lives in a private repo on **the person's own GitHub**;
everything else that must last (accounts, apps, chats, usage, money, builds, files, signing keys)
lives in Convex.

Status: **the agreed plan** (decisions of 12 Nov 2026, section 12). **Milestone 0, the spike, ran on
12 Nov 2026**: the box image, builds on a box, an agent turn with the key only in the Secrets proxy,
Convex sign-in, the phone round trip, the repo made with the person's GitHub user token, and push
and clone with a one-repo token through the proxy are proven (section 10, `cloud/README.md`). Facts were
checked on the web on **12 Nov 2026**; each has its source link. Not legal advice: section 1 gives
the texts and the one line that leaves any doubt.

What the user decided (it overrides `C:\aa\ideas\cloud-changes.html` and the first draft of this
file): chat in the Kiwimake phone app, Google or a code by email, Convex for most things, one
instabox.sh box per thread behind a small interface, signing keys stored encrypted in Convex,
storage free to the person. **People pay in credits** (decisions of 12 Nov 2026, third round): a
monthly plan (Starter $12 for 30 credits, Pro $25 for 70, Max $60 for 180; yearly at 10 times the
monthly price), extra credit at $10 for 20 with or without a plan, and 3 free credits every month. A credit bundles everything a change needs (the agent, the
machine, the build, delivery to the phone) and the person never sees tokens, machine time or our
costs. The agent runs on the **Claude Agent SDK** (today's agent, the ACP adapter built on it) with
**our own Anthropic API key**. People with their own Anthropic key take the **Own key plan, $6 a
month**. **Every change shows an estimate first**, in credits. The code is **never stored by us**: the agent commits and pushes
to the person's GitHub after every change. Each app's chat is an orchestrator on **Opus 5.5 high**
that hands work to helpers on the right model. No email or agreement with Anthropic is sought.

**Local and cloud** (decisions of 12 Nov 2026, fourth round, `C:\aa\ideas\local-and-cloud.html`,
Q430 to Q436): **one Kiwimake account** for the PC and the cloud, **optional on the PC** and asked
for only where a feature needs it; signed in **once, on the phone or the PC**, the other side joins
through pairing; **one grid** on the phone with PC and cloud apps together; and, in the first
version, **moving an app between the PC and the cloud** (both ways) and **"My PC is off, do this
change in the cloud"**. Section 3, "One account, two places that make apps".

## 1. The terms question first

**Short version.** **An agent built on the Claude Agent SDK, run in our product on our cloud boxes
with our own Anthropic API key, for our end users, who pay us, is allowed.** Fairly sure (about 85 to
90%): every page about the SDK says so in its own words, and Anthropic itself publishes case studies
of exactly this shape. What stays forbidden is offering **Claude Code itself** (the product: the CLI,
its name and look) as a hosted service paid on our key, and offering claude.ai sign-in or plan limits
inside our product. People bringing their own Anthropic API key stays allowed too. Selling
**credits that bundle the whole service** (the agent's work, machines, builds, storage, delivery to
the phone) at a margin is selling our own product, which A.1 allows ("to power products and services
Customer makes available to its own customers"); it is how Anything and Bolt, both Anthropic case
studies, charge. What D.4 forbids is reselling "the Services" themselves, so we never sell or show
tokens, a token price or API access. (Texts read on the live pages on 12 Nov 2026, below; the one
line that leaves doubt is named in "The Agent SDK finding".)

### The Agent SDK finding (12 Nov 2026)

**The question**: may a company run the Claude Agent SDK (TypeScript or Python) inside its own hosted
product, on cloud boxes, for its end users, with the company's own Anthropic API key, and charge
those end users (credits that bundle AI, machine time and builds, sold at a margin)?

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
   That is Kiwimake Cloud's shape: an app builder for non-coders, on the SDK, paid from credit.
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
  Agent", or "Kiwimake, powered by Claude". No Claude Code look-alike visuals.
- **No claude.ai sign-in in the cloud** (the ACP adapter offers `--cli auth login --claudeai`: not
  shown in cloud mode). Their own API key is fine.
- **Credits buy app changes, never Claude** (D.4). A credit is the price of Kiwimake's service as
  a whole. No token price, token allowance, model price list or per-model cost is shown or sold;
  no API endpoint, general chat or prompt box outside app building is paid from credits; the agent
  only builds and changes the person's own apps. The margin is on our product, not on "the
  Services".
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
App builders for people who do not code price differently: they sell **bundled credits with a
margin** and show no token price. Anything (on the Agent SDK) sells 20K credits for $24 a month
(https://www.anything.com/docs/account/credits.md), Lovable 100 credits for $25
(https://docs.lovable.dev/introduction/subscription-plans.md), Bolt (on the Agent SDK) its own
"tokens" from $25 a month (https://bolt.new/pricing), Rork about 100 messages for $20 to $25 (third-party
figures, https://vp0.com/blogs/rork-pricing-plans-2026/). That is
the model Kiwimake Cloud follows (section 2).

### What that means for each way of paying for AI

| Way | Agent | What the texts say | Status |
| --- | ----- | ------------------ | ------ |
| **E. Our Anthropic API key, AI paid from credit** | Agent SDK (today's agent: the ACP adapter `claude-agent-acp`, built on it) | Allowed: the SDK is under the Commercial Terms "including when you use it to power products and services that you make available to your own customers and end users"; the legal page tells SDK developers to "use API key authentication through Claude Console"; the hosting guide is written for multi-tenant products on the developer's key; Anthropic's own case studies (Anything, Bolt) are this shape. Doubt: one literal reading of the hosted-Claude-Code line ("The Agent SDK finding" above). | **Chosen** (section 12). In the first version. Sold inside credits (section 2), never as tokens. |
| **B. The person's own Anthropic API key** | Agent SDK | Allowed under both regimes: "their own Anthropic API key". | In the first version, next to E, on the Own key plan ($6 a month, section 2). |
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
into Kiwimake Cloud (way B). Whether our service running the agent with their key counts as
"when you run them yourself" is not settled (no one is asking Anthropic); if not, the key still
works, it is just billed to their Console balance.

### Decided

1. **AI paid from credit runs on the Agent SDK with our own Anthropic API key** (way E): today's
   agent and ACP adapter, unmodified, never called "Claude Code" in the product. It is sold inside
   **credits that bundle the whole service**, with our margin in the credit price; no token price
   is ever shown (section 2, section 12).
2. **Their own Anthropic key** (way B, Ultra and Max credit included) is offered next to it on the
   **Own key plan**, $6 a month: Anthropic bills them for the AI, we charge the plan.
3. **No email to Anthropic and no agreement sought.** Ways A, C and F are out.
4. **Instabox** was asked in writing about terms 2(b)(iii) (section 8); that email was sent.

## 2. How people pay

People buy **credits**, and every change uses some. A credit bundles everything a change needs: the
agent's work (AI), the cloud box, the build, storage and delivery to the phone. The person sees
credits only: never tokens, a token price, machine time or what anything costs us. This is how
Lovable, Anything, Bolt and Rork price (section 1).

### Plans

| Plan | Monthly | Yearly (two months free) | Credits a month | Per credit, monthly / yearly |
| ---- | ------- | ------------------------ | --------------- | ---------------------------- |
| Free | $0 | | 3 | |
| Starter | **$12** | **$120** ($10 a month) | **30** | $0.40 / $0.33 |
| Pro | **$25** | **$250** ($20.83 a month) | **70** | $0.36 / $0.30 |
| Max | **$60** | **$600** ($50 a month) | **180** | $0.33 / $0.28 |
| Own key | **$6** | **$60** ($5 a month) | none needed: changes are unlimited on their own Anthropic key, fair use 30 box hours a month | |

- **Yearly plans** cost 10 times the monthly price, paid up front, from the first version. Their
  credits are **given monthly** (30, 70 or 180 on each monthly date of the year), not all at once:
  one rollover and expiry rule for every plan, our AI cost follows the money month by month (no
  year of credits spent in the first week and then disputed), and a person who wants more in one
  month buys extra credit. Cancelling a yearly plan takes effect at the end of the year.

- **Extra credit**: **$10 for 20 credits** ($0.50 each), a one-off Stripe Checkout, valid 12 months.
  Anyone signed in can buy it, with or without a plan, so a light user can pay as they go.
- **Card fees are inside the prices**: no fee is added at checkout.
- **Free credit**: 3 credits a month, given when the account is first used in that month (so dormant
  accounts cost nothing), expiring at the end of the month, no rollover. One free allowance per
  GitHub account (every account must connect GitHub). 3 credits make about three small changes, one
  change in a few files, or the first app (below).
- **The first new app uses at most 3 credits**, on every plan, Free included, so the free credit
  alone can make one (it costs us about $0.86, so the cap gives away about $0.26 once per person).
  Its estimate says "3 credits". Later new apps are metered as usual.
- **Rollover**: unused plan credits roll over **one month** while the plan is active, then expire.
  Extra credit lasts 12 months. Credits are spent **closest to expiry first**: this month's free
  credit, then last month's plan credit, then this month's, then extra credit.
- **Changing plan**: an upgrade starts now (Stripe prorates the price) and adds the new plan's
  credits for the rest of the month pro rata; a downgrade or cancel takes effect at the end of the
  month (the year, on a yearly plan). Monthly to yearly is an upgrade; yearly to monthly starts when
  the year ends. Credits already given stay until they expire; a cancelled account is on Free after that.
- **Refunds**: credits are not refunded as money. A change that fails through our fault (the box or
  the build service, not the app's own code) has its credits given back by hand in the first
  version.

### Credits per change

Credits are **metered from what the change really cost us**, hidden from the person:

- Credits used = (the change's AI at list price + its machine time) / **$0.20**, rounded up to a
  tenth of a credit. $0.20 is the **credit cost basis**, one constant (`CREDIT_COST_MICROS =
  200000`), reviewed when model prices or measured costs change; it is never shown.
- Typical changes (section 7): a small change about **1** credit, a change in a few files about
  **2.2**, a change across areas about **3.3**, a new app about **4.3**.
- The usage line says **"Used 2.2 credits"**. The person can see each change's credits, each app's
  credits this month and their balance; nothing is split into AI and machine.

Because every credit is priced above the $0.20 it costs us, no change and no heavy user can lose us
money on credits; only the free credit, failures we give back and the fixed fees are costs without
income (section 7).

### The Own key plan

- **$6 a month**. AI runs on the person's own Anthropic API key (way B; Max or Ultra API credit
  works, section 1) and Anthropic bills them for it. We charge nothing per change.
- **Fair use: 30 box hours a month** (a typical change keeps a box running about 11 minutes, so
  about 160 changes). Past that, each further box hour uses half a credit from their free or extra
  credit; with none left, the phone offers extra credit.
- Their free monthly credits stay theirs and are used only past fair use; the plan does not mix
  their key and ours within one change.
- Their key cannot be used without the plan: on Free, Starter, Pro or Max every change runs on our
  key and uses credits.
- Each change shows what it likely cost **on their own key**, in dollars ("about $0.20 on your
  Claude key"): that is Anthropic's bill to them, not a price of ours, so it does not break the "no
  token price" rule.

The AI key, ours or theirs, is never put in a file or an environment variable on the box:
Instabox's Secrets proxy adds it to outgoing HTTPS requests, so the agent cannot print it (section
8). **Proven in the spike**: the box's `ANTHROPIC_API_KEY` is a placeholder (`ibsec_...`), the
agent ran a full turn with it (the proxy counted 17 requests, 0 denied), and a scan of the whole
box found the real key in no file, before or after the turn. Managing Secrets needs a signed-in
owner (`instabox login`) or a workspace's `workspace:admin` key (a personal org's API key cannot),
so production runs in an Instabox **workspace** whose key Convex holds. The fallback for a
provider without a secrets proxy, also proven: the runner holds the key in memory and serves a
forwarder on 127.0.0.1 that adds it; the agent runs as another Unix user with a dummy key and
`ANTHROPIC_BASE_URL` pointing at the forwarder.

### Estimates before every change

Before a change runs the person sees what it will likely use:

- **Under the message box**, before sending: **"About 1 credit"** (on the Own key plan: "About
  $0.20 on your Claude key"). It is the median of this app's last 10 changes of the same size, or
  the defaults in section 7 for a new app.
- **On the plan** (bigger changes are planned first, as today): the orchestrator says which helpers
  it will start and at which level (section 3, "Models"), and the plan card shows the estimate for
  exactly that, as a range: "About 3 to 4 credits" (the 25th to 75th percentile of past changes at
  those levels).
- **Per app**, on its Settings page: "This app: about 12 credits a month at your pace", from its
  last 30 days, plus what it used so far.
- **After the change**, the usage line shows the real number next to the estimate: "Used 2.2
  credits (est. 2)".
- A change starts only if the available credits cover the high end of its estimate; otherwise the
  phone offers extra credit or a plan. Nothing else asks for confirmation (spending limits come
  later, as decided).

## 3. The architecture

```
 Kiwimake on the phone             Convex (one deployment, US East)        Box provider (Instabox first)
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

The same Kiwimake APK gets a second way in. First run asks where apps should be made: **"On my
PC"** (today's pairing and Easy Connect, no sign-in), **"In the cloud"** (sign in, then connect
GitHub) or "Already have an account? Sign in". A phone can have both: **one grid** holds the PC's
apps and the cloud's (section 3, "One account, two places that make apps").

- Cloud setup is two short steps: sign in, connect GitHub. The 3 free credits let the person
  try a change at once; a plan or extra credit comes when they want more (the Own key plan asks for
  the key when chosen).
- For cloud apps the phone talks only to Convex. The Convex React Native client keeps live queries
  for the app list, each thread's messages and builds, the balance and the estimates; it reconnects
  by itself and retries mutations until they are confirmed. PC apps keep today's WebSocket to the
  PC; a phone with both keeps both connections.
- Everything the phone does with an APK or a quick update stays as it is (`app/src/lib/installer.ts`,
  `app/modules/anyapp-native`, the Reload card, rollback, crash reports): only where the file comes
  from changes (a Convex file URL instead of `GET /api/apps/:id/apk`).
- The screens stay the same. The data layer gets a second implementation of today's calls
  (`app/src/lib/api.ts` `Client` and the `ServerEvent` stream) backed by Convex and returning the
  same `shared/protocol.ts` types, so `shared/chat` renders cloud chats unchanged. A small merging
  client in front of the two lists both places' apps in one grid and sends each call to the place
  that holds the app (app ids are kept apart per place).
- New screens: first run with the three ways in, sign in, the Kiwimake account sheet, connect GitHub, "Your plan" (plan, credits left, extra credit, the Own key
  plan and its key), the estimate line under the message box and on the plan card, the per-app
  credits line in the app's Settings.
- **Package names**: a new cloud app gets its own prefix, **`com.anyappcloud.<slug>`**, so a cloud
  app and a PC app with the same name never fight over one package on the same phone. (The server
  already sets the package name in one place, `server/src/apps.ts`; the runner passes the cloud
  prefix.) **The package name is the app's for life**: the prefix only says where the app was
  born, and an app moved to the other place keeps it, with its signing key, so it installs over
  itself and keeps its data. The cloud accepts either prefix.

### One account, two places that make apps

**The account.** One Kiwimake account (Convex Auth: Google or an email code), the same for the PC
and the cloud. A person's **PC** and **the cloud** are two *places that make apps*, both listed
under the account. The account exists without GitHub, a plan or a PC.

- **The PC never needs it.** Making and changing apps on your own PC with your own Claude stays
  account free, as today. The account holds no PC app's code, key or chat unless the person moves
  the app or turns on "Use the cloud when my PC is off" (below).
- **Asked for only where a feature needs it**, right there: a family circle, a web app online,
  adding the cloud, moving an app, or a change while the PC is off. Never as a step of the PC's
  onboarding; its last screen says in one line that an account is optional and where to sign in.
- **Signed in once, on either side.** The phone or the desktop signs in; the other joins through
  pairing (the phone hands its paired PC a **PC link**, or the PC hands the sign-in to the phone),
  so no one signs in twice. The desktop's Account page shows it ("Linked from Pixel 8") and can
  unlink.
- **Free credits** are given on the first **cloud** change of a month, not on sign-in, so an
  account used only for circles or web apps costs nothing.

| What | Without an account | Needs the account |
| ---- | ------------------ | ----------------- |
| Make and change apps on your PC, with your Claude | Yes | |
| AI for your apps, backup to a folder, restore on a new PC | Yes | |
| Share on GitHub, updates to friends, Send app, Suggest a change by text, Make my own version | Yes (the PC's own GitHub login) | |
| Family circles, a suggestion straight into the owner's inbox | | Yes (`docs/CIRCLES.md`) |
| A web app online at an address (without: it opens on your phone through your PC) | | Yes (`docs/WEB-APPS.md`) |
| Making apps in the cloud, credits, plans | | Yes, plus GitHub |
| Moving an app between PC and cloud; a change while the PC is off | | Yes, plus GitHub, and credits for cloud changes |

**The PC link.** A credential that lets one PC act for its owner in Convex, and nothing else:
random, shown once, stored only as a hash (`pcLinks`, section 4), kept by the companion in its
state folder, never put in an agent's environment, revocable from either side. Its scopes:
`share` (circles' uploads and suggestions), `web` (publish web apps), `move` (push an app's code
to its cloud repo with a one-repo token Convex mints, upload or download its sealed key, copy its
chat, report build numbers). It replaces circles' `pcTokens` and web apps' publish token.

**One grid.** The phone lists every place it knows: the paired PC (as today) and the account's
cloud. Each tile says where it is made (a small PC or cloud mark) **only when the person has both**;
a PC-only person sees today's grid. "Make a kiwi" gets **Make it on: My PC | Cloud** when both
exist, defaulting to the PC when it is on (the cloud choice shows its estimate). The account sheet
in Settings lists the places with "Add" for the missing one, and the circles and web address the
account has. A PC app whose PC is off still opens; its tile says "PC, off".

**Moving an app** (both ways, in the first version). From the app's menu on the phone or the PC,
while the PC is on and linked:

- **To the cloud**: Convex makes `anyapp-cloud-<slug>` on the person's GitHub (their user token,
  as for a new cloud app; the PC's own `anyapp-<slug>` repo is not reused, since `gh` may be signed
  in to another GitHub account), the companion pushes the code with its whole history there with a
  one-repo token from Convex (so it works whether or not the app ever had a GitHub repo), uploads
  the app's signing key sealed to Convex's public key (the desktop's key backup format,
  `builder/lib/keybackup.mjs`, then wrapped as in section 6), copies the chat history and to-dos
  into `messages`, and reports its highest build number. The cloud's `apps` row takes over with
  `place: "cloud"` and the **same package name**; the next build is numbered above the PC's and
  installs over the app. The PC keeps a read-only copy marked "Moved to the cloud".
- **To the PC**: the companion clones the cloud repo into `C:\aa\apps\<slug>`, downloads the key
  sealed to a key it made for this one request, imports the chat, and takes the next build number.
  The Convex row becomes `place: "pc"` (moved), its box is deleted and its files kept until they
  expire as usual.
- A move is one `moves` row with its steps; a move that stops halfway is resumed or undone from that
  row, and nothing is deleted until the other side has confirmed the code, the key and the chat.

**"My PC is off, do this change in the cloud"** (in the first version). When a PC app's PC is not
reachable, its chat says so and offers **"Do it in the cloud (about 2 credits)"** next to "Wait for
my PC". It needs the account, the cloud added (GitHub connected) and the switch **"Use the cloud
when my PC is off"** in the account sheet; turning it on makes the linked PC keep each app ready:
its code pushed to its cloud repo after every change and its key uploaded once (as for a move).

- The change runs as a normal cloud change on a box (estimate, credits, orchestrator and helpers,
  build, delivery to the phone), on the same package and key, numbered above the PC's last build.
  The app's chat on the phone shows the cloud turn in place, marked "Made in the cloud".
- **The app stays a PC app.** When the PC is back, the companion pulls the cloud's commits, imports
  the cloud turns into the chat, takes the build number, and the box is deleted. If the PC had
  commits it never pushed, it merges them as one prompt to the app's agent (as a build fix is sent
  today) before it takes new work.
- Only one place works on an app at a time: while a cloud change runs or waits to be pulled back,
  the PC holds new prompts for that app and says why.


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

- **Connecting**: a **GitHub App** ("Kiwimake Cloud"), not an OAuth app. The person installs it
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
  a repo the App creates joins the installation by itself (**proven in the spike**: the install was
  on "Only select repositories" with one repo; `anyapp-cloud-spike-1`, made with the user token,
  was in `/installation/repositories` at once and a one-repo token for it could be minted), so the
  phone never has to ask for "All repositories". **Spike (12 Nov 2026)**: an installation
  token cannot do it, whatever the permissions page says: `POST /user/repos` with one answered
  `403 "Rate Limit Exceeded"` five times over 15 minutes while its core limit had 4,998 calls left,
  so the user token is required, as planned. The callback that turns GitHub's code into the user
  token (sealed with AES-256-GCM, with its refresh token; GitHub gives it 8 hours) and the create
  action are built (`cloud/convex/github.ts`) and made `anyapp-cloud-spike-1` (201, private).
- **Every change is pushed**: the playbook tells the orchestrator and every helper to commit with a
  plain message and push after each change, as part of finishing the change. The runner checks
  after each turn that `HEAD` is on GitHub and pushes itself if the agent did not, and a build is
  only shown as "saved" once its commit is pushed. If GitHub is down the runner retries and the chat
  says the change is not saved yet. **Built in milestone 2, simpler than planned:** as on the PC,
  neither the orchestrator nor a helper commits; the runner commits each change when its build
  succeeds ("Build N: ...") and pushes right after (`git.setPushImpl`, `cloud-runner.ts
  pushWithToken`), three tries, with a one-repo token it asks Convex for and holds only in memory
  for that push. The build row records whether its commit was pushed.
- **Pushing from the box**: a Git credential helper asks the runner for the current one-repo token
  (the runner asks Convex, which mints it with the App's private key); the spike checks whether
  Instabox's Secrets proxy can carry it instead, so it never reaches the box at all. **Proven in the
  spike**: a one-repo token (Contents write, 1 hour) saved as a proxy Secret scoped to `github.com`
  and `api.github.com`; on the box git's credential helper hands out only the placeholder
  (`ibsec_...`); the push took 1.7 s, a push to another repo failed, and a fresh box from the image
  cloned it back in 0.8 s and built it in 208 s. So the proxy carries it: Convex mints the token
  and stores it as that box's Secret (an Instabox workspace key in Convex does that headless), and
  replaces its value before the hour runs out (the placeholder stays the same, running boxes get
  the new value in about 10 s). Secrets are org-wide names, so each box gets its own
  (`GH_<boxId>`). **Built in milestone 3, without the proxy for now:** Secrets can only be set by a
  workspace's `workspace:admin` key, and the dev account is a personal org on the Free plan, so the
  runner asks Convex (`/runner/github-token`) for a fresh one-repo token at each push and clone and
  hands it to its own `git` child through an environment variable (never a file, a command line or
  the agent, which runs as another user and cannot read the runner's processes). With a workspace
  key in Convex the token moves into the proxy as above and the runner's code stays the same.
- **A new box restores from GitHub**: it clones the repo (full history, which versions and undo
  need), then installs `node_modules` from the warm cache in the image. Snapshots stay a speed-up,
  not the copy that matters. **Built in milestone 3** (`cloud-runner.ts restoreFromGithub`): a box
  with no state for an app that has a repo and builds clones it (1.4 s), brings the main chat back
  from Convex (`/runner/chat`) and numbers the next build above the highest one. Its first build is
  a full one (the fast lane's base APK is not in the repo): message to new version 447 s, of which
  285 s Gradle.
- **Disconnecting GitHub** stops cloud changes for that person until they reconnect (the chat says
  why); their repos and apps stay as they are. **Built in milestone 3**: "Disconnect GitHub"
  deletes the tokens; a refused token refresh, or GitHub refusing a one-repo token (the App
  uninstalled or the repo taken out of the install), marks the account disconnected; making an app
  or sending a message then answers "GitHub is disconnected. Connect it again to keep changing your
  apps; they are all still there." Connecting: `github:connectUrl` gives the install link (or the
  authorize link once installed) with a one-time state; `/github/callback` checks it, stores the
  user token (8 hours) and its refresh token sealed, and sends the browser back to
  `anyappagent://github`. The user token is refreshed 5 minutes before it expires (refresh tokens
  rotate: an old one is refused).
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

- Our own image: Node 22, a JDK (the builder already builds with JDK 21, `docs/ENVIRONMENT.md`, so
  Debian 13's OpenJDK 21 is fine), the Android SDK and NDK as `docs/ENVIRONMENT.md` pins, Gradle with
  a warm cache for the template, the template's `node_modules`, Git, the agent and the **runner**.
  **The spike built it on a box and saved it with `instabox snapshot save`** (32 s, about 16.6 GB of
  content on 36 GiB of disks): `snapshot import` pulls only from a registry ("it cannot read an image
  that exists only in Docker on your computer"), which means a private registry and a multi-GB push.
  `cloud/box/Dockerfile` is the same recipe for import from CI later. (Spike, 12 Nov 2026:
  `cloud/README.md`.)
- **Lifecycle**: a message resumes the box (pause and resume took about 4 s each through the CLI,
  memory kept). The runner holds Instabox's "activity lease" while a turn or a build runs (model
  calls are silent, and an idle box would pause). **5 minutes** after the last work it pauses (only
  disk billed). After **1 hour** paused it is snapshotted and deleted (snapshots are free today), and
  the next message restores it from the snapshot: **a box from a snapshot took 69 s** (a stock
  template under 1 s), so that message waits about a minute more; the chat says "Waking up your
  app's machine". A snapshot unused for 30 days is deleted; the next message then makes a fresh box
  from the image and clones the repo from GitHub (the first full build of an app on a fresh box
  from the image took 171 s).
  **Built in milestone 1 (`cloud/convex/boxes.ts`), measured on real boxes:** Convex holds the
  activity lease itself while the runner says it is busy (the runner has no Instabox key). **A
  paused box cannot be snapshotted** (Instabox: "resume it, then save the snapshot"), so the hour
  step is resume, stop, snapshot the stopped box, delete: 21 s in all. Pause 5 s, a reply after
  resume 3 s, a reply on a running box 3 s, the first reply from a fresh box from the image 76 to
  125 s (the box's create operation keeps running for a while after it says "running", and
  commands are refused until it ends), a reply after a restore from the thread's own snapshot
  189 s (`cloud/README.md`). A box that pauses in the middle of a long poll loses the poll's answer,
  so work is **offered with a 45 s lease and acknowledged** by the runner, never marked taken when
  sent. Instabox's webhooks (`/instabox/webhook`, Standard Webhooks signing) and a 10-minute
  reconcile against the provider keep Convex's view right when a box pauses or goes by itself.
- **All of a box's outbound HTTPS goes through Instabox's TLS-intercepting proxy**, Secrets or not.
  In the spike it refused every HTTPS connection for about 1.5 minutes during Gradle's first
  download burst, then recovered: the runner retries a build that failed on downloads before it
  counts as a failed build (and before it uses one of the 3 fix turns).

**The runner** is the companion's work loop without its HTTP server, pairing, Easy Connect or `gh`
(`server/src` minus `http.ts`, `auth.ts`, `easy-connect/`, `github.ts`). It starts the agent over
ACP, keeps the playbook, helpers (`workers.ts`), pages, to-dos, the usage meter, the build after
every turn with up to 3 fix turns (`build-cycle.ts`), versions and undo, and the fast lane. Instead
of broadcasting `ServerEvent`s on a WebSocket it posts them to a Convex HTTP action
(`POST /runner/events`, batched every 250 ms while text streams). It takes its work (new messages,
permission answers, cancel, page answers) from Convex by one long-poll HTTP action (`/runner/take`,
then `/runner/ack`). It signs in with
a **runner token**: random, made per box, stored only as a hash in Convex, good for one thread,
revoked when the box is deleted. Convex starts it on the box with a fixed script whose arguments
carry no secret (the token goes on stdin), from a **runner bundle** in Convex file storage
(`node scripts/dev.mjs bundle`), so a new runner needs no new image.

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
  session with the matching model and effort. **Proven in the spike**: after `session/new`,
  `session/set_config_option` with `configId: "model"`, `value: "claude-opus-5-5"` (or
  `claude-sonnet-5-5`), then `configId: "effort"` (category `thought_level`), `value: "high"` or
  `"medium"`; the session's transcript showed `claude-opus-5-5` at `high`.
- **Helpers run in the same box**: each is its own Claude Code process with its own ACP session, as
  the `agent` Unix user, in the app's folder. Helpers that change the app take turns (one change
  slot per app, as today); helpers that only read run at once. Builds run after a changing helper's
  turn, as today. The box size (4 vCPU, 8 GiB) fits the orchestrator, two helpers and a Gradle
  build: in the spike one agent session and a full Gradle build ran at once with no OOM kill, but
  memory (page cache included) sat at 7.4 to 7.9 GiB through every build; two helpers and a build
  at once is still to measure (milestone 2), with 4 vCPU / 16 GiB (Pro's 8/16) as the fallback.
  **Measured in milestone 2** (the runner samples `/proc/meminfo` while it works): the
  orchestrator, one helper and a full Gradle build peaked at 6.6 GiB used (1.2 GiB available); the
  orchestrator and two helpers working at once, each landing a quick update, sat at 5.5 to 5.6 GiB.
  Two helpers each starting a full Gradle build at once did not happen (builds take turns per app),
  so 8 GiB stays.
- **Costs**: every ACP turn reports its usage with the session's model; the runner prices it with
  that model's list price and tags it with the helper and its level. The change's usage line adds
  them up: on the Own key plan "AI $0.31 on your key (orchestrator $0.09, 2 helpers $0.22)", with
  each helper's own line in its row as today; on our key only credits are shown ("Used 1.6
  credits", per helper in its row), never dollars or tokens. The estimate (section 2) is built from the same tags: the orchestrator's
  share plus the planned helpers' levels, each from the app's (or everyone's) past medians for that
  level. Machine time is the box's, shared by all of them, so it is not split per helper.

**The builder on the box** is `builder/` unchanged in what it builds: `createApp`, `buildApk`, the
fast lane (a JavaScript-only change is a quick build in about 16 s with no Gradle, `docs/FAST-LANE.md`).
One change: in the cloud **Gradle never sees the signing key**. With `ANYAPP_SIGN_LATER=1` the init
script sets the release `signingConfig` to `null` (leaving it empty is not enough: Expo's generated
Gradle then signs release builds with the debug key), Gradle builds the release APKs unsigned, and
they are signed with `apksigner` (as the fast lane's bundle swap already does) and the quick update
with `OtaSign.java`, in a separate step after Gradle has exited (section 6). Built in the spike:
`builder/` signs right after Gradle exits (1.6 to 2.6 s for three APKs); moving that step to the
`runner` user with a signing ticket is milestone 2. **Built in milestone 2:** on the box the builder
runs as `agent` with `ANYAPP_SIGN_EXTERNAL=1` and never sees a key (its APKs and quick update
leave it unsigned); the runner (the box's login user) asks Convex for that build's one-time ticket,
writes the key to a tmpfs folder only it can read, signs copies of the outputs
(`builder/lib/external-sign.mjs`: `apksigner`, then `ota.sig` added to the quick update), checks
the certificate, wipes the key and writes the signing log. A new app's key is made by the runner
before the agent starts and handed to Convex once over TLS (sealed there with a data key wrapped by
`KEYS_KEK`; milestone 5 adds sealing to Convex's public key on the way). Kotlin apps sign inside
their own Gradle script and are refused in the cloud for now.

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
| `users` | The Kiwimake account, for the PC and the cloud: from Convex Auth (`name`, `email`, `image`), `cloudSince?` (set on the first cloud change), `pcOffSwitch` ("Use the cloud when my PC is off"), `aiMode` ("ownAnthropic", only on the Own key plan, or "credit"), `githubLogin`, `githubInstallationId`, `stripeCustomerId`, `blocked` | `by_email`, `by_github_installation` |
| `apps` | `userId`, `name`, `slug`, `packageName` (`com.anyappcloud.<slug>`, or `com.anyapp.<slug>` for an app born on the PC), `place` ("cloud" or "pc"), `pcLinkId?` and `pcAppId?` (a PC app that moved or is kept ready for PC-off changes), `buildHigh` (the highest build number either place made), `repo` (`owner/anyapp-cloud-<slug>`), `pushedCommit`, `preset`, `iconFileId`, `lastBuild`, `status` (`AppStatus`), `health`, `overview` (text of `overview.md`) | `by_user`, `by_package` |
| `threads` | `appId`, `userId`, `boxId`, `boxState` ("none", "starting", "running", "paused", "snapshotted", "deleted"), `runnerTokenHash`, `lastActiveAt`, `agentSessionId` | `by_app`, `by_state_and_active` |
| `messages` | `threadId`, `workerId?`, `item` (a `ChatItem`: text, tool rows, plan, permission, page, build, usage), `seq` | `by_thread_seq` |
| `inbox` | `threadId`, `kind` ("prompt", "permission", "cancel", "page-answers"), `payload`, `takenAt` | `by_thread_untaken` |
| `changes` | `appId`, `threadId`, `messageId`, `estimate` (`costMicros`, `millicredits`, `low`, `high`, `levels`), `actual` (`machineMicros`, `aiMicros`, `millicredits`), `aiPaidBy` ("ownKey" or "credit"), `state` | `by_app_at`, `by_message` |
| `builds` | `appId`, `number`, `delivery` ("apk" or "quick"), `files` (`{abi, fileId, sizeBytes, sha256}[]`), `otaFileId`, `runtime`, `changes` (`ChangeNotes`), `commit`, `pushed`, `seconds` | `by_app_number` |
| `usage` | `userId`, `appId`, `threadId`, `changeId`, `kind` ("inference" or "machine"), `workerId?`, `level?`, `model?`, `effort?`, `tokens` (`TokenUsage`) or `seconds` and `size`, `costMicros` (our cost, never shown), `millicredits` (0 for AI on their own key), `settled` | `by_user_at`, `by_change`, `by_app_level` |
| `subscriptions`, `grants`, `ledger`, `balances` | Plans and credits: section 5 | |
| `keys` | `appId`, `userId`, `packageName`, `certSha256`, `wrappedDataKey`, `ciphertext`, `iv`, `kekVersion`, `lineage?` (never deleted) | `by_app` |
| `signings` | `appId`, `build`, `sha256` of what was signed, `at` | `by_app` |
| `secrets` | `userId`, `kind` ("anthropic", "githubRefresh"), `wrappedDataKey`, `ciphertext`, `iv`, `last4`, `expiresAt?` | `by_user_kind` |
| `pcLinks` | One PC acting for its owner. `userId`, `tokenHash`, `deviceName`, `scopes` (`share`, `web`, `move`), `linkedFrom` ("phone" or "pc"), `createdAt`, `lastSeenAt`, `revokedAt?` | `by_hash`, `by_user` |
| `moves` | `appId`, `userId`, `pcLinkId`, `kind` ("toCloud", "toPc", "pcOff" for a change while the PC is off, "pullBack"), `steps` (code, key, chat, build number, each with `doneAt?`), `state`, `startedAt`, `endedAt?` | `by_app`, `by_user_state` |
| `boxes` | `threadId`, `provider` ("instabox"), `providerId`, `size`, `startedAt`, `pausedAt`, `snapshotId`, `secondsBilled` | `by_thread`, `by_provider_id` |

Medians for the estimates come from `usage` through the aggregate component (per app and level, and
across everyone for new apps). Files: APKs (per ABI), quick update zips, icons, chat pictures, page
HTML. **No code**, no Git bundles.

## 5. Metering and billing (credits)

**What is measured, and from where:**

| What | Live number (shown while it runs) | The number we bill (the truth) |
| ---- | --------------------------------- | ------------------------------ |
| Machine | Seconds the box ran (runner) | The provider's usage. Instabox's per-machine usage endpoint (`GET /v1/machines/{id}/usage`, offered "for billing your own customers"): running seconds by size, plus disk while paused. Priced at our cost into the change's credits; on the Own key plan, counted against the 30 box hours. |
| AI on our key | Each ACP turn's `usage` (input, output, cache write, cache read) per session, as the usage meter reads it today (`server/src/usage.ts`), times that model's list price | The same, settled after each turn as our cost, then turned into credits. Checked once a day against our Console usage for the key. |
| AI, own key (Own key plan) | The same ACP usage | Never billed by us. Billed by Anthropic to them. Shown in dollars as "on your Claude key" so the estimates are honest. |
| Storage in Convex, GitHub | Not shown | Free to the person, as decided (GitHub is theirs). Paused disk is ours, not charged. |

**Turning cost into credits**: each turn's cost (AI at list plus machine) is converted at the credit
cost basis, `CREDIT_COST_MICROS = 200000` ($0.20 a credit), into **millicredits** (thousandths of a
credit, integers, never floats; 2.2 credits is 2,200). At the end of the change the total is rounded
up to a tenth of a credit with one `adjust` row. The person sees only credits.

**The data model** (Convex; these four tables replace the dollar `ledger` and `balances` of the
first draft):

| Table | Fields (short) | Indexes |
| ----- | -------------- | ------- |
| `subscriptions` | `userId`, `plan` ("free", "starter", "pro", "max", "ownKey"), `interval` ("month" or "year"), `stripeSubscriptionId?`, `status` ("active", "pastDue", "cancelled"), `periodStart`, `periodEnd` (a month or a year), `nextGrantAt` (the next monthly grant), `cancelAtPeriodEnd`, `boxSecondsThisMonth` (Own key fair use, reset at each monthly grant), `firstAppDone` | `by_user`, `by_stripe_id`, `by_next_grant` |
| `grants` | `userId`, `source` ("free", "plan", "extra", "refund", "adjust"), `millicredits` (given), `remaining`, `grantedAt`, `expiresAt`, `stripePaymentId?`, `period?` | `by_user_expires` (spending order), `by_expires` (the expiry job) |
| `ledger` | `userId`, `kind` ("grant", "spend", "expire", "refund", "adjust"), `millicredits` (plus or minus), `grantId`, `changeId?`, `usageIds?` | `by_user_at`, `by_change` |
| `balances` | `userId`, `millicredits` (the sum of unexpired grants' `remaining`, changed in the same mutation as `grants` and `ledger`) | `by_user` |

The plan prices and credits (`PLANS`: Starter $12 or $120 a year and 30, Pro $25 or $250 and 70,
Max $60 or $600 and 180, Own key $6 or $60), the extra credit pack ($10 for 20), the free allowance
(3), the first app cap (3) and the cost basis live in one config file in `cloud/`, so a price change
is one edit.

**Grants:**

- **Free**: when an account on Free (or any plan) first opens the app or starts a change in a month,
  a `free` grant of 3 credits is written if none exists for that month; it expires at the month's
  end (UTC). One per GitHub account.
- **Plan**: a `plan` grant of that plan's credits is written each month, expiring at the end of the
  **next** month (one month of rollover). For a monthly plan Stripe's `invoice.paid` writes it; for
  a yearly plan `invoice.paid` writes the first one and sets `nextGrantAt`, and a Convex cron
  (hourly, on `by_next_grant`) writes the other eleven on each monthly date while the subscription
  is active. Upgrades add a pro rata grant at once.
- **Extra**: Checkout's `checkout.session.completed` writes an `extra` grant of 20 credits,
  expiring in 12 months. Any signed-in account can buy it, with or without a plan.
- **Expiry**: a daily Convex cron writes an `expire` row for each grant past `expiresAt` with credits
  left, and lowers the balance in the same mutation.

**Spending**: after each turn the runner reports its usage; one mutation prices it, converts it to
millicredits, takes them from the user's grants in `by_user_expires` order (closest to expiry first),
writes the `spend` rows with the grant and change ids, and lowers the balance. On the Own key plan
the box's seconds are added to `boxSecondsThisMonth` instead; past 30 hours each box hour costs half
a credit, spent the same way.

**The first app cap**: the change that creates a person's first app (while `firstAppDone` is false)
stops taking credits at 3 (3,000 millicredits); what it costs above that is written as an `adjust`
row against our cost, not the person's credits, and `firstAppDone` is set when it ends. The credit
gate asks only for 3 credits for that change.

**Money in**: Stripe Billing subscriptions for the plans and Stripe Checkout for extra credit (the
`@convex-dev/stripe` component handles the webhooks). Card fees are inside our prices: about $0.65
on Starter, $1.03 on Pro, $2.04 on Max, $0.47 on Own key and $0.59 on an extra credit pack; on the
yearly plans $3.78, $7.55, $17.70 and $2.04 a year (2.9% plus 30 cents, a US card; 1% more for
international cards). A failed renewal moves the subscription
to "pastDue": its next grant waits, credits already given stay.

**Who pays nothing**: an account that never pays gets its 3 free credits a month and nothing more.
Storage is free.

**Running out**: a change starts only if the available credits cover the high end of its estimate.
The runner is the hard stop: it adds up each turn's credits and cancels the ACP session when the
change reaches the balance plus a small overdraft (half a credit). A change already running is
allowed to finish within that overdraft; the next grant covers it. Monthly spending limits come
later, as decided.

**Checks**: once a day, the sum of `usage.costMicros` is compared with our Anthropic Console usage
and Instabox's usage, and the average credits per change by level with section 7's numbers; if real
costs drift above the cost basis, the basis is raised (one constant) before margins go.

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

**Moving between PC and cloud** (in the first version, section 3): the key travels sealed in the
desktop's key backup format (`builder/lib/keybackup.mjs`) through the PC link, never as a file the
person handles; in Convex it is wrapped like any other key. The code moves through GitHub.

## 7. Costs

### Per change, with the orchestrator and helpers

Prices (section 8): Opus 5.5 $4 in, $20 out, $5 cache write, $0.20 cache read per million; Sonnet
5.5 half of that. Machine: Instabox 4 vCPU and 8 GiB is 4 x $0.004 + 8 x $0.00225 = **$0.034 an
hour**, for the turns, the build and 5 minutes before the box pauses.

The first draft's numbers were the usage meter's measured run with one agent doing the work
(`docs/TRUST.md`). The orchestrator plus helpers split is **not measured yet**: the numbers below
are that measurement re-cut by hand (the orchestrator's Opus turns about $0.08 to $0.15 per change,
the helper's work at its level's price, high effort a little dearer than medium). Milestone 6
replaces them with real medians, and the credit cost basis follows the real numbers.

| Change | Levels | AI (list) | Box minutes | Machine | **Our cost** | **Credits** | Price on Starter ($0.40 a credit) | Our margin |
| ------ | ------ | --------- | ----------- | ------- | ------------ | ----------- | --------------------------------- | ---------- |
| Simple (text, styling), quick update | orchestrator + 1 `simple` | about $0.20 | about 7 | $0.004 | $0.20 | about **1** | $0.40 | $0.20 |
| Complex in a few files, full build | orchestrator + 1 `focused` | about $0.43 | about 12 | $0.007 | $0.44 | about **2.2** | $0.88 | $0.44 |
| Complex across areas, full build | orchestrator + 1 or 2 `deep` | about $0.65 | about 15 | $0.009 | $0.66 | about **3.3** | $1.32 | $0.66 |
| New app (plan, helpers, first build) | orchestrator + 2 `deep` | about $0.85 | about 20 | $0.011 | $0.86 | about **4.3** | $1.72 | $0.86 |

Spike check (12 Nov 2026): two small changes done by the Opus 5.5 high orchestrator alone (no
helper) cost $0.182 and $0.209 at list price, with 31K to 33K tokens of cache write and 92K to 127K
of cache read each; the box worked about 40 to 60 s per change (turn, quick build, upload), so the
"about 7" box minutes are mostly the 5 minutes before the pause. The simple row holds.

The margin before card fees is half the price on Starter, 44% on Pro ($0.36 a credit), 40% on Max
($0.33) and 60% on extra credit ($0.50).

### Per month

Assumptions:

- An **active person** makes 8 changes a month (4 simple, 2 in a few files, 1 across areas, 1 new
  app): about **16 credits**, costing us **$3.26** (AI $3.16, machines about $0.10 with build-fix
  turns and paused disk).
- Every paying person is on **Starter** ($12, 30 credits), the plan that fits 16 credits. Pro and Max
  keep the same or a higher margin per person.
- **Free accounts**: 3 free accounts in use for every paying person, each using all 3 free credits
  ($0.60 of our cost), so **$1.80 per paying person**. Free accounts that do not open the app that
  month get no credits and cost nothing.
- **The first app cap**: as many new accounts a month as there are paying people, each giving away
  about $0.26 once, so **$0.26 per paying person** a month.
- Fixed fees without machine usage (counted per person above): Instabox Pro $20 (its $20 of
  included usage covers up to about 100 people) or Builder $100 at 1000; Convex $0, about $3, about
  $30; the key service, domain, email codes and GitHub App about $1.

| A month, everyone paying on Starter, typical use | Monthly ($12) |  |  | Yearly ($120, so $10 a month) |  |  |
| ------- | --------- | ---------- | ----------- | --------- | ---------- | ----------- |
| People paying | 10 | 100 | 1000 | 10 | 100 | 1000 |
| Plans paid | $120 | $1,200 | $12,000 | $100 | $1,000 | $10,000 |
| Card fees ($0.65 a month; yearly $0.32) | $6.50 | $65 | $650 | $3 | $32 | $315 |
| AI and machines for paying people (16 credits, $3.26 each) | $33 | $326 | $3,260 | $33 | $326 | $3,260 |
| Free credit (3 free accounts per payer, $0.60 each) | $18 | $180 | $1,800 | $18 | $180 | $1,800 |
| The first app cap ($0.26 per payer) | $3 | $26 | $260 | $3 | $26 | $260 |
| Instabox plan, Convex, the rest | $21 | $24 | $131 | $21 | $24 | $131 |
| **What we keep** | about **$39** | about **$579** | about **$5,899** | about **$23** | about **$413** | about **$4,234** |
| The same if every payer uses all 30 credits ($6.00 each) | about $12 | about $305 | about $3,159 | about minus $5 | about $139 | about $1,494 |

Pro and Max keep more per person at full use (yearly Pro about $4.10, yearly Max about $10.50 a
month after the free tier and the cap); yearly Starter at full use is the thinnest plan, about $1.63
a person. Yearly money arrives up front, so cash comes early, but it is earned month by month.

| A month, everyone on the Own key plan | Monthly ($6) |  |  | Yearly ($60, so $5 a month) |  |  |
| ------- | --------- | ---------- | ----------- | --------- | ---------- | ----------- |
| People paying | 10 | 100 | 1000 | 10 | 100 | 1000 |
| Plans paid | $60 | $600 | $6,000 | $50 | $500 | $5,000 |
| Card fees ($0.47 a month; yearly $0.17) | $5 | $47 | $470 | $2 | $17 | $170 |
| Machines (about $0.10 each; $1.02 at full fair use) | $1 | $10 | $100 | $1 | $10 | $100 |
| Instabox plan, Convex, the rest | $21 | $24 | $131 | $21 | $24 | $131 |
| **What we keep** | about **$33** | about **$519** | about **$5,299** | about **$26** | about **$449** | about **$4,599** |

**The development budget** (about $3,000 a month of profit): reached at about **520 paying people**
on monthly Starter with typical use (about **950** if every one of them uses every credit), and at
about **720** if all of them pay yearly (about 1,900 at full use). A real mix of plans lands between.
At 100 people the business keeps about $140 to $579 a month; $3,000 at 100 people would take about
$37 a month from each.
The free tier is the cost to watch: each active free account costs up to $0.60 a month, so about 13
active free accounts per paying person on monthly Starter (10 on yearly Starter) eat the whole profit
at typical use. If that
happens, the allowance is lowered or tied to activity (one constant).

Instabox's paused disk is the one cost that grows fastest if boxes are not snapshotted;
snapshotting after an hour keeps the average under 1 GiB per person.

Numbers used: Instabox "$0.004 per vCPU-hour", "$0.00225 per GiB-hour", disk "$0.08 per GiB-month",
"Snapshots are free", Pro "$20/month + usage" with "$20 of credits" and 200 GiB disk, Builder
"$100/month + usage" (https://instabox.sh/docs/pricing.md). Convex Starter free with 1M function
calls, then $2.20 per million; Professional $25 per developer with 25M calls
(https://www.convex.dev/pricing); about 1,000 to 2,000 calls per change for streaming chat, batched
(estimate). Stripe 2.9% plus 30 cents for a US card. OpenRouter: "5.5% ($0.80 minimum) fee when you
purchase credits", "We pass through the pricing of the underlying model providers without any
markup" (https://openrouter.ai/docs/faq). GitHub Apps and private repos on personal accounts cost
nothing. Competitors' prices (12 Nov 2026): section 1, "What others do".

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
  not run an emulator there). **The Free plan, as the API enforces it** (spike, 12 Nov 2026): only
  the `agent-browser`, `android`, `omarchy` and `ci` templates or a snapshot (`universal` refused),
  idle pause fixed at 30 minutes, `maxRunMinutes: 120` on the machine (the limits page says 480),
  5 snapshots.
- **Times** (measured in the spike, through the CLI): create from a template under 1 s server side
  (9 s wall); pause 3.7 s, resume 4.1 s; stop 7.6 s, start 7.2 s; snapshot save 32 s; **create from
  a snapshot 69 s**; restore in place 83 s. Every table and number: `cloud/README.md`.
- **Android**: "Debian 13 has no `openjdk-17` package"; it ships OpenJDK 21, and "Gradle and the
  Android Gradle plugin run on 21". Our builder already builds with JDK 21 (proven on a box: the
  template app builds unchanged). Custom images: `instabox snapshot import <docker image>`, amd64
  only, from a registry only (https://instabox.sh/docs/custom-images.md); or set a box up and
  `instabox snapshot save` it (the spike's route).
- **Persistence**: stop keeps files, pause keeps memory too; "No forced TTL" for paused machines and
  snapshots.
- **Limits**: Pro 500 machines, 100 running, 30 starts a minute; idle pause 5 to 30 minutes on paid
  plans; an "activity lease" keeps a box awake during silent model calls; upload about 50 Mbit/s per
  machine; no documented outbound allowlist; automatic abuse checks can lock a box for 24 hours.
- **Secrets proxy**: adds API keys to outgoing HTTPS headers so the real key never enters the box
  (https://instabox.sh/docs/secrets.md); git over HTTPS works with it too (Basic auth, hosts
  `github.com` and `api.github.com`). Saving a Secret needs an org owner signed in, or a
  workspace's `workspace:admin` API key: "a personal org's API key cannot carry workspace:admin"
  (the spike's key was refused with `missing_scope`; the signed-in CLI saved it). Proven with the
  agent in the spike (section 2, "The Own key plan"); the GitHub token through it is still to
  prove. The proxy intercepts all outbound HTTPS (its CA is in the box's trust stores), with or
  without Secrets.
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
  the spike checks it. In practice (spike) an installation token on a personal account's
  installation is refused (`403 "Rate Limit Exceeded"`, every time); the user token is needed.

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
| `shared/protocol.ts` | Every type the phone renders (`App`, `ChatItem`, `BuildInfo`, `OtaInfo`, `ApkVariant`, `TokenUsage`, `AppUsage`, `ChangeNotes`, `WorkerInfo`, `PageInfo`, `ServerEvent`) | Additive only: `BuildInfo.fileUrls?`, `App.cloud?`, `ChatItem.cost?`, `WorkerInfo.level?` | Runner event, estimate and billing types (`CreditEstimate`, `Balance`, `UsageCharge`, in credits) |
| `shared/chat`, `shared/theme` | All: rows, build card, usage line, pages, the Workbench look | The usage line shows the credits used and the estimate next to it; the plan card shows an estimate | The estimate line under the message box |
| `server/` | `acp/`, `workers.ts`, `playbook.ts`, `pages/`, `todos.ts`, `usage.ts`, `build-cycle.ts`, `history.ts`, `health.ts`, `apk-scan.ts`, `icon.ts`, `secrets.ts`, `git.ts` (commit, history, undo) | A second entry `runner.ts` with no HTTP server; events go to a sink (WebSocket today, Convex in the cloud); `coordinator-playbook.ts` gets the three levels and "commit and push after every change"; `start_worker` gets `level`; ACP sessions start with a model and effort; `usage.ts` prices per model; the package prefix comes from config | `runner/convex-sink.ts`, `runner/inbox.ts`, `runner/signing.ts`, `runner/git-credentials.ts` (the one-repo token), `runner/ai-meter.ts` (the per-change stop when credits run out); on the PC side `cloud-link.ts` (the PC link, moves, keeping apps ready, pull back) |
| `builder/` | `createApp`, `buildApk`, `fastlane.mjs`, `zip.mjs`, `axml.mjs`, `apksign.mjs`, `OtaSign.java`, `keybackup.mjs` | `ANYAPP_SIGN_LATER=1` (Gradle unsigned, then `apksign.mjs`); checked on Linux (it was built on Windows) | Nothing else |
| `template/`, `template-kotlin/` | All, including the updater, Reload card, crash catcher and diary | Nothing for the first version | Later: a cloud feed for shared apps |
| `app/` | Home grid, chat, installer, quick update hand-over, crash forwarding, AI for your apps, Settings | `api.ts`: the `Client` behind an interface with two implementations and a merging client in front; tiles get a place mark | First run with three ways in, sign in, the account sheet, Make it on, Move, Do it in the cloud, connect GitHub, "Your plan" and extra credit, estimates, the Convex client |
| `desktop/` | Onboarding unchanged (one line about the optional account) | | The Account page (sign in, or linked from the phone, and unlink), "Move to the cloud" and "Move to my PC", the "Use the cloud when my PC is off" switch |
| New `cloud/` | | | The Convex project (schema, functions, HTTP actions, auth, the GitHub App's token minting, Stripe webhook, estimates), the box provider interface and its Instabox implementation, the box image (Dockerfile) |

Not used in the cloud: Easy Connect, pairing codes, the admin token, the desktop onboarding, the
`gh` CLI and `server/src/github.ts` (the GitHub App's REST calls replace them), sharing and
publishing (after the first version), and the `anyapp` CLI's other apps.

## 10. The first version

**In**: cloud mode in the phone app; **one optional Kiwimake account** for the PC and the cloud,
signed in once on either side, the PC link; **one grid** with PC and cloud apps; **moving apps
between PC and cloud, both ways**; **"My PC is off, do this change in the cloud"**; Google and
email code sign-in (Convex Auth); **connect GitHub**
(the GitHub App), a private `anyapp-cloud-<slug>` repo per app, commit and push after every change,
new boxes restored from GitHub; the app grid with `com.anyappcloud.<slug>` packages; one chat per
app as an **Opus 5.5 high orchestrator** with helpers at three levels in the same box; plan first
and pages; builds and quick updates to the phone; versions and undo; What changed; crash reports;
**AI on our Anthropic key through the Agent SDK** (way E) or **their own Anthropic API key** (way B,
the Own key plan); **credits**: the Free, Starter, Pro, Max and Own key plans, monthly and yearly, as Stripe
subscriptions, extra credit by Stripe Checkout, the free monthly credit, rollover and expiry (test
mode until launch); **estimates** in credits (under the message box, on the plan card, per app) and
actuals per change; signing keys encrypted in
Convex, signed on the box as a separate Unix user; Instabox behind the provider interface.

**Out**: monthly spending limits; Claude sign-in (way F); sharing
and publishing releases (+3 days, the first thing after); the diary (it needs a phone round trip
through Convex); Expo Exact; the separate signer machine (+2 days, next).

| # | Milestone | Days |
| - | --------- | ---- |
| 0 | **Spike**: the box image (Node, JDK 21, Android SDK, warm Gradle, Git, Claude Code, the runner) imported to Instabox; one box creates and builds the template app (full and quick), signs after Gradle, runs one orchestrator turn that starts a `simple` helper, each with its own model and effort, with an Anthropic key through the Secrets proxy; the helper commits and pushes to a test repo with a one-repo GitHub App token, and a fresh box clones it back; measure create, resume, snapshot restore, clone and build times and memory with two helpers and a build; Convex project with Google and email code sign-in from a dev build of the phone app on the emulator | 4 |
| 1 | Convex backend: schema, auth, runner HTTP actions and token, inbox, file uploads, the box provider interface with Instabox behind it, box lifecycle (scheduler, webhooks, pause, snapshot, delete); `users` as the Kiwimake account without GitHub or a plan, the subscription and free grant made on the first cloud change, `apps.place` and either package prefix, `pcLinks` | 4 |
| 2 | Runner: the event sink in `server/`, `runner.ts`, signing tickets and tmpfs signing, levels and per-session model and effort, the playbook's levels and push rule, the push check after each turn | 4 |
| 3 | GitHub: the App, connect flow (browser and back), user token refresh, repo creation, minting one-repo tokens, the credential helper, restore from GitHub, disconnect handling | 3 |
| 4 | Phone: first run with three ways in (sign-in skipped for the PC), sign in, the account sheet with places and "Add", the Convex `Client` and the merging client (one grid, place marks, app ids kept apart), "Make it on" in Make a kiwi, the PC-off line, sign-in sheets reused by circles and web apps, downloads from file URLs, connect GitHub, "Your plan" (plans, extra credit, the Own key plan and its key), the estimate line, plan card estimate, per-app credits | 6.5 |
| 5 | Keys and secrets: envelope encryption, the key service, the signing log, the GitHub refresh token | 2 |
| 6 | Credits and metering: usage rows per session and model from ACP and Instabox, cost turned into credits, subscriptions, grants (free, plan, extra), rollover and the expiry job, spending closest to expiry first, ledger and balances, Stripe Billing and Checkout and their webhooks (test mode), Own key fair use, the credit gate, estimates from medians (aggregate component), real medians replacing section 7's guesses, the runner's per-change stop | 5.5 |
| 7 | The PC link: sign in on the desktop (a browser page, then back) or link from the paired phone, both ways, through the pairing channel; the companion keeps the link; the desktop's Account page and unlink; scopes checked in Convex | 1 |
| 8 | **Moving apps, both ways**: the `moves` row and its resumable steps, the cloud repo made and pushed from the PC with a one-repo token, the key sealed up and down, the chat and to-dos copied both ways, build numbers carried over (`buildHigh`), the read-only "Moved" copy, Move on the phone's app menu and the desktop | 4 |
| 9 | **"My PC is off, do this change in the cloud"**: the PC-off switch and keeping apps ready (push after every change, key once), the chat's offer with its estimate, the cloud change on a PC app's package and key, "Made in the cloud" rows, pull back when the PC returns (commits, chat, build number, a merge prompt for unpushed work), one place at a time | 3 |
| 10 | Proof and hardening: the Ajman prayer alarm made in cloud mode on the emulator (a Starter plan in Stripe test mode, estimate in credits shown, code on GitHub), a second prompt as a quick update, a box deleted and the app restored from GitHub; a phone with a PC paired and the cloud added, both in one grid; a PC app moved to the cloud and back, installing over itself each time with its data; a change made while the PC is off and pulled back when it returns; rate limits (one change at a time, 5 boxes per person), egress and abuse notes, docs | 4 |
| | **First version** | **41 days, about 8 weeks** (30.5 before local and cloud; the first draft was 22) |
| | Sharing and publishing releases from the cloud | +3 |
| | Separate signer machine | +2 |

**Milestone 0, what ran (12 Nov 2026, numbers in `cloud/README.md`):** the image (built on a box and
saved as a snapshot, not imported); a fresh box from it builds a new app in 171 s, a quick update in
6 to 7 s, signed after Gradle; orchestrator turns on Opus 5.5 high (no helper yet) for $0.14 to
$0.21 a small change, the last one with the key only in Instabox's Secrets proxy; Convex Auth
(Google reaches Google's page, the email code goes out through Resend, dev-only anonymous sign-in)
and the phone round trip, prompt to APK link in about 38 s; a push from a box and a clone on a
fresh box with a one-repo token carried by the Secrets proxy; the repo made with the person's
user token, which joins a "selected repositories" install by itself. Left for milestone 2: a helper at its own level, and memory with two helpers
and a build.

**Milestone 1, what ran (12 Nov 2026):** the full schema (sections 4 and 5, plus `workers`,
`pages`, `todos`, `signingTickets`, `meta`, `webhookEvents`), the account without GitHub or a
plan, the Free subscription and the 3 free credits on the first cloud change (one per GitHub
account), `apps.place` and either package prefix, `pcLinks`, the runner routes with a per-box token,
the inbox with leases, file uploads and build records (last 3 builds keep their files), the
`BoxProvider` interface with Instabox behind it, and the lifecycle (scheduler, a minute tick,
webhooks, reconcile). Proven: 19 tests (`cloud/tests`), and on real boxes a phone stand-in made an
app, Convex made its box from the image and started a stand-in runner (no AI), then pause, resume,
snapshot and delete, restore from the snapshot, and removal, with no box or snapshot left behind.

**Milestone 2, what ran (12 Nov 2026):** the runner is `server/src/cloud-runner.ts` (AppManager
with its ServerEvents sent to Convex and its commands taken from the inbox), started by
`cloud/runner/runner.mjs` from the runner bundle. A new image, **`anyapp-box-v1`**
(`cloud/box/provision-v1.sh`): the `kiwi` group shared by the runner and `agent` for `/data/apps`
only, the agent owning the shared Gradle and builder caches, `/opt/kiwi/agent.sh` (sudo gives the
agent a clean environment with only the proxy placeholder for the AI key), and the companion's
dependencies (the boot script links them when the lock file matches). ACP sessions get their model
and effort (`session/set_config_option`), `start_worker` has `level`, the orchestrator's playbook
in the cloud has the three levels and says it is "Kiwimake's AI agent, powered by Claude", and the
agent gets no file access through the runner (ACP's fs capability is off). Proven on a real box
(`cloud/scripts/m2-proof.mjs`, `C:/aa/e2e/cloud-build/m2/`): a new app planned by the orchestrator
(Opus 5.5 high) and built by a `focused` helper (Opus 5.5 medium) as `agent`, signed with a ticket
(the APK's certificate is the app's own, checked with `apksigner`), uploaded and installed on the
emulator; a "make the title green" change by a `simple` helper (Sonnet 5.5 high) as a quick update;
two `simple` helpers at once, each landing a quick update. The agent could not read the runner's
environment, its state, the box's secrets file or the key folder, and had no sudo. AI used: $2.11
at list price for a new app and three changes (with $0.14 of fix turns lost to a box permission
bug found and fixed on the way). Pushing waits for GitHub (milestone 3).

**Milestone 3, what ran (12 Nov 2026):** `cloud/convex/github.ts` (connect link with a one-time
state, the callback, the user token sealed and refreshed, the app repo made with it, one-repo
installation tokens signed with the App's key in Convex's own runtime, disconnect), the runner's
pushes and clones with those tokens, and the restore from GitHub. Proven: 7 tests with a fake
GitHub (`cloud/tests/github.test.ts`); live, the stored user token refreshed after a forced expiry;
a new app "Shop List" got `maddada/anyapp-cloud-shoplist` (private) at once, its first build was
pushed (GitHub's main is the build's commit), its token reached that one repo only; its box and
snapshot were then deleted, the next message made a fresh box that cloned the repo in 1.4 s, and
build 2 was pushed on top; after "Disconnect GitHub" a message was refused with the plain reason.
**Not run:** the browser end of connecting (the person signs in to GitHub and taps Authorize): the
proofs used the user token the spike stored. AI used: about $1.3.

**Milestone 4, what ran (12 Nov 2026):** the phone's cloud mode. `app/src/lib/cloud.ts` is a
second client with the PC client's calls (same names, same `shared/protocol.ts` types), and each
call goes to the place that holds the app (Convex ids are 32 lowercase letters and digits, a PC's
are UUIDs, so they never collide); `app/src/lib/cloudSync.tsx` keeps the account, the cloud apps
and each open cloud chat live from Convex; the store keeps each place's apps apart, so pairing,
unpairing or signing out touch only their own place. New screens: first run with three ways in,
sign in (Google, a code by email; `?reason=` gives circles, web apps, moving and PC-off their own
line), the account sheet with both places and "Add", Connect GitHub (browser and back through
`anyappagent://github`), "Your plan" with the plans, extra credit and the Own key plan and its key
(buying waits for milestone 6: its buttons say "Coming soon"). In the existing screens: the
estimate under a cloud chat's message box, the estimate on a plan card, a cloud app's credits in
its sheet, "Make it on: My PC | Cloud" when both places exist, place marks on tiles, "PC, off" and
a PC-off line in a PC app's chat (its "Do it in the cloud" button is milestone 9), and a line while
a cloud app's machine wakes. **Pages in the cloud** (not in the plan, needed for plan first): the
runner uploads each page with its kit, Convex serves it under a signed ticket
(`/page/<id>/<ticket>`, `cloud/convex/pages.ts`) and keeps drafts, and answers go to the box
through the inbox. A cloud build's file URLs ride on its `BuildInfo` (`fileUrls`, `otaUrl`), so the
phone's installer is unchanged but for where it downloads. Proven on emulator-5560 with
`com.anyappagent.cloudbuild` (`C:/aa/e2e/cloud-build/m4/`): first run, sign-in (the dev account),
GitHub connected through the browser (the App was already authorized, so GitHub went straight
back), "Water Sips" made from the phone, its plan page opened and answered on the phone, the first
version installed from Convex, "make the big button green" from the phone arriving as a quick
update with the app's Reload, and the grid with a paired PC and the cloud. Calls the cloud does not
have yet (versions and undo, crash reports, sharing) answer "not in the cloud yet".

Where the 10.5 days of local and cloud come from (decisions of 12 Nov 2026, fourth round): the
account without GitHub or a plan, `pcLinks` and `apps.place` (+0.5), the phone's first run, account
sheet and one grid (+1.5), the PC link (+1, which circles and web apps then reuse), moving apps
(+4), changes while the PC is off (+3), and their proof (+0.5).

Where the 8.5 extra days of the plan's second draft come from: GitHub instead of Git bundles (+2.5 net), credits, plans and
Stripe live instead of switched off (+2), estimates (+2), the orchestrator's levels and per-model
pricing (+1.5), the provider interface (+0.5).

## 11. Accounts and keys: one task for the user

Do these in order. Put every value into a **1Password item named `Kiwimake Cloud (dev)`**, one
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
   - Name `Kiwimake Cloud Dev`, homepage `https://github.com/<your login>`.
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
- **Q12, pricing** (third round, 12 Nov 2026, replaces "tokens at cost plus 10%"; the pricing page
  `C:\aa\ideas\cloud-pricing.html`, Q390 to Q395): **monthly plans with credits** (page Q391,
  model A). A credit bundles the whole service; the person never sees tokens, a token price, machine
  time or our costs. Credits are metered from our real cost at a hidden basis of $0.20 a credit
  (section 2).
- **Q3, credit**: credits, not dollars. **Starter $12 for 30 credits, Pro $25 for 70, Max $60 for
  180; extra credit $10 for 20** (page Q392), valid 12 months; plan credits roll over one month.
  Every change shows an estimate in credits first, and each app shows its own.
- **Q14, free tier** (page Q393): **3 free credits every month**, given when the account is first
  used that month, no rollover, one per GitHub account.
- **Q15, own key** (page Q394): the **Own key plan, $6 a month**, unlimited changes on their own
  Anthropic key, fair use 30 box hours a month, then half a credit per box hour.
- **Q16, terms**: credits buy app changes, never Claude: no token price, allowance or API access is
  shown or sold, and credits pay only for building the person's apps (section 1).
- **Q4, package names**: cloud apps get their own prefix, `com.anyappcloud.<slug>`.
- **Q5, Instabox**: yes, behind a small provider interface.
- **Q6, signing**: on the box as a separate Unix user first, then a separate signer machine.
- **Q7, payments** (replaced by Q3): plans as Stripe subscriptions and extra credit by Stripe
  Checkout, card fees inside the prices, in the first version.
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

- **Q13** (the platform fee's size) is closed: there is no separate platform fee; the margin is in
  the credit price (Q12).

- **Q17, first app**: a person's **first new app uses at most 3 credits**, on every plan, so the free
  tier can make one (about $0.26 given away once per person).
- **Q18, extra credit**: **$10 for 20 credits, with or without a plan**, valid 12 months.
- **Q20 to Q24, local and cloud** (fourth round, 12 Nov 2026, `C:\aa\ideas\local-and-cloud.html`,
  Q431 to Q435): **one Kiwimake account**, optional on the PC and asked for only when a feature needs
  it (Q431); **signed in once, on the phone or the PC**, the other joins through pairing, no sign-in
  step in the desktop's onboarding (Q432); **one grid** with PC and cloud apps, replacing "one mode
  per install" (Q433); **moving apps between PC and cloud, both ways, in the first version** (Q434,
  the user's change: the page recommended right after it); **"My PC is off, do this change in the
  cloud" in the first version** (Q435, the user's change: the page recommended later). Package names
  are the app's for life. The first version becomes 41 days (section 10).
- **Q19, yearly plans**: from the first version, **10 times the monthly price** (Starter $120, Pro
  $250, Max $600, Own key $60), paid up front; **credits given monthly**, not all at once, so
  rollover and expiry stay one rule and our cost follows the money (section 2).
