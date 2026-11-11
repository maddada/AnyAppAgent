// The person's own to-do list for one app (shared/protocol.ts "To-do"): ideas to change later.
// Kept on the PC, the same list as on the desktop; the app's agent never sees it. Very basic: add a
// line, tick it off, remove it, or send it to the chat as a message (it is ticked off then).
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft, Circle, CircleCheck, Plus, SendHorizontal, Trash2 } from "lucide-react-native";
import type { TodoItem } from "@/lib/protocol";
import { setTodos, useStore } from "@/lib/store";
import { Button, IconButton } from "@/ui/Button";
import { Field } from "@/ui/Field";
import { Spinner } from "@/ui/Spinner";
import { StateLine } from "@/ui/StateLine";
import { T } from "@/ui/Text";
import { border, icon, size, space, useTheme } from "@/ui/theme";

export default function TodoScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const appId = String(params.id);
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const client = useStore((s) => s.client);
  const online = useStore((s) => s.connection === "online");
  const app = useStore((s) => s.apps[appId]);
  const todos = useStore((s) => s.todos[appId]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);

  // Loaded when opened (and again after a reconnect); changes then arrive over the socket.
  useEffect(() => {
    if (!client || !online) return;
    let live = true;
    client
      .todos(appId)
      .then((list) => live && setTodos(appId, list))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [client, online, appId]);

  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await action();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work. Try again.");
      return false;
    } finally {
      setBusy(null);
    }
  };
  const add = async () => {
    const line = text.trim();
    if (!line || !client) return;
    if (await run("add", () => client.addTodo(appId, line))) {
      setText("");
      input.current?.focus();
    }
  };

  const open = (todos ?? []).filter((x) => !x.done);
  const done = (todos ?? []).filter((x) => x.done);
  const row = (item: TodoItem) => (
    <TodoRow
      key={item.id}
      item={item}
      disabled={!online || !client}
      sending={busy === item.id}
      onTick={() => client && void run(item.id, () => client.setTodoDone(appId, item.id, !item.done))}
      onSend={() => client && void run(item.id, () => client.sendTodo(appId, item.id))}
      onRemove={() => client && void run(item.id, () => client.removeTodo(appId, item.id))}
    />
  );

  return (
    <View style={{ flex: 1, paddingTop: insets.top, paddingBottom: insets.bottom, backgroundColor: t.bg }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          height: size.chatHeaderHeight,
          paddingLeft: space.xs,
          paddingRight: space.lg,
          gap: space.sm,
          borderBottomWidth: border.width,
          borderBottomColor: t.border,
        }}
      >
        <IconButton testID="todo-back" icon={ChevronLeft} label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
        <View style={{ flex: 1, marginLeft: space.xs }}>
          <T variant="heading" numberOfLines={1}>
            To-do
          </T>
          <T variant="caption" color="textSecondary" numberOfLines={1}>
            {app?.name ?? ""}
          </T>
        </View>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: space["2xl"] }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.lg }}>
          <Field
            ref={input}
            testID="todo-input"
            containerStyle={{ flex: 1 }}
            placeholder="Add an idea"
            value={text}
            onChangeText={setText}
            maxLength={500}
            returnKeyType="done"
            submitBehavior="submit"
            onSubmitEditing={() => void add()}
            editable={online}
          />
          <Button testID="todo-add" label="Add" icon={Plus} small disabled={!online || !text.trim()} busy={busy === "add"} onPress={() => void add()} />
        </View>
        <T variant="caption" color="textTertiary" style={{ paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.md }}>
          Only for you. The agent sees an idea only when you send it.
        </T>
        {error ? (
          <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
            <StateLine kind="problem" label={error} role="caption" lines={0} />
          </View>
        ) : null}
        {todos === undefined ? (
          <View style={{ padding: space["2xl"], alignItems: "center" }}>{online ? <Spinner color={t.working} /> : <StateLine kind="problem" label="Not connected to your PC." role="caption" />}</View>
        ) : todos.length === 0 ? (
          <T variant="callout" color="textSecondary" style={{ paddingHorizontal: space.lg, paddingTop: space.xl, textAlign: "center" }}>
            Nothing here yet. Jot down what you want to change, then send it to the agent when you are ready.
          </T>
        ) : null}
        {open.map(row)}
        {done.length ? (
          <>
            <T variant="eyebrow" color="textTertiary" style={{ paddingHorizontal: space.lg, paddingTop: space.xl, paddingBottom: space.xs }}>
              Done
            </T>
            {done.map(row)}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function TodoRow({
  item,
  disabled,
  sending,
  onTick,
  onSend,
  onRemove,
}: {
  item: TodoItem;
  disabled: boolean;
  sending: boolean;
  onTick: () => void;
  onSend: () => void;
  onRemove: () => void;
}) {
  const t = useTheme();
  const Tick = item.done ? CircleCheck : Circle;
  return (
    <View testID="todo-row" style={{ flexDirection: "row", alignItems: "center", minHeight: size.touch + space.sm, paddingLeft: space.xs, paddingRight: space.sm, gap: space.xs }}>
      <Pressable
        testID="todo-tick"
        accessibilityRole="checkbox"
        accessibilityState={{ checked: item.done, disabled }}
        accessibilityLabel={item.text}
        disabled={disabled}
        onPress={onTick}
        hitSlop={space.xs}
        style={({ pressed }) => ({ width: size.touch, height: size.touch, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
      >
        <Tick size={icon.size.md} color={item.done ? t.ready : t.textSecondary} strokeWidth={icon.stroke} absoluteStrokeWidth />
      </Pressable>
      <T
        variant="row"
        color={item.done ? "textTertiary" : "text"}
        style={{ flex: 1, paddingVertical: space.sm, textDecorationLine: item.done ? "line-through" : "none" }}
        onPress={disabled ? undefined : onTick}
      >
        {item.text}
      </T>
      {!item.done ? <Button testID="todo-send" label="Send to agent" icon={SendHorizontal} variant="quiet" small disabled={disabled} busy={sending} onPress={onSend} /> : null}
      {item.sentAt ? (
        <T variant="caption" color="textTertiary">
          Sent
        </T>
      ) : null}
      <IconButton testID="todo-remove" icon={Trash2} label={`Remove ${item.text}`} iconSize={icon.size.sm} color={t.textTertiary} onPress={() => !disabled && onRemove()} />
    </View>
  );
}
