// Kiwimake Cloud, the spike's slice of the data model (docs/CLOUD.md, section 4). Milestone 1
// replaces it with the full schema.
import { authTables } from '@convex-dev/auth/server';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  ...authTables,
  // One app's chat with its agent.
  threads: defineTable({
    userId: v.id('users'),
    appName: v.string(),
    boxState: v.string(), // "none" | "running" | "paused" | ...
    lastActiveAt: v.number(),
  }).index('by_user', ['userId']),
  messages: defineTable({
    threadId: v.id('threads'),
    seq: v.number(),
    role: v.union(v.literal('user'), v.literal('agent'), v.literal('build'), v.literal('status')),
    text: v.string(),
    apkFileId: v.optional(v.id('_storage')),
    usage: v.optional(
      v.object({
        inputTokens: v.number(),
        outputTokens: v.number(),
        cacheReadTokens: v.number(),
        cacheWriteTokens: v.number(),
        costMicros: v.number(),
      }),
    ),
  }).index('by_thread_seq', ['threadId', 'seq']),
  // The person's GitHub App user token, encrypted with KEYS_KEK (github.ts). Spike: by login.
  githubTokens: defineTable({
    login: v.string(),
    access: v.object({ iv: v.string(), ciphertext: v.string() }),
    refresh: v.optional(v.object({ iv: v.string(), ciphertext: v.string() })),
    expiresAt: v.optional(v.number()),
    installationId: v.optional(v.string()),
  }).index('by_login', ['login']),
  // Work for the thread's box: the runner long-polls it.
  inbox: defineTable({
    threadId: v.id('threads'),
    kind: v.literal('prompt'),
    text: v.string(),
    takenAt: v.optional(v.number()),
  }).index('by_untaken', ['takenAt']),
});
