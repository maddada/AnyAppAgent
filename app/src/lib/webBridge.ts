// window.kiwimake (docs/WEB-APPS.md, "The Kiwimake bridge"): what Kiwimake's web screen injects
// into the person's own web app, before its scripts run, only while the page is at that app's own
// address. The page talks to Kiwimake with window.ReactNativeWebView.postMessage(JSON.stringify(
// { kiwimake: 1, type, id, ... })), type one of ai.status, ai.chat (with request), ai.cancel, close,
// openChat; Kiwimake answers with window.__kiwimakeReply(id, payload) (the status) and
// window.__kiwimakeEvent(id, event) (AI events, the last one done or error).

/** Whether `url` is inside the app: at its address (or the PC's path for it). */
export function insideApp(prefix: string, url: string): boolean {
  const u = url.toLowerCase();
  const p = prefix.toLowerCase();
  if (u.startsWith(p)) return true;
  // The address without its last "/" (GitHub Pages redirects it to the one with it).
  const bare = p.replace(/\/+$/, "");
  if (u === bare || u.startsWith(`${bare}?`) || u.startsWith(`${bare}#`)) return true;
  if (/^about:(blank|srcdoc)/.test(u)) return true;
  // The app's own blob: URLs (a file it made itself).
  return u.startsWith(`blob:${originOf(p)}/`);
}

/** "https://maddada.github.io" from any URL ("" when it has none). No URL class: React Native's is partial. */
export function originOf(url: string): string {
  const m = /^([a-z][a-z0-9+.-]*:\/\/[^/?#]*)/i.exec(url);
  return m ? m[1].toLowerCase() : "";
}

/** A JavaScript string literal (JSON's are valid JavaScript). */
const lit = (value: unknown) => JSON.stringify(value);

/**
 * The bridge itself. It does nothing when the page is not at `prefix`, and nothing twice (it runs
 * both before the content loads and after, in case Android ran the first one too early).
 */
export function bridgeScript(prefix: string, appId: string): string {
  return `(function () {
  try {
    var PREFIX = ${lit(prefix.toLowerCase())};
    var BARE = PREFIX.replace(/\\/+$/, "");
    var here = String(location.href).toLowerCase();
    if (window.kiwimake) return;
    if (here.indexOf(PREFIX) !== 0 && here !== BARE) return;
    var seq = 0;
    var replies = {};
    var listeners = {};
    var post = function (message) {
      var rn = window.ReactNativeWebView;
      if (!rn || typeof rn.postMessage !== "function") return false;
      message.kiwimake = 1;
      rn.postMessage(JSON.stringify(message));
      return true;
    };
    var nextId = function () {
      seq += 1;
      return "k" + seq + "-" + Date.now().toString(36);
    };
    window.__kiwimakeReply = function (id, payload) {
      var reply = replies[id];
      if (!reply) return;
      delete replies[id];
      reply(payload);
    };
    window.__kiwimakeEvent = function (id, event) {
      var listener = listeners[id];
      if (!listener) return;
      if (event && (event.type === "done" || event.type === "error")) delete listeners[id];
      try {
        listener(event);
      } catch (e) {
        setTimeout(function () { throw e; }, 0);
      }
    };
    var ai = Object.freeze({
      status: function () {
        return new Promise(function (resolve) {
          var id = nextId();
          var timer = setTimeout(function () {
            if (!replies[id]) return;
            delete replies[id];
            resolve({ ready: false, reason: "no_answer" });
          }, 10000);
          replies[id] = function (payload) {
            clearTimeout(timer);
            resolve(payload);
          };
          if (!post({ type: "ai.status", id: id })) {
            clearTimeout(timer);
            delete replies[id];
            resolve({ ready: false, reason: "not_set_up" });
          }
        });
      },
      chat: function (request, onEvent) {
        var id = nextId();
        listeners[id] = onEvent;
        if (!post({ type: "ai.chat", id: id, request: request })) {
          delete listeners[id];
          setTimeout(function () {
            onEvent({ type: "error", code: "not_set_up", message: "Open this in Kiwimake to use AI." });
          }, 0);
        }
        return Object.freeze({
          cancel: function () {
            if (listeners[id]) post({ type: "ai.cancel", id: id });
          },
        });
      },
    });
    var bridge = Object.freeze({
      version: 1,
      appId: ${lit(appId)},
      ai: ai,
      close: function () { post({ type: "close", id: nextId() }); },
      openChat: function () { post({ type: "openChat", id: nextId() }); },
    });
    Object.defineProperty(window, "kiwimake", { value: bridge, enumerable: true, configurable: false, writable: false });
    try {
      window.dispatchEvent(new Event("kiwimake:ready"));
    } catch (e) {}
  } catch (e) {}
})();
true;`;
}

/** Answers ai.status. */
export const replyScript = (id: string, payload: unknown) => `window.__kiwimakeReply && window.__kiwimakeReply(${lit(id)}, ${lit(payload)}); true;`;

/** One AI event for the call `id`. */
export const eventScript = (id: string, event: unknown) => `window.__kiwimakeEvent && window.__kiwimakeEvent(${lit(id)}, ${lit(event)}); true;`;

/** A newer version is live: the page's "Version N is ready" check runs at once. */
export const CHECK_UPDATE_SCRIPT = `try { window.dispatchEvent(new Event("kiwimake:check-update")); } catch (e) {} true;`;
