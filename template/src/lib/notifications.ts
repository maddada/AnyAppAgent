// Plain notifications (expo-notifications): permission, show now, schedule a reminder.
// For alarms that must speak or play a sound while the app is closed, use '@/lib/alarms'.
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';

let configured = false;

/** Shows notifications even while the app is open. Called once from App.tsx. */
export function setupNotifications() {
  if (configured) return;
  configured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
  Notifications.setNotificationChannelAsync('reminders', {
    name: 'Reminders',
    importance: AndroidImportance.HIGH,
  }).catch(() => {});
}

/** Asks for notification permission if needed. Returns true when notifications may be shown. */
export async function ensureNotificationPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

export async function notifyNow(title: string, body?: string): Promise<string> {
  return Notifications.scheduleNotificationAsync({
    content: { title, body },
    trigger: { channelId: 'reminders' },
  });
}

/** An exact reminder at `at`, delivered even if the app is closed or the phone rebooted. */
export async function scheduleReminder(opts: { at: Date; title: string; body?: string }): Promise<string> {
  return Notifications.scheduleNotificationAsync({
    content: { title: opts.title, body: opts.body },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: opts.at,
      channelId: 'reminders',
      delivery: 'alarmClock',
    },
  });
}

export function cancelReminder(id: string): Promise<void> {
  return Notifications.cancelScheduledNotificationAsync(id);
}
