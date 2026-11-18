// A web app (docs/WEB-APPS.md), full screen inside Kiwimake: its address in a WebView with service
// workers and storage on (it works offline after the first open), or, while it is not online, its
// newest build from the PC (POST /api/apps/:id/web/open). The person's own app at its own address
// gets the window.kiwimake bridge (src/lib/webBridge.ts): AI through Kiwimake's key, close and
// openChat. Any other link opens in the phone's browser. Android's back goes back in the page's
// own history first.
//
// Opened from a tile or a chat card (/web?app=<id>), or from a home screen shortcut:
//   anyappagent://web?app=<id>&url=<encoded address>&name=<encoded name>
// The address is trusted only from the PC's app list (or what this phone saved from it): a link's
// own url opens without the bridge.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, Linking, PanResponder, Pressable, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import type { ShouldStartLoadRequest, WebViewMessageEvent, WebViewNavigation } from "react-native-webview/lib/WebViewTypes";
import { ChevronLeft, ChevronUp, MessageCircle, RotateCw } from "lucide-react-native";
import { AnyAppAi } from "anyapp-ai";
import { ApiError } from "@/lib/api";
import { isCloudId } from "@/lib/cloud";
import { getState, useStore } from "@/lib/store";
import { isSiteAddress, knownWebApp, shortAddress, webAiKey, webAiLabel } from "@/lib/web";
import { bridgeScript, CHECK_UPDATE_SCRIPT, eventScript, insideApp, originOf, replyScript } from "@/lib/webBridge";
import { AppIcon } from "@/ui/AppIcon";
import { Button, IconButton } from "@/ui/Button";
import { Spinner } from "@/ui/Spinner";
import { T } from "@/ui/Text";
import { border, elevation, radius, size, space, useTheme } from "@/ui/theme";

/** What the screen loads: `url`, and everything under `prefix` stays inside. */
interface Target {
  url: string;
  prefix: string;
  bridge: boolean; // the person's own app at its own address (from the app list, or the PC)
  fromPc: boolean;
}

/** The thin handle above the app (a tap or a pull down shows Kiwimake's bar). */
const HANDLE = 18;
const HANDLE_PILL = { width: 36, height: 4 };
/** The bar hides by itself after this. */
const BAR_MS = 6000;
/** Waiting for the PC (a web app that is not online yet) gives up after this. */
const PC_WAIT_MS = 15000;

