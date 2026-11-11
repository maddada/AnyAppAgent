import type {
  App,
  ChatItem,
  WorkerInfo,
  PageOpenResponse,
  CreateAppRequest,
  EasyConnectPairRequest,
  ErrorBody,
  HealthResponse,
  PairRequest,
  PairResponse,
  PermissionAnswerRequest,
  PublishRequest,
  ReleaseStats,
  SendMessageRequest,
  TodoItem,
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
  // Pictures make a message bigger: give it longer than the usual 10 s on a slow connection.
  send = (id: string, body: SendMessageRequest) =>
    request<void>(this.baseUrl, `/api/apps/${encodeURIComponent(id)}/messages`, { method: "POST", body, token: this.token, timeoutMs: body.images?.length ? 120000 : 20000 });
  cancel = (id: string) => this.call<void>(`/api/apps/${encodeURIComponent(id)}/cancel`, "POST", {});
  rebuild = (id: string) => this.call<void>(`/api/apps/${encodeURIComponent(id)}/build`, "POST", {});
  answerPermission = (id: string, body: PermissionAnswerRequest) =>
    this.call<void>(`/api/apps/${encodeURIComponent(id)}/permission`, "POST", body);

  // Helpers (the wire calls them workers): their list, a helper's own chat (read only), its Stop.
  helpers = (id: string) => this.call<WorkerInfo[]>(`/api/apps/${encodeURIComponent(id)}/workers`);
  helperMessages = (id: string, workerId: string) =>
    this.call<ChatItem[]>(`/api/apps/${encodeURIComponent(id)}/workers/${encodeURIComponent(workerId)}/messages`);
  stopHelper = (id: string, workerId: string) =>
    this.call<void>(`/api/apps/${encodeURIComponent(id)}/workers/${encodeURIComponent(workerId)}/cancel`, "POST", {});

  // Pages: a fresh signed address for one page (served without a token; the ticket is the grant).
  openPage = (id: string, pageId: string) =>
    this.call<PageOpenResponse>(`/api/apps/${encodeURIComponent(id)}/pages/${encodeURIComponent(pageId)}/open`, "POST", {});
  // The person's own to-do list for an app (the agent never sees it).
  todos = (id: string) => this.call<TodoItem[]>(`/api/apps/${encodeURIComponent(id)}/todos`);
  addTodo = (id: string, text: string) => this.call<TodoItem>(`/api/apps/${encodeURIComponent(id)}/todos`, "POST", { text });
  setTodoDone = (id: string, todoId: string, done: boolean) =>
    this.call<TodoItem>(`/api/apps/${encodeURIComponent(id)}/todos/${encodeURIComponent(todoId)}`, "PATCH", { done });
  removeTodo = (id: string, todoId: string) => this.call<void>(`/api/apps/${encodeURIComponent(id)}/todos/${encodeURIComponent(todoId)}`, "DELETE");
  /** Sends the item's text to the app's chat as a message, then ticks it off. */
  sendTodo = (id: string, todoId: string) =>
    this.call<TodoItem>(`/api/apps/${encodeURIComponent(id)}/todos/${encodeURIComponent(todoId)}/send`, "POST", {});

  // Sharing an app with other people and publishing versions (docs/DISTRIBUTION.md). GitHub
  // calls on the PC: they can take minutes (a publish uploads the APKs).
  share = (id: string, shared: boolean) =>
    request<App>(this.baseUrl, `/api/apps/${encodeURIComponent(id)}/share`, { method: "POST", body: { shared }, token: this.token, timeoutMs: 300000 });
  publish = (id: string, body: PublishRequest) =>
    request<App>(this.baseUrl, `/api/apps/${encodeURIComponent(id)}/publish`, { method: "POST", body, token: this.token, timeoutMs: 1800000 });
  pullBack = (id: string, build: number) =>
    request<App>(this.baseUrl, `/api/apps/${encodeURIComponent(id)}/pullback`, { method: "POST", body: { build }, token: this.token, timeoutMs: 300000 });
  releases = (id: string) => request<ReleaseStats[]>(this.baseUrl, `/api/apps/${encodeURIComponent(id)}/releases`, { token: this.token, timeoutMs: 60000 });

  imageUrl = (id: string, imageId: string) => `${this.baseUrl}/api/apps/${encodeURIComponent(id)}/images/${encodeURIComponent(imageId)}`;
  iconUrl = (id: string) => `${this.baseUrl}/api/apps/${encodeURIComponent(id)}/icon`;
  /** With `abi`, the smaller APK made for that processor type (when the build has one). */
  apkUrl = (id: string, abi?: string) => `${this.baseUrl}/api/apps/${encodeURIComponent(id)}/apk${abi ? `?abi=${encodeURIComponent(abi)}` : ""}`;
  socketUrl = () => `${this.baseUrl.replace(/^http/i, "ws")}/ws?token=${encodeURIComponent(this.token)}`;
  authHeaders = () => ({ Authorization: `Bearer ${this.token}` });
}
