// Ready apps, the gallery of official Kiwimake apps (docs/GALLERY.md): Install the signed APK (no PC
// needed), or Make it mine (the paired PC makes a separate own version from its published code).
import { useEffect } from "react";
import { AppState, RefreshControl, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X } from "lucide-react-native";
import { loadGallery, refreshInstalled, useGallery } from "@/lib/gallery";
import { IconButton } from "@/ui/Button";
import { GalleryCard } from "@/ui/Gallery";
import { StateLine } from "@/ui/StateLine";
import { T } from "@/ui/Text";
import { border, size, space, useTheme } from "@/ui/theme";

export default function Gallery() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const list = useGallery((s) => s.list);
  const loading = useGallery((s) => s.loading);
  const error = useGallery((s) => s.error);

  useEffect(() => {
    void loadGallery();
    // Back from Android's installer or uninstaller: what is on the phone may have changed.
    const sub = AppState.addEventListener("change", (status) => status === "active" && refreshInstalled());
    return () => sub.remove();
  }, []);

  const close = () => (router.canGoBack() ? router.back() : router.replace("/"));
  return (
    <View style={{ flex: 1, paddingTop: insets.top, paddingBottom: insets.bottom, backgroundColor: t.bg }}>
      <View style={{ flexDirection: "row", alignItems: "center", height: size.chatHeaderHeight, paddingLeft: space.xs, paddingRight: space.lg, gap: space.sm, borderBottomWidth: border.width, borderBottomColor: t.border }}>
        <IconButton testID="gallery-close" icon={X} label="Close" onPress={close} />
        <View style={{ flex: 1, marginLeft: space.xs }}>
          <T variant="heading" numberOfLines={1}>
            Ready apps
          </T>
          <T variant="caption" color="textSecondary" numberOfLines={1}>
            Made and checked by {list?.maker ?? "Kiwimake"}
          </T>
        </View>
      </View>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space["2xl"] }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => void loadGallery(true)} colors={[t.text]} progressBackgroundColor={t.surface} />}
      >
        <T variant="callout" color="textSecondary">
          Install one as it is, and its new versions reach you by themselves. Or make it yours: your PC makes your own copy that you change as you like.
        </T>
        {!list && loading ? <StateLine kind="working" label="Getting the list" role="row" /> : null}
        {!list && error ? <StateLine kind="problem" label={error} role="row" lines={0} /> : null}
        {list && list.apps.length === 0 ? <StateLine kind="idle" label="No ready apps yet. Check again soon." role="row" lines={0} /> : null}
        {list?.apps.map((app) => <GalleryCard key={app.package} app={app} />)}
      </ScrollView>
    </View>
  );
}
