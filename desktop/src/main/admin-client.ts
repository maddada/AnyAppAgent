// Talks to the companion over http://127.0.0.1:<port> with the admin token: /api/admin/state,
// the app list, chat history, icons, and the live event socket (/api/admin/events).
//
// Until the companion has the admin routes (another thread is adding them), it falls back to what
// any companion offers: the pairing code from <state>/pairing-code.txt, this PC's addresses, the
// paired phones from <state>/tokens.json, and /ws for events.
import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { networkInterfaces, hostname } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import type { AdminEvent, AdminState, App, AppPreset, ChatItem, ImageUpload, PairedDevice, WorkerInfo } from "../../../shared/protocol.ts";

const VIRTUAL_ADAPTER = /vethernet|wsl|hyper-v|virtualbox|vmware|tailscale|zerotier|docker|loopback|vpn/i;

/** IPv4 addresses a phone on the same Wi-Fi is most likely to reach, best first (as the companion ranks them). */
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

export function pairingUri(url: string, code: string): string {
  return `anyappagent://pair?url=${encodeURIComponent(url)}&code=${code}`;
}

interface TokenRecord {
  id?: string;
  deviceName?: string;
  createdAt?: string;
  lastSeenAt?: string;
  via?: string; // "lan" (older companions), "same-network" or "easy-connect"
}

/** AdminState built without the admin routes (fallback). */
export function fallbackAdminState(stateDir: string, port: number): AdminState | null {
  const codeFile = join(stateDir, "pairing-code.txt");
  if (!existsSync(codeFile)) return null;
  const code = readFileSync(codeFile, "utf8").trim();
  const lanUrls = lanAddresses().map((a) => `http://${a}:${port}`);
  let devices: PairedDevice[] = [];
  try {
    const records = JSON.parse(readFileSync(join(stateDir, "tokens.json"), "utf8")) as TokenRecord[];
    devices = records.map((r, i) => ({
      id: r.id ?? String(i),
      name: r.deviceName ?? "Phone",
      pairedAt: r.createdAt ?? "",
      lastSeenAt: r.lastSeenAt,
      connected: false,
      via: r.via === "easy-connect" ? "easy-connect" : "same-network",
    }));
  } catch {
    // no phones yet
  }
  return {
    serverName: hostname(),
    version: "",
    port,
    pairing: { code, lanUrls, qrPayload: pairingUri(lanUrls[0] ?? `http://10.0.2.2:${port}`, code) },
    easyConnect: { state: "off" },
    devices,
  };
}

export class AdminClient extends EventEmitter {
  private socket: WebSocket | undefined;
  private socketTimer: NodeJS.Timeout | undefined;
  private pollTimer: NodeJS.Timeout | undefined;
  private closed = false;
  adminRoutes = false;
  state: AdminState | null = null;
  apps: App[] = [];

