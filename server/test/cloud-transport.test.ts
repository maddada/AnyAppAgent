// The runner's key transport (src/cloud-transport.ts) and Convex's (cloud/convex/lib/transport.ts)
// must agree: a key sealed by one opens with the other, both ways (docs/CLOUD.md section 6).
import { describe, expect, test } from "vitest";
import { oneTimeKey, openWith, sealTo } from "../src/cloud-transport.ts";
import * as convexSide from "../../cloud/convex/lib/transport.ts";

const enc = new TextEncoder();
const dec = new TextDecoder();

describe("the key transport, runner and Convex", () => {
  test("runner to Convex: a new app's key", async () => {
    const convex = await convexSide.newTransportKey();
    const box = await sealTo(convex.publicRaw, enc.encode("p12"), "appkey-upload:t");
    expect(dec.decode(await convexSide.openWith(convex.key, box, "appkey-upload:t"))).toBe("p12");
  });

  test("Convex to runner: a signing ticket, for that build only", async () => {
    const once = await oneTimeKey();
    const box = await convexSide.sealTo(once.publicRaw, enc.encode("ticket"), "ticket:t:3");
    expect(dec.decode(await openWith(once.key, box, "ticket:t:3"))).toBe("ticket");
    await expect(openWith(once.key, box, "ticket:t:4")).rejects.toThrow();
  });
});
