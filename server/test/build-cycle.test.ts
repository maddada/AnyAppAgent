import { describe, expect, it } from "vitest";
import { runBuildCycle, type BuildAttempt } from "../src/build-cycle.ts";

function scripted(results: BuildAttempt<string>[], options: { cancelOnFix?: number } = {}) {
  const calls: string[] = [];
  let cancelled = false;
  let i = 0;
  return {
    calls,
    deps: {
      maxFixes: 3,
      build: async () => {
        calls.push("build");
        return results[Math.min(i++, results.length - 1)];
      },
      fix: async (error: string, attempt: number) => {
        calls.push(`fix ${attempt}: ${error}`);
        if (options.cancelOnFix === attempt) {
          cancelled = true;
          return false;
        }
        return true;
      },
      cancelled: () => cancelled,
    },
  };
}

const fail = (error: string): BuildAttempt<string> => ({ ok: false, error });
const ok: BuildAttempt<string> = { ok: true, result: "apk" };

describe("runBuildCycle", () => {
  it("succeeds on the first build without asking the agent", async () => {
    const s = scripted([ok]);
    expect(await runBuildCycle(s.deps)).toEqual({ outcome: "succeeded", result: "apk", builds: 1, fixes: 0 });
    expect(s.calls).toEqual(["build"]);
  });

  it("sends each failure back to the agent and builds again", async () => {
    const s = scripted([fail("e1"), fail("e2"), ok]);
    expect(await runBuildCycle(s.deps)).toEqual({ outcome: "succeeded", result: "apk", builds: 3, fixes: 2 });
    expect(s.calls).toEqual(["build", "fix 1: e1", "build", "fix 2: e2", "build"]);
  });

  it("gives up after 3 fixes: 4 builds, the last error is reported", async () => {
    const s = scripted([fail("e1"), fail("e2"), fail("e3"), fail("e4"), ok]);
    expect(await runBuildCycle(s.deps)).toEqual({ outcome: "failed", error: "e4", builds: 4, fixes: 3 });
    expect(s.calls.filter((c) => c.startsWith("fix"))).toHaveLength(3);
  });

  it("stops when the user cancels a fix turn", async () => {
    const s = scripted([fail("e1"), fail("e2"), ok], { cancelOnFix: 2 });
    expect(await runBuildCycle(s.deps)).toEqual({ outcome: "cancelled", error: "e2", builds: 2, fixes: 2 });
    expect(s.calls).toEqual(["build", "fix 1: e1", "build", "fix 2: e2"]);
  });

  it("honours maxFixes = 0", async () => {
    const s = scripted([fail("only")]);
    expect(await runBuildCycle({ ...s.deps, maxFixes: 0 })).toEqual({ outcome: "failed", error: "only", builds: 1, fixes: 0 });
  });
});
