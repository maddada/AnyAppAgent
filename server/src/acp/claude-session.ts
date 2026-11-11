// One Claude Code ACP session for one app, following bb's startAgentSession / stopSession /
// prompt flow in packages/provider-bridge-acp/src/bridge/bridge.ts (MIT, see
// THIRD_PARTY_NOTICES.md):
//   initialize -> authenticate (only for a cached_token method) -> session/resume (or
//   session/load) of the stored session id -> session/new if there is none or it fails ->
//   prompts carry bb's <system_instructions> block on the first prompt of a NEW session ->
//   session/cancel to stop a turn -> permission requests answered allow_once in full mode.
// Claude Code is launched the way bb's ACP registry entry "claude-acp" launches it: the
// @agentclientprotocol/claude-agent-acp package (bb: `npx -y @agentclientprotocol/claude-agent-acp@<v>`).
import { promises as fs, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import {
  createAcpAgentConnection,
  requestAcpInitialize,
  type AcpAgentConnection,
  type AcpAgentExitInfo,
  type AcpAgentRequestResponder,
} from "./agent-connection.ts";
import { decodeAcpPermissionRequest, isJsonObject, readString, type AcpPermissionRequest } from "./acp-client.ts";

export const CLAUDE_ACP_PACKAGE = "@agentclientprotocol/claude-agent-acp";
export const CLAUDE_ACP_VERSION = "0.102.0";
const ACP_SESSION_SETUP_TIMEOUT_MS = 120_000;
const FULL_ACCESS_MODE_ID = "bypassPermissions";

export interface LaunchSpec {
  command: string;
  args: string[];
}

export function claudeLaunchSpec(kind: "local" | "npx"): LaunchSpec {
  if (kind === "npx") return { command: "npx", args: ["-y", `${CLAUDE_ACP_PACKAGE}@${CLAUDE_ACP_VERSION}`] };
  const require = createRequire(import.meta.url);
  const pkgJson = require.resolve(`${CLAUDE_ACP_PACKAGE}/package.json`);
  const pkg = require(pkgJson) as { bin: Record<string, string> };
  return { command: process.execPath, args: [join(dirname(pkgJson), pkg.bin["claude-agent-acp"])] };
}

const STRIPPED_ENV = new Set(["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_SSE_PORT", "CLAUDE_AGENT_SDK_VERSION"]);

/** bb's withoutBridgeRuntimeEnv: the agent must not inherit this process's own agent markers. */
export function agentEnv(base: NodeJS.ProcessEnv = process.env): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(base)) {
    if (STRIPPED_ENV.has(key) || key.startsWith("GHOSTEX_") || key.startsWith("ANYAPP_")) continue;
    env[key] = value;
  }
  return env;
}

export interface PermissionAsk {
  request: AcpPermissionRequest;
  responder: AcpAgentRequestResponder;
}

export interface ClaudeSessionOptions {
  cwd: string;
  resumeSessionId?: string;
  instructions: string;
  launch: LaunchSpec;
  /** Dev and tests only (ANYAPP_ASK_PERMISSIONS=1): stay in the default mode, so permission requests reach the chat. */
  askPermissions?: boolean;
  onUpdate(update: unknown): void;
  onPermission(ask: PermissionAsk): void;
  onExit(info: AcpAgentExitInfo): void;
  log(message: string): void;
}

function sliceLines(content: string, line: number | undefined, limit: number | undefined): string {
  if (line === undefined && limit === undefined) return content;
  const lines = content.split("\n");
  const start = Math.max(0, (line ?? 1) - 1);
  return lines.slice(start, limit === undefined ? undefined : start + limit).join("\n");
}

/** A picture saved on the PC, sent with a prompt. */
export interface PromptImage {
  path: string;
  mimeType: string;
}

type AcpPromptBlock = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

export class ClaudeSession {
  sessionId = "";
  resumed = false;
  modeId: string | undefined;
  private readonly options: ClaudeSessionOptions;
  private connection: AcpAgentConnection | undefined;
  private pendingInstructions: string | undefined;
  /** The agent's promptCapabilities.image (bb: supportsImageInput). */
  supportsImageInput = false;
  private loading = false;
  private canResume = false;

