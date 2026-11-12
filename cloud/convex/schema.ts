// Kiwimake Cloud's data model (docs/CLOUD.md, sections 4 and 5). Field names follow
// shared/protocol.ts where a type exists; chat rows keep the runner's ChatItem as it is, so the
// phone renders cloud chats with shared/chat unchanged. Money in micros, credits in millicredits.
import { authTables } from '@convex-dev/auth/server';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

const sealed = v.object({ iv: v.string(), ciphertext: v.string() });

export const boxState = v.union(
  v.literal('none'),
  v.literal('starting'),
  v.literal('running'),
  v.literal('paused'),
  v.literal('snapshotted'),
  v.literal('deleted'),
);

export const planId = v.union(v.literal('free'), v.literal('starter'), v.literal('pro'), v.literal('max'), v.literal('ownKey'));

export default defineSchema({
  ...authTables,

  // The Kiwimake account, for the PC and the cloud (section 3, "One account, two places"). It
  // exists without GitHub, a plan or a PC: the cloud fields are set when the person adds the cloud.
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    // Set on the first cloud change.
    cloudSince: v.optional(v.number()),
    // "Use the cloud when my PC is off".
    pcOffSwitch: v.optional(v.boolean()),
    // "ownAnthropic" only on the Own key plan.
    aiMode: v.optional(v.union(v.literal('credit'), v.literal('ownAnthropic'))),
    githubLogin: v.optional(v.string()),
    githubUserId: v.optional(v.number()),
    githubInstallationId: v.optional(v.string()),
    // Set when GitHub refused the token (revoked or uninstalled): cloud changes wait.
    githubDisconnectedAt: v.optional(v.number()),
    stripeCustomerId: v.optional(v.string()),
    blocked: v.optional(v.boolean()),
  })
    .index('email', ['email'])
    .index('phone', ['phone'])
    .index('by_github_installation', ['githubInstallationId'])
    .index('by_github_user', ['githubUserId']),

  apps: defineTable({
    userId: v.id('users'),
    name: v.string(),
    slug: v.string(),
    // com.anyappcloud.<slug> for a cloud-born app, com.anyapp.<slug> for one born on a PC.
    packageName: v.string(),
    place: v.union(v.literal('cloud'), v.literal('pc')),
    pcLinkId: v.optional(v.id('pcLinks')),
    pcAppId: v.optional(v.string()),
    // The highest build number either place made (the next build is above it).
    buildHigh: v.number(),
    // owner/anyapp-cloud-<slug>
    repo: v.optional(v.string()),
    pushedCommit: v.optional(v.string()),
    preset: v.optional(v.union(v.literal('react-native'), v.literal('kotlin'), v.literal('expo-exact'))),
    iconFileId: v.optional(v.id('_storage')),
    iconVersion: v.number(),
    // The runner's view of the app (protocol App fields: status, latestBuild, usage, ...).
    status: v.union(v.literal('creating'), v.literal('idle'), v.literal('working'), v.literal('building'), v.literal('error')),
    error: v.optional(v.string()),
    latestBuild: v.optional(v.any()),
    latestApk: v.optional(v.any()),
    health: v.optional(v.any()),
    overview: v.optional(v.string()),
    lastMessagePreview: v.optional(v.string()),
    replying: v.optional(v.boolean()),
    activeHelpers: v.optional(v.number()),
    waitingForAnswer: v.optional(v.boolean()),
    usage: v.optional(v.any()),
    // The prompt the app was made from (its first change).
    prompt: v.optional(v.string()),
    updatedAt: v.number(),
    deletedAt: v.optional(v.number()),
  })
    .index('by_user', ['userId'])
    .index('by_user_slug', ['userId', 'slug'])
    .index('by_package', ['packageName']),

  // One app's chat with its agent, and the box it runs on.
  threads: defineTable({
    appId: v.id('apps'),
    userId: v.id('users'),
    boxId: v.optional(v.id('boxes')),
    boxState,
    // SHA-256 of the box's runner token (good for this thread only, revoked with the box).
    runnerTokenHash: v.optional(v.string()),
    // The runner's last long poll (it is alive) and whether it says it is working.
    runnerSeenAt: v.optional(v.number()),
    busy: v.optional(v.boolean()),
    // Last work (a message in, an event out): the pause and snapshot timers count from here.
    lastActiveAt: v.number(),
    agentSessionId: v.optional(v.string()),
    // The latest snapshot of the thread's box (after it was deleted to save money).
    snapshotId: v.optional(v.string()),
    snapshotAt: v.optional(v.number()),
    // What the chat says while the box wakes ("Waking up your app's machine").
    boxNote: v.optional(v.string()),
    // The next seq for chat rows Convex writes itself (the runner numbers its own).
    seq: v.number(),
  })
    .index('by_app', ['appId'])
    .index('by_state_and_active', ['boxState', 'lastActiveAt'])
    .index('by_runner_token', ['runnerTokenHash']),

  // A ChatItem (shared/protocol.ts), upserted by its id. workerId set: a helper's own chat.
  messages: defineTable({
    threadId: v.id('threads'),
    itemId: v.string(),
    workerId: v.optional(v.string()),
    seq: v.number(),
    item: v.any(),
    updatedAt: v.number(),
  })
    .index('by_thread_seq', ['threadId', 'workerId', 'seq'])
    .index('by_thread_item', ['threadId', 'itemId']),

  // Helpers (WorkerInfo), upserted by id.
  workers: defineTable({
    threadId: v.id('threads'),
    workerId: v.string(),
    info: v.any(),
  }).index('by_thread_worker', ['threadId', 'workerId']),

  // Work for the thread's box: the runner long-polls it.
  inbox: defineTable({
    threadId: v.id('threads'),
    kind: v.union(
      v.literal('prompt'),
      v.literal('permission'),
      v.literal('cancel'),
      v.literal('page-answers'),
      v.literal('stop-helper'),
      v.literal('rebuild'),
      v.literal('restore'),
      v.literal('undo'),
      v.literal('fix-crash'),
    ),
    payload: v.any(),
    changeId: v.optional(v.id('changes')),
    // Offered to the runner until then; it acknowledges (takenAt) as soon as it has it, so a
    // reply lost on the way (a box pausing mid-poll) is offered again after the lease.
    leasedUntil: v.optional(v.number()),
    takenAt: v.optional(v.number()),
  }).index('by_thread_untaken', ['threadId', 'takenAt']),

  // One message's work: its estimate, what it really cost, who paid for the AI.
  changes: defineTable({
    appId: v.id('apps'),
    threadId: v.id('threads'),
    userId: v.id('users'),
    messageItemId: v.string(),
    estimate: v.optional(
      v.object({ costMicros: v.number(), millicredits: v.number(), low: v.number(), high: v.number(), levels: v.array(v.string()) }),
    ),
    actual: v.object({ machineMicros: v.number(), aiMicros: v.number(), millicredits: v.number() }),
    aiPaidBy: v.union(v.literal('ownKey'), v.literal('credit')),
    firstApp: v.optional(v.boolean()),
    state: v.union(v.literal('queued'), v.literal('running'), v.literal('done'), v.literal('failed'), v.literal('stopped')),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
  })
    .index('by_app_at', ['appId', 'startedAt'])
    .index('by_message', ['threadId', 'messageItemId'])
    .index('by_thread_state', ['threadId', 'state']),

  builds: defineTable({
    appId: v.id('apps'),
    number: v.number(),
    delivery: v.union(v.literal('apk'), v.literal('quick')),
    files: v.array(v.object({ abi: v.string(), fileId: v.id('_storage'), sizeBytes: v.number(), sha256: v.string() })),
    otaFileId: v.optional(v.id('_storage')),
    runtime: v.optional(v.string()),
    // The runner's BuildInfo, as the phone renders it.
    info: v.any(),
    commit: v.optional(v.string()),
    pushed: v.boolean(),
    seconds: v.optional(v.number()),
  }).index('by_app_number', ['appId', 'number']),

  usage: defineTable({
    userId: v.id('users'),
    appId: v.id('apps'),
    threadId: v.id('threads'),
    changeId: v.optional(v.id('changes')),
    kind: v.union(v.literal('inference'), v.literal('machine')),
    workerId: v.optional(v.string()),
    level: v.optional(v.string()),
    model: v.optional(v.string()),
    effort: v.optional(v.string()),
    tokens: v.optional(v.object({ inputTokens: v.number(), outputTokens: v.number(), cacheWriteTokens: v.number(), cacheReadTokens: v.number() })),
    seconds: v.optional(v.number()),
    size: v.optional(v.string()),
    costMicros: v.number(),
    millicredits: v.number(),
    settled: v.boolean(),
    at: v.number(),
  })
    .index('by_user_at', ['userId', 'at'])
    .index('by_change', ['changeId'])
    .index('by_app_level', ['appId', 'level']),

  subscriptions: defineTable({
    userId: v.id('users'),
    plan: planId,
    interval: v.union(v.literal('month'), v.literal('year')),
    stripeSubscriptionId: v.optional(v.string()),
    status: v.union(v.literal('active'), v.literal('pastDue'), v.literal('cancelled')),
    periodStart: v.number(),
    periodEnd: v.number(),
    nextGrantAt: v.optional(v.number()),
    cancelAtPeriodEnd: v.boolean(),
    boxSecondsThisMonth: v.number(),
    firstAppDone: v.boolean(),
  })
    .index('by_user', ['userId'])
    .index('by_stripe_id', ['stripeSubscriptionId'])
    .index('by_next_grant', ['nextGrantAt']),

  grants: defineTable({
    userId: v.id('users'),
    source: v.union(v.literal('free'), v.literal('plan'), v.literal('extra'), v.literal('refund'), v.literal('adjust')),
    millicredits: v.number(),
    remaining: v.number(),
    grantedAt: v.number(),
    expiresAt: v.number(),
    stripePaymentId: v.optional(v.string()),
    // "2026-11" for free and plan grants (one per month).
    period: v.optional(v.string()),
  })
    .index('by_user_expires', ['userId', 'expiresAt'])
    .index('by_expires', ['expiresAt'])
    .index('by_user_source_period', ['userId', 'source', 'period'])
    .index('by_stripe_payment', ['stripePaymentId']),

  ledger: defineTable({
    userId: v.id('users'),
    kind: v.union(v.literal('grant'), v.literal('spend'), v.literal('expire'), v.literal('refund'), v.literal('adjust')),
    millicredits: v.number(),
    grantId: v.optional(v.id('grants')),
    changeId: v.optional(v.id('changes')),
    usageIds: v.optional(v.array(v.id('usage'))),
    note: v.optional(v.string()),
    at: v.number(),
  })
    .index('by_user_at', ['userId', 'at'])
    .index('by_change', ['changeId']),

  balances: defineTable({
    userId: v.id('users'),
    millicredits: v.number(),
  }).index('by_user', ['userId']),

  // Signing keys, sealed (section 6). Never deleted.
  keys: defineTable({
    appId: v.id('apps'),
    userId: v.id('users'),
    packageName: v.string(),
    certSha256: v.string(),
    wrappedDataKey: v.string(),
    ciphertext: v.string(),
    iv: v.string(),
    kekVersion: v.number(),
    lineage: v.optional(v.string()),
    at: v.number(),
  }).index('by_app', ['appId']),

  signings: defineTable({
    appId: v.id('apps'),
    build: v.number(),
    sha256: v.string(),
    what: v.optional(v.string()),
    at: v.number(),
  }).index('by_app', ['appId']),

  // One-time signing tickets (milestone 2): a box asks, Convex opens the key once for one build.
  signingTickets: defineTable({
    threadId: v.id('threads'),
    appId: v.id('apps'),
    build: v.number(),
    usedAt: v.optional(v.number()),
    expiresAt: v.number(),
  }).index('by_thread', ['threadId']),

  // The person's own Anthropic key and their GitHub tokens, sealed.
  secrets: defineTable({
    userId: v.id('users'),
    kind: v.union(v.literal('anthropic'), v.literal('githubAccess'), v.literal('githubRefresh')),
    wrappedDataKey: v.optional(v.string()),
    ciphertext: v.string(),
    iv: v.string(),
    last4: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
  }).index('by_user_kind', ['userId', 'kind']),

  // One PC acting for its owner (section 3, "The PC link").
  pcLinks: defineTable({
    userId: v.id('users'),
    tokenHash: v.string(),
    deviceName: v.string(),
    scopes: v.array(v.union(v.literal('share'), v.literal('web'), v.literal('move'))),
    linkedFrom: v.union(v.literal('phone'), v.literal('pc')),
    createdAt: v.number(),
    lastSeenAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index('by_hash', ['tokenHash'])
    .index('by_user', ['userId']),

  moves: defineTable({
    appId: v.id('apps'),
    userId: v.id('users'),
    pcLinkId: v.id('pcLinks'),
    kind: v.union(v.literal('toCloud'), v.literal('toPc'), v.literal('pcOff'), v.literal('pullBack')),
    steps: v.object({
      code: v.optional(v.number()),
      key: v.optional(v.number()),
      chat: v.optional(v.number()),
      buildNumber: v.optional(v.number()),
    }),
    state: v.union(v.literal('running'), v.literal('done'), v.literal('failed'), v.literal('undone')),
    error: v.optional(v.string()),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
  })
    .index('by_app', ['appId'])
    .index('by_user_state', ['userId', 'state']),

  boxes: defineTable({
    threadId: v.id('threads'),
    userId: v.id('users'),
    provider: v.literal('instabox'),
    providerId: v.optional(v.string()),
    name: v.string(),
    size: v.string(),
    startedAt: v.number(),
    pausedAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
    snapshotId: v.optional(v.string()),
    secondsBilled: v.number(),
    error: v.optional(v.string()),
  })
    .index('by_thread', ['threadId'])
    .index('by_provider_id', ['providerId'])
    .index('by_user', ['userId']),

  // The person's own to-do list per app (the agent never sees it).
  todos: defineTable({
    appId: v.id('apps'),
    text: v.string(),
    done: v.boolean(),
    at: v.number(),
  }).index('by_app', ['appId']),

  // Pages the agent published: their HTML in file storage.
  pages: defineTable({
    threadId: v.id('threads'),
    pageId: v.string(),
    info: v.any(),
    htmlFileId: v.optional(v.id('_storage')),
  }).index('by_thread_page', ['threadId', 'pageId']),

  // The spike's GitHub user token by login (github.ts); milestone 3 moves it to `secrets`.
  githubTokens: defineTable({
    login: v.string(),
    access: sealed,
    refresh: v.optional(sealed),
    expiresAt: v.optional(v.number()),
    installationId: v.optional(v.string()),
  }).index('by_login', ['login']),

  // A "Connect GitHub" in progress: the state GitHub sends back to /github/callback.
  githubStates: defineTable({ state: v.string(), userId: v.id('users'), createdAt: v.number() }).index('by_state', ['state']),

  // Small settings: the runner bundle boxes download ({fileId, version}).
  meta: defineTable({ key: v.string(), value: v.any() }).index('by_key', ['key']),

  // Provider webhooks already handled (deduplicated on their id).
  webhookEvents: defineTable({
    source: v.string(),
    eventId: v.string(),
    at: v.number(),
  }).index('by_source_event', ['source', 'eventId']),
});
