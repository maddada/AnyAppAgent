// Timers: the box lifecycle tick and the provider check (docs/CLOUD.md section 3). Milestone 6
// adds the credit grants and expiry.
import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();
crons.interval('box lifecycle', { minutes: 1 }, internal.boxes.tick, {});
crons.interval('box reconcile', { minutes: 10 }, internal.boxes.reconcile, {});
export default crons;
