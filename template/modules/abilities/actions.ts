// Actions: what a widget button, a Quick Settings tile or an app shortcut does.
//
// An action has a name you choose ("log-glass"). It either runs in the background, with the app
// closed (register it with onAction at the top level of a file App.tsx imports, never inside a
// component), or opens the app (open: true in app.json, or a widget tap) and then reaches
// useOpenAction in a screen.
import { useEffect, useRef } from 'react';
import { AppRegistry } from 'react-native';

import { native } from './native';

export type ActionSource = 'widget' | 'tile' | 'shortcut';

export type AbilityAction = {
  /** The name you gave the action, e.g. "log-glass". */
  name: string;
  source: ActionSource;
  /** The id of the widget, tile or shortcut it came from. */
  from: string;
  /** Extra values: a toggle tile sends { on: boolean }. */
  data: Record<string, unknown>;
};

/** Return a short text to show it as a small message ("Glass logged"), or nothing. */
export type ActionHandler = (action: AbilityAction) => Promise<string | void> | string | void;

type Raw = { name?: string; source?: string; from?: string; data?: string | Record<string, unknown> };

const handlers = new Map<string, ActionHandler>();

function parse(raw: Raw): AbilityAction {
  let data: Record<string, unknown> = {};
  if (typeof raw.data === 'string') {
    try {
      data = JSON.parse(raw.data) as Record<string, unknown>;
    } catch {
      data = {};
    }
  } else if (raw.data) data = raw.data;
  return { name: raw.name ?? '', source: (raw.source ?? 'widget') as ActionSource, from: raw.from ?? '', data };
}

// The task Android starts for a background action (JsActionRunner.kt). It also runs while the
// app is closed: then only the files App.tsx imports have run, and no screen is shown.
AppRegistry.registerHeadlessTask('AnyappAction', () => async (raw: object) => {
  const action = parse(raw as Raw);
  const handler = handlers.get(action.name) ?? handlers.get('*');
  if (!handler) {
    console.warn(`[abilities] no onAction handler for "${action.name}"`);
    return;
  }
  try {
    const message = await handler(action);
    if (typeof message === 'string' && message) native.setMessage(message);
  } catch (e) {
    console.error(`[abilities] action "${action.name}" failed`, e);
  }
});

/**
 * Runs [handler] when the action [name] starts in the background (a widget button, a tile, a
 * shortcut without open). Call it at the top level of a module, e.g. src/lib/actions.ts,
 * imported from App.tsx. "*" catches every action without its own handler. A new widget with
 * nothing to show yet sends "widget-update" (from = the widget id).
 */
export function onAction(name: string, handler: ActionHandler): void {
  handlers.set(name, handler);
}

/**
 * In a component: [handler] gets each action that opened the app (a shortcut or tile with
 * open: true, a widget tap or a button with open), including the one that started it.
 */
export function useOpenAction(handler: (action: AbilityAction) => void): void {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    const drain = () => {
      const raw = native.takeOpenedAction();
      if (raw) ref.current(parse(JSON.parse(raw) as Raw));
    };
    drain();
    const sub = native.addListener('onOpenAction', drain);
    return () => sub.remove();
  }, []);
}
