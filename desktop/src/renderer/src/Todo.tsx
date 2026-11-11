// The person's own to-do list for an app (shared/protocol.ts "To-do"): ideas to change later.
// Kept by the companion, the same list as on the phone; the app's agent never sees it. Very basic:
// add a line, tick it off, remove it, or send it to the chat as a message (it is ticked off then).
import { useEffect, useState } from "react";
import { Circle, CircleCheck, Plus, SendHorizontal, Trash2, X } from "lucide-react";
import type { App, TodoItem } from "../../shared/types.ts";
import { Icon, StateLine } from "./ui.tsx";

const api = window.anyapp;

/** Live to-do list of one app: loaded once, then kept current by the companion's socket. */
function useTodos(appId: string, online: boolean): { todos: TodoItem[]; loaded: boolean } {
  const [state, setState] = useState<{ appId: string; todos: TodoItem[]; loaded: boolean }>({ appId, todos: [], loaded: false });
  useEffect(() => {
    let live = true;
    const off = api.onTodos((id, todos) => {
      if (id === appId) setState({ appId, todos, loaded: true });
    });
    if (online) void api.getTodos(appId).then((todos) => live && setState({ appId, todos, loaded: true }));
    return () => {
      live = false;
      off();
    };
  }, [appId, online]);
  return state.appId === appId ? state : { todos: [], loaded: false };
}

export function TodoPanel({ app, online, onClose }: { app: App; online: boolean; onClose: () => void }) {
  const { todos, loaded } = useTodos(app.id, online);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const open = todos.filter((t) => !t.done);
  const done = todos.filter((t) => t.done);

  const run = async (key: string, action: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(key);
    setError(null);
    const r = await action();
    setBusy(null);
    if (!r.ok) setError(r.error ?? "That did not work. Try again.");
    return r.ok;
  };
  const add = async () => {
    const line = text.trim();
    if (!line) return;
    if (await run("add", () => api.addTodo(app.id, line))) setText("");
  };

  const row = (t: TodoItem) => (
    <li key={t.id} className={`todo-row${t.done ? " is-done" : ""}`} data-testid="todo-row">
      <button
        className="todo-tick"
        aria-label={t.done ? "Not done yet" : "Tick off"}
        title={t.done ? "Not done yet" : "Tick off"}
        disabled={!online}
        onClick={() => void run(t.id, () => api.setTodoDone(app.id, t.id, !t.done))}
      >
        <Icon of={t.done ? CircleCheck : Circle} size="md" />
      </button>
      <span className="todo-text">{t.text}</span>
      {t.sentAt ? <span className="caption todo-sent">Sent</span> : null}
      {!t.done ? (
        <button
          className="btn btn-quiet btn-sm todo-send"
          data-testid="todo-send"
          title="Send this to the agent as a message"
          disabled={!online || busy === t.id}
          onClick={() => void run(t.id, () => api.sendTodo(app.id, t.id))}
        >
          <Icon of={SendHorizontal} px={14} /> Send to agent
        </button>
      ) : null}
      <button className="btn btn-icon todo-remove" aria-label="Remove" title="Remove" disabled={!online} onClick={() => void run(t.id, () => api.removeTodo(app.id, t.id))}>
        <Icon of={Trash2} size="sm" />
      </button>
    </li>
  );

  return (
    <aside className="helper-chat helper-chat-beside todo-panel" data-testid="todo-panel" aria-label="To-do">
      <header className="chat-head">
        <div className="chat-id">
          <div className="heading">To-do</div>
          <span className="caption todo-sub">Only for you. The agent does not see it.</span>
        </div>
        <button className="btn btn-icon" aria-label="Close the to-do list" data-testid="todo-close" onClick={onClose}>
          <Icon of={X} size="md" />
        </button>
      </header>
      <form
        className="todo-add"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input className="field field-small" data-testid="todo-input" placeholder="Add an idea" value={text} maxLength={500} onChange={(e) => setText(e.target.value)} disabled={!online} />
        <button className="btn btn-primary btn-sm" type="submit" disabled={!online || !text.trim() || busy === "add"}>
          <Icon of={Plus} px={14} /> Add
        </button>
      </form>
      {error ? (
        <div className="helper-error">
          <StateLine state="problem" text={error} />
        </div>
      ) : null}
      <div className="todo-scroll">
        {loaded && todos.length === 0 ? (
          <div className="chat-empty todo-empty">
            <span className="label">Nothing here yet. Jot down what you want to change, then send it to the agent when you are ready.</span>
          </div>
        ) : null}
        <ul className="todo-list">{open.map(row)}</ul>
        {done.length ? (
          <>
            <div className="caption todo-done-head">Done</div>
            <ul className="todo-list">{done.map(row)}</ul>
          </>
        ) : null}
      </div>
    </aside>
  );
}
