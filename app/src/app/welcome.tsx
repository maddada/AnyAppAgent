// First run (docs/CLOUD.md, "The phone app"): where should apps be made? On my PC (today's
// pairing, no account), in the cloud (sign in, then connect GitHub), or sign in to an existing
// Kiwimake account. A phone can have both later; this only picks the first.
import { Pressable, ScrollView, View } from "react-native";
import { Redirect, router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronRight, Cloud, Monitor } from "lucide-react-native";
import { useStore } from "@/lib/store";
import { Button } from "@/ui/Button";
import { T } from "@/ui/Text";
import { BrandLockup } from "@/ui/Brand";
import { border, icon, radius, size, space, useTheme } from "@/ui/theme";


function Way({ icon: Icon, title, line, onPress, testID }: { icon: typeof Cloud; title: string; line: string; onPress: () => void; testID: string }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.lg,
        padding: space.lg,
        borderRadius: radius.card,
        borderWidth: border.width,
        borderColor: t.border,
        backgroundColor: pressed ? t.selectedBg : t.surface,
      })}
    >
      <Icon size={icon.size.lg} strokeWidth={1.75} color={t.accent} />
      <View style={{ flex: 1 }}>
        <T variant="heading">{title}</T>
        <T variant="caption" color="textSecondary" style={{ marginTop: space.hair }}>
          {line}
        </T>
      </View>
      <ChevronRight size={icon.size.md} strokeWidth={1.75} color={t.textTertiary} />
    </Pressable>
  );
}

export default function Welcome() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const done = useStore((s) => !!s.pairing || s.cloudAuth === "signedIn");
  if (done) return <Redirect href="/" />;
  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top }}>
      <ScrollView contentContainerStyle={{ paddingTop: space["5xl"], paddingHorizontal: size.screenGutter, paddingBottom: insets.bottom + space["2xl"] }}>
        <BrandLockup height={48} />
        <T variant="display" style={{ marginTop: space["2xl"] }}>
          Where should your apps be made?
        </T>
        <T variant="lede" color="textSecondary" style={{ marginTop: space.md }}>
          Kiwimake makes apps for this phone. Pick where the work happens. You can add the other one later.
        </T>
        <View style={{ gap: space.md, marginTop: space["3xl"] }}>
          <Way icon={Monitor} title="On my PC" line="Kiwimake runs on your computer with your own Claude. No account needed." onPress={() => router.push("/connect")} testID="way-pc" />
          <Way
            icon={Cloud}
            title="In the cloud"
            line="No computer needed. Sign in, connect GitHub, and start with free credits."
            onPress={() => router.push({ pathname: "/sign-in", params: { then: "cloud" } })}
            testID="way-cloud"
          />
        </View>
        <View style={{ alignItems: "flex-end", marginTop: space.xl }}>
          <Button label="Already have an account? Sign in" variant="text" onPress={() => router.push("/sign-in")} testID="way-sign-in" />
        </View>
      </ScrollView>
    </View>
  );
}
