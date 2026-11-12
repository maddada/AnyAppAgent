// Webhook deliveries are deduplicated on their id.
import { v } from 'convex/values';
import { internalMutation } from './_generated/server';

export const once = internalMutation({
  args: { source: v.string(), eventId: v.string() },
  handler: async (ctx, { source, eventId }) => {
    const seen = await ctx.db
      .query('webhookEvents')
      .withIndex('by_source_event', (q) => q.eq('source', source).eq('eventId', eventId))
      .first();
    if (seen) return false;
    await ctx.db.insert('webhookEvents', { source, eventId, at: Date.now() });
    return true;
  },
});