  constructor(
    private readonly base: string,
    private readonly token: string,
    private readonly stateDir: string,
    private readonly port: number,
    private readonly log: (line: string) => void,
  ) {
    super();
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        message = ((await res.json()) as { error?: string }).error ?? message;
      } catch {
        // not JSON
      }
      const error = new Error(message) as Error & { status?: number };
      error.status = res.status;
      throw error;
    }
    if (res.status === 204 || res.status === 202) return undefined as T;
    const type = res.headers.get("content-type") ?? "";
    return (type.includes("json") ? await res.json() : await res.arrayBuffer()) as T;
  }

  /** Waits until /api/health answers. */
  async waitHealthy(timeoutMs = 60_000): Promise<boolean> {
    const until = Date.now() + timeoutMs;
    while (!this.closed && Date.now() < until) {
      try {
        const res = await fetch(`${this.base}/api/health`, { signal: AbortSignal.timeout(2_000) });
        if (res.ok) return true;
      } catch {
        // not up yet
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    return false;
  }

  /** Called once the companion is up: loads everything and opens the event socket. */
  async connect(): Promise<void> {
    this.closed = false;
    await this.refreshState();
    await this.refreshApps();
    this.openSocket();
    // The fallback has no admin.state events; poll the files instead.
    this.pollTimer = setInterval(() => {
      if (!this.adminRoutes) void this.refreshState();
    }, 2_000);
  }

  close(): void {
    this.closed = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.socketTimer) clearTimeout(this.socketTimer);
    this.socket?.close();
    this.socket = undefined;
  }

  async refreshState(): Promise<void> {
    try {
      const state = await this.request<AdminState>("GET", "/api/admin/state");
      this.adminRoutes = true;
      this.setState(state);
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 404 || status === 401 || status === 403) {
        this.adminRoutes = false;
        this.setState(fallbackAdminState(this.stateDir, this.port));
      } else {
        this.log(`[admin] state: ${(error as Error).message}`);
      }
    }
  }

  private setState(state: AdminState | null): void {
    if (JSON.stringify(state) === JSON.stringify(this.state)) return;
    this.state = state;
    this.emit("state", state);
  }

  async refreshApps(): Promise<void> {
    try {
      this.apps = await this.request<App[]>("GET", "/api/apps");
      this.emit("apps", this.apps);
    } catch (error) {
      this.log(`[admin] apps: ${(error as Error).message}`);
    }
  }

  private openSocket(): void {
    if (this.closed) return;
    const path = this.adminRoutes ? "/api/admin/events" : "/ws";
    const url = `${this.base.replace(/^http/, "ws")}${path}?token=${encodeURIComponent(this.token)}`;
    const socket = new WebSocket(url, { headers: { authorization: `Bearer ${this.token}` } });
    this.socket = socket;
    socket.on("message", (data) => {
      try {
        this.onEvent(JSON.parse(String(data)) as AdminEvent);
      } catch {
        // ignore malformed frames
      }
    });
    socket.on("error", (error) => this.log(`[admin] socket: ${error.message}`));
    socket.on("close", () => {
      if (this.socket !== socket || this.closed) return;
      this.socketTimer = setTimeout(() => {
        void this.refreshApps();
        void this.refreshState();
        this.openSocket();
      }, 2_000);
    });
  }

  private onEvent(event: AdminEvent): void {
    switch (event.type) {
      case "admin.state":
        this.adminRoutes = true;
        this.setState(event.state);
        break;
      case "app.updated":
      case "apk.ready": {
        const i = this.apps.findIndex((a) => a.id === event.app.id);
        if (i >= 0) this.apps[i] = event.app;
        else this.apps.push(event.app);
        this.emit("apps", this.apps);
        break;
      }
      case "app.deleted":
        this.apps = this.apps.filter((a) => a.id !== event.appId);
        this.emit("apps", this.apps);
        break;
      case "chat.item":
        this.emit("chat", event.item);
        break;
      case "worker.updated":
        this.emit("helper", event.worker);
        break;
      case "worker.item":
        this.emit("helper-item", event.item);
        break;
    }
  }

  messages(appId: string): Promise<ChatItem[]> {
    return this.request<ChatItem[]>("GET", `/api/apps/${encodeURIComponent(appId)}/messages`);
  }

  /** Helpers of an app (an older companion has no such route: no helpers). */
  async helpers(appId: string): Promise<WorkerInfo[]> {
    try {
      return await this.request<WorkerInfo[]>("GET", `/api/apps/${encodeURIComponent(appId)}/workers`);
    } catch {
      return [];
    }
  }

  helperMessages(appId: string, workerId: string): Promise<ChatItem[]> {
    return this.request<ChatItem[]>("GET", `/api/apps/${encodeURIComponent(appId)}/workers/${encodeURIComponent(workerId)}/messages`);
  }

  /** A helper's own Stop (the main chat's Stop never stops helpers). */
  stopHelper(appId: string, workerId: string): Promise<void> {
    return this.request("POST", `/api/apps/${encodeURIComponent(appId)}/workers/${encodeURIComponent(workerId)}/cancel`, {});
  }

  send(appId: string, text: string, images: ImageUpload[] = []): Promise<void> {
    return this.request("POST", `/api/apps/${encodeURIComponent(appId)}/messages`, { text, ...(images.length ? { images } : {}) });
  }

  /** A picture sent in the chat, as a data URL for the renderer (it cannot send the admin token). */
  async image(appId: string, imageId: string): Promise<string | undefined> {
    try {
      const res = await fetch(`${this.base}/api/apps/${encodeURIComponent(appId)}/images/${encodeURIComponent(imageId)}`, {
        headers: { authorization: `Bearer ${this.token}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return undefined;
      const type = (res.headers.get("content-type") ?? "image/png").split(";")[0];
      if (!/^image\/(png|jpeg|webp|gif)$/.test(type)) return undefined;
      return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
    } catch {
      return undefined;
    }
  }

  /** Stop: ends the agent's current turn (ACP session/cancel on the companion). */
  cancel(appId: string): Promise<void> {
    return this.request("POST", `/api/apps/${encodeURIComponent(appId)}/cancel`, {});
  }

  /** Builds again without a new message (a failed build's Try again). */
  rebuild(appId: string): Promise<void> {
    return this.request("POST", `/api/apps/${encodeURIComponent(appId)}/build`, {});
  }

  answerPermission(appId: string, requestId: string, optionId: string): Promise<void> {
    return this.request("POST", `/api/apps/${encodeURIComponent(appId)}/permission`, { requestId, optionId });
  }

  /** A new app, made from this PC: the same route and fields as the phone's New app sheet. */
  async createApp(name: string, prompt: string, preset?: AppPreset): Promise<App> {
    // The default is left out, so an older companion still accepts the request.
    const app = await this.request<App>("POST", "/api/apps", { name, prompt, ...(preset && preset !== "react-native" ? { preset } : {}) });
    if (!this.apps.some((a) => a.id === app.id)) {
      this.apps.push(app);
      this.emit("apps", this.apps);
    }
    return app;
  }

  async icon(appId: string): Promise<string | undefined> {
    try {
      const res = await fetch(`${this.base}/api/apps/${encodeURIComponent(appId)}/icon`, { headers: { authorization: `Bearer ${this.token}` }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return undefined;
      const type = (res.headers.get("content-type") ?? "image/png").split(";")[0];
      if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(type)) return undefined;
      return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
    } catch {
      return undefined;
    }
  }

  async newPairing(): Promise<void> {
    if (!this.adminRoutes) return; // the fallback cannot make a new code
    this.setState(await this.request<AdminState>("POST", "/api/admin/pairing/new"));
  }

  async easyConnect(enabled: boolean): Promise<void> {
    if (!this.adminRoutes) return;
    this.setState(await this.request<AdminState>("POST", "/api/admin/easy-connect", { enabled }));
  }

  async removeDevice(id: string): Promise<void> {
    if (!this.adminRoutes) throw new Error("Removing a phone needs a newer AnyAppAgent companion.");
    await this.request("DELETE", `/api/admin/devices/${encodeURIComponent(id)}`);
    await this.refreshState();
  }
}
