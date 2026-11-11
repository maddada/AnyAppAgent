import { memo, useEffect, useState } from "react";
import { Animated, Easing, Modal, Pressable, View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import {
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleDot,
  Download,
  FilePen,
  FileText,
  Folder,
  Globe,
  ListTodo,
  Lock,
  Package,
  RotateCcw,
  Search,
  Smartphone,
  Terminal,
  Trash,
  X,
} from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { AnyAppNative } from "anyapp-native";
import { installApp, launchApp } from "@/lib/installer";
import type { App, ChatImage, ChatItem, PlanEntry } from "@/lib/protocol";
import { useStore } from "@/lib/store";
import { Button } from "@/ui/Button";
import { Spinner } from "@/ui/Spinner";
import { T } from "@/ui/Text";
import { easing, elevation, fonts, icon, motion, radius, size, space, typeStyle, useTheme, border } from "@/ui/theme";
import { buildCard, fitWithin, planCount, permissionView, plainToolTitle, REBUILD_SETTLE_MS, thoughtLabel, toolDetail, userNote, type Row } from "@shared/chat/index";
import { Markdown } from "./Markdown";

/** COMPONENTS.md: tool detail blocks are indented 28 and show at most 12 lines; the permission badge is 36. */
const DETAIL_INDENT = 28;
const DETAIL_MAX_LINES = 12;
const PERMISSION_BADGE = 36;
const ROW_LINE = typeStyle("row").lineHeight ?? icon.size.sm;
/** A sent picture's long edge in the chat (no token: about a third of the phone's width). */
const PICTURE = 120;

export const ChatRow = memo(function ChatRow({ row, app }: { row: Row; app: App | undefined }) {
  if (row.type === "working") return <WorkingRow label={row.label} />;
  if (row.type === "rebuild") return <RebuildRow app={app} />;
  if (row.type === "tools") return <ToolGroup row={row} />;
  const item = row.item;
  switch (item.kind) {
    case "user":
      return <UserMessage item={item} />;
    case "assistant":
      return <AssistantMessage item={item} />;
    case "thought":
      return <ThoughtRow item={item} />;
    case "tool":
      return <ToolRow item={item} />;
    case "plan":
      return <PlanBox item={item} />;
    case "permission":
      return <PermissionCard item={item} />;
    case "build":
      return <BuildCard item={item} app={app} />;
    case "error":
      return <ErrorRow item={item} />;
    default:
      return null;
  }
});

function Glyph({ icon: Icon, color }: { icon: LucideIcon; color: string }) {
  return <Icon size={icon.size.sm} color={color} strokeWidth={icon.stroke} absoluteStrokeWidth />;
}

// ---------- messages

function UserMessage({ item }: { item: ChatItem }) {
  const t = useTheme();
  const client = useStore((s) => s.client);
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  const [resent, setResent] = useState(false);
  const note = userNote(item);
  return (
    <View style={{ alignItems: "flex-end" }}>
      {item.images?.length ? <Pictures appId={item.appId} images={item.images} /> : null}
      {item.text ? (
      <View
        style={{
          maxWidth: `${size.bubbleMaxWidthPercent}%`,
          backgroundColor: t.bubbleBg,
          borderWidth: border.width,
          borderColor: t.bubbleBorder,
          borderTopLeftRadius: radius.bubble.topLeft,
          borderTopRightRadius: radius.bubble.topRight,
          borderBottomRightRadius: radius.bubble.bottomRight,
          borderBottomLeftRadius: radius.bubble.bottomLeft,
          paddingVertical: space.md,
          paddingHorizontal: space.lg,
        }}
      >
        <T
          variant="callout"
          color="bubbleText"
          selectable
          numberOfLines={open ? undefined : 15}
          onTextLayout={(e) => {
            if (!open && e.nativeEvent.lines.length >= 15) setLong(true);
          }}
        >
          {item.text}
        </T>
      </View>
      ) : null}
      {long ? <Button label={open ? "Show less" : "Show more"} variant="text" small onPress={() => setOpen(!open)} style={{ marginTop: space.xs }} /> : null}
      {note ? (
        <View testID={`user-note-${note.kind}`} style={{ flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.xs, paddingHorizontal: space.xs }}>
          {note.kind === "queued" ? <Spinner color={t.textTertiary} /> : null}
          <T variant="caption" color="textTertiary">
            {note.text}
          </T>
          {note.kind === "dropped" && client && item.text ? (
            <Button
              testID="send-again"
              label={resent ? "Sent" : "Send again"}
              variant="text"
              small
              disabled={resent}
              onPress={() => {
                setResent(true);
                void client.send(item.appId, { text: item.text ?? "" }).catch(() => setResent(false));
              }}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** The pictures sent with a message, above its bubble; a tap shows one full screen. */
function Pictures({ appId, images }: { appId: string; images: ChatImage[] }) {
  const t = useTheme();
  const client = useStore((s) => s.client);
  const [shown, setShown] = useState<ChatImage | null>(null);
  const screen = useWindowDimensions();
  if (!client) return null;
  const source = (img: ChatImage) => ({ uri: client.imageUrl(appId, img.id), headers: client.authHeaders(), cacheKey: `${appId}/${img.id}` });
  const one = images.length === 1;
  return (
    <View testID="message-pictures" style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: space.xs, marginBottom: space.xs, maxWidth: `${size.bubbleMaxWidthPercent}%` }}>
      {images.map((img) => {
        const box = fitWithin(img.width ?? PICTURE, img.height ?? PICTURE, one ? PICTURE * 1.5 : PICTURE);
        return (
          <Pressable key={img.id} accessibilityRole="imagebutton" accessibilityLabel="Picture you sent" onPress={() => setShown(img)}>
            <Image source={source(img)} style={{ width: box.width, height: box.height, borderRadius: radius.badge, backgroundColor: t.surfaceSunken, borderWidth: border.width, borderColor: t.bubbleBorder }} contentFit="cover" />
          </Pressable>
        );
      })}
      <Modal visible={!!shown} transparent animationType="fade" onRequestClose={() => setShown(null)}>
        <Pressable accessibilityLabel="Close the picture" onPress={() => setShown(null)} style={{ flex: 1, backgroundColor: t.scrim, alignItems: "center", justifyContent: "center", padding: space.lg }}>
          {shown ? <Image source={source(shown)} style={{ width: screen.width - space.lg * 2, height: screen.height * 0.8 }} contentFit="contain" /> : null}
        </Pressable>
      </Modal>
    </View>
  );
}

function AssistantMessage({ item }: { item: ChatItem }) {
  if (!item.text) return null;
  return (
    <View style={{ paddingHorizontal: space.xs }}>
      <Markdown text={item.text} />
    </View>
  );
}

// ---------- one-line rows (thinking, tools, folded tools, answered permission)

/** A row drawn at size.toolRowHeight with its hit area padded to size.touch (COMPONENTS.md, tool row). */
function LineRow({ children, onPress, testID }: { children: React.ReactNode; onPress?: () => void; testID?: string }) {
  const pad = (size.touch - size.toolRowHeight) / 2;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={!onPress}
      hitSlop={{ top: pad, bottom: pad }}
      style={{ minHeight: size.toolRowHeight, flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.xs }}
    >
      {children}
    </Pressable>
  );
}

function ThoughtRow({ item }: { item: ChatItem }) {
  const t = useTheme();
  const live = !!item.streaming;
  const [open, setOpen] = useState(false);
  return (
    <View>
      <LineRow onPress={item.text ? () => setOpen(!open) : undefined}>
        {live ? (
          <View style={{ width: icon.size.sm, alignItems: "center" }}>
            <Spinner color={t.textTertiary} />
          </View>
        ) : (
          <Glyph icon={open ? ChevronDown : ChevronRight} color={t.textTertiary} />
        )}
        <T variant="row" color="textTertiary">
          {thoughtLabel(item)}
        </T>
      </LineRow>
      {open && item.text ? (
        <View style={{ borderLeftWidth: 2, borderLeftColor: t.border, paddingLeft: space.md, marginLeft: space.sm, marginTop: space.xs }}>
          <T variant="callout" color="textSecondary">
            {item.text}
          </T>
        </View>
      ) : null}
    </View>
  );
}

const TOOL_GLYPHS: Record<string, LucideIcon> = {
  read: FileText,
  edit: FilePen,
  delete: Trash,
  move: Folder,
  search: Search,
  execute: Terminal,
  think: Brain,
  fetch: Globe,
};

function ToolRow({ item }: { item: ChatItem }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const tool = item.tool;
  if (!tool) return null;
  const { inline, block } = toolDetail(tool);
  const failed = tool.status === "failed";
  const titleColor = tool.status === "in_progress" ? "text" : tool.status === "pending" ? "textTertiary" : "textSecondary";
  return (
    <View>
      <LineRow onPress={block ? () => setOpen(!open) : undefined}>
        <Glyph icon={TOOL_GLYPHS[tool.kind] ?? CircleDot} color={t.textTertiary} />
        <View style={{ flex: 1, flexDirection: "row", alignItems: "baseline", gap: space.sm, overflow: "hidden" }}>
          <T variant="row" color={titleColor} numberOfLines={1} style={{ flexShrink: 1 }}>
            {plainToolTitle(tool)}
          </T>
          {inline ? (
            <T variant="mono" color={failed ? "problem" : "textTertiary"} numberOfLines={1}>
              {inline}
            </T>
          ) : null}
        </View>
        {tool.status === "in_progress" ? <Spinner color={t.working} /> : null}
        {tool.status === "completed" ? <Glyph icon={Check} color={t.textTertiary} /> : null}
        {failed ? <Glyph icon={X} color={t.problem} /> : null}
      </LineRow>
      {open && block ? <DetailBlock text={block} failed={failed} /> : null}
    </View>
  );
}

function DetailBlock({ text, failed }: { text: string; failed?: boolean }) {
  const t = useTheme();
  const [all, setAll] = useState(false);
  const [long, setLong] = useState(false);
  return (
    <View style={{ marginLeft: DETAIL_INDENT, marginTop: space.xs, marginBottom: space.xs }}>
      <View style={{ backgroundColor: t.codeBg, borderRadius: radius.badge, padding: space.md }}>
        <T
          variant="mono"
          color={failed ? "problem" : "textSecondary"}
          selectable
          numberOfLines={all ? undefined : DETAIL_MAX_LINES}
          onTextLayout={(e) => {
            if (!all && e.nativeEvent.lines.length >= DETAIL_MAX_LINES) setLong(true);
          }}
        >
          {text}
        </T>
      </View>
      {long && !all ? <Button label="Show all" variant="text" small onPress={() => setAll(true)} style={{ marginTop: space.xs }} /> : null}
    </View>
  );
}

/** A finished run of tool calls folds into one row ("Edited 2 files, ran 3 commands"). */
function ToolGroup({ row }: { row: Extract<Row, { type: "tools" }> }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const items = row.items;
  // While any of them is still going, show every row (the live frontier stays open).
  if (row.active || open) {
    return (
      <View>
        {open ? (
          <LineRow onPress={() => setOpen(false)}>
            <Glyph icon={ChevronDown} color={t.textTertiary} />
            <T variant="row" color="textSecondary" numberOfLines={1} style={{ flex: 1 }}>
              {row.summary}
            </T>
          </LineRow>
        ) : null}
        {items.map((i) => (
          <ToolRow key={i.id} item={i} />
        ))}
      </View>
    );
  }
  return (
    <LineRow onPress={() => setOpen(true)}>
      <Glyph icon={ChevronRight} color={t.textTertiary} />
      <T variant="row" color="textSecondary" numberOfLines={1} style={{ flex: 1 }}>
        {row.summary}
      </T>
      {row.failed ? <Glyph icon={X} color={t.problem} /> : <Glyph icon={Check} color={t.textTertiary} />}
    </LineRow>
  );
}

// ---------- plan

export function PlanEntries({ entries }: { entries: PlanEntry[] }) {
  const t = useTheme();
  return (
    <View style={{ gap: space.xs }}>
      {entries.map((e, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          {e.status === "completed" ? (
            <Glyph icon={CircleCheck} color={t.textTertiary} />
          ) : e.status === "in_progress" ? (
            <View style={{ width: icon.size.sm, alignItems: "center" }}>
              <Spinner color={t.working} />
            </View>
          ) : (
            <Glyph icon={CircleDashed} color={t.textTertiary} />
          )}
          <T
            variant="row"
            color={e.status === "completed" ? "textSecondary" : e.status === "in_progress" ? "text" : "textTertiary"}
            style={[{ flex: 1 }, e.status === "in_progress" ? { fontFamily: fonts.textMedium } : null]}
          >
            {e.content}
          </T>
        </View>
      ))}
    </View>
  );
}

function PlanBox({ item }: { item: ChatItem }) {
  const t = useTheme();
  const entries = item.plan ?? [];
  return (
    <View style={{ borderWidth: border.width, borderColor: t.border, borderRadius: radius.card, padding: space.md, gap: space.xs, marginHorizontal: space.xs }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, marginBottom: space.xs }}>
        <Glyph icon={ListTodo} color={t.textSecondary} />
        <T variant="label" color="textSecondary" style={{ flex: 1 }}>
          Plan
        </T>
        <T variant="row" color="textTertiary">{planCount(item)}</T>
      </View>
      <PlanEntries entries={entries} />
    </View>
  );
}

// ---------- permission

function PermissionCard({ item }: { item: ChatItem }) {
  const t = useTheme();
  const client = useStore((s) => s.client);
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const p = item.permission;
  if (!p) return null;
  const view = permissionView(p);
  if (view.answered) {
    return (
      <LineRow>
        <Glyph icon={Lock} color={t.textTertiary} />
        <T variant="row" color="textSecondary" numberOfLines={2} style={{ flex: 1 }}>
          {view.line}
        </T>
      </LineRow>
    );
  }
  const answer = async (optionId: string) => {
    if (!client) return;
    setSending(optionId);
    setError(null);
    try {
      await client.answerPermission(item.appId, { requestId: p.requestId, optionId });
    } catch (e) {
      setSending(null);
      setError(e instanceof Error ? e.message : "That didn't reach your PC. Try again.");
    }
  };
  const button = (o: { optionId: string; label: string }, variant: "primary" | "quiet", flex: boolean) => (
    <Button
      key={o.optionId}
      testID={`permission-${o.optionId}`}
      label={o.label}
      variant={variant}
      small
      style={flex ? { flex: 1 } : undefined}
      busy={sending === o.optionId}
      disabled={!!sending && sending !== o.optionId}
      onPress={() => void answer(o.optionId)}
    />
  );
  return (
    <View testID="permission-card" style={{ backgroundColor: t.surface, borderRadius: radius.card, borderWidth: border.width, borderColor: t.borderStrong, padding: space.lg, gap: space.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
        <View style={{ width: PERMISSION_BADGE, height: PERMISSION_BADGE, borderRadius: radius.badge, backgroundColor: t.surfaceSunken, alignItems: "center", justifyContent: "center" }}>
          <Glyph icon={Lock} color={t.textSecondary} />
        </View>
        <View style={{ flex: 1 }}>
          <T variant="heading">{view.heading}</T>
          <T variant="mono" color="textSecondary" selectable>
            {view.title}
          </T>
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: space.sm }}>
        {view.reject ? button(view.reject, "quiet", true) : null}
        {view.allow ? button(view.allow, "primary", true) : null}
      </View>
      {view.others.map((o) => button(o, "quiet", false))}
      {error ? (
        <T variant="caption" color="problem">
          {error}
        </T>
      ) : null}
    </View>
  );
}

// ---------- build

function Badge({ icon: Icon, fill, color }: { icon: LucideIcon; fill: string; color: string }) {
  return (
    <View style={{ width: size.badge, height: size.badge, borderRadius: radius.badge, backgroundColor: fill, alignItems: "center", justifyContent: "center" }}>
      <Icon size={icon.size.md} color={color} strokeWidth={icon.stroke} absoluteStrokeWidth />
    </View>
  );
}

function BuildCard({ item, app }: { item: ChatItem; app: App | undefined }) {
  const t = useTheme();
  const client = useStore((s) => s.client);
  const pkg = useStore((s) => (app ? s.packages[app.packageName] : undefined));
  const install = useStore((s) => (app ? s.installs[app.id] : undefined));
  const [retrying, setRetrying] = useState(false);
  // Words and state from shared/chat/build.ts, the same as on the desktop.
  const card = buildCard(item, app, "phone", pkg?.versionCode ?? null);
  if (!card) return null;

  if (card.state === "older" || !app) {
    return (
      <LineRow>
        <Glyph icon={Package} color={t.textTertiary} />
        <T variant="row" color="textTertiary">
          {card.title}
        </T>
      </LineRow>
    );
  }

  const box = {
    backgroundColor: t.surface,
    borderRadius: radius.card,
    borderWidth: border.width,
    borderColor: t.border,
    padding: space.lg,
    gap: space.lg,
    ...elevation(t.mode, 1),
  } as const;
  const head = (badge: React.ReactNode) => (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
      {badge}
      <View style={{ flex: 1 }}>
        <T variant="heading">{card.title}</T>
        <T variant="row" color="textSecondary" selectable={card.state === "failed"}>
          {card.sub}
        </T>
      </View>
    </View>
  );

  if (card.state === "running") {
    return (
      <View testID="build-running" style={box}>
        {head(<Badge icon={Package} fill={t.surfaceSunken} color={t.textSecondary} />)}
        <ProgressSweep />
      </View>
    );
  }

  if (card.state === "failed") {
    return (
      <View testID="build-failed" style={box}>
        {head(<Badge icon={CircleAlert} fill={t.problemSoft} color={t.problem} />)}
        {card.canRetry && client ? (
          <Button
            testID="build-retry"
            label={retrying ? "Building" : "Try again"}
            icon={RotateCcw}
            variant="quiet"
            busy={retrying}
            onPress={() => {
              setRetrying(true);
              void client.rebuild(app.id).catch(() => setRetrying(false));
            }}
          />
        ) : null}
      </View>
    );
  }

  const phase = install?.phase;
  const busy = phase === "waiting" || phase === "downloading" || phase === "checking" || phase === "installing" || phase === "confirm";
  const installed = card.installed || phase === "done";
  return (
    <View testID="build-ready" style={box}>
      {head(<Badge icon={Package} fill={t.readySoft} color={t.ready} />)}
      {phase === "failed" ? (
        <View style={{ gap: space.xs }}>
          <T variant="row" color="problem">
            {install?.message}
          </T>
          {install?.conflict ? <Button label="Remove the old one" variant="text" small onPress={() => AnyAppNative?.requestUninstall(app.packageName)} /> : null}
        </View>
      ) : null}
      {installed && !busy ? (
        <Button testID="build-install" label="Open" icon={Smartphone} variant="quiet" onPress={() => launchApp(app)} />
      ) : (
        <Button
          testID="build-install"
          label={busy ? (phase === "downloading" ? `Downloading ${Math.round((install?.progress ?? 0) * 100)}%` : "Installing") : "Install"}
          icon={Download}
          busy={busy}
          onPress={() => void installApp(app)}
        />
      )}
    </View>
  );
}

/** Indeterminate progress (COMPONENTS.md 8): a 32% segment sweeps across, looping. */
function ProgressSweep() {
  const t = useTheme();
  const [x] = useState(() => new Animated.Value(0));
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(x, { toValue: 1, duration: motion.duration.progressSweep, easing: Easing.bezier(...easing("standard")), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [x]);
  const segment = width * 0.32;
  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ height: size.progressHeight, borderRadius: radius.progress, backgroundColor: t.surfaceSunken, overflow: "hidden" }}
    >
      <Animated.View
        style={{
          width: segment,
          height: size.progressHeight,
          borderRadius: radius.progress,
          backgroundColor: t.working,
          transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [-segment, width] }) }],
        }}
      />
    </View>
  );
}

