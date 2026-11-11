// When the desktop renews the Easy Connect code by itself (Pairing.tsx useFreshCode).

/**
 * Someone counts as at the PC while the window is in front and was used within this long. Past it
 * the panel stops renewing the Easy Connect code (renewing it forever kept the pairing window
 * open for good, and each renewal used to restart the helper, cutting every phone's tunnel) and
 * shows the same-network code until someone moves the mouse or presses a key again.
 */
export const RENEW_WHILE_IDLE_MS = 10 * 60_000;

/** True while a person is plausibly looking at the code. */
export function someoneIsHere(now: number, lastActivity: number, visible: boolean, focused: boolean): boolean {
  return visible && focused && now - lastActivity < RENEW_WHILE_IDLE_MS;
}
