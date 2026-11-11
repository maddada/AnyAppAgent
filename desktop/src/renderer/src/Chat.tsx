// One app's chat on the desktop (COMPONENTS.md 10 to 12, bb's thread structure): the same rows,
// words and actions as the phone's chat. Everything that is not drawing (rows, tool titles,
// markdown, build card, state line, send/queue/stop, drafts, following new items) comes from the
// shared chat core in shared/chat; this file only draws it as DOM.
import { createContext, memo, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowDown, ArrowUp, Brain, Check, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, CircleDashed, CircleDot, Clock, FilePen, FileText, Folder, GitMerge, Globe, Hand, ImagePlus, ListTodo, Lock, MessageSquare, Package, Pen, RotateCcw, Search, Square, Terminal, Trash, X,
} from "lucide-react";
import type { App, ChatImage, ChatItem, WorkerInfo } from "../../shared/types.ts";
import {
  buildCard, buildRows, composerState, COMPOSER_MAX_LINES, describeApp, enterSends, fitWithin, Follower, HELPER_CHAT_FOOTER, helperChatRows, helperView, IMAGE_TYPES, mainChatReplying, MAX_IMAGES, permissionView, planCount, plainToolTitle, REBUILD_SETTLE_MS, thoughtLabel, toolDetail, userNote, type HelperIcon, type Row,
} from "../../../../shared/chat/index.ts";
import { drafts, useChat } from "./chatStore.ts";
import { useHelperChat, useHelpers } from "./helperStore.ts";
import { Markdown } from "./Markdown.tsx";
import { imageFiles, prepare, sentPicture, type Attachment } from "./pictures.ts";
import { AppIcon, Icon, Spinner, StateLine } from "./ui.tsx";
import { TodoPanel } from "./Todo.tsx";

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

/**
 * Where a helper's chat opens on the PC: beside the main chat, so the main chat stays in front of
 * you (the user's choice, Q8 in docs/APP-COORDINATOR.md). "replace" (as on the phone, with a way
 * back) is kept working behind this one constant.
 */
export const HELPER_CHAT_PLACEMENT: "beside" | "replace" = "beside";
/** Below this width of the chat area the two chats share it half and half, with tighter spacing. */
const ROOMY_WIDTH = 760;

/** Opening a helper's chat from its row, and which one is open (its row shows as selected). */
const HelperPanel = createContext<{ open: (workerId: string) => void; selected: string | null }>({ open: () => {}, selected: null });

export function ChatView({ app, icon, online, headerExtra, onHelperOpen }: { app: App; icon?: string; online: boolean; headerExtra?: ReactNode; onHelperOpen?: (open: boolean) => void }) {
  const helpers = useHelpers(app.id, online);
  // The open helper chat, per app (moving between apps keeps each one's choice for this run).
  const [openHelpers, setOpenHelpers] = useState<Record<string, string | null>>({});
  // The to-do list open beside the chat, per app (it and a helper's chat take turns on the side).
  const [todoOpen, setTodoOpen] = useState<Record<string, boolean>>({});
  const showTodo = !!todoOpen[app.id];
  const openId = showTodo ? null : (openHelpers[app.id] ?? null);
  const helper = openId ? helpers.find((w) => w.id === openId) : undefined;
  // How wide the chat area is decides how the two chats share it.
  const area = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);
  const placement = HELPER_CHAT_PLACEMENT;
  const narrow = width > 0 && width < ROOMY_WIDTH;
  // The window makes room for two chats while one is open beside the main chat (the app list folds).
  const open = (!!helper && placement === "beside") || showTodo;
  useEffect(() => {
    onHelperOpen?.(open);
  }, [open, onHelperOpen]);
  useEffect(() => () => onHelperOpen?.(false), [onHelperOpen]);
  const panel = useMemo(() => {
    const set = (workerId: string | null) => {
      setOpenHelpers((m) => ({ ...m, [app.id]: workerId }));
      if (workerId) setTodoOpen((m) => ({ ...m, [app.id]: false }));
    };
    return { open: (id: string) => set(openId === id && placement === "beside" ? null : id), close: () => set(null), selected: openId };
  }, [openId, app.id, placement]);
  const toggleTodo = () => setTodoOpen((m) => ({ ...m, [app.id]: !m[app.id] }));
  const todoButton = (
    <button className={`btn btn-quiet btn-sm todo-toggle${showTodo ? " is-on" : ""}`} data-testid="todo-toggle" aria-pressed={showTodo} onClick={toggleTodo}>
      <Icon of={ListTodo} px={14} /> To-do
      {app.openTodos ? <span className="todo-count" data-testid="todo-count">{app.openTodos}</span> : null}
    </button>
  );
  const side = showTodo ? (
    <TodoPanel app={app} online={online} onClose={toggleTodo} />
  ) : helper ? (
    <HelperChatView app={app} worker={helper} online={online} placement={placement} onClose={panel.close} />
  ) : null;
  return (
    <HelperPanel.Provider value={panel}>
      <div ref={area} className={side ? `chat-split chat-split-${placement}${narrow ? " is-narrow" : ""}` : "chat-single"}>
        {side && placement === "replace" ? null : <MainChat app={app} icon={icon} online={online} headerExtra={<>{todoButton}{headerExtra}</>} />}
        {side}
      </div>
    </HelperPanel.Provider>
  );
}

