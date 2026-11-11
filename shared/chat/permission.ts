// A permission card: which buttons, in which order, and the quiet line once it is answered.
import type { PermissionInfo } from "../protocol.ts";

type Option = PermissionInfo["options"][number];

export type PermissionView =
  | { answered: true; line: string; allowed: boolean }
  | { answered: false; heading: string; title: string; reject?: Option; allow?: Option; others: Option[] };

export function permissionView(p: PermissionInfo): PermissionView {
  const title = p.title.replace(/`/g, "");
  if (p.selectedOptionId !== undefined) {
    const chosen = p.options.find((o) => o.optionId === p.selectedOptionId);
    if (!chosen) return { answered: true, allowed: false, line: `Not answered, the agent stopped: ${title}` };
    const allowed = chosen.kind.startsWith("allow");
    return { answered: true, allowed, line: `${allowed ? "Allowed" : "Not allowed"}: ${title}` };
  }
  const reject = p.options.find((o) => o.kind.startsWith("reject"));
  const allow = p.options.find((o) => o.kind === "allow_once") ?? p.options.find((o) => o.kind.startsWith("allow") && o.kind !== "allow_always");
  const always = p.options.find((o) => o.kind === "allow_always");
  const others = [always, ...p.options.filter((o) => o !== reject && o !== allow && o !== always)].filter((o): o is Option => !!o);
  return { answered: false, heading: "Allow this step?", title, reject, allow, others };
}