export default function WebScreen() {
  const params = useLocalSearchParams<{ app?: string; url?: string; name?: string }>();
  const appId = String(params.app ?? "");
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const app = useStore((s) => s.apps[appId]);
  const client = useStore((s) => s.client);
  const appsLoaded = useStore((s) => s.appsLoaded);
  const paired = useStore((s) => !!s.pairing);
  const liveBuild = app?.web?.liveBuild;
  const known = useMemo(() => knownWebApp(appId), [appId]);
  const name = app?.name ?? known?.name ?? (typeof params.name === "string" && params.name ? params.name : "Web app");
  const slug = app?.slug ?? known?.slug ?? null;

  const [pcTarget, setPcTarget] = useState<Target | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [mount, setMount] = useState(0);
  const [bar, setBar] = useState(false);

  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }, []);

  // ---------- what to load

  // Online: the address from the app list (once a version is live), or saved from it before.
  const listedAddress = app?.web?.address;
  const listedLive = !!app?.web?.liveBuild;
  const online = app ? (listedAddress && listedLive ? listedAddress : null) : (known?.address ?? null);
  // A shortcut's own address, from before this phone saved it: it opens, without the bridge.
  const linkUrl = !app && !online && typeof params.url === "string" && isSiteAddress(params.url) ? params.url : null;
  const fixedTarget = useMemo<Target | null>(
    () => (online ? { url: online, prefix: online, bridge: true, fromPc: false } : linkUrl ? { url: linkUrl, prefix: linkUrl, bridge: false, fromPc: false } : null),
    [online, linkUrl],
  );
  // Not online yet: the newest web build from the PC.
  const fromPc = !online && !!app && !!client && !isCloudId(appId);
  const target = fixedTarget ?? (fromPc ? pcTarget : null);
  const stuck = fixedTarget || fromPc ? null : app ? `${app.name} has no version yet.` : !paired || appsLoaded ? "This app is not in your app list." : null;
  const failure = problem ?? stuck;

  useEffect(() => {
    if (!fromPc || !client || pcTarget || problem) return;
    let cancelled = false;
    const name = getState().apps[appId]?.name ?? "This app";
    client
      .openWeb(appId)
      .then((answer) => {
        if (!cancelled) {
          const url = `${client.baseUrl.replace(/\/+$/, "")}${answer.path}`;
          setPcTarget({ url, prefix: url, bridge: true, fromPc: true });
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        // Its site exists but nothing is live there yet: try it anyway.
        const address = getState().apps[appId]?.web?.address;
        if (address) return setPcTarget({ url: address, prefix: address, bridge: true, fromPc: false });
        setProblem(
          e instanceof ApiError && e.unreachable
            ? `Can't reach your PC. ${name} is not online yet, so it opens from your PC.`
            : e instanceof ApiError && e.status === 404
              ? `${name} has no web version yet. Ask for a change in its chat and it builds one.`
              : e instanceof ApiError
                ? e.message
                : "It could not be opened.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [fromPc, client, appId, pcTarget, problem, attempt]);

  // Opened from a shortcut while the app list is still on its way: give up after a while.
  const waiting = !target && !failure;
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => setProblem("Can't reach your PC. Open it again when your PC is on."), PC_WAIT_MS);
    return () => clearTimeout(timer);
  }, [waiting, attempt]);

  const retry = () => {
    setProblem(null);
    setLoaded(false);
    setPcTarget(null);
    setAttempt((a) => a + 1);
  };
  const source = useMemo(() => (target ? { uri: target.url } : null), [target]);

  // ---------- the WebView: what stays inside, back, links outside

  const webview = useRef<WebView<object>>(null);
  const canGoBack = useRef(false);
  const currentUrl = useRef("");
  const lastOutside = useRef({ url: "", at: 0 });
  const inside = useCallback((url: string) => !!target && insideApp(target.prefix, url), [target]);

  const openOutside = useCallback((url: string) => {
    const now = Date.now();
    if (lastOutside.current.url === url && now - lastOutside.current.at < 3000) return;
    lastOutside.current = { url, at: now };
    if (/^(https?|mailto|tel|sms|geo|market|intent):/i.test(url)) void Linking.openURL(url).catch(() => undefined);
  }, []);

  const shouldStartLoad = useCallback(
    (request: ShouldStartLoadRequest): boolean => {
      // Frames inside the page (a map, a video) load as the page wants; only the page itself is held to its address.
      if (request.isTopFrame === false) return /^(https?|about|data|blob):/i.test(request.url);
      if (inside(request.url)) return true;
      openOutside(request.url);
      return false;
    },
    [inside, openOutside],
  );

  const onNavigation = useCallback(
    (nav: WebViewNavigation) => {
      canGoBack.current = nav.canGoBack;
      if (inside(nav.url)) currentUrl.current = nav.url;
    },
    [inside],
  );

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (bar) {
        setBar(false);
        return true;
      }
      if (canGoBack.current && webview.current) {
        webview.current.goBack();
        return true;
      }
      close();
      return true;
    });
    return () => sub.remove();
  }, [close, bar]);

  // ---------- the bridge: AI through Kiwimake's key, close, openChat

  const [screen] = useState(() => `w${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`);
  // Native call id -> the page's id, for the calls still running.
  const calls = useRef(new Map<string, string>());
  const aiKey = slug ? webAiKey(slug) : null;
  const aiLabel = webAiLabel(name);

  const inject = useCallback((script: string) => webview.current?.injectJavaScript(script), []);

  useEffect(() => {
    if (!AnyAppAi) return;
    const sub = AnyAppAi.addListener("onWebAiEvent", ({ id, json }) => {
      const pageId = calls.current.get(id);
      if (pageId === undefined) return;
      let event: { type?: string } & Record<string, unknown>;
      try {
        event = JSON.parse(json) as typeof event;
      } catch {
        return;
      }
      if (event.type === "done" || event.type === "error") calls.current.delete(id);
      if (target && insideApp(target.prefix, currentUrl.current)) inject(eventScript(pageId, event));
    });
    return () => sub.remove();
  }, [inject, target]);

  // Leaving the screen stops the answers still coming.
  useEffect(() => {
    const running = calls.current;
    return () => {
      if (aiKey) for (const id of running.keys()) AnyAppAi?.webCancel?.(aiKey, id);
      running.clear();
    };
  }, [aiKey]);

  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      if (!target?.bridge) return;
      // From the app's own origin, while the page is at its own address.
      const from = originOf(e.nativeEvent.url);
      if (from && from !== originOf(target.prefix)) return;
      if (!insideApp(target.prefix, currentUrl.current)) return;
      let m: { kiwimake?: unknown; type?: unknown; id?: unknown; request?: unknown };
      try {
        m = JSON.parse(e.nativeEvent.data) as typeof m;
      } catch {
        return;
      }
      if (!m || m.kiwimake !== 1 || typeof m.id !== "string" || m.id.length > 80) return;
      const pageId = m.id;
      const callId = `${screen}:${pageId}`;
      switch (m.type) {
        case "ai.status": {
          let status: unknown = { ready: false, reason: "not_set_up" };
          if (AnyAppAi?.webStatus && aiKey) {
            try {
              status = JSON.parse(AnyAppAi.webStatus(aiKey, aiLabel));
            } catch {
              // keep "not set up"
            }
          }
          inject(replyScript(pageId, status));
          return;
        }
        case "ai.chat": {
          if (!AnyAppAi?.webChat || !aiKey) {
            inject(eventScript(pageId, { type: "error", code: "not_set_up", message: "This Kiwimake can't give web apps AI yet. Update it." }));
            return;
          }
          if (!m.request || typeof m.request !== "object") {
            inject(eventScript(pageId, { type: "error", code: "bad_request", message: "The request was not valid." }));
            return;
          }
          calls.current.set(callId, pageId);
          try {
            AnyAppAi.webChat(aiKey, aiLabel, callId, JSON.stringify(m.request));
          } catch {
            calls.current.delete(callId);
            inject(eventScript(pageId, { type: "error", code: "internal", message: "Something went wrong in Kiwimake." }));
          }
          return;
        }
        case "ai.cancel":
          if (aiKey && calls.current.has(callId)) AnyAppAi?.webCancel?.(aiKey, callId);
          return;
        case "close":
          close();
          return;
        case "openChat":
          if (getState().apps[appId]) router.push(`/chat/${appId}`);
          return;
      }
    },
    [target, screen, aiKey, aiLabel, inject, close, appId],
  );

  // ---------- a newer version went live while it is open: the page's own notice shows at once

  const shownLive = useRef(liveBuild);
  useEffect(() => {
    const before = shownLive.current;
    shownLive.current = liveBuild;
    if (!loaded || !liveBuild || !before || liveBuild <= before) return;
    if (target && !target.fromPc && insideApp(target.prefix, currentUrl.current)) inject(CHECK_UPDATE_SCRIPT);
  }, [liveBuild, loaded, target, inject]);

  // ---------- Kiwimake's bar: hidden, a tap or a pull on the handle shows it

  useEffect(() => {
    if (!bar) return;
    const timer = setTimeout(() => setBar(false), BAR_MS);
    return () => clearTimeout(timer);
  }, [bar]);

  const [handlePan] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => g.dy > 4,
      onPanResponderRelease: (_e, g) => {
        if (g.dy > 8 || (Math.abs(g.dx) < 10 && Math.abs(g.dy) < 10)) setBar(true);
      },
    }),
  );

  const script = target?.bridge ? bridgeScript(target.prefix, appId) : undefined;
  const where = target ? (target.fromPc ? "From your PC" : shortAddress(target.prefix)) : "";

  return (
    <View style={{ flex: 1, paddingTop: insets.top, paddingBottom: insets.bottom, backgroundColor: t.bg }}>
      <View
        testID="web-handle"
        accessible
        accessibilityRole="button"
        accessibilityLabel="Show Kiwimake's bar"
        accessibilityActions={[{ name: "activate" }]}
        onAccessibilityAction={() => setBar(true)}
        {...handlePan.panHandlers}
        style={{ height: HANDLE, alignItems: "center", justifyContent: "center", backgroundColor: t.bg }}
      >
        <View style={{ ...HANDLE_PILL, borderRadius: radius.full, backgroundColor: t.borderStrong }} />
      </View>
      <View style={{ flex: 1 }}>
        {target && source && !failure ? (
          <WebView<object>
            key={`${attempt}-${mount}`}
            ref={webview}
            testID="web-webview"
            source={source ?? undefined}
            originWhitelist={["http://*", "https://*", "about:*", "blob:*"]}
            style={{ flex: 1, backgroundColor: t.bg }}
            javaScriptEnabled
            // Storage, the HTTP cache and service workers: the app works offline after the first open.
            domStorageEnabled
            cacheEnabled
            cacheMode="LOAD_DEFAULT"
            thirdPartyCookiesEnabled={false}
            sharedCookiesEnabled={false}
            allowFileAccess={false}
            allowFileAccessFromFileURLs={false}
            allowUniversalAccessFromFileURLs={false}
            allowsLinkPreview={false}
            mixedContentMode="never"
            geolocationEnabled={false}
            setSupportMultipleWindows
            overScrollMode="content"
            webviewDebuggingEnabled={__DEV__}
            injectedJavaScriptBeforeContentLoaded={script}
            injectedJavaScript={script}
            onMessage={target.bridge ? onMessage : undefined}
            onShouldStartLoadWithRequest={shouldStartLoad}
            onOpenWindow={(event) => {
              const url = event.nativeEvent.targetUrl;
              if (inside(url)) webview.current?.injectJavaScript(`location.href = ${JSON.stringify(url)}; true;`);
              else openOutside(url);
            }}
            onNavigationStateChange={onNavigation}
            onLoadStart={(event) => {
              // Android may start a load before onShouldStartLoadWithRequest has answered: stop
              // anything that is not the app and load the app again.
              if (!inside(event.nativeEvent.url)) {
                webview.current?.stopLoading();
                openOutside(event.nativeEvent.url);
                if (!insideApp(target.prefix, currentUrl.current)) setMount((m) => m + 1);
                return;
              }
              currentUrl.current = event.nativeEvent.url;
              canGoBack.current = event.nativeEvent.canGoBack;
            }}
            onLoadEnd={(event) => {
              canGoBack.current = event.nativeEvent.canGoBack;
              setLoaded(true);
            }}
            onError={(event) => {
              const { description, url } = event.nativeEvent;
              if (description.includes("ERR_ABORTED") || !inside(url)) return;
              setProblem(
                target.fromPc
                  ? "Can't reach your PC. Check that Kiwimake is running on it."
                  : `Can't open ${name} right now. Check the internet connection. Once it has opened, it works offline too.`,
              );
            }}
            onHttpError={(event) => {
              if (!inside(event.nativeEvent.url)) return;
              const status = event.nativeEvent.statusCode;
              setProblem(
                status === 404
                  ? target.fromPc
                    ? `This version of ${name} is not on your PC any more.`
                    : `${name} is not online yet. It usually takes a minute after a new version.`
                  : `The site answered with an error (${status}).`,
              );
            }}
            onRenderProcessGone={() => setMount((m) => m + 1)}
            renderError={() => <View style={{ flex: 1, backgroundColor: t.bg }} />}
          />
        ) : null}
        {failure ? (
          <View testID="web-failure" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "center", paddingHorizontal: space["2xl"], backgroundColor: t.bg }}>
            {/* Design rule (AGENTS.md): the words keep the full width; the buttons sit below them, on the right. */}
            <T variant="heading">{name}</T>
            <T variant="callout" color="textSecondary" style={{ marginTop: space.xs }}>
              {failure}
            </T>
            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: space.sm, marginTop: space.lg }}>
              <Button testID="web-close" label="Close" variant="quiet" small onPress={close} />
              <Button testID="web-retry" label="Try again" small onPress={retry} />
            </View>
          </View>
        ) : !loaded ? (
          <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: t.bg }}>
            <Spinner color={t.working} />
          </View>
        ) : null}
      </View>
      {bar ? (
        <View
          testID="web-bar"
          style={{
            position: "absolute",
            top: insets.top,
            left: 0,
            right: 0,
            minHeight: size.chatHeaderHeight,
            flexDirection: "row",
            alignItems: "center",
            paddingLeft: space.xs,
            paddingRight: space.xs,
            gap: space.xs,
            backgroundColor: t.surface,
            borderBottomWidth: border.width,
            borderBottomColor: t.border,
            ...elevation(t.mode, 2),
          }}
        >
          <IconButton testID="web-back" icon={ChevronLeft} label="Back to Kiwimake" onPress={close} />
          {app ? <AppIcon app={app} size={size.appIconSmall} /> : null}
          <Pressable style={{ flex: 1, marginLeft: space.xs }} onPress={() => setBar(false)} accessibilityLabel="Hide the bar">
            <T variant="heading" numberOfLines={1}>
              {name}
            </T>
            {where ? (
              <T variant="caption" color="textTertiary" numberOfLines={1}>
                {where}
              </T>
            ) : null}
          </Pressable>
          <IconButton
            testID="web-reload"
            icon={RotateCw}
            label="Reload"
            color={t.textSecondary}
            onPress={() => {
              setBar(false);
              if (failure) retry();
              else webview.current?.reload();
            }}
          />
          {app ? (
            <IconButton
              testID="web-chat"
              icon={MessageCircle}
              label={`Change ${name}`}
              color={t.textSecondary}
              onPress={() => {
                setBar(false);
                router.push(`/chat/${appId}`);
              }}
            />
          ) : null}
          <IconButton testID="web-hide-bar" icon={ChevronUp} label="Hide the bar" color={t.textSecondary} onPress={() => setBar(false)} />
        </View>
      ) : null}
    </View>
  );
}
