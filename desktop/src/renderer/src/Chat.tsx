// One app's chat on the desktop (COMPONENTS.md 10 to 12, bb's thread structure): the same rows,
// words and actions as the phone's chat. Everything that is not drawing (rows, tool titles,
// markdown, build card, state line, send/queue/stop, drafts, following new items) comes from the
// shared chat core in shared/chat; this file only draws it as DOM.
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowDown, ArrowUp, Brain, Check, ChevronDown, ChevronRight, CircleAlert, CircleCheck, CircleDashed, CircleDot, FilePen, FileText, Folder, Globe, ImagePlus, ListTodo, Lock, Package, RotateCcw, Search, Square, Terminal, Trash, X,
} from "lucide-react";
import type { App, ChatImage, ChatItem } from "../../shared/types.ts";
import {
  buildCard, buildRows, composerState, COMPOSER_MAX_LINES, describeApp, enterSends, fitWithin, Follower, IMAGE_TYPES, MAX_IMAGES, permissionView, planCount, plainToolTitle, REBUILD_SETTLE_MS, thoughtLabel, toolDetail, userNote, type Row,
} from "../../../../shared/chat/index.ts";
import { drafts, useChat } from "./chatStore.ts";
import { Markdown } from "./Markdown.tsx";
import { imageFiles, prepare, sentPicture, type Attachment } from "./pictures.ts";
import { AppIcon, Icon, Spinner, StateLine } from "./ui.tsx";

const api = window.anyapp;
/** COMPONENTS.md: tool detail blocks show at most 12 lines until "Show all". */
const DETAIL_MAX_LINES = 12;
/** A sent picture's long edge in the chat (no token). */
const PICTURE = 160;

const TOOL_GLYPHS: Record<string, LucideIcon> = {
  read: FileText,
  edit: FilePen,
  delete: Trash,
  move: Folder,
  search: Search,
  execute: Terminal,
  think: Brain,
  fetch: Globe,
  other: CircleDot,
};

export function ChatView({ app, icon, online, headerExtra }: { app: App; icon?: string; online: boolean; headerExtra?: ReactNode }) {
  const chat = useChat(app.id, online);
  const rows = useMemo(() => buildRows(chat.items, app), [chat.items, app]);
  const st = describeApp(app);

  // Stay on the newest item while the agent works, unless the reader scrolled up (shared Follower).
  const scroller = useRef<HTMLDivElement>(null);
  const [follower] = useState(() => new Follower());
  const [pinned, setPinned] = useState(true);
  const toBottom = (smooth = false) => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  const jump = () => {
    follower.jump();
    setPinned(true);
    toBottom(true);
  };
  useLayoutEffect(() => {
    if (follower.shouldFollow()) toBottom();
  }, [rows, follower]);
  // Opening another app starts at its newest item.
  useLayoutEffect(() => {
    follower.jump();
    setPinned(true);
    toBottom();
  }, [app.id, chat.loaded, follower]);

  // Pictures dropped anywhere on the chat go to the composer.
  const dropInto = useRef<((files: File[]) => void) | null>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <div
      className="chat-view"
      onDragOver={(e) => {
        if (!Array.from(e.dataTransfer.items).some((i) => i.kind === "file")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        dropInto.current?.(imageFiles(e.dataTransfer.files));
      }}
    >
      {dragging && (
        <div className="drop-veil">
          <Icon of={ImagePlus} size="lg" /> Drop pictures to send them
        </div>
      )}
      <header className="chat-head">
        <AppIcon icon={icon} small />
        <div className="chat-id">
          <div className="heading">{app.name}</div>
          <StateLine state={st.kind} text={st.label} />
        </div>
        {headerExtra}
      </header>
      <div className="chat-scroll-wrap">
        <div
          className="chat"
          ref={scroller}
          data-testid="chat-scroll"
          onScroll={(e) => {
            const el = e.currentTarget;
            if (follower.scrolled(el.scrollHeight - el.scrollTop - el.clientHeight)) setPinned(follower.pinned);
          }}
        >
          <div className="timeline">
            {!chat.loaded && chat.items.length === 0 ? (
              <div className="chat-loading">{chat.error ? <StateLine state="problem" text={chat.error} /> : <Spinner />}</div>
            ) : null}
            {rows.map((r) => (
              <ChatRow key={r.key} row={r} app={app} />
            ))}
          </div>
        </div>
        {!pinned && (
          <button className="jump" onClick={jump} data-testid="jump-to-latest">
            <Icon of={ArrowDown} size="sm" /> Jump to latest
          </button>
        )}
      </div>
      <Composer key={app.id} app={app} online={online} onSent={jump} registerDrop={(add) => (dropInto.current = add)} />
    </div>
  );
}

