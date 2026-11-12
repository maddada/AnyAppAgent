// Kiwimake Cloud on the phone (docs/CLOUD.md section 3, "The phone app"): the Convex client, a
// cloud implementation of the PC client's calls (same names, same shared/protocol.ts types, so the
// screens and shared/chat stay as they are), the choice of client per app, and the live sync of
// the account's cloud apps and open chats into the store. A phone can have both places: PC apps
// keep the PC's socket, cloud apps come from Convex. App ids never collide: Convex ids are 32
// lowercase letters and digits, a PC's are UUIDs.
import * as SecureStore from "expo-secure-store";
import { ConvexReactClient } from "convex/react";
import { anyApi } from "convex/server";
import { ApiError, type Client } from "./api";
import type { App, AppVersion, ChatItem, CreateAppRequest, PageOpenResponse, PermissionAnswerRequest, SendMessageRequest, TodoItem, WorkerInfo } from "./protocol";

export const CONVEX_URL = process.env.EXPO_PUBLIC_CONVEX_URL ?? "";
/** Dev builds only: the "Try it without an account" sign-in (the dev deployment's anonymous provider). */
export const CLOUD_DEV = process.env.EXPO_PUBLIC_CLOUD_DEV === "1";
export const CLOUD_SITE = CONVEX_URL.replace(/\.convex\.cloud\/?$/, ".convex.site");
/** True when this build can make apps in the cloud. */
export const cloudAvailable = Boolean(CONVEX_URL);

export const convex = CONVEX_URL ? new ConvexReactClient(CONVEX_URL, { unsavedChangesWarning: false }) : null;
export const api = anyApi;

export const isCloudId = (id: string) => /^[a-z0-9]{32}$/.test(id);
export const isCloudApp = (app: Pick<App, "id" | "cloud">) => app.cloud?.place === "cloud" || isCloudId(app.id);

// SecureStore keys allow only letters, digits, ".", "-" and "_".
const safe = (k: string) => k.replace(/[^A-Za-z0-9._-]/g, "_");
/** Where Convex Auth keeps the session (the phone's secure storage). */
export const authStorage = {
  getItem: (k: string) => SecureStore.getItemAsync(safe(k)),
  setItem: (k: string, v: string) => SecureStore.setItemAsync(safe(k), v),
  removeItem: (k: string) => SecureStore.deleteItemAsync(safe(k)),
};

/** Convex's "[CONVEX M(chat:send)] ... Uncaught Error: <sentence>\n at ..." down to the sentence. */
export function cloudMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const m = /Uncaught (?:Error: )?([^\n]+)/.exec(raw);
  const text = (m?.[1] ?? raw).replace(/\s+at .*$/, "").trim();
  if (/fetch failed|Network request failed|WebSocket/i.test(text)) return "Can't reach Kiwimake's cloud. Check the phone's internet, then try again.";
  return text.slice(0, 300);
}

async function call<T>(fn: () => Promise<T>): Promise<T> {
  if (!convex) throw new ApiError("This build has no cloud.", 0);
  try {
    return await fn();
  } catch (e) {
    throw new ApiError(cloudMessage(e), /Sign in first/.test(String(e)) ? 401 : 400);
  }
}

const notYet = (what: string) => () => Promise.reject(new ApiError(`${what} is not in the cloud yet.`, 400));

/** Lives in the store between a cloud app and its build files (fileUrls on its latestApk). */
function buildFile(app: App | undefined, abi?: string): string {
  const files = app?.latestApk?.fileUrls ?? [];
  return (abi ? files.find((f) => f.abi === abi) : undefined)?.url ?? files.find((f) => f.abi === "arm64-v8a")?.url ?? files[0]?.url ?? "";
}

/**
 * The PC client's calls, answered by the cloud. Calls the cloud does not have yet answer with a
 * plain sentence. `appOf` reads the store (for the build files of an app).
 */
export class CloudClient {
  readonly baseUrl = CLOUD_SITE;
  readonly token = "";
  private readonly appOf: (id: string) => App | undefined;
  constructor(appOf: (id: string) => App | undefined) {
    this.appOf = appOf;
  }