  constructor(options: ClaudeSessionOptions) {
    this.options = options;
    this.pendingInstructions = options.instructions;
  }

  get alive(): boolean {
    return this.connection !== undefined && !this.connection.exited;
  }

  async start(): Promise<void> {
    const { cwd, launch } = this.options;
    const connection = createAcpAgentConnection({
      command: launch.command,
      args: launch.args,
      cwd,
      env: agentEnv(),
      onSessionUpdate: (sessionId, update) => {
        if (this.loading || (this.sessionId !== "" && sessionId !== this.sessionId)) return;
        this.options.onUpdate(update);
      },
      onNotification: () => {},
      onRequest: (method, params, responder) => void this.handleRequest(method, params, responder),
      onExit: (info) => this.options.onExit(info),
    });
    this.connection = connection;
    try {
      const init = await requestAcpInitialize(connection);
      const agent = isJsonObject(init) && isJsonObject(init["agentCapabilities"]) ? init["agentCapabilities"] : {};
      const sessionCaps = isJsonObject(agent["sessionCapabilities"]) ? agent["sessionCapabilities"] : {};
      const supportsResume = sessionCaps["resume"] !== undefined && sessionCaps["resume"] !== null && sessionCaps["resume"] !== false;
      const supportsLoad = agent["loadSession"] === true;
      this.canResume = supportsResume || supportsLoad;
      // bb: session.supportsImageInput = capabilities.prompt.image
      const promptCaps = isJsonObject(agent["promptCapabilities"]) ? agent["promptCapabilities"] : {};
      this.supportsImageInput = promptCaps["image"] === true;
      const authMethods = isJsonObject(init) && Array.isArray(init["authMethods"]) ? init["authMethods"] : [];
      if (authMethods.some((m) => isJsonObject(m) && m["id"] === "cached_token")) {
        await connection.request("authenticate", { methodId: "cached_token", _meta: { headless: true } }, 60_000);
      }

      let configState: unknown;
      const resumeId = this.options.resumeSessionId;
      if (resumeId && this.canResume) {
        const method = supportsResume ? "session/resume" : "session/load";
        this.loading = true;
        try {
          configState = await connection.request(method, { sessionId: resumeId, cwd, mcpServers: [] }, ACP_SESSION_SETUP_TIMEOUT_MS);
          this.sessionId = resumeId;
          this.resumed = true;
          this.pendingInstructions = undefined;
          this.options.log(`${method} restored Claude Code session ${resumeId}`);
        } catch (error) {
          this.options.log(`could not restore session ${resumeId} (${(error as Error).message}); starting a new one`);
        } finally {
          this.loading = false;
        }
      }
      if (this.sessionId === "") {
        configState = await connection.request("session/new", { cwd, mcpServers: [] }, ACP_SESSION_SETUP_TIMEOUT_MS);
        const sessionId = isJsonObject(configState) ? readString(configState, "sessionId") : undefined;
        if (!sessionId) throw new Error("Claude Code did not return a session id");
        this.sessionId = sessionId;
        this.options.log(`session/new created Claude Code session ${sessionId}`);
      }
      if (!this.options.askPermissions) await this.selectFullAccessMode(configState);
      else await this.connection.request("session/set_mode", { sessionId: this.sessionId, modeId: "default" }, 30_000).catch(() => undefined);
    } catch (error) {
      await connection.kill();
      throw error;
    }
  }

  // bb answers every permission request itself in "full" mode; the Claude adapter also offers a
  // bypassPermissions session mode, selected the way bb applies a session mode (session/set_mode),
  // so most tool calls never ask at all.
  private async selectFullAccessMode(configState: unknown): Promise<void> {
    const modes = isJsonObject(configState) && isJsonObject(configState["modes"]) ? configState["modes"] : undefined;
    const available = modes && Array.isArray(modes["availableModes"]) ? modes["availableModes"] : [];
    const current = modes ? readString(modes, "currentModeId") : undefined;
    this.modeId = current;
    if (current === FULL_ACCESS_MODE_ID) return;
    if (!available.some((mode) => isJsonObject(mode) && mode["id"] === FULL_ACCESS_MODE_ID)) return;
    try {
      await this.connection!.request("session/set_mode", { sessionId: this.sessionId, modeId: FULL_ACCESS_MODE_ID }, 30_000);
      this.modeId = FULL_ACCESS_MODE_ID;
    } catch (error) {
      this.options.log(`session/set_mode ${FULL_ACCESS_MODE_ID} failed: ${(error as Error).message}`);
    }
  }

