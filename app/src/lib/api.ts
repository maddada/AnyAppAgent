import type {
  App,
  ChatItem,
  CreateAppRequest,
  EasyConnectPairRequest,
  ErrorBody,
  HealthResponse,
  PairRequest,
  PairResponse,
  PermissionAnswerRequest,
  SendMessageRequest,
} from "./protocol";

/** An error with a sentence that can be shown to the user as is. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number, // 0 = the PC could not be reached
  ) {
    super(message);
  }
  get unreachable() {
    return this.status === 0;
  }
  get unauthorized() {
    return this.status === 401 || this.status === 403;
  }
}

export const UNREACHABLE = "Can't reach your PC. Check that AnyAppAgent is running on it and that both are on the same Wi-Fi.";

async function request<T>(
  baseUrl: string,
  path: string,
  options: { method?: string; token?: string | null; body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10000);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(UNREACHABLE, 0);
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    let message = "";
    try {
      message = ((await response.json()) as ErrorBody).error ?? "";
    } catch {
      // not JSON
    }
    if (!message) {
      message =
        response.status === 401 || response.status === 403
          ? "Your PC doesn't know this phone any more. Connect again."
          : `Your PC answered with an error (${response.status}).`;
    }
    throw new ApiError(message, response.status);
  }
  if (response.status === 202 || response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const health = (baseUrl: string, timeoutMs = 5000) => request<HealthResponse>(baseUrl, "/api/health", { timeoutMs });

export const pair = (baseUrl: string, body: PairRequest) =>
  request<PairResponse>(baseUrl, "/api/pair", { method: "POST", body, timeoutMs: 10000 });

export const pairEasyConnect = (baseUrl: string, body: EasyConnectPairRequest) =>
  request<PairResponse>(baseUrl, "/api/pair/easy-connect", { method: "POST", body, timeoutMs: 20000 });

/** Calls bound to one paired PC. */
export class Client {
  constructor(
    readonly baseUrl: string,
    readonly token: string,
  ) {}

  private call<T>(path: string, method = "GET", body?: unknown) {
    return request<T>(this.baseUrl, path, { method, body, token: this.token });
  }

  listApps = () => this.call<App[]>("/api/apps");
  getApp = (id: string) => this.call<App>(`/api/apps/${encodeURIComponent(id)}`);
  createApp = (body: CreateAppRequest) => this.call<App>("/api/apps", "POST", body);
  /** POST /api/unpair: the PC forgets this phone (its token, and its Easy Connect key). 204. */
  unpair = (timeoutMs = 8000) => request<void>(this.baseUrl, "/api/unpair", { method: "POST", token: this.token, timeoutMs });
  deleteApp = (id: string) => this.call<void>(`/api/apps/${encodeURIComponent(id)}`, "DELETE");
  messages = (id: string, afterSeq?: number) =>
    this.call<ChatItem[]>(`/api/apps/${encodeURIComponent(id)}/messages${afterSeq != null ? `?afterSeq=${afterSeq}` : ""}`);
  send = (id: string, body: SendMessageRequest) => this.call<void>(`/api/apps/${encodeURIComponent(id)}/messages`, "POST", body);
  cancel = (id: string) => this.call<void>(`/api/apps/${encodeURIComponent(id)}/cancel`, "POST", {});
  rebuild = (id: string) => this.call<void>(`/api/apps/${encodeURIComponent(id)}/build`, "POST", {});
  answerPermission = (id: string, body: PermissionAnswerRequest) =>
    this.call<void>(`/api/apps/${encodeURIComponent(id)}/permission`, "POST", body);

  iconUrl = (id: string) => `${this.baseUrl}/api/apps/${encodeURIComponent(id)}/icon`;
  apkUrl = (id: string) => `${this.baseUrl}/api/apps/${encodeURIComponent(id)}/apk`;
  socketUrl = () => `${this.baseUrl.replace(/^http/i, "ws")}/ws?token=${encodeURIComponent(this.token)}`;
  authHeaders = () => ({ Authorization: `Bearer ${this.token}` });
}
