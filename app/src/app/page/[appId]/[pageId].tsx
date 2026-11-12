// A page the agent published (shared/chat/pages.ts), full screen like Ghostex's page sheet: a bar
// with the title and a close button, and the page in a web view. The page is served by the PC at a
// signed address (POST /api/apps/:id/pages/:pageId/open), so it loads, reloads and sends its
// answers without the phone's token. It is sandboxed: no bridge to the app (no onMessage, nothing
// injected), no cookies or storage, and any link it holds opens in the browser instead.
import { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler, Linking, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import type { ShouldStartLoadRequest } from "react-native-webview/lib/WebViewTypes";
import { X } from "lucide-react-native";
import { pageCard, pageUrl, staysInPage } from "@shared/chat/index";
import { ApiError } from "@/lib/api";
import { useStore, useClientFor } from "@/lib/store";
import { Button, IconButton } from "@/ui/Button";
import { Spinner } from "@/ui/Spinner";
import { StateLine } from "@/ui/StateLine";
import { T } from "@/ui/Text";
import { border, size, space, useTheme } from "@/ui/theme";

/** How long the page stays open after its answers were sent, so its "Answered" note is seen. */
const CLOSE_AFTER_ANSWER_MS = 1000;

export default function PageScreen() {
  const params = useLocalSearchParams<{ appId: string; pageId: string }>();
  const appId = String(params.appId);
  const pageId = String(params.pageId);
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const client = useClientFor(appId);
  const page = useStore((s) => s.chats[appId]?.find((i) => i.kind === "page" && i.page?.id === pageId)?.page);
  const [address, setAddress] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const answeredAtOpen = useRef<string | undefined>(undefined);
  const opened = useRef(false);

  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(`/chat/${appId}`);
  }, [appId]);

  // A fresh signed address each time the screen opens (or Try again is pressed).
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    client
      .openPage(appId, pageId)
      .then((answer) => {
        if (!cancelled) setAddress(pageUrl(client.baseUrl, answer.path, t.dark ? "dark" : "light"));
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setLoading(false);
        setFailure(e instanceof ApiError ? e.message : "The page could not be opened.");
      });
    return () => {
      cancelled = true;
    };
    // The theme is read once per open: the page has its own light and dark switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, appId, pageId, attempt]);

  // Once the answers are sent (the chat item turns answered), the page closes by itself.
  useEffect(() => {
    if (!opened.current) {
      opened.current = true;
      answeredAtOpen.current = page?.answeredAt;
      return;
    }
    if (!page?.answeredAt || page.answeredAt === answeredAtOpen.current) return;
    const timer = setTimeout(close, CLOSE_AFTER_ANSWER_MS);
    return () => clearTimeout(timer);
  }, [page?.answeredAt, close]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, [close]);

  const webview = useRef<WebView<object>>(null);
  // Bumped to load the page again at its own address after a link tried to take the web view away.
  const [mount, setMount] = useState(0);
  const lastOutside = useRef({ url: "", at: 0 });
  const inPage = useCallback((url: string) => !address || staysInPage(address, url), [address]);

  /** A link the page holds opens in the phone's browser (once, however many callbacks report it). */
  const openOutside = useCallback((url: string) => {
    const now = Date.now();
    if (lastOutside.current.url === url && now - lastOutside.current.at < 3000) return;
    lastOutside.current = { url, at: now };
    if (/^https?:/i.test(url) || /^(mailto|tel):/i.test(url)) void Linking.openURL(url).catch(() => undefined);
  }, []);

  const shouldStartLoad = useCallback(
    (request: ShouldStartLoadRequest): boolean => {
      if (inPage(request.url)) return true;
      openOutside(request.url);
      return false;
    },
    [inPage, openOutside],
  );

  const title = page ? pageCard(page).title : "Page";
  return (
    <View style={{ flex: 1, paddingTop: insets.top, paddingBottom: insets.bottom, backgroundColor: t.bg }}>
      <View style={{ flexDirection: "row", alignItems: "center", minHeight: size.chatHeaderHeight, paddingLeft: space.lg, paddingRight: space.xs, gap: space.sm, borderBottomWidth: border.width, borderBottomColor: t.border }}>
        <View style={{ flex: 1 }}>
          <T variant="heading" numberOfLines={1}>
            {title}
          </T>
          <T variant="caption" color="textTertiary" numberOfLines={1}>
            {page ? pageCard(page).status : "Page from the agent"}
          </T>
        </View>
        <IconButton testID="page-close" icon={X} label="Close the page" onPress={close} />
      </View>
      <View style={{ flex: 1 }}>
        {address && !failure ? (
          <WebView<object>
            key={mount}
            ref={webview}
            testID="page-webview"
            source={{ uri: address }}
            originWhitelist={["http://*", "https://*"]}
            style={{ flex: 1, backgroundColor: t.bg }}
            javaScriptEnabled
            domStorageEnabled={false}
            thirdPartyCookiesEnabled={false}
            sharedCookiesEnabled={false}
            incognito
            cacheEnabled={false}
            setSupportMultipleWindows={false}
            allowFileAccess={false}
            allowsLinkPreview={false}
            mixedContentMode="never"
            geolocationEnabled={false}
            onShouldStartLoadWithRequest={shouldStartLoad}
            onLoadStart={(event) => {
              // Android may start a load before onShouldStartLoadWithRequest has answered: stop
              // anything that is not the page itself and load the page again.
              if (!inPage(event.nativeEvent.url)) {
                webview.current?.stopLoading();
                openOutside(event.nativeEvent.url);
                setMount((m) => m + 1);
                return;
              }
              setLoading(true);
            }}
            onLoadEnd={() => setLoading(false)}
            onError={(event) => {
              const { description, url } = event.nativeEvent;
              if (description.includes("ERR_ABORTED") || !inPage(url)) return;
              setFailure("The page could not be loaded from your PC.");
            }}
            onHttpError={(event) => inPage(event.nativeEvent.url) && setFailure(event.nativeEvent.statusCode === 404 ? "This page is not on your PC any more." : `Your PC answered with an error (${event.nativeEvent.statusCode}).`)}
            renderError={() => <View style={{ flex: 1, backgroundColor: t.bg }} />}
          />
        ) : null}
        {failure ? (
          <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", gap: space.md, paddingHorizontal: space["2xl"], backgroundColor: t.bg }}>
            <StateLine kind="problem" label={failure} role="row" lines={0} />
            <Button testID="page-retry" label="Try again" variant="quiet" small onPress={() => {
                setFailure(null);
                setLoading(true);
                setAddress(null);
                setAttempt((a) => a + 1);
              }} />
          </View>
        ) : loading ? (
          <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: t.bg }}>
            <Spinner color={t.working} />
          </View>
        ) : null}
      </View>
    </View>
  );
}
