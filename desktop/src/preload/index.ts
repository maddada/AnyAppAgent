// The typed bridge between the renderer (no Node, context isolated) and the main process.
import { contextBridge, ipcRenderer } from "electron";
import type { AnyAppBridge, ChatItem, Snapshot, TodoItem, WorkerInfo } from "../shared/types.ts";

const bridge: AnyAppBridge = {
  getSnapshot: () => ipcRenderer.invoke("snapshot"),
  onSnapshot: (listener) => {
    const fn = (_e: unknown, s: Snapshot) => listener(s);
    ipcRenderer.on("snapshot", fn);
    return () => ipcRenderer.removeListener("snapshot", fn);
  },
  onChatItem: (listener) => {
    const fn = (_e: unknown, item: ChatItem) => listener(item);
    ipcRenderer.on("chat:item", fn);
    return () => ipcRenderer.removeListener("chat:item", fn);
  },
  onHelper: (listener) => {
    const fn = (_e: unknown, worker: WorkerInfo) => listener(worker);
    ipcRenderer.on("helper:updated", fn);
    return () => ipcRenderer.removeListener("helper:updated", fn);
  },
  onHelperItem: (listener) => {
    const fn = (_e: unknown, item: ChatItem) => listener(item);
    ipcRenderer.on("helper:item", fn);
    return () => ipcRenderer.removeListener("helper:item", fn);
  },
  onNavigate: (listener) => {
    const fn = (_e: unknown, where: "connect-phone" | "home") => listener(where);
    ipcRenderer.on("navigate", fn);
    return () => ipcRenderer.removeListener("navigate", fn);
  },
  onTodos: (listener) => {
    const fn = (_e: unknown, appId: string, todos: TodoItem[]) => listener(appId, todos);
    ipcRenderer.on("todos:updated", fn);
    return () => ipcRenderer.removeListener("todos:updated", fn);
  },
  recheck: () => ipcRenderer.invoke("recheck"),
  claudeSignIn: () => ipcRenderer.invoke("claude:signin"),
  claudeCancel: () => ipcRenderer.invoke("claude:cancel"),
  claudeSubmitCode: (code) => ipcRenderer.invoke("claude:code", code),
  githubStart: () => ipcRenderer.invoke("github:start"),
  githubOpenPage: () => ipcRenderer.invoke("github:open"),
  githubCancel: () => ipcRenderer.invoke("github:cancel"),
  githubSkip: (skipped) => ipcRenderer.invoke("github:skip", skipped),
  toolsInstall: () => ipcRenderer.invoke("tools:install"),
  toolsCancel: () => ipcRenderer.invoke("tools:cancel"),
  phoneDownload: () => ipcRenderer.invoke("phone:download"),
  phoneRelease: () => ipcRenderer.invoke("phone:release"),
  newPairingCode: () => ipcRenderer.invoke("pairing:new"),
  setEasyConnect: (enabled) => ipcRenderer.invoke("pairing:easy", enabled),
  easyConnectAuto: () => ipcRenderer.invoke("pairing:easy-auto"),
  removeDevice: (id) => ipcRenderer.invoke("devices:remove", id),
  hexInstall: () => ipcRenderer.invoke("hex:install"),
  hexOpen: () => ipcRenderer.invoke("hex:open"),
  hexCheck: () => ipcRenderer.invoke("hex:check"),
  hexTranscribe: (wav) => ipcRenderer.invoke("hex:transcribe", wav),
  backupKeys: (password) => ipcRenderer.invoke("keys:backup", password),
  restoreKeys: (password) => ipcRenderer.invoke("keys:restore", password),
  backupOn: (password) => ipcRenderer.invoke("backup:on", password),
  backupOff: () => ipcRenderer.invoke("backup:off"),
  backupRun: () => ipcRenderer.invoke("backup:run"),
  backupRestore: (password) => ipcRenderer.invoke("backup:restore", password),
  dismissReminder: () => ipcRenderer.invoke("care:dismiss"),
  keepHealthy: (appId) => ipcRenderer.invoke("apps:keep-healthy", appId),
  getMessages: (appId) => ipcRenderer.invoke("apps:messages", appId),
  getHelpers: (appId) => ipcRenderer.invoke("helpers:list", appId),
  getHelperMessages: (appId, workerId) => ipcRenderer.invoke("helpers:messages", appId, workerId),
  stopHelper: (appId, workerId) => ipcRenderer.invoke("helpers:stop", appId, workerId),
  sendMessage: (appId, text, images) => ipcRenderer.invoke("apps:send", appId, text, images),
  getImage: (appId, imageId) => ipcRenderer.invoke("apps:image", appId, imageId),
  cancelTurn: (appId) => ipcRenderer.invoke("apps:cancel", appId),
  rebuild: (appId) => ipcRenderer.invoke("apps:rebuild", appId),
  shareApp: (appId, shared) => ipcRenderer.invoke("apps:share", appId, shared),
  publishApp: (appId, notes, channel) => ipcRenderer.invoke("apps:publish", appId, notes, channel),
  pullBack: (appId, build) => ipcRenderer.invoke("apps:pullback", appId, build),
  releaseStats: (appId) => ipcRenderer.invoke("apps:releases", appId),
  qr: (text) => ipcRenderer.invoke("qr", text),
  getSuggestions: (appId) => ipcRenderer.invoke("suggestions:list", appId),
  fileSuggestion: (text) => ipcRenderer.invoke("suggestions:file", text),
  openSuggestion: (appId, id) => ipcRenderer.invoke("suggestions:open", appId, id),
  removeSuggestion: (appId, id) => ipcRenderer.invoke("suggestions:remove", appId, id),
  setChange: (appId, body) => ipcRenderer.invoke("apps:change", appId, body),
  getOwnerName: () => ipcRenderer.invoke("owner:name"),
  answerPermission: (appId, requestId, optionId) => ipcRenderer.invoke("apps:permission", appId, requestId, optionId),
  getVersions: (appId) => ipcRenderer.invoke("versions:list", appId),
  restoreVersion: (appId, build) => ipcRenderer.invoke("versions:restore", appId, build),
  undoChange: (appId) => ipcRenderer.invoke("versions:undo", appId),
  fixCrash: (appId, crashId) => ipcRenderer.invoke("crashes:fix", appId, crashId),
  getTodos: (appId) => ipcRenderer.invoke("todos:list", appId),
  addTodo: (appId, text) => ipcRenderer.invoke("todos:add", appId, text),
  setTodoDone: (appId, todoId, done) => ipcRenderer.invoke("todos:done", appId, todoId, done),
  removeTodo: (appId, todoId) => ipcRenderer.invoke("todos:remove", appId, todoId),
  sendTodo: (appId, todoId) => ipcRenderer.invoke("todos:send", appId, todoId),
  createApp: (name, prompt, preset, askMore) => ipcRenderer.invoke("apps:create", name, prompt, preset, askMore),
  openPage: (appId, pageId, title) => ipcRenderer.invoke("pages:open", appId, pageId, title),
  setSetting: (key, value) => ipcRenderer.invoke("settings:set", key, value),
  restartCompanion: () => ipcRenderer.invoke("companion:restart"),
  quit: () => ipcRenderer.invoke("app:quit"),
  copyText: (text) => ipcRenderer.invoke("copy", text),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  openFolder: (which) => ipcRenderer.invoke("open-folder", which),
};

contextBridge.exposeInMainWorld("anyapp", bridge);