// ------------------------------------------------------------------ composer

function Composer({ app, online, onSent, registerDrop }: { app: App; online: boolean; onSent: () => void; registerDrop: (add: ((files: File[]) => void) | null) => void }) {
  const [text, setTextState] = useState(() => drafts.get(app.id));
  const setText = (v: string) => {
    setTextState(v);
    drafts.set(app.id, v);
  };
  // Pictures waiting to be sent, kept per app like the text.
  const [attached, setAttachedState] = useState<Attachment[]>(() => drafts.attachments(app.id));
  const attachedRef = useRef(attached);
  const setAttached = (list: Attachment[]) => {
    attachedRef.current = list;
    setAttachedState(list);
    drafts.setAttachments(app.id, list);
  };
  const [adding, setAdding] = useState(0);
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const state = composerState(app, text, { sending, stopping, online, images: attached.length });
  // A stop lasts until the turn really ends.
  useEffect(() => {
    if (app.status !== "working") setStopping(false);
  }, [app.status]);
  // Grow with the text up to six lines, then scroll (COMPONENTS.md, Composer).
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    const line = parseFloat(getComputedStyle(el).lineHeight) || 24;
    const pad = parseFloat(getComputedStyle(el).paddingTop) * 2;
    el.style.height = `${Math.min(el.scrollHeight, line * COMPOSER_MAX_LINES + pad)}px`;
  }, [text]);
  useEffect(() => {
    box.current?.focus();
  }, [app.id]);

  const addFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setError(null);
    const room = MAX_IMAGES - attachedRef.current.length;
    if (files.length > room) setError(`Send at most ${MAX_IMAGES} pictures at a time.`);
    const take = files.slice(0, Math.max(0, room));
    setAdding((n) => n + take.length);
    for (const file of take) {
      try {
        const a = await prepare(file);
        setAttached([...attachedRef.current, a]);
      } catch (e) {
        setError((e as Error).message || "That picture could not be added.");
      } finally {
        setAdding((n) => n - 1);
      }
    }
  };
  useEffect(() => {
    registerDrop((files) => void addFiles(files));
    return () => registerDrop(null);
  });

  const send = async () => {
    if (state.button === "stop" || !state.enabled || adding > 0) return;
    const message = text.trim();
    const images = attached.map(({ mimeType, data, width, height }) => ({ mimeType, data, width, height }));
    setSending(true);
    setError(null);
    const r = await api.sendMessage(app.id, message, images);
    setSending(false);
    if (!r.ok) return setError(r.error ?? "That didn't send. Try again.");
    setText("");
    setAttached([]);
    onSent();
  };
  const stop = async () => {
    setStopping(true);
    setError(null);
    const r = await api.cancelTurn(app.id);
    if (!r.ok) {
      setStopping(false);
      setError(r.error ?? "Couldn't stop it.");
    }
  };
  const isStop = state.button === "stop";
  const hasContent = text.trim().length > 0 || attached.length > 0;
  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        void (isStop ? stop() : send());
      }}
    >
      {error && <p className="label composer-note">{error}</p>}
      <div className="composer-box">
        {(attached.length > 0 || adding > 0) && (
          <div className="composer-thumbs">
            {attached.map((a) => (
              <div key={a.key} className="thumb" data-testid="composer-thumb">
                <img src={a.preview} alt="Picture to send" />
                <button type="button" className="thumb-x" aria-label="Remove picture" title="Remove picture" onClick={() => setAttached(attached.filter((x) => x.key !== a.key))}>
                  <Icon of={X} px={14} />
                </button>
              </div>
            ))}
            {adding > 0 && (
              <div className="thumb thumb-busy">
                <Spinner />
              </div>
            )}
          </div>
        )}
        <div className="composer-row">
          <button
            type="button"
            className="attach"
            aria-label="Add a picture"
            title="Add a picture (or paste one, or drop it here)"
            data-testid="composer-attach"
            disabled={attached.length >= MAX_IMAGES}
            onClick={() => picker.current?.click()}
          >
            <Icon of={ImagePlus} size="md" />
          </button>
          <input
            ref={picker}
            type="file"
            accept={IMAGE_TYPES.join(",")}
            multiple
            hidden
            onChange={(e) => {
              void addFiles(imageFiles(e.target.files));
              e.target.value = "";
            }}
          />
          <textarea
            ref={box}
            data-testid="composer-input"
            placeholder={state.placeholder}
            value={text}
            rows={1}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              // A pasted picture is added as one; pasted text goes in exactly as copied.
              const files = imageFiles(e.clipboardData.files);
              if (files.length === 0) return;
              if (!e.clipboardData.getData("text/plain")) e.preventDefault();
              void addFiles(files);
            }}
            onKeyDown={(e) => {
              if (enterSends(e.key, e.shiftKey, e.nativeEvent.isComposing)) {
                e.preventDefault();
                if (!isStop) void send();
              }
            }}
          />
          <button
            className={`send${isStop ? " stop" : hasContent ? " on" : ""}`}
            data-testid={isStop ? "composer-stop" : "composer-send"}
            type="submit"
            disabled={!state.enabled || adding > 0}
            aria-label={state.label}
            title={state.label}
          >
            {isStop ? stopping ? <Spinner /> : <Square className="ic" size={14} fill="currentColor" strokeWidth={0} aria-hidden /> : sending ? <Spinner /> : <Icon of={ArrowUp} size="md" />}
          </button>
        </div>
      </div>
      <p className="caption composer-hint">
        {state.button === "queue" ? "The agent is busy: this waits its turn. " : ""}Enter to send, Shift+Enter for a new line. Paste or drop pictures to add them.
      </p>
    </form>
  );
}

