// Build after a turn; on failure hand the error to the agent and build again, at most
// `maxFixes` times. Pure control flow so it can be tested without an agent or a builder.
export type BuildAttempt<R> = { ok: true; result: R } | { ok: false; error: string };

export type BuildCycleOutcome<R> =
  | { outcome: "succeeded"; result: R; builds: number; fixes: number }
  | { outcome: "failed"; error: string; builds: number; fixes: number }
  | { outcome: "cancelled"; error: string; builds: number; fixes: number };

export interface BuildCycleDeps<R> {
  maxFixes: number;
  build(): Promise<BuildAttempt<R>>;
  /** Sends the failure to the agent. Resolves false when the user cancelled the fix turn. */
  fix(error: string, attempt: number): Promise<boolean>;
  cancelled(): boolean;
}

export async function runBuildCycle<R>(deps: BuildCycleDeps<R>): Promise<BuildCycleOutcome<R>> {
  let builds = 0;
  let fixes = 0;
  for (;;) {
    const attempt = await deps.build();
    builds += 1;
    if (attempt.ok) return { outcome: "succeeded", result: attempt.result, builds, fixes };
    if (deps.cancelled()) return { outcome: "cancelled", error: attempt.error, builds, fixes };
    if (fixes >= deps.maxFixes) return { outcome: "failed", error: attempt.error, builds, fixes };
    fixes += 1;
    const keepGoing = await deps.fix(attempt.error, fixes);
    if (!keepGoing || deps.cancelled()) return { outcome: "cancelled", error: attempt.error, builds, fixes };
  }
}
