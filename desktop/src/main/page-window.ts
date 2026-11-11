// Pages an app's agent published (shared/protocol.ts PageInfo), opened in their own window over the
// app, like Ghostex's floating page window. The page runs sandboxed: no preload (so no bridge to
// the app), its own session partition (no cookies or storage shared with the app), and the
// companion serves it with a sandbox content policy (opaque origin). Links it holds open in the
// browser; the window itself never leaves the page.
import { BrowserWindow, nativeTheme, session, shell } from "electron";
import { pageUrl, staysInPage } from "../../../shared/chat/pages.ts";
import { color as themeColor } from "../../../shared/theme/tokens.ts";

/** The partition every page window shares: in memory, nothing from the app's own session. */
const PARTITION = "page";
const windows = new Map<string, BrowserWindow>();
let sessionReady = false;

function openOutside(url: string): void {
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
}

function pageSession(): Electron.Session {
  const ses = session.fromPartition(PARTITION);
  if (!sessionReady) {
    sessionReady = true;
    // A page asks for nothing: no camera, microphone, notifications or the like.
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
  }
  return ses;
}

export interface OpenPageArgs {
  appId: string;
  pageId: string;
  title: string;
  baseUrl: string;
  /** The path the companion answered for POST /api/apps/:id/pages/:pageId/open. */
  path: string;
  parent?: BrowserWindow;
  icon?: Electron.NativeImage;
}

/** Opens the page in its window, or brings its window to the front when it is open already. */
export function openPageWindow(args: OpenPageArgs): void {
  const key = `${args.appId}/${args.pageId}`;
  const open = windows.get(key);
  if (open && !open.isDestroyed()) {
    if (open.isMinimized()) open.restore();
    open.focus();
    return;
  }
  const dark = nativeTheme.shouldUseDarkColors;
  const address = pageUrl(args.baseUrl, args.path, dark ? "dark" : "light");
  const parentBounds = args.parent && !args.parent.isDestroyed() ? args.parent.getBounds() : undefined;
  const width = 900;
  const height = parentBounds ? Math.min(900, Math.max(560, parentBounds.height - 40)) : 900;
  const win = new BrowserWindow({
    width,
    height,
    minWidth: 380,
    minHeight: 420,
    ...(parentBounds
      ? { x: Math.round(parentBounds.x + (parentBounds.width - width) / 2), y: Math.round(parentBounds.y + Math.max(0, (parentBounds.height - height) / 2)) }
      : {}),
    title: args.title || "Page",
    ...(args.icon ? { icon: args.icon } : {}),
    ...(args.parent && !args.parent.isDestroyed() ? { parent: args.parent } : {}),
    modal: false,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: dark ? themeColor.dark.bg : themeColor.light.bg,
    webPreferences: {
      session: pageSession(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  win.setMenuBarVisibility(false);
  windows.set(key, win);
  win.on("closed", () => {
    if (windows.get(key) === win) windows.delete(key);
  });
  // Keep the window named after the page, not after whatever the page's <title> says.
  win.on("page-title-updated", (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    openOutside(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (staysInPage(address, url)) return;
    event.preventDefault();
    openOutside(url);
  });
  win.webContents.on("will-redirect", (event, url) => {
    if (staysInPage(address, url)) return;
    event.preventDefault();
  });
  // The page's own window.close() (Ghostex closes a floating page once its answers are sent).
  win.webContents.on("did-finish-load", () => {
    if (!win.isVisible()) win.show();
  });
  win.once("ready-to-show", () => win.show());
  void win.loadURL(address).catch(() => {
    if (!win.isDestroyed()) win.show();
  });
}

/** A page was answered: its window closes a moment later, as Ghostex's floating page window does. */
export function pageAnswered(appId: string, pageId: string): void {
  const win = windows.get(`${appId}/${pageId}`);
  if (!win || win.isDestroyed()) return;
  setTimeout(() => {
    if (!win.isDestroyed()) win.close();
  }, 1200);
}

/** The page windows open now (for the screenshot run). */
export function openPageWindows(): BrowserWindow[] {
  return [...windows.values()].filter((w) => !w.isDestroyed());
}

/** Closes every page window of an app (the app was deleted), or all of them. */
export function closePageWindows(appId?: string): void {
  for (const [key, win] of windows) {
    if ((appId === undefined || key.startsWith(`${appId}/`)) && !win.isDestroyed()) win.close();
  }
}