function MainChat({ app, icon, online, headerExtra }: { app: App; icon?: string; online: boolean; headerExtra?: ReactNode }) {
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
            {chat.loaded && rows.length === 0 ? (
              <div className="chat-empty" data-testid="chat-empty">
                <span className="heading">No messages yet</span>
                <span className="label">Ask for a change below, and the new version goes to your phone.</span>
              </div>
            ) : null}
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
  // A stop lasts until the main chat's turn really ends (with helpers the app can stay "working"
  // while only helpers work: they keep going, and the main chat's Stop is done).
  const replying = mainChatReplying(app);
  useEffect(() => {
    if (!replying) setStopping(false);
  }, [replying]);
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
        {state.button === "queue" ? <span className="keep">The agent is busy: this waits its turn. </span> : ""}
        <span className="keep">Enter to send, Shift+Enter for a new line.</span> <span className="keep">Paste or drop pictures to add them.</span>
      </p>
    </form>
  );
}

// ------------------------------------------------------------------ rows

const ChatRow = memo(function ChatRow({ row, app }: { row: Row; app: App }) {
  if (row.type === "working") return <WorkingRow label={row.label} />;
  if (row.type === "rebuild") return <RebuildRow app={app} />;
  if (row.type === "tools") return <ToolGroup row={row} />;
  if (row.type === "helper") return <HelperRow worker={row.worker} />;
  if (row.type === "stopped") return <StoppedRow label={row.label} />;
  if (row.type === "task") return <TaskCard label={row.label} text={row.text} />;
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

// ------------------------------------------------------------------ helpers

const HELPER_ICONS: Record<HelperIcon, LucideIcon> = { clock: Clock, pen: Pen, search: Search, merge: GitMerge, package: Package, check: Check, alert: CircleAlert, square: Square };

/** One helper in the main chat (the approved mockup): its task, a mark and a word, its latest line. */
function HelperRow({ worker }: { worker: WorkerInfo }) {
  const panel = useContext(HelperPanel);
  const view = helperView(worker);
  const selected = panel.selected === worker.id;
  return (
    <button
      className={`helper-row${selected ? " is-open" : ""}`}
      data-testid={`helper-row-${worker.id}`}
      aria-label={`${view.title}, ${view.state.label}. ${selected ? "Close" : "Open"} this helper's chat.`}
      aria-pressed={selected}
      onClick={() => panel.open(worker.id)}
    >
      <span className="helper-badge">
        <Icon of={HELPER_ICONS[view.icon]} px={18} />
      </span>
      <span className="helper-body">
        <span className="helper-title">{view.title}</span>
        <StateLine state={view.state.kind} text={view.state.label} />
        {view.latest ? <span className="helper-latest">{view.latest}</span> : null}
      </span>
      <span className="helper-chev">
        <Icon of={ChevronRight} px={18} />
      </span>
    </button>
  );
}

/** A plain line where the person stopped a turn. */
function StoppedRow({ label }: { label: string }) {
  return (
    <div className="trow row-type stopped-row" data-testid="stopped-line">
      <span className="tr-icon">
        <Icon of={Square} px={14} />
      </span>
      <span className="tr-title">{label}</span>
    </div>
  );
}

/** In a helper's chat: what the main chat asked it (its task, then follow-ups). */
function TaskCard({ label, text }: { label: string; text: string }) {
  return (
    <div className="helper-task" data-testid="helper-task">
      <span className="helper-task-label">
        <Icon of={Hand} px={14} /> {label}
      </span>
      <span className="helper-task-text">{text}</span>
    </div>
  );
}

/** A helper's own chat: read only, with its own Stop. Beside the main chat, or in its place. */
function HelperChatView({ app, worker, online, placement, onClose }: { app: App; worker: WorkerInfo; online: boolean; placement: "beside" | "replace"; onClose: () => void }) {
  const chat = useHelperChat(app.id, worker.id, online);
  const rows = useMemo(() => helperChatRows(chat.items, worker), [chat.items, worker]);
  const view = helperView(worker);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!view.active) setStopping(false);
  }, [view.active]);
  const scroller = useRef<HTMLDivElement>(null);
  const [follower] = useState(() => new Follower());
  useLayoutEffect(() => {
    if (follower.shouldFollow()) scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [rows, follower]);
  const stop = async () => {
    setStopping(true);
    setError(null);
    const r = await api.stopHelper(app.id, worker.id);
    if (!r.ok) {
      setStopping(false);
      setError(r.error ?? "Couldn't stop it.");
    }
  };
  return (
    <aside className={`helper-chat helper-chat-${placement}`} data-testid="helper-chat" aria-label={`Helper: ${view.title}`}>
      <header className="chat-head helper-head">
        {placement === "replace" ? (
          <button className="btn btn-icon" aria-label="Back to the main chat" onClick={onClose}>
            <Icon of={ChevronLeft} size="lg" />
          </button>
        ) : null}
        <div className="chat-id">
          <div className="heading">{view.title}</div>
          <StateLine state={view.state.kind} text={stopping ? "Stopping" : view.state.label} />
        </div>
        {view.active ? (
          <button className="btn btn-quiet btn-sm" data-testid="helper-stop" disabled={stopping} onClick={() => void stop()}>
            <Icon of={Square} px={14} /> {stopping ? "Stopping" : "Stop"}
          </button>
        ) : null}
        {placement === "beside" ? (
          <button className="btn btn-icon" aria-label="Close this helper's chat" data-testid="helper-close" onClick={onClose}>
            <Icon of={X} size="md" />
          </button>
        ) : null}
      </header>
      {error ? (
        <div className="helper-error">
          <StateLine state="problem" text={error} />
        </div>
      ) : null}
      <div
        className="chat helper-scroll"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          follower.scrolled(el.scrollHeight - el.scrollTop - el.clientHeight);
        }}
      >
        <div className="timeline">
          {!chat.loaded && chat.items.length === 0 ? <div className="chat-loading">{chat.error ? <StateLine state="problem" text={chat.error} /> : <Spinner />}</div> : null}
          {rows.map((r) => (
            <ChatRow key={r.key} row={r} app={app} />
          ))}
        </div>
      </div>
      <div className="helper-readonly" data-testid="helper-readonly">
        <Icon of={MessageSquare} size="sm" />
        <span>{HELPER_CHAT_FOOTER}</span>
      </div>
    </aside>
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