  /**
   * Sends one prompt and resolves with the ACP stopReason when the turn ends. Pictures go as ACP
   * image content blocks read from the saved file, as bb's buildPromptContentBlocks does for a
   * "localImage" (packages/provider-bridge-acp/src/bridge/bridge.ts), or as a text line naming the
   * file when the agent does not take images.
   */
  async prompt(text: string, images: PromptImage[] = []): Promise<string> {
    if (!this.connection || this.connection.exited) throw new Error("The Claude Code session is not running");
    const prompt: AcpPromptBlock[] = [];
    if (this.pendingInstructions) {
      prompt.push({ type: "text", text: `<system_instructions>\n${this.pendingInstructions}\n</system_instructions>` });
      this.pendingInstructions = undefined;
    }
    if (text) prompt.push({ type: "text", text });
    for (const image of images) {
      if (!this.supportsImageInput) {
        prompt.push({ type: "text", text: `[image attachment on disk: ${image.path}]` });
        continue;
      }
      try {
        prompt.push({ type: "image", data: readFileSync(image.path).toString("base64"), mimeType: image.mimeType });
      } catch {
        prompt.push({ type: "text", text: `[unreadable image attachment: ${image.path}]` });
      }
    }
    if (images.length > 0) {
      // The files stay on this PC, so the agent can also put a picture into the app when asked to.
      prompt.push({ type: "text", text: `(The ${images.length === 1 ? "picture is" : "pictures are"} also saved on this PC: ${images.map((i) => i.path).join(", ")})` });
    }
    const result = await this.connection.request("session/prompt", { sessionId: this.sessionId, prompt }, null);
    return isJsonObject(result) ? (readString(result, "stopReason") ?? "end_turn") : "end_turn";
  }

  cancel(): void {
    this.connection?.notify("session/cancel", { sessionId: this.sessionId });
  }

  async stop(): Promise<void> {
    await this.connection?.kill();
  }

  private async handleRequest(method: string, params: unknown, responder: AcpAgentRequestResponder): Promise<void> {
    try {
      switch (method) {
        case "session/request_permission":
          this.options.onPermission({ request: decodeAcpPermissionRequest(params), responder });
          return;
        case "fs/read_text_file": {
          if (!isJsonObject(params) || typeof params["path"] !== "string") {
            responder.error(-32602, "Invalid fs/read_text_file params");
            return;
          }
          const content = await fs.readFile(params["path"], "utf8");
          const line = typeof params["line"] === "number" ? params["line"] : undefined;
          const limit = typeof params["limit"] === "number" ? params["limit"] : undefined;
          responder.result({ content: sliceLines(content, line, limit) });
          return;
        }
        case "fs/write_text_file": {
          if (!isJsonObject(params) || typeof params["path"] !== "string" || typeof params["content"] !== "string") {
            responder.error(-32602, "Invalid fs/write_text_file params");
            return;
          }
          await fs.mkdir(dirname(params["path"]), { recursive: true });
          await fs.writeFile(params["path"], params["content"], "utf8");
          responder.result({});
          return;
        }
        default:
          responder.error(-32601, `Unsupported ACP client method "${method}"`);
      }
    } catch (error) {
      responder.error(-32603, error instanceof Error ? error.message : String(error));
    }
  }
}

/** bb's pickPermissionOptionId for "allow_once". */
export function pickAllowOption(options: { optionId: string; kind: string }[]): string | undefined {
  for (const kind of ["allow_once", "allow_always"]) {
    const found = options.find((option) => option.kind === kind);
    if (found) return found.optionId;
  }
  return undefined;
}