  listApps = () => call(() => convex!.query(api.apps.list, {}) as Promise<App[]>);
  getApp = (id: string) => call(() => convex!.query(api.apps.get, { appId: id }) as Promise<App>);
  createApp = async (body: CreateAppRequest) => {
    const images = await this.uploadImages(body.images);
    const appId = await call(() =>
      convex!.mutation(api.apps.create, {
        name: body.name,
        prompt: body.prompt,
        ...(body.preset === "kotlin" ? { preset: "kotlin" } : {}),
        ...(body.askMore ? { askMore: true } : {}),
        ...(images.length ? { images } : {}),
      }) as Promise<string>,
    );
    return this.getApp(appId);
  };
  deleteApp = (id: string) => call(() => convex!.mutation(api.apps.remove, { appId: id }) as Promise<void>);
  messages = (id: string) => call(() => convex!.query(api.chat.messages, { appId: id }) as Promise<ChatItem[]>);
  send = async (id: string, body: SendMessageRequest) => {
    const images = await this.uploadImages(body.images);
    await call(() => convex!.mutation(api.chat.send, { appId: id, text: body.text, ...(images.length ? { images } : {}) }));
  };
  cancel = (id: string) => call(() => convex!.mutation(api.chat.cancel, { appId: id }) as Promise<void>);
  rebuild = (id: string) => call(() => convex!.mutation(api.chat.rebuild, { appId: id }) as Promise<void>);
  answerPermission = (id: string, body: PermissionAnswerRequest) => call(() => convex!.mutation(api.chat.answerPermission, { appId: id, ...body }) as Promise<void>);
  helpers = (id: string) => call(() => convex!.query(api.chat.helpers, { appId: id }) as Promise<WorkerInfo[]>);
  helperMessages = (id: string, workerId: string) => call(() => convex!.query(api.chat.messages, { appId: id, workerId }) as Promise<ChatItem[]>);
  stopHelper = (id: string, workerId: string) => call(() => convex!.mutation(api.chat.stopHelper, { appId: id, workerId }) as Promise<void>);
  openPage = (id: string, pageId: string) => call(() => convex!.mutation(api.pages.open, { appId: id, pageId }) as Promise<PageOpenResponse>);

  todos = (id: string) => call(() => convex!.query(api.todos.list, { appId: id }) as Promise<TodoItem[]>);
  addTodo = (id: string, text: string) => call(() => convex!.mutation(api.todos.add, { appId: id, text }) as Promise<TodoItem>);
  setTodoDone = (id: string, todoId: string, done: boolean) => call(() => convex!.mutation(api.todos.setDone, { appId: id, todoId, done }) as Promise<TodoItem>);
  removeTodo = (id: string, todoId: string) => call(() => convex!.mutation(api.todos.remove, { appId: id, todoId }) as Promise<void>);
  sendTodo = async (id: string, todoId: string) => {
    const list = await this.todos(id);
    const item = list.find((x) => x.id === todoId);
    if (!item) throw new ApiError("That to-do is gone.", 404);
    await this.send(id, { text: item.text });
    return this.setTodoDone(id, todoId, true);
  };

  versions = (_id: string) => Promise.resolve([] as AppVersion[]);
  restoreVersion = notYet("Going back to a version");
  undo = notYet("Undo");
  reportCrash = notYet("Crash reports");
  fixCrash = notYet("Fixing a crash from its card");
  diaryAnswer = () => Promise.resolve();
  care = () => Promise.reject(new ApiError("no usage meter in the cloud", 404));
  dismissReminder = notYet("Reminders");
  keepHealthy = notYet("Keep my apps healthy");
  share = notYet("Sharing");
  publish = notYet("Publishing");
  pullBack = notYet("Pulling a version back");
  releases = () => Promise.resolve([]);
  suggestions = () => Promise.resolve([]);
  openSuggestion = notYet("Suggestions");
  removeSuggestion = notYet("Suggestions");
  setShowToOthers = notYet("This setting");
  fileSuggestion = notYet("Suggestions");
  owner = notYet("This");
  clone = notYet("Making your own version");
  unpair = () => Promise.resolve();

  /** Pictures go to Convex file storage first; the message carries their ids. */
  private async uploadImages(images: SendMessageRequest["images"]) {
    const out: { fileId: string; mimeType: string; width?: number; height?: number }[] = [];
    for (const im of images ?? []) {
      const url = await call(() => convex!.mutation(api.apps.imageUploadUrl, {}) as Promise<string>);
      const bytes = Uint8Array.from(atob(im.data), (c) => c.charCodeAt(0));
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": im.mimeType }, body: bytes });
      if (!res.ok) throw new ApiError("A picture did not upload. Try again.", res.status);
      const { storageId } = (await res.json()) as { storageId: string };
      out.push({ fileId: storageId, mimeType: im.mimeType, ...(im.width ? { width: im.width } : {}), ...(im.height ? { height: im.height } : {}) });
    }
    return out;
  }

  imageUrl = () => "";
  iconUrl = (id: string) => this.appOf(id)?.cloud?.iconUrl ?? "";
  otaUrl = (id: string) => this.appOf(id)?.latestApk?.otaUrl ?? "";
  apkUrl = (id: string, abi?: string) => buildFile(this.appOf(id), abi);
  socketUrl = () => "";
  authHeaders = () => ({}) as Record<string, string>;
}

/** The calls the screens make, whichever place holds the app. */
export type AppClient = Client | CloudClient;
