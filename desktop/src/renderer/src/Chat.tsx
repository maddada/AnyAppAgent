// One app's chat on the desktop (COMPONENTS.md 10 to 12, bb's thread structure): read what the
// agent is doing; sending a change from here is an extra (the phone is the main place).
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowUp, Brain, Check, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, CircleDashed, CircleDot, FilePen, FileText, Folder, Globe, ListTodo, Lock, Package, Search, Terminal, Trash, X,
} from "lucide-react";
import type { App, ChatItem } from "../../shared/types.ts";
import { AppIcon, Icon, Spinner, StateLine, appState } from "./ui.tsx";

const api = window.anyapp;

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

export function ChatView({ app, icon, onBack }: { app: App; icon?: string; onBack: () => void }) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [text, setText] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    let alive = true;
    void api.getMessages(app.id).then((list) => alive && setItems(list ?? []));
    const off = api.onChatItem((item) => {
      if (item.appId !== app.id) return;
      setItems((prev) => {
        const i = prev.findIndex((p) => p.id === item.id);
        if (i >= 0) {
          const next = [...prev];
          next[i] = item;
          return next;
        }
        return [...prev, item].sort((a, b) => a.seq - b.seq);
      });
    });
    return () => {
      alive = false;
      off();
    };
  }, [app.id]);
  useEffect(() => {
    if (stick.current) chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight });
  }, [items]);
  const st = appState(app);
  const busy = app.status === "working" || app.status === "building" || app.status === "creating";
  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    const r = await api.sendMessage(app.id, t);
    setSendError(r.ok ? null : (r.error ?? "Could not send."));
  };
  return (
    <div className="chat-view">
      <header className="chat-head">
        <button className="btn btn-icon" onClick={onBack} aria-label="Back to your apps">
          <Icon of={ChevronLeft} size="lg" />
        </button>
        <AppIcon icon={icon} small />
        <div className="chat-id">
          <div className="heading">{app.name}</div>
          <StateLine state={st.state} text={st.text} />
        </div>
      </header>
      <div
        className="chat"
        ref={chatRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        <div className="timeline">
          {items.length === 0 && <p className="callout tertiary">Nothing said yet.</p>}
          {groupTools(items).map((g) => (Array.isArray(g) ? <ToolGroup key={g[0].id} items={g} /> : <Row key={g.id} item={g} />))}
        </div>
      </div>
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <div className="composer-box">
          <textarea
            placeholder="Ask for a change"
            value={text}
            rows={1}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button className={`send${text.trim() ? " on" : ""}`} type="submit" disabled={!text.trim()} aria-label={busy ? "Queue this change" : "Send"}>
            <Icon of={ArrowUp} size="md" />
          </button>
        </div>
        {sendError && <p className="label composer-note">{sendError}</p>}
      </form>
    </div>
  );
}

/** Small, safe markdown: paragraphs, bullet lists, **strong**, `code`. Never HTML from the agent. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((part, j) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={j}>{part.slice(2, -2)}</strong>;
    if (/^`[^`]+`$/.test(part)) return <code key={j}>{part.slice(1, -1)}</code>;
    return part;
  });
}

function Prose({ text }: { text: string }) {
  // Paragraphs, with runs of "- " or "* " lines turned into lists (also right after a lead-in line).
  const out: ReactNode[] = [];
  text
    .trim()
    .split(/\n{2,}/)
    .forEach((block, i) => {
      let para: string[] = [];
      let list: string[] = [];
      const flush = (k: string) => {
        if (para.length)
          out.push(
            <p key={`p${k}`}>
              {para.map((l, j) => (
                <span key={j}>
                  {j > 0 && <br />}
                  {inline(l)}
                </span>
              ))}
            </p>,
          );
        if (list.length)
          out.push(
            <ul key={`u${k}`}>
              {list.map((l, j) => (
                <li key={j}>{inline(l)}</li>
              ))}
            </ul>,
          );
        para = [];
        list = [];
      };
      block.split("\n").forEach((line, j) => {
        const m = line.match(/^\s*[-*] (.*)$/);
        if (m) {
          if (para.length) flush(`${i}-${j}a`);
          list.push(m[1]);
        } else {
          if (list.length) flush(`${i}-${j}b`);
          para.push(line);
        }
      });
      flush(`${i}-end`);
    });
  return <div className="prose">{out}</div>;
}

/** Runs of three or more finished tool calls fold into one summary row (bb's completed-turn row). */
function groupTools(items: ChatItem[]): (ChatItem | ChatItem[])[] {
  const out: (ChatItem | ChatItem[])[] = [];
  let run: ChatItem[] = [];
  const flush = () => {
    if (run.length >= 3) out.push(run);
    else out.push(...run);
    run = [];
  };
  for (const item of items) {
    const finished = item.kind === "tool" && (item.tool?.status === "completed" || item.tool?.status === "failed");
    if (finished) run.push(item);
    else {
      flush();
      out.push(item);
    }
  }
  flush();
  return out;
}

