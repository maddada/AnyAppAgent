// One app's chat on the desktop (COMPONENTS.md 10 to 12, bb's thread structure): read what the
// agent is doing; sending a change from here is an extra (the phone is the main place).
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowUp, Brain, Mic, Square, Check, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, CircleDashed, CircleDot, FilePen, FileText, Folder, Globe, ListTodo, Lock, Package, Search, Terminal, Trash, X,
} from "lucide-react";
import type { App, ChatItem, HexCheck } from "../../shared/types.ts";
import { DICTATE_HOTKEY, HOLD_MS, insertAt, isDictateHotkey, useDictation } from "./dictation.ts";
import { AppIcon, Icon, Spinner, StateLine, appState } from "./ui.tsx";
import { plainToolTitle, summarizeTools } from "./chatText.ts";

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

export function ChatView({ app, icon, hex, onBack, onSetupHex }: { app: App; icon?: string; hex: HexCheck; onBack: () => void; onSetupHex: () => void }) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [text, setText] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const textNow = useRef(text);
  textNow.current = text;
  const dictation = useDictation({
    onText: (said) => {
      const el = box.current;
      const value = textNow.current;
      const focused = !!el && document.activeElement === el;
      const next = insertAt(value, focused ? el.selectionStart : value.length, focused ? el.selectionEnd : value.length, said);
      setText(next.value);
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(next.caret, next.caret);
      });
    },
  });
  // The box grows with what is in it (a dictation is often several lines), up to about six lines.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);
  const hexReady = hex.state === "ready";
  const dictate = () => {
    if (dictation.phase === "recording") return dictation.stop();
    if (dictation.phase !== "idle") return;
    if (!hexReady) {
      dictation.setError(hex.state === "checking" ? "Looking for Hex on this PC..." : hexProblem(hex));
      return;
    }
    void dictation.start();
  };
  // Ctrl+Alt+Space anywhere in this chat: tap to start and tap to stop, or hold and let go.
  // Escape cancels a recording.
  const press = useRef<{ at: number; started: boolean } | null>(null);
  const dictateNow = useRef(dictate);
  dictateNow.current = dictate;
  const phaseNow = useRef(dictation.phase);
  phaseNow.current = dictation.phase;
  const { cancel: cancelDictation, stop: stopDictation } = dictation;
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Escape" && (phaseNow.current === "recording" || phaseNow.current === "starting")) {
        e.preventDefault();
        cancelDictation();
        return;
      }
      if (!isDictateHotkey(e)) return;
      e.preventDefault();
      if (e.repeat) return;
      press.current = { at: Date.now(), started: phaseNow.current === "idle" };
      dictateNow.current();
    };
    const up = (e: KeyboardEvent) => {
      if (!press.current || (e.code !== "Space" && e.key !== "Control" && e.key !== "Alt")) return;
      const p = press.current;
      press.current = null;
      if (p.started && Date.now() - p.at >= HOLD_MS) stopDictation();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [cancelDictation, stopDictation]);
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
          {groupTools(items).map((g) => (Array.isArray(g) ? <ToolGroup key={g[0].id} items={g} app={app} /> : <Row key={g.id} item={g} app={app} />))}
        </div>
      </div>
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <div className={`composer-box${dictation.phase === "recording" ? " is-recording" : ""}`}>
          <textarea
            ref={box}
            placeholder={dictation.phase === "recording" ? "Listening. Stop when you're done." : dictation.phase === "transcribing" ? "Hex is writing it down..." : "Ask for a change"}
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
          {dictation.phase === "recording" && (
            <span className="dictate-meter mono" aria-hidden>
              <span className="dictate-dot" style={{ transform: `scale(${1 + dictation.level * 0.9})` }} />
              {`${Math.floor(dictation.seconds / 60)}:${String(dictation.seconds % 60).padStart(2, "0")}`}
            </span>
          )}
          <button
            type="button"
            className={`mic${dictation.phase === "recording" ? " is-recording" : ""}${!hexReady && hex.state !== "checking" ? " is-off" : ""}`}
            onClick={dictate}
            disabled={dictation.phase === "starting" || dictation.phase === "transcribing"}
            aria-label={dictation.phase === "recording" ? "Stop and write it down" : "Dictate with Hex"}
            title={dictation.phase === "recording" ? `Stop (${DICTATE_HOTKEY}). Esc cancels.` : hexReady ? `Dictate with Hex (${DICTATE_HOTKEY}). Tap to start and tap to stop, or hold and let go.` : hexProblem(hex)}
          >
            {dictation.phase === "transcribing" || dictation.phase === "starting" ? <Spinner /> : <Icon of={dictation.phase === "recording" ? Square : Mic} size="md" />}
          </button>
          <button className={`send${text.trim() ? " on" : ""}`} type="submit" disabled={!text.trim()} aria-label={busy ? "Queue this change" : "Send"}>
            <Icon of={ArrowUp} size="md" />
          </button>
        </div>
        {sendError && <p className="label composer-note">{sendError}</p>}
        {dictation.error && (
          <div className="label composer-note dictate-note">
            <span>{dictation.error}</span>
            {!hexReady && (
              <button type="button" className="btn btn-text label" onClick={onSetupHex}>
                Set up Hex
              </button>
            )}
            <button type="button" className="btn btn-icon" aria-label="Dismiss" onClick={() => dictation.setError(null)}>
              <Icon of={X} size="sm" />
            </button>
          </div>
        )}
      </form>
    </div>
  );
}

