import { networkInterfaces } from "node:os";

const VIRTUAL_ADAPTER = /vethernet|wsl|hyper-v|virtualbox|vmware|tailscale|zerotier|docker|loopback|vpn/i;

/** IPv4 addresses, real LAN adapters on private ranges first (they are what a phone on Wi-Fi reaches). */
export function lanAddresses(): string[] {
  const found: { address: string; rank: number }[] = [];
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal || entry.address.startsWith("169.254.")) continue;
      const privateRange = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(entry.address);
      found.push({ address: entry.address, rank: (VIRTUAL_ADAPTER.test(name) ? 2 : 0) + (privateRange ? 0 : 1) });
    }
  }
  return found.sort((a, b) => a.rank - b.rank).map((f) => f.address);
}

/** What the same-network QR code encodes (see shared/protocol.ts). */
export function pairingUri(address: string, port: number, code: string): string {
  return `anyappagent://pair?url=${encodeURIComponent(`http://${address}:${port}`)}&code=${code}`;
}
