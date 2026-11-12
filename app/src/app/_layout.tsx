import { useEffect } from "react";
import { View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { boot } from "@/lib/session";
import { useStore } from "@/lib/store";
import { useTheme } from "@/ui/theme";
import { InstallPermissionSheet } from "@/ui/InstallPermissionSheet";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { authStorage, convex } from "@/lib/cloud";
import { CloudBridge } from "@/lib/cloudSync";

/** With a cloud in this build, the whole app sits inside Convex Auth (sign-in, the account, cloud apps). */
function WithCloud({ children }: { children: React.ReactNode }) {
  if (!convex) return <>{children}</>;
  return (
    <ConvexAuthProvider client={convex} storage={authStorage}>
      <CloudBridge />
      {children}
    </ConvexAuthProvider>
  );
}

let booted = false;

export default function RootLayout() {
  const t = useTheme();
  const ready = useStore((s) => s.ready);

  useEffect(() => {
    if (!booted) {
      booted = true;
      void boot();
    }
  }, []);

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(t.bg);
  }, [t.bg]);

  return (
    <WithCloud>
    <SafeAreaProvider>
      <StatusBar style={t.dark ? "light" : "dark"} />
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        {ready ? (
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg }, animation: "slide_from_right" }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="connect" options={{ animation: "fade" }} />
            <Stack.Screen name="chat/[id]" />
            <Stack.Screen name="helper/[appId]/[workerId]" />
            <Stack.Screen name="page/[appId]/[pageId]" options={{ animation: "slide_from_bottom" }} />
            <Stack.Screen name="todo/[id]" />
            <Stack.Screen name="versions/[id]" />
            <Stack.Screen name="share/[id]" />
            <Stack.Screen name="like-this" options={{ animation: "slide_from_bottom" }} />
            <Stack.Screen name="change" options={{ animation: "slide_from_bottom" }} />
            <Stack.Screen name="suggestions/[id]" />
            <Stack.Screen name="settings" />
            <Stack.Screen name="pair" options={{ animation: "none" }} />
            <Stack.Screen name="welcome" options={{ animation: "fade" }} />
            <Stack.Screen name="sign-in" options={{ animation: "slide_from_bottom" }} />
            <Stack.Screen name="account" />
            <Stack.Screen name="github" />
            <Stack.Screen name="plan" />
          </Stack>
        ) : null}
        <InstallPermissionSheet />
      </View>
    </SafeAreaProvider>
    </WithCloud>
  );
}