/** Why dictation can't start, in plain words. */
function hexProblem(hex: HexCheck): string {
  if (hex.state === "notInstalled") return "Dictation uses Hex, a free app that turns your voice into text on this PC. It isn't installed yet.";
  if (hex.state === "notRunning") return "Dictation needs Hex open. Open Hex, then try again.";
  if (hex.state === "noModels") return "Hex has no speech model yet. Open Hex and download one in its settings.";
  return hex.summary;
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
  return summarizeTools(items.flatMap((i) => (i.tool ? [i.tool] : [])));
}

function ToolGroup({ items, app }: { items: ChatItem[]; app: App }) {
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
      {open && items.map((i) => <Row key={i.id} item={i} app={app} />)}
    </>
  );
}

function Row({ item, app }: { item: ChatItem; app: App }) {
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
      const title = plainToolTitle(t);
      // The raw command line (or the path) shows only once the row is opened.
      const more = [t.detail, t.title.split("\n")[0].trim() !== title ? t.title : undefined].filter((x, i, a): x is string => !!x && a.indexOf(x) === i).join("\n");
      const cls = t.status === "pending" ? "is-pending" : t.status === "in_progress" ? "is-running" : t.status === "failed" ? "is-failed" : "";
      return (
        <>
          <button className={`trow row-type ${cls}`} onClick={() => more && setOpen(!open)}>
            <span className="tr-icon">
              <Icon of={TOOL_GLYPHS[t.kind] ?? CircleDot} size="sm" />
            </span>
            <span className="tr-title">{title}</span>
            <span className="tr-status">{t.status === "in_progress" ? <Spinner /> : t.status === "completed" ? <Icon of={Check} size="sm" /> : t.status === "failed" ? <Icon of={X} size="sm" /> : null}</span>
          </button>
          {open && more && <div className="tr-open">{more}</div>}
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
      // The build finishes before the companion saves it and announces it (apk.ready): only then
      // has it really gone to the phone.
      const sent = ready && (app.latestApk?.number ?? 0) >= (b?.number ?? Infinity);
      return (
        <div className="card build">
          <div className="build-top">
            <span className={`badge${ready ? " ready" : failed ? " problem" : ""}`}>
              <Icon of={failed ? CircleAlert : Package} size="md" />
            </span>
            <div>
              <div className="heading">{ready ? "Your app is ready" : failed ? `Version ${b?.number} didn't build` : `Building version ${b?.number ?? ""}`}</div>
              <div className="build-sub row-type">
                {ready ? `Version ${b?.number}${mb}. ${sent ? "Sent to your phone." : "Saving it and sending it to your phone…"}` : failed ? (b?.error ?? "Ask for a fix, or keep using the last version.") : (item.text ?? "Usually about two minutes")}
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
