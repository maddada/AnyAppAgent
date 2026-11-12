import { useEffect, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, TextInput, View } from "react-native";
import { Redirect, useLocalSearchParams } from "expo-router";
import { Image } from "expo-image";
import * as Clipboard from "expo-clipboard";
import * as Device from "expo-device";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronDown, ClipboardPaste, QrCode, X } from "lucide-react-native";
import { cleanCode, EMULATOR_ADDRESS, parsePairingQr } from "@/lib/address";
import { looksLikeEasyConnect } from "@/lib/easyConnectCode";
import { pairWith, pairWithEasyConnect } from "@/lib/session";
import { useStore } from "@/lib/store";
import { Sheet, useKeyboardHeight } from "@/ui/Sheet";
import { Button, IconButton } from "@/ui/Button";
import { Field } from "@/ui/Field";
import { StateLine } from "@/ui/StateLine";
import { T } from "@/ui/Text";
import { icon, radius, size, space, typeStyle, useTheme } from "@/ui/theme";

const MARK = require("../../../shared/theme/mark/android/expo/icon.png");
/** The scanner's aiming square (no token: it frames the camera, not the UI). */
const SCAN_FRAME = 240;

/** True when the text is one of the two codes a PC can show. */
function isPairingText(text: string) {
  return looksLikeEasyConnect(text) || !!parsePairingQr(text);
}

export default function Connect() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();
  const onEmulator = Device.isDevice === false;
  // Deep link anyappagent://pair?... (see app/pair.tsx) arrives here as ?link=<the whole code>.
  const params = useLocalSearchParams<{ link?: string }>();
  const [address, setAddress] = useState(onEmulator ? EMULATOR_ADDRESS : "");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [otherWay, setOtherWay] = useState(false);
  const [linkPending, setLinkPending] = useState(!!params.link);
  const codeRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const paired = useStore((s) => !!s.pairing && !s.authLost);

  /** Either kind of code: Easy Connect (ANYAPP-EC1:...) or same network (anyappagent://pair?...). */
  const pairWithCode = async (text: string) => {
    setBusy(true);
    setError(null);
    setStep(null);
    try {
      if (looksLikeEasyConnect(text)) {
        await pairWithEasyConnect(text, setStep);
      } else {
        const found = parsePairingQr(text);
        if (!found) throw new Error("That isn't a Kiwimake code. On your PC, choose Connect a phone and use the code it shows.");
        setAddress(found.address);
        setCode(found.code);
        await pairWith(found.address, found.code, setStep);
      }
      setLinkPending(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLinkPending(false);
    } finally {
      setBusy(false);
      setStep(null);
    }
  };

  const connectSameNetwork = async () => {
    if (!address.trim() || code.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      await pairWith(address, code, setStep); // once paired, this screen redirects home by itself
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setStep(null);
    }
  };

  // The keyboard must never cover the Connect button: the screen shrinks by the keyboard's height
  // (below) and, with the typed fields open, scrolls so the fields and Connect sit above it.
  useEffect(() => {
    if (!otherWay || keyboard === 0) return;
    const timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(timer);
  }, [keyboard, otherWay, error, step]);

  const handled = useRef(false);
  useEffect(() => {
    if (params.link && !handled.current) {
      handled.current = true;
      void pairWithCode(String(params.link));
    }
  }, [params.link]);

  if (paired && !linkPending) return <Redirect href="/" />;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top, paddingBottom: keyboard }}>
    <ScrollView
      ref={scrollRef}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingTop: space["5xl"], paddingHorizontal: size.screenGutter, paddingBottom: (keyboard > 0 ? 0 : insets.bottom) + space["2xl"] }}
    >
      <Image source={MARK} style={{ width: size.appIcon, height: size.appIcon, borderRadius: radius.appIcon }} />
      <T variant="display" style={{ marginTop: space["2xl"] }}>
        Connect your PC
      </T>
      <T variant="lede" color="textSecondary" style={{ marginTop: space.md }}>
        On your PC, open Kiwimake and choose Connect a phone. Then scan the code it shows.
      </T>

      <Button
        testID="scan-qr"
        label="Scan the code"
        icon={QrCode}
        style={{ marginTop: space["3xl"] }}
        busy={busy && !otherWay}
        onPress={() => {
          setError(null);
          setScanning(true);
        }}
      />
      <Button
        testID="paste-code"
        label="Paste a code"
        icon={ClipboardPaste}
        variant="quiet"
        style={{ marginTop: space.sm }}
        disabled={busy}
        onPress={() => {
          setError(null);
          setPasting(true);
        }}
      />

      {step && !otherWay ? (
        <View testID="pair-step" style={{ marginTop: space.lg }}>
          <StateLine kind="working" label={`${step} This can take up to 20 seconds.`} lines={0} />
        </View>
      ) : null}
      {error && !otherWay ? <ErrorBox text={error} /> : null}

      <Pressable
        testID="connect-other-way"
        onPress={() => setOtherWay(!otherWay)}
        style={{ flexDirection: "row", alignItems: "center", alignSelf: "center", gap: space.xs, marginTop: space["2xl"], minHeight: size.touch }}
      >
        <T variant="button" style={{ textDecorationLine: "underline", textDecorationColor: t.borderStrong }}>
          Connect another way
        </T>
        <View style={{ transform: [{ rotate: otherWay ? "180deg" : "0deg" }] }}>
          <ChevronDown size={icon.size.sm} color={t.textSecondary} strokeWidth={icon.stroke} absoluteStrokeWidth />
        </View>
      </Pressable>

      {otherWay ? (
        <View style={{ marginTop: space.sm, gap: space.lg }}>
          <T variant="callout" color="textSecondary">
            On the same Wi-Fi, type the address and the 6-digit code your PC shows.
          </T>
          <Field
            testID="pair-address"
            label="Address"
            value={address}
            onChangeText={(v) => {
              setAddress(v);
              setError(null);
            }}
            placeholder="192.168.1.20:8787"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => codeRef.current?.focus()}
            help={onEmulator && address.trim() === EMULATOR_ADDRESS ? `This is an emulator, so your PC is at ${EMULATOR_ADDRESS}.` : undefined}
          />
          <Field
            testID="pair-code"
            ref={codeRef}
            label="Code"
            value={code}
            onChangeText={(v) => {
              setCode(cleanCode(v));
              setError(null);
            }}
            placeholder="000000"
            keyboardType="number-pad"
            maxLength={6}
            returnKeyType="done"
            onSubmitEditing={() => void connectSameNetwork()}
            inputStyle={{ ...typeStyle("titleSmall"), textAlign: "center", letterSpacing: space.sm }}
          />
          {error ? <ErrorBox text={error} /> : null}
          {step ? <StateLine kind="working" label={step} /> : null}
          <Button
            testID="pair-connect"
            label="Connect"
            variant="quiet"
            disabled={!address.trim() || code.length !== 6}
            busy={busy}
            onPress={() => void connectSameNetwork()}
          />
        </View>
      ) : null}

      <Scanner
        visible={scanning}
        onClose={() => setScanning(false)}
        onCode={(text) => {
          setScanning(false);
          void pairWithCode(text);
        }}
      />
      <PasteSheet
        visible={pasting}
        onClose={() => setPasting(false)}
        onCode={(text) => {
          setPasting(false);
          void pairWithCode(text);
        }}
      />
    </ScrollView>
    </View>
  );
}

