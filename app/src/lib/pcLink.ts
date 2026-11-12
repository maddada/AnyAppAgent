// The PC link from the phone (docs/CLOUD.md section 3, "Signed in once, on either side"): a
// signed-in phone makes a link for its paired PC and hands it over through pairing; a phone that
// is not signed in can take the sign-in of a PC that signed in itself (a one-time code).
import { api, CLOUD_SITE, convex } from "./cloud";
import type { AccountLinkInfo } from "./protocol";
import { friendlyDeviceName } from "./session";
import { getState, setState } from "./store";

function pcClient() {
  const client = getState().client;
  if (!client || getState().connection !== "online") throw new Error("Your PC is not connected right now.");
  return client;
}

/** Links the paired PC to the signed-in account. The token goes from Convex to the PC, never stored here. */
export async function linkPairedPc(): Promise<AccountLinkInfo> {
  const client = pcClient();
  if (!convex) throw new Error("This build has no cloud.");
  const phoneName = friendlyDeviceName();
  const { token } = (await convex.mutation(api.accounts.createPcLink, { deviceName: getState().serverName ?? "My PC", linkedFrom: "phone", fromName: phoneName })) as { token: string };
  const info = await client.linkPc({ token, site: CLOUD_SITE, phoneName });
  setState({ pcAccount: info, accountAsked: null });
  return info;
}

/** Unlinks the paired PC (revoked in Convex by the PC itself, then forgotten there). */
export async function unlinkPairedPc(): Promise<void> {
  const info = await pcClient().unlinkPc();
  setState({ pcAccount: info });
}

/** A one-time code from the PC, for the "pc-handoff" sign-in. */
export async function handoffCode(): Promise<string> {
  const { code, site } = await pcClient().pcHandoff();
  if (site.replace(/\/+$/, "") !== CLOUD_SITE.replace(/\/+$/, "")) throw new Error("Your PC uses another Kiwimake cloud than this phone.");
  return code;
}

/** The PC's link is to the account signed in here (Convex lists this PC among its links). */
export function pcLinkedHere(pcs: { name: string }[] | undefined): boolean {
  const { pcAccount, serverName } = getState();
  return pcAccount?.state === "linked" && !!serverName && !!pcs?.some((p) => p.name === serverName);
}
