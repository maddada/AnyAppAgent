// The hard limits: what no automation can do while the safety locks are on (the default).
// Settings, Advanced, "Safety locks" turns them off, with a warning. Run log and Stop all always stay.

export const LIMITS = {
  /** Runs of one automation in an hour. */
  runsPerHour: 12,
  /** Runs of all automations together in an hour. */
  allRunsPerHour: 60,
  /** Power calls in one run. */
  actionsPerRun: 20,
  /** How long one run may take, in ms. */
  runMs: 60_000,
  /** `every` cannot be more often than this. */
  minEveryMinutes: 15,
  /** Do Not Disturb always turns itself off within this, in minutes. */
  maxDndMinutes: 12 * 60,
  /** Spoken text, characters. */
  maxSpeak: 300,
  /** sleep(), seconds. */
  maxSleepSeconds: 60,
  /** Things sent (web.get / web.post) in an hour, each asked first. */
  sendsPerHour: 10,
  /** How long the ask-before-sending question waits for an answer, in ms. */
  askMs: 120_000,
  /** memory, bytes of JSON per automation. */
  memoryBytes: 10_000,
} as const;

/** With the safety locks off: only a guard against a run that never ends. */
export const UNLOCKED_RUN_MS = 10 * 60_000;

/** What the card says under "Hard limits", in plain words. */
export const LIMIT_LINES = [
  `Runs at most ${LIMITS.runsPerHour} times an hour, and stops after ${LIMITS.runMs / 1000} seconds`,
  `Do Not Disturb always turns itself off within ${LIMITS.maxDndMinutes / 60} hours`,
  'Asks you before anything is sent from this phone',
  'Never installs apps, changes security settings or reads passwords: there is no way to ask for that',
];

/** Hosts a script may never send to while the locks are on: this phone and its home network. */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.localhost') || h === '::1') return true;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (!m) return h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80');
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}
