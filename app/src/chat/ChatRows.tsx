import { memo, useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import {
  Brain,
  Check,
  ChevronRight,
  File as FileIcon,
  FilePen,
  FolderInput,
  Globe,
  Hammer,
  ListChecks,
  Lock,
  Puzzle,
  Search,
  Smartphone,
  Square,
  SquareTerminal,
  Trash2,
  Wrench,
  X,
} from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { AnyAppNative } from "anyapp-native";
import { actionLabel } from "@/lib/describe";
import { installApp, launchApp } from "@/lib/installer";
import type { App, ChatItem, PlanEntry } from "@/lib/protocol";
import { appAction, useStore } from "@/lib/store";
import { AppIcon } from "@/ui/AppIcon";
import { Button } from "@/ui/Button";
import { Shine } from "@/ui/Shine";
import { T } from "@/ui/Text";
import { font, radius, type as typeScale, useTheme, space } from "@/ui/theme";
import { Markdown } from "./Markdown";
import { duration, seconds, summarizeTools, toolActive, type Row } from "./timeline";

const ROW_TEXT = { ...typeScale.sm, fontFamily: font.regular };

export const ChatRow = memo(function ChatRow({ row, app }: { row: Row; app: App | undefined }) {
  if (row.type === "working") return <WorkingRow label={row.label} />;
  if (row.type === "tools") return <ToolGroup items={row.items} />;
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
      return <PlanRow item={item} />;
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

// ---------- messages

function UserMessage({ item }: { item: ChatItem }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  return (
    <View style={{ alignItems: "flex-end", paddingLeft: space.huge }}>
      <View style={{ maxWidth: "100%", borderRadius: radius.xl, borderWidth: 1, borderColor: t.seam, backgroundColor: t.recessed, paddingHorizontal: space.lg, paddingVertical: space.sm }}>
        <T
          size="sm"
          selectable
          numberOfLines={open ? undefined : 15}
          onTextLayout={(e) => {
            if (!open && e.nativeEvent.lines.length >= 15) setLong(true);
          }}
        >
          {item.text}
        </T>
      </View>
      {long ? (
        <Pressable onPress={() => setOpen(!open)} hitSlop={8} style={{ marginTop: space.xs }}>
          <T size="xs" weight="medium" tone="muted">
            {open ? "Show less" : "Show more"}
          </T>
        </Pressable>
      ) : null}
    </View>
  );
}

function AssistantMessage({ item }: { item: ChatItem }) {
  if (!item.text) return null;
  return (
    <View style={{ paddingHorizontal: space.sm }}>
      <Markdown text={item.text} />
    </View>
  );
}

// ---------- disclosure rows (thinking, tools, plan updates): bb's 20px timeline rows

function DisclosureHeader({
  icon: Icon,
  children,
  open,
  onPress,
  dim,
  expandable = true,
  trailing,
}: {
  icon: LucideIcon;
  children: React.ReactNode;
  open: boolean;
  onPress?: () => void;
  dim?: boolean;
  expandable?: boolean;
  trailing?: React.ReactNode;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={expandable ? onPress : undefined}
      hitSlop={{ top: 8, bottom: 8 }}
      style={{ flexDirection: "row", alignItems: "center", minHeight: 28, paddingHorizontal: space.sm, gap: space.sm, opacity: dim && !open ? 0.45 : 1 }}
    >
      <Icon size={16} color={t.mutedForeground} strokeWidth={1.75} />
      <View style={{ flexShrink: 1, flexDirection: "row", alignItems: "center" }}>{children}</View>
      {trailing}
      {expandable ? (
        <View style={{ transform: [{ rotate: open ? "90deg" : "0deg" }], opacity: 0.6 }}>
          <ChevronRight size={14} color={t.subtleForeground} strokeWidth={2} />
        </View>
      ) : null}
    </Pressable>
  );
}

function ThoughtRow({ item }: { item: ChatItem }) {
  const t = useTheme();
  const live = !!item.streaming;
  const [toggled, setToggled] = useState<boolean | null>(null);
  // bb: live reasoning opens by itself and closes when done, unless the user chose.
  const open = toggled ?? live;
  const secs = seconds(item);
  return (
    <View>
      <DisclosureHeader icon={Brain} open={open} onPress={() => setToggled(!open)} dim={!live}>
        {live ? (
          <Shine style={{ ...ROW_TEXT, color: t.mutedForeground }}>Thinking…</Shine>
        ) : (
          <T size="sm" tone="muted">
            Thought
            {secs > 1 ? <T size="sm" tone="subtle">{`  ${duration(secs)}`}</T> : null}
          </T>
        )}
      </DisclosureHeader>
      {open && item.text ? (
        <ScrollView nestedScrollEnabled style={{ maxHeight: 220, marginLeft: space.lg, marginTop: space.xs }}>
          <View style={{ borderLeftWidth: 1, borderLeftColor: t.border, paddingLeft: space.md }}>
            <T size="sm" tone="muted">
              {item.text}
            </T>
          </View>
        </ScrollView>
      ) : null}
    </View>
  );
}

const TOOL_ICONS: Record<string, LucideIcon> = {
  read: FileIcon,
  edit: FilePen,
  delete: Trash2,
  move: FolderInput,
  search: Search,
  execute: SquareTerminal,
  think: Brain,
  fetch: Globe,
};

function ToolTitle({ item }: { item: ChatItem }) {
  const t = useTheme();
  const tool = item.tool;
  if (!tool) return null;
  if (toolActive(item)) {
    return (
      <Shine style={{ ...ROW_TEXT, color: t.mutedForeground }} active>
        {tool.title}
      </Shine>
    );
  }
  return (
    <T size="sm" tone="muted" numberOfLines={1}>
      {tool.title}
    </T>
  );
}

function ToolRow({ item, nested }: { item: ChatItem; nested?: boolean }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const tool = item.tool;
  if (!tool) return null;
  const failed = tool.status === "failed";
  return (
    <View>
      <DisclosureHeader
        icon={TOOL_ICONS[tool.kind] ?? Puzzle}
        open={open}
        onPress={() => setOpen(!open)}
        dim={!toolActive(item)}
        expandable={!!tool.detail}
        trailing={
          failed ? (
            <T mono style={{ fontSize: 12, color: t.destructiveText }}>
              error
            </T>
          ) : null
        }
      >
        <ToolTitle item={item} />
      </DisclosureHeader>
      {open && tool.detail ? <DetailCard text={tool.detail} indent={nested ? 0 : 8} /> : null}
    </View>
  );
}

function DetailCard({ text, indent = 8 }: { text: string; indent?: number }) {
  const t = useTheme();
  return (
    <View style={{ marginHorizontal: indent, marginTop: space.xs, marginBottom: space.xs, borderRadius: radius.lg, borderWidth: 1, borderColor: t.border, backgroundColor: t.card }}>
      <ScrollView nestedScrollEnabled style={{ maxHeight: 288 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <T mono selectable style={{ fontSize: 12, lineHeight: 17, color: t.foreground, opacity: 0.75, paddingHorizontal: space.md, paddingVertical: space.md }}>
            {text}
          </T>
        </ScrollView>
      </ScrollView>
    </View>
  );
}

function ToolGroup({ items }: { items: ChatItem[] }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const active = items.find(toolActive);
  const failed = items.filter((i) => i.tool?.status === "failed").length;
  return (
    <View>
      <DisclosureHeader
        icon={active ? (TOOL_ICONS[active.tool?.kind ?? ""] ?? Puzzle) : Wrench}
        open={open}
        onPress={() => setOpen(!open)}
        dim={!active}
        trailing={
          failed ? (
            <T mono style={{ fontSize: 12, color: t.subtleForeground, opacity: 0.75 }}>
              {failed} failed
            </T>
          ) : null
        }
      >
        {active ? <ToolTitle item={active} /> : <T size="sm" tone="muted" numberOfLines={1}>{summarizeTools(items)}</T>}
      </DisclosureHeader>
      {open ? (
        <View style={{ marginLeft: space.lg, marginTop: space.xs, marginBottom: space.xs, borderLeftWidth: 1, borderLeftColor: t.seam, paddingLeft: space.xs }}>
          {items.map((i) => (
            <ToolRow key={i.id} item={i} nested />
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ---------- plan

export function PlanEntries({ entries }: { entries: PlanEntry[] }) {
  const t = useTheme();
  return (
    <View style={{ gap: space.xs }}>
      {entries.map((e, i) => {
        const done = e.status === "completed";
        const now = e.status === "in_progress";
        return (
          <View
            key={i}
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              gap: space.sm,
              paddingHorizontal: space.sm,
              paddingVertical: now ? 5 : 3,
              borderRadius: radius.md,
              backgroundColor: now ? t.activeRow : "transparent",
            }}
          >
            <View style={{ paddingTop: space.xs }}>
              {done ? (
                <Check size={15} color={t.subtleForeground} strokeWidth={2} />
              ) : (
                <Square size={15} color={now ? t.foreground : t.mutedForeground} strokeWidth={1.75} style={{ opacity: now ? 1 : 0.45 }} />
              )}
            </View>
            {now ? (
              <Shine style={{ ...typeScale.sm, flex: 1, fontFamily: font.medium, color: t.foreground }}>{e.content}</Shine>
            ) : (
              <T
                size="sm"
                tone={done ? "subtle" : "muted"}
                style={{ flex: 1, textDecorationLine: done ? "line-through" : "none" }}
              >
                {e.content}
              </T>
            )}
          </View>
        );
      })}
    </View>
  );
}

function PlanRow({ item }: { item: ChatItem }) {
  const [open, setOpen] = useState(false);
  const entries = item.plan ?? [];
  const done = entries.filter((e) => e.status === "completed").length;
  return (
    <View>
      <DisclosureHeader icon={ListChecks} open={open} onPress={() => setOpen(!open)} dim>
        <T size="sm" tone="muted">
          Updated plan
          <T size="sm" tone="subtle">{`  ${done}/${entries.length}`}</T>
        </T>
      </DisclosureHeader>
      {open ? (
        <View style={{ marginTop: space.xs, marginLeft: space.sm }}>
          <PlanEntries entries={entries} />
        </View>
      ) : null}
    </View>
  );
}

// ---------- permission (bb's approval card)

function PermissionCard({ item }: { item: ChatItem }) {
  const t = useTheme();
  const client = useStore((s) => s.client);
  const [sending, setSending] = useState<string | null>(null);
  const p = item.permission;
  if (!p) return null;
  const chosen = p.options.find((o) => o.optionId === p.selectedOptionId);
  if (chosen) {
    const allowed = chosen.kind.startsWith("allow");
    return (
      <DisclosureHeader icon={Lock} open={false} expandable={false} dim>
        <T size="sm" tone="muted" numberOfLines={2}>
          {p.title}
          <T size="sm" tone="subtle">{`  ·  ${allowed ? "Allowed" : "Not allowed"}`}</T>
        </T>
      </DisclosureHeader>
    );
  }
  const answer = async (optionId: string) => {
    if (!client) return;
    setSending(optionId);
    try {
      await client.answerPermission(item.appId, { requestId: p.requestId, optionId });
    } catch {
      setSending(null);
    }
  };
  // bb order: deny on the left (ghost); allow-always (outline) and allow-once (filled) on the right.
  const rank = (kind: string) => (kind.startsWith("reject") ? 0 : kind === "allow_always" ? 1 : 2);
  const options = [...p.options].sort((a, b) => rank(a.kind) - rank(b.kind));
  return (
    <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: t.border, backgroundColor: t.recessed, overflow: "hidden" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 40, paddingHorizontal: space.md, borderBottomWidth: 1, borderBottomColor: t.border }}>
        <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: t.attentionSurface, alignItems: "center", justifyContent: "center" }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.attention }} />
        </View>
        <T size="xs" weight="medium">
          Your OK is needed
        </T>
      </View>
      <View style={{ paddingHorizontal: space.md, paddingTop: space.sm, paddingBottom: space.md }}>
        <Markdown text={p.title} size={15} />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.md }}>
          {options.map((o) => (
            <Button
              key={o.optionId}
              testID={`permission-${o.optionId}`}
              label={o.label}
              size="md"
              variant={o.kind.startsWith("reject") ? "ghost" : o.kind === "allow_always" ? "outline" : "primary"}
              busy={sending === o.optionId}
              disabled={!!sending && sending !== o.optionId}
              onPress={() => void answer(o.optionId)}
              style={{ flexGrow: o.kind.startsWith("reject") ? 0 : 1 }}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

// ---------- build (AnyAppAgent's own: progress, then "Your app is ready")

function BuildCard({ item, app }: { item: ChatItem; app: App | undefined }) {
  const t = useTheme();
  const b = item.build;
  const client = useStore((s) => s.client);
  const pkg = useStore((s) => (app ? s.packages[app.packageName] : undefined));
  const install = useStore((s) => (app ? s.installs[app.id] : undefined));
  const [showError, setShowError] = useState(false);
  if (!b) return null;

  const card = { borderRadius: radius.xl, borderWidth: 1, borderColor: t.border, backgroundColor: t.raised, padding: space.md } as const;

  if (b.status === "running") {
    return (
      <View style={card}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Hammer size={18} color={t.mutedForeground} strokeWidth={1.75} />
          <Shine style={{ ...typeScale.sm, fontFamily: font.medium, color: t.foreground, flex: 1 }}>Building your app…</Shine>
        </View>
        <T size="xs" tone="subtle" style={{ marginTop: space.xs, marginLeft: space.xxl }}>
          This takes a few minutes. You can leave, you’ll get a message.
        </T>
        <ProgressBar />
      </View>
    );
  }

  if (b.status === "failed") {
    return (
      <View style={card}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <X size={18} color={t.destructiveText} strokeWidth={2} />
          <T size="sm" weight="medium" style={{ flex: 1 }}>
            The app didn’t build
          </T>
        </View>
        {b.error ? (
          <Pressable onPress={() => setShowError(!showError)} style={{ marginTop: space.sm, marginLeft: space.xxl }}>
            <T size="xs" tone="muted" numberOfLines={showError ? undefined : 2}>
              {b.error}
            </T>
          </Pressable>
        ) : null}
        {app && client && app.status === "idle" ? (
          <Button label="Try again" variant="outline" size="md" style={{ marginTop: space.md }} onPress={() => void client.rebuild(app.id).catch(() => undefined)} />
        ) : null}
      </View>
    );
  }

  // Succeeded. Only the newest build gets the big card; older ones are a quiet line.
  const newest = app?.latestApk?.number === b.number;
  if (!app || !newest) {
    return (
      <DisclosureHeader icon={Smartphone} open={false} expandable={false} dim>
        <T size="sm" tone="muted">{`Version ${b.number} was ready`}</T>
      </DisclosureHeader>
    );
  }
  const action = appAction(app, pkg);
  const phase = install?.phase;
  const busy = phase === "waiting" || phase === "downloading" || phase === "checking" || phase === "installing" || phase === "confirm";
  const label = busy
    ? phase === "downloading"
      ? `Downloading ${Math.round((install?.progress ?? 0) * 100)}%`
      : "Installing…"
    : phase === "done"
      ? "Open"
      : actionLabel(action);
  return (
    <View testID="build-ready" style={card}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
        <AppIcon app={app} size={44} />
        <View style={{ flex: 1 }}>
          <T size="base" weight="semibold">
            {action === "open" || phase === "done" ? `${app.name} is on your phone` : "Your app is ready"}
          </T>
          <T size="xs" tone="subtle">
            {`Version ${b.number}${b.sizeBytes ? ` · ${formatSize(b.sizeBytes)}` : ""}`}
          </T>
        </View>
      </View>
      {phase === "failed" ? (
        <View style={{ marginTop: space.sm }}>
          <T size="xs" tone="destructive">
            {install?.message}
          </T>
          {install?.conflict ? (
            <Pressable onPress={() => AnyAppNative?.requestUninstall(app.packageName)}>
              <T size="xs" weight="semibold" tone="destructive" style={{ textDecorationLine: "underline", marginTop: space.xs }}>
                Remove the old one
              </T>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <Button
        testID="build-install"
        label={label}
        icon={Smartphone}
        size="lg"
        busy={busy}
        style={{ marginTop: space.md }}
        onPress={() => {
          if (action === "open" || phase === "done") launchApp(app);
          else void installApp(app);
        }}
      />
    </View>
  );
}

function formatSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function ProgressBar() {
  const t = useTheme();
  const [x, setX] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setX((v) => (v + 1) % 100), 30);
    return () => clearInterval(timer);
  }, []);
  return (
    <View style={{ height: 3, borderRadius: 2, backgroundColor: t.muted, overflow: "hidden", marginTop: space.md }}>
      <View style={{ position: "absolute", top: 0, bottom: 0, width: "30%", left: `${x * 1.3 - 30}%`, backgroundColor: t.foreground, borderRadius: 2, opacity: 0.6 }} />
    </View>
  );
}

// ---------- errors and the working line

function ErrorRow({ item }: { item: ChatItem }) {
  const t = useTheme();
  return (
    <View style={{ paddingHorizontal: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm }}>
        <T size="sm" tone="muted" style={{ flex: 1 }} selectable>
          {item.text}
        </T>
        <T mono style={{ fontSize: 12, color: t.destructiveText, marginTop: space.xxs }}>
          error
        </T>
      </View>
    </View>
  );
}

function WorkingRow({ label }: { label: string }) {
  const t = useTheme();
  return (
    <View style={{ minHeight: 28, paddingHorizontal: space.sm, justifyContent: "center", marginTop: space.sm }}>
      <Shine style={{ ...ROW_TEXT, color: t.mutedForeground }}>{label}</Shine>
    </View>
  );
}
