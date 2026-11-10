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
    void SystemUI.setBackgroundColorAsync(t.background);
  }, [t.background]);

  return (
    <SafeAreaProvider>
      <StatusBar style={t.dark ? "light" : "dark"} />
      <View style={{ flex: 1, backgroundColor: t.background }}>
        {ready ? (
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.background }, animation: "slide_from_right" }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="connect" options={{ animation: "fade" }} />
            <Stack.Screen name="chat/[id]" />
            <Stack.Screen name="settings" />
          </Stack>
        ) : null}
        <InstallPermissionSheet />
      </View>
    </SafeAreaProvider>
  );
}
