export const DEFAULT_PORT = 8787;
export const EMULATOR_ADDRESS = `10.0.2.2:${DEFAULT_PORT}`;

/** "192.168.1.5", "192.168.1.5:8787", "http://pc.local:8787/" -> "http://192.168.1.5:8787" */
export function toBaseUrl(input: string): string | null {
  let text = input.trim();
  if (!text) return null;
  if (!/^https?:\/\//i.test(text)) text = `http://${text}`;
  try {
    const url = new URL(text);
    if (!url.hostname) return null;
    const port = url.port || (url.protocol === "https:" ? "" : String(DEFAULT_PORT));
    return `${url.protocol}//${url.hostname}${port ? `:${port}` : ""}`;
  } catch {
    return null;
  }
}

/** The host:port part, for showing to people. */
export function displayAddress(baseUrl: string): string {
  return baseUrl.replace(/^https?:\/\//i, "");
}

export function cleanCode(input: string): string {
  return input.replace(/\D/g, "").slice(0, 6);
}

/**
 * What the PC's QR code holds (shared/protocol.ts):
 *   anyappagent://pair?url=<encodeURIComponent("http://<pc-address>:8787")>&code=<6 digits>
 * Also accepted, to be forgiving: ?address=host:port, JSON {"url"|"address", "code"},
 * and http://host:port/...?code=123456.
 */
export function parsePairingQr(raw: string): { address: string; code: string } | null {
  const text = raw.trim();
  if (text.startsWith("{")) {
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      const address = String(data.url ?? data.address ?? data.host ?? "");
      const code = cleanCode(String(data.code ?? ""));
      if (address && code.length === 6) return { address: displayAddress(address), code };
    } catch {
      return null;
    }
    return null;
  }
  const query = text.includes("?") ? text.slice(text.indexOf("?") + 1) : "";
  const params = new Map<string, string>();
  for (const part of query.split("&")) {
    const [k, v = ""] = part.split("=");
    if (k) params.set(decodeURIComponent(k), decodeURIComponent(v.replace(/\+/g, " ")));
  }
  const code = cleanCode(params.get("code") ?? "");
  if (code.length !== 6) return null;
  let address = params.get("url") ?? params.get("address") ?? params.get("host") ?? "";
  if (!address && /^https?:\/\//i.test(text)) {
    const base = toBaseUrl(text.split("?")[0]);
    if (base) address = displayAddress(base);
  }
  return address ? { address: displayAddress(address), code } : null;
}
