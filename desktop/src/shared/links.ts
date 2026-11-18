// Which addresses the desktop app hands to the default browser (the main process checks again).

/** https anywhere, or http on this PC only (localhost, 127.0.0.1). Never file:, javascript: and the like. */
export function isOpenableUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.username || u.password) return false;
  if (u.protocol === "https:") return u.hostname !== "";
  if (u.protocol === "http:") return u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
  return false;
}