function summary(items: ChatItem[]): string {
  const n = (kind: string) => items.filter((i) => i.tool?.kind === kind).length;
  const plural = (k: number, one: string, many: string) => (k === 1 ? one : many.replace("#", String(k)));
  const parts: string[] = [];
  const edits = n("edit") + n("delete") + n("move");
  if (edits) parts.push(plural(edits, "changed a file", "changed # files"));
  if (n("read")) parts.push(plural(n("read"), "read a file", "read # files"));
  if (n("execute")) parts.push(plural(n("execute"), "ran a command", "ran # commands"));
  if (n("search")) parts.push(plural(n("search"), "searched once", "searched # times"));
  const rest = items.length - edits - n("read") - n("execute") - n("search");
  if (rest > 0) parts.push(plural(rest, "one more step", "# more steps"));
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function ToolGroup({ items }: { items: ChatItem[] }) {
  const [open, setOpen] = useState(false);
  const failed = items.some((i) => i.tool?.status === "failed");
  return (
    <>
      <button className={`trow row-type${failed ? " is-failed" : ""}`} onClick={() => setOpen(!open)}>
        <span className="tr-icon">
          <Icon of={open ? ChevronDown : ChevronRight} size="sm" />
        </span>
        <span className="tr-title">{summary(items)}</span>
        <span className="tr-status">{failed ? <Icon of={X} size="sm" /> : <Icon of={Check} size="sm" />}</span>
      </button>
      {open && items.map((i) => <Row key={i.id} item={i} />)}
    </>
  );
}

function Row({ item }: { item: ChatItem }) {
  const [open, setOpen] = useState(false);
  switch (item.kind) {
    case "user":
      return (
        <div className="msg-user">
          <div className="bubble">{item.text}</div>
        </div>
      );
    case "assistant":
      return <Prose text={item.text ?? ""} />;
    case "thought":
      return (
        <>
          <button className="think row-type" onClick={() => setOpen(!open)}>
            {item.streaming ? <Spinner /> : <Icon of={open ? ChevronDown : ChevronRight} size="sm" />}
            {item.streaming ? "Thinking" : "Thought"}
          </button>
          {open && item.text && <div className="think-body callout">{item.text}</div>}
        </>
      );
    case "tool": {
      const t = item.tool;
      if (!t) return null;
      const title = t.title.split("\n")[0];
      const cls = t.status === "pending" ? "is-pending" : t.status === "in_progress" ? "is-running" : t.status === "failed" ? "is-failed" : "";
      return (
        <>
          <button className={`trow row-type ${cls}`} onClick={() => setOpen(!open)} title={t.title}>
            <span className="tr-icon">
              <Icon of={TOOL_GLYPHS[t.kind] ?? CircleDot} size="sm" />
            </span>
            <span className="tr-title">{title}</span>
            {t.detail && <span className="tr-detail">{t.detail.split("\n")[0]}</span>}
            <span className="tr-status">{t.status === "in_progress" ? <Spinner /> : t.status === "completed" ? <Icon of={Check} size="sm" /> : t.status === "failed" ? <Icon of={X} size="sm" /> : null}</span>
          </button>
          {open && (t.detail || t.title.includes("\n")) && <div className="tr-open">{t.detail ?? t.title}</div>}
        </>
      );
    }
    case "plan": {
      const plan = item.plan ?? [];
      const done = plan.filter((p) => p.status === "completed").length;
      return (
        <div className="plan">
          <div className="plan-head label">
            <Icon of={ListTodo} size="sm" /> Plan
            <span className="plan-count row-type">
              {done} of {plan.length} done
            </span>
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
    case "build": {
      const b = item.build;
      const ready = b?.status === "succeeded";
      const failed = b?.status === "failed";
      const mb = b?.sizeBytes && b.sizeBytes >= 1024 * 1024 ? `, ${Math.round(b.sizeBytes / 1024 / 1024)} MB` : "";
      return (
        <div className="card build">
          <div className="build-top">
            <span className={`badge${ready ? " ready" : failed ? " problem" : ""}`}>
              <Icon of={failed ? CircleAlert : Package} size="md" />
            </span>
            <div>
              <div className="heading">{ready ? "Your app is ready" : failed ? `Version ${b?.number} didn't build` : `Building version ${b?.number ?? ""}`}</div>
              <div className="build-sub row-type">
                {ready ? `Version ${b?.number}${mb}. Sent to your phone.` : failed ? (b?.error ?? "Ask for a fix, or keep using the last version.") : (item.text ?? "Usually about two minutes")}
              </div>
            </div>
          </div>
          {!ready && !failed && (
            <div className="progress indeterminate">
              <span />
            </div>
          )}
        </div>
      );
    }
    case "permission":
      return (
        <div className="perm">
          <span className="badge">
            <Icon of={Lock} size="md" />
          </span>
          <div>
            <div className="heading">{item.permission?.selectedOptionId ? "You answered" : "Allow this step?"}</div>
            <div className="mono secondary">{item.permission?.title}</div>
            {!item.permission?.selectedOptionId && <div className="label secondary">Answer it on your phone.</div>}
          </div>
        </div>
      );
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
}
