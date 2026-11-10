import { useRef, useState } from "react";
import { Modal, Pressable, ScrollView, TextInput, View } from "react-native";
import { Redirect } from "expo-router";
import * as Device from "expo-device";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Laptop, QrCode, X } from "lucide-react-native";
import { cleanCode, EMULATOR_ADDRESS, parsePairingQr } from "@/lib/address";
import { pairWith } from "@/lib/session";
import { useStore } from "@/lib/store";
import { useKeyboardHeight } from "@/ui/Sheet";
import { Button, IconButton } from "@/ui/Button";
import { T } from "@/ui/Text";
import { font, radius, type as typeScale, useTheme, space } from "@/ui/theme";

export default function Connect() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();
  const onEmulator = Device.isDevice === false;
  const [address, setAddress] = useState(onEmulator ? EMULATOR_ADDRESS : "");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const codeRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const paired = useStore((s) => !!s.pairing && !s.authLost);

  const connect = async (addr = address, c = code) => {
    if (!addr.trim() || c.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      // Once paired, this screen redirects home by itself (see below).
      await pairWith(addr, c);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (paired) return <Redirect href="/" />;

  const field = {
    ...typeScale.lg,
    fontFamily: font.regular,
    color: t.foreground,
    backgroundColor: t.recessed,
    borderWidth: 1,
    borderColor: t.seam,
    borderRadius: radius.xl,
    paddingHorizontal: space.lg,
    height: 56,
  } as const;

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingTop: insets.top + 40, paddingHorizontal: space.xxl, paddingBottom: insets.bottom + 24 + keyboard }}
    >
      <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: t.primary, alignItems: "center", justifyContent: "center", marginBottom: space.xxl }}>
        <Laptop size={32} color={t.primaryForeground} strokeWidth={1.75} />
      </View>
      <T size="xxl" weight="semibold">
        Connect your PC
      </T>
      <T size="base" tone="muted" style={{ marginTop: space.sm }}>
        Start AnyAppAgent on your PC. It shows a code to scan, or an address and a 6-digit code to type here.
      </T>

      <Button
        testID="scan-qr"
        label="Scan the code"
        icon={QrCode}
        size="xl"
        style={{ marginTop: space.xxl }}
        onPress={() => {
          setError(null);
          setScanning(true);
        }}
      />

      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, marginVertical: space.xxl }}>
        <View style={{ flex: 1, height: 1, backgroundColor: t.border }} />
        <T size="xs" tone="subtle">
          or type it
        </T>
        <View style={{ flex: 1, height: 1, backgroundColor: t.border }} />
      </View>

      <T size="xs" weight="medium" tone="muted" style={{ marginBottom: space.sm }}>
        Address
      </T>
      <TextInput
        testID="pair-address"
        value={address}
        onChangeText={(v) => {
          setAddress(v);
          setError(null);
        }}
        placeholder="192.168.1.20:8787"
        placeholderTextColor={t.subtleForeground}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        returnKeyType="next"
        onSubmitEditing={() => codeRef.current?.focus()}
        style={field}
      />
      {onEmulator && address.trim() === EMULATOR_ADDRESS ? (
        <T size="xs" tone="subtle" style={{ marginTop: space.sm }}>
          This is an emulator, so your PC is at {EMULATOR_ADDRESS}.
        </T>
      ) : null}

      <T size="xs" weight="medium" tone="muted" style={{ marginTop: space.lg, marginBottom: space.sm }}>
        Code
      </T>
      <TextInput
        testID="pair-code"
        ref={codeRef}
        value={code}
        onChangeText={(v) => {
          setCode(cleanCode(v));
          setError(null);
        }}
        placeholder="000000"
        placeholderTextColor={t.subtleForeground}
        keyboardType="number-pad"
        maxLength={6}
        returnKeyType="done"
        onSubmitEditing={() => void connect()}
        style={[field, { fontFamily: font.semibold, fontSize: 26, letterSpacing: 10, textAlign: "center" }]}
      />

      {error ? (
        <View
          testID="pair-error"
          style={{ marginTop: space.lg, borderRadius: radius.lg, backgroundColor: t.destructiveSurface, borderWidth: 1, borderColor: t.destructiveSurface, padding: space.md }}
        >
          <T size="sm" tone="destructive">
            {error}
          </T>
        </View>
      ) : null}

      <Button
        testID="pair-connect"
        label="Connect"
        size="xl"
        style={{ marginTop: space.xl }}
        disabled={!address.trim() || code.length !== 6}
        busy={busy}
        onPress={() => void connect()}
      />

      <Scanner
        visible={scanning}
        onClose={() => setScanning(false)}
        onCode={(found) => {
          setScanning(false);
          setAddress(found.address);
          setCode(found.code);
          void connect(found.address, found.code);
        }}
      />
    </ScrollView>
  );
}

function Scanner({ visible, onClose, onCode }: { visible: boolean; onClose: () => void; onCode: (v: { address: string; code: string }) => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [hint, setHint] = useState<string | null>(null);
  const done = useRef(false);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} onShow={() => ((done.current = false), setHint(null))} statusBarTranslucent navigationBarTranslucent>
      <View style={{ flex: 1, backgroundColor: t.cameraBackdrop }}>
        {permission?.granted ? (
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={({ data }) => {
              if (done.current) return;
              const found = parsePairingQr(data);
              if (found) {
                done.current = true;
                onCode(found);
              } else {
                setHint("That's not the AnyAppAgent code. Scan the one your PC shows.");
              }
            }}
          />
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space.xxxl, gap: space.lg }}>
            <T size="lg" weight="semibold" style={{ color: t.onColor, textAlign: "center" }}>
              Allow the camera to scan the code
            </T>
            <Button label="Allow camera" size="lg" variant="secondary" onPress={() => void requestPermission()} />
          </View>
        )}
        {permission?.granted ? (
          <View pointerEvents="none" style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center" }}>
            <View style={{ width: 240, height: 240, borderRadius: 24, borderWidth: 3, borderColor: t.cameraFrame }} />
            <T size="base" weight="medium" style={{ color: t.onColor, marginTop: space.xxl, textAlign: "center", paddingHorizontal: space.xxxl }}>
              {hint ?? "Point at the code on your PC"}
            </T>
          </View>
        ) : null}
        <View style={{ position: "absolute", top: insets.top + 8, left: 8 }}>
          <Pressable style={{ backgroundColor: t.cameraButton, borderRadius: 24 }}>
            <IconButton icon={X} label="Close" color={t.onColor} onPress={onClose} size={48} />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