// ---------- errors and the working line

function ErrorRow({ item }: { item: ChatItem }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm, paddingHorizontal: space.xs }}>
      <View style={{ paddingTop: (ROW_LINE - icon.size.sm) / 2 }}>
        <Glyph icon={CircleAlert} color={t.problem} />
      </View>
      <T variant="row" color="textSecondary" style={{ flex: 1 }} selectable>
        {item.text}
      </T>
    </View>
  );
}

/** No new version came out of the last turn: say so, and offer to build again. */
function RebuildRow({ app }: { app: App | undefined }) {
  const t = useTheme();
  const client = useStore((s) => s.client);
  const [sent, setSent] = useState(false);
  // Status turns "idle" a moment before a build or apk.ready arrives: only say "no new version"
  // once things have been quiet for a few seconds.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(true), REBUILD_SETTLE_MS);
    return () => clearTimeout(timer);
  }, []);
  if (!app || !client || !settled) return null;
  return (
    <LineRow>
      <Glyph icon={Package} color={t.textTertiary} />
      <T variant="row" color="textSecondary" style={{ flex: 1 }}>
        No new version this time.
      </T>
      <Button
        testID="rebuild"
        label={sent ? "Building" : "Build it again"}
        variant="text"
        small
        disabled={sent}
        onPress={() => {
          setSent(true);
          void client.rebuild(app.id).catch(() => setSent(false));
        }}
      />
    </LineRow>
  );
}

function WorkingRow({ label }: { label: string }) {
  const t = useTheme();
  return (
    <LineRow>
      <View style={{ width: icon.size.sm, alignItems: "center" }}>
        <Spinner color={t.working} />
      </View>
      <T variant="row" color="textSecondary">
        {label}
      </T>
    </LineRow>
  );
}