// ------------------------------------------------------------------ rows

const ChatRow = memo(function ChatRow({ row, app }: { row: Row; app: App }) {
  if (row.type === "working") return <WorkingRow label={row.label} />;
  if (row.type === "rebuild") return <RebuildRow app={app} />;
  if (row.type === "tools") return <ToolGroup row={row} />;
  const item = row.item;
  switch (item.kind) {
    case "user":
      return <UserMessage item={item} />;
    case "assistant":
      return item.text ? <Markdown text={item.text} /> : null;
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
      return (
        <div className="err-row row-type">
          <Icon of={CircleAlert} size="sm" />
          <span>{item.text}</span>
        </div>
      );
    default:
      return null;
  }
});

function UserMessage({ item }: { item: ChatItem }) {
  const note = userNote(item);
  const [resent, setResent] = useState(false);
  return (
    <div className="msg-user">
      {item.images?.length ? <Pictures appId={item.appId} images={item.images} /> : null}
      {item.text ? <div className="bubble">{item.text}</div> : null}
      {note && (
        <div className={`user-note caption is-${note.kind}`} data-testid={`user-note-${note.kind}`}>
          {note.kind === "queued" && <Spinner />}
          <span>{note.text}</span>
          {note.kind === "dropped" && item.text && (
            <button
              className="btn btn-text btn-sm"
              disabled={resent}
              onClick={async () => {
                setResent(true);
                const r = await api.sendMessage(item.appId, item.text ?? "");
                if (!r.ok) setResent(false);
              }}
            >
              {resent ? "Sent" : "Send again"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** The pictures sent with a message, above its bubble; a click shows one large. */
function Pictures({ appId, images }: { appId: string; images: ChatImage[] }) {
  const [shown, setShown] = useState<string | null>(null);
  const one = images.length === 1;
  return (
    <div className="msg-pictures" data-testid="message-pictures">
      {images.map((img) => (
        <SentPicture key={img.id} appId={appId} img={img} max={one ? PICTURE * 1.5 : PICTURE} onOpen={setShown} />
      ))}
      {shown && (
        <div className="lightbox" role="dialog" aria-label="Picture" onClick={() => setShown(null)}>
          <img src={shown} alt="Picture you sent" />
        </div>
      )}
    </div>
  );
}

function SentPicture({ appId, img, max, onOpen }: { appId: string; img: ChatImage; max: number; onOpen: (url: string) => void }) {
  const [url, setUrl] = useState<string | undefined>();
  useEffect(() => {
    let alive = true;
    void sentPicture(appId, img.id).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [appId, img.id]);
  const box = fitWithin(img.width ?? max, img.height ?? max, max);
  return (
    <button className="picture" style={{ width: box.width, height: box.height }} onClick={() => url && onOpen(url)} aria-label="Show the picture">
      {url ? <img src={url} alt="Picture you sent" /> : <Spinner />}
    </button>
  );
}

function ThoughtRow({ item }: { item: ChatItem }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="think row-type" onClick={() => item.text && setOpen(!open)}>
        {item.streaming ? <Spinner /> : <Icon of={open ? ChevronDown : ChevronRight} size="sm" />}
        {thoughtLabel(item)}
      </button>
      {open && item.text && <div className="think-body callout">{item.text}</div>}
    </>
  );
}

function ToolRow({ item }: { item: ChatItem }) {
  const [open, setOpen] = useState(false);
  const t = item.tool;
  if (!t) return null;
  const { inline, block } = toolDetail(t);
  const cls = t.status === "pending" ? "is-pending" : t.status === "in_progress" ? "is-running" : t.status === "failed" ? "is-failed" : "";
  return (
    <>
      <button className={`trow row-type ${cls}${block ? " can-open" : ""}`} onClick={() => block && setOpen(!open)} aria-expanded={block ? open : undefined}>
        <span className="tr-icon">
          <Icon of={TOOL_GLYPHS[t.kind] ?? CircleDot} size="sm" />
        </span>
        <span className="tr-title">{plainToolTitle(t)}</span>
        {inline && <span className="tr-detail">{inline}</span>}
        <span className="tr-status">{t.status === "in_progress" ? <Spinner /> : t.status === "completed" ? <Icon of={Check} size="sm" /> : t.status === "failed" ? <Icon of={X} size="sm" /> : null}</span>
      </button>
      {open && block && <DetailBlock text={block} failed={t.status === "failed"} />}
    </>
  );
}

function DetailBlock({ text, failed }: { text: string; failed?: boolean }) {
  const [all, setAll] = useState(false);
  const long = text.split("\n").length > DETAIL_MAX_LINES;
  return (
    <div className="tr-open-wrap">
      <div className={`tr-open${all ? " all" : ""}${failed ? " is-failed" : ""}`}>{text}</div>
      {long && !all && (
        <button className="btn btn-text btn-sm" onClick={() => setAll(true)}>
          Show all
        </button>
      )}
    </div>
  );
}

function ToolGroup({ row }: { row: Extract<Row, { type: "tools" }> }) {
  const [open, setOpen] = useState(false);
  // While any of them is still going, show every row (the live frontier stays open).
  if (row.active || open) {
    return (
      <>
        {open && (
          <button className="trow row-type" onClick={() => setOpen(false)} aria-expanded>
            <span className="tr-icon">
              <Icon of={ChevronDown} size="sm" />
            </span>
            <span className="tr-title">{row.summary}</span>
          </button>
        )}
        {row.items.map((i) => (
          <ToolRow key={i.id} item={i} />
        ))}
      </>
    );
  }
  return (
    <button className={`trow row-type${row.failed ? " is-failed" : ""}`} onClick={() => setOpen(true)} aria-expanded={false}>
      <span className="tr-icon">
        <Icon of={ChevronRight} size="sm" />
      </span>
      <span className="tr-title">{row.summary}</span>
      <span className="tr-status">{row.failed ? <Icon of={X} size="sm" /> : <Icon of={Check} size="sm" />}</span>
    </button>
  );
}

function PlanBox({ item }: { item: ChatItem }) {
  const plan = item.plan ?? [];
  return (
    <div className="plan">
      <div className="plan-head label">
        <Icon of={ListTodo} size="sm" /> Plan
        <span className="plan-count row-type">{planCount(item)}</span>
      </div>
      {plan.map((p, i) => (
        <div key={i} className={`plan-item row-type ${p.status === "completed" ? "is-done" : p.status === "in_progress" ? "is-active" : "is-pending"}`}>
          {p.status === "completed" ? <Icon of={CircleCheck} size="sm" /> : p.status === "in_progress" ? <Spinner /> : <Icon of={CircleDashed} size="sm" />}
          {p.content}
        </div>
      ))}
    </div>
  );
}

function PermissionCard({ item }: { item: ChatItem }) {
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const p = item.permission;
  if (!p) return null;
  const view = permissionView(p);
  if (view.answered) {
    return (
      <div className="trow row-type">
        <span className="tr-icon">
          <Icon of={Lock} size="sm" />
        </span>
        <span className="tr-title wrap">{view.line}</span>
      </div>
    );
  }
  const answer = async (optionId: string) => {
    setSending(optionId);
    setError(null);
    const r = await api.answerPermission(item.appId, p.requestId, optionId);
    if (!r.ok) {
      setSending(null);
      setError(r.error ?? "That didn't reach the agent. Try again.");
    }
  };
  const button = (o: { optionId: string; label: string }, kind: "primary" | "quiet") => (
    <button key={o.optionId} className={`btn btn-${kind} btn-sm`} disabled={!!sending} onClick={() => void answer(o.optionId)} data-testid={`permission-${o.optionId}`}>
      {sending === o.optionId ? <Spinner /> : null}
      {o.label}
    </button>
  );
  return (
    <div className="perm" data-testid="permission-card">
      <div className="perm-top">
        <span className="badge">
          <Icon of={Lock} size="md" />
        </span>
        <div>
          <div className="heading">{view.heading}</div>
          <div className="mono secondary">{view.title}</div>
        </div>
      </div>
      <div className="perm-actions">
        {view.reject && button(view.reject, "quiet")}
        {view.allow && button(view.allow, "primary")}
        {view.others.map((o) => button(o, "quiet"))}
      </div>
      {error && <p className="label problem-text">{error}</p>}
    </div>
  );
}

function BuildCard({ item, app }: { item: ChatItem; app: App }) {
  const [retrying, setRetrying] = useState(false);
  const card = buildCard(item, app, "pc");
  if (!card) return null;
  if (card.state === "older") {
    return (
      <div className="trow row-type">
        <span className="tr-icon">
          <Icon of={Package} size="sm" />
        </span>
        <span className="tr-title tertiary">{card.title}</span>
      </div>
    );
  }
  const badge = card.state === "ready" ? " ready" : card.state === "failed" ? " problem" : "";
  return (
    <div className="card build" data-testid={`build-${card.state}`}>
      <div className="build-top">
        <span className={`badge${badge}`}>
          <Icon of={card.state === "failed" ? CircleAlert : Package} size="md" />
        </span>
        <div className="grow">
          <div className="heading">{card.title}</div>
          <div className="build-sub row-type">{card.sub}</div>
        </div>
      </div>
      {card.state === "running" && (
        <div className="progress indeterminate">
          <span />
        </div>
      )}
      {card.state === "failed" && card.canRetry && (
        <div>
          <button
            className="btn btn-quiet btn-sm"
            disabled={retrying}
            data-testid="build-retry"
            onClick={async () => {
              setRetrying(true);
              const r = await api.rebuild(app.id);
              if (!r.ok) setRetrying(false);
            }}
          >
            {retrying ? <Spinner /> : <Icon of={RotateCcw} size="sm" />} {retrying ? "Building" : "Try again"}
          </button>
        </div>
      )}
    </div>
  );
}

function WorkingRow({ label }: { label: string }) {
  return (
    <div className="trow row-type">
      <span className="tr-icon">
        <Spinner />
      </span>
      <span className="tr-title">{label}</span>
    </div>
  );
}

/** No new version came out of the last turn: say so, and offer to build again. */
function RebuildRow({ app }: { app: App }) {
  const [sent, setSent] = useState(false);
  // Status turns "idle" a moment before a build or apk.ready arrives: wait until it is quiet.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(true), REBUILD_SETTLE_MS);
    return () => clearTimeout(timer);
  }, []);
  if (!settled) return null;
  return (
    <div className="trow row-type">
      <span className="tr-icon">
        <Icon of={Package} size="sm" />
      </span>
      <span className="tr-title">No new version this time.</span>
      <button
        className="btn btn-text btn-sm"
        disabled={sent}
        data-testid="rebuild"
        onClick={async () => {
          setSent(true);
          const r = await api.rebuild(app.id);
          if (!r.ok) setSent(false);
        }}
      >
        {sent ? "Building" : "Build it again"}
      </button>
    </div>
  );
}