function ErrorBox({ text }: { text: string }) {
  const t = useTheme();
  return (
    <View testID="pair-error" style={{ marginTop: space.lg, borderRadius: radius.card, backgroundColor: t.problemSoft, padding: space.md }}>
      <StateLine kind="problem" label={text} role="row" lines={0} />
    </View>
  );
}

/** "Paste a code": the Easy Connect text (or the same-network link) copied from the PC. */
function PasteSheet({ visible, onClose, onCode }: { visible: boolean; onClose: () => void; onCode: (text: string) => void }) {
  const [text, setText] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const ready = isPairingText(text);
  return (
    <Sheet visible={visible} onClose={onClose}>
      <T variant="titleSmall">Paste a code</T>
      <T variant="callout" color="textSecondary" style={{ marginTop: space.sm, marginBottom: space.xl }}>
        On your PC, copy the code under the QR code, then paste it here.
      </T>
      <Field
        testID="paste-input"
        value={text}
        onChangeText={(v) => {
          setText(v);
          setHint(null);
        }}
        placeholder="ANYAPP-EC1:…"
        autoCapitalize="characters"
        autoCorrect={false}
        multiline
        problem={hint}
        inputStyle={typeStyle("mono")}
      />
      <View style={{ flexDirection: "row", gap: space.sm, marginTop: space.xl }}>
        <Button
          testID="paste-from-clipboard"
          label="Paste"
          icon={ClipboardPaste}
          variant="quiet"
          style={{ flex: 1 }}
          onPress={async () => {
            const clip = (await Clipboard.getStringAsync().catch(() => "")).trim();
            if (clip) setText(clip);
            else setHint("There's nothing to paste. Copy the code on your PC first.");
          }}
        />
        <Button
          testID="paste-connect"
          label="Connect"
          style={{ flex: 1 }}
          disabled={!ready}
          onPress={() => {
            const value = text.trim();
            setText("");
            onCode(value);
          }}
        />
      </View>
    </Sheet>
  );
}

function Scanner({ visible, onClose, onCode }: { visible: boolean; onClose: () => void; onCode: (text: string) => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [hint, setHint] = useState<string | null>(null);
  const done = useRef(false);
  // The camera view is always dark; it uses the dark palette whatever the app's mode.
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} onShow={() => ((done.current = false), setHint(null))} statusBarTranslucent navigationBarTranslucent>
      <View style={{ flex: 1, backgroundColor: t.dark ? t.bg : t.text }}>
        {permission?.granted ? (
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={({ data }) => {
              if (done.current) return;
              if (isPairingText(data)) {
                done.current = true;
                onCode(data);
              } else {
                setHint("That's not the Kiwimake code. Scan the one your PC shows.");
              }
            }}
          />
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space["3xl"], gap: space.lg }}>
            <T variant="heading" color={t.dark ? "text" : "bg"} style={{ textAlign: "center" }}>
              Allow the camera to scan the code
            </T>
            <Button label="Allow camera" onPress={() => void requestPermission()} />
          </View>
        )}
        {permission?.granted ? (
          <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}>
            <View style={{ width: SCAN_FRAME, height: SCAN_FRAME, borderRadius: radius.sheet, borderWidth: 3, borderColor: t.dark ? t.text : t.bg }} />
            <T variant="body" color={t.dark ? "text" : "bg"} style={{ marginTop: space["2xl"], textAlign: "center", paddingHorizontal: space["3xl"] }}>
              {hint ?? "Point at the code on your PC"}
            </T>
          </View>
        ) : null}
        <View style={{ position: "absolute", top: insets.top + space.sm, left: space.sm, backgroundColor: t.scrim, borderRadius: radius.full }}>
          <IconButton icon={X} label="Close" color={t.dark ? t.text : t.bg} onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}
