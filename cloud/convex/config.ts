// Kiwimake Cloud's prices, allowances and timings in one place (docs/CLOUD.md, sections 2 and 5),
// so a price change is one edit. Money is in micros (millionths of a dollar), credits in
// millicredits (thousandths of a credit): integers only, never floats.

/** What one credit costs us, never shown to anyone (section 2, "Credits per change"). */
export const CREDIT_COST_MICROS = 200_000;

export type PlanId = 'free' | 'starter' | 'pro' | 'max' | 'ownKey';
export type Interval = 'month' | 'year';

export interface Plan {
  id: PlanId;
  name: string;
  /** Price in US cents per interval. */
  cents: { month: number; year: number };
  /** Credits given every month (yearly plans too: monthly, not all at once). */
  monthlyMillicredits: number;
}

export const PLANS: Record<PlanId, Plan> = {
  free: { id: 'free', name: 'Free', cents: { month: 0, year: 0 }, monthlyMillicredits: 0 },
  starter: { id: 'starter', name: 'Starter', cents: { month: 1200, year: 12000 }, monthlyMillicredits: 30_000 },
  pro: { id: 'pro', name: 'Pro', cents: { month: 2500, year: 25000 }, monthlyMillicredits: 70_000 },
  max: { id: 'max', name: 'Max', cents: { month: 6000, year: 60000 }, monthlyMillicredits: 180_000 },
  ownKey: { id: 'ownKey', name: 'Own key', cents: { month: 600, year: 6000 }, monthlyMillicredits: 0 },
};

/** Extra credit: $10 for 20 credits, valid 12 months, with or without a plan. */
export const EXTRA_PACK = { cents: 1000, millicredits: 20_000, validDays: 365 };
/** Free credit every month, given on the first cloud change of the month. */
export const FREE_MONTHLY_MILLICREDITS = 3_000;
/** A person's first new app uses at most this much. */
export const FIRST_APP_CAP_MILLICREDITS = 3_000;
/** A running change may go this far past the balance before the runner stops it. */
export const OVERDRAFT_MILLICREDITS = 500;
/** Own key plan: fair use box hours a month, then half a credit per box hour. */
export const OWN_KEY_FAIR_USE_SECONDS = 30 * 3600;
export const OWN_KEY_EXTRA_MILLICREDITS_PER_HOUR = 500;

/** List prices per million tokens, micros: in, out, cache write, cache read (section 7). */
export const MODEL_PRICES: Record<string, [number, number, number, number]> = {
  'claude-opus-5-5': [4_000_000, 20_000_000, 5_000_000, 200_000],
  'claude-sonnet-5-5': [2_000_000, 10_000_000, 2_500_000, 100_000],
};
/** Instabox 4 vCPU / 8 GiB: 4 x $0.004 + 8 x $0.00225 an hour, in micros per running second. */
export const BOX_MICROS_PER_HOUR = 34_000;

/** Box lifecycle (section 3, "One box per thread"). */
export const BOX = {
  /** Pause this long after the last work. */
  pauseAfterMs: 5 * 60_000,
  /** Snapshot and delete after this long paused. */
  snapshotAfterMs: 60 * 60_000,
  /** A snapshot unused this long is deleted; the next message clones from GitHub. */
  snapshotTtlMs: 30 * 24 * 3600_000,
  /** The image every box starts from (the spike's snapshot). */
  imageSnapshot: 'anyapp-box-v1',
  /** A person may have this many boxes not deleted. */
  maxPerUser: 5,
};

/** Package prefixes: a cloud-born app and a PC-born app (both accepted; the name is the app's for life). */
export const CLOUD_PACKAGE_PREFIX = 'com.anyappcloud.';
export const PC_PACKAGE_PREFIX = 'com.anyapp.';

/** Turns our cost into millicredits (rounded up to whole millicredits). */
export function microsToMillicredits(micros: number): number {
  return Math.ceil((micros * 1000) / CREDIT_COST_MICROS);
}

/** Rounds a change's total up to a tenth of a credit (section 5). */
export function roundUpToTenth(millicredits: number): number {
  return Math.ceil(millicredits / 100) * 100;
}
