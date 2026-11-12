// Whether Android allows what a card needs, and how to ask for it. Shared by the card (It needs)
// and Settings (Powers: what is allowed and which automations use it).
import { Linking, PermissionsAndroid } from 'react-native';

import * as Native from '../../modules/automate';
import type { Need } from './card';
import { ensureNotificationPermission } from '@/lib/notifications';

export function needReady(n: Need): boolean {
  if (n === 'dnd') return Native.dnd.hasAccess();
  if (n === 'notifications') return Native.canNotify();
  if (n === 'listening') return Native.canNotify();
  if (n === 'nearby') return Native.hasPermission('android.permission.BLUETOOTH_CONNECT');
  if (n === 'notificationAccess') return Native.notificationAccess();
  if (n === 'usageAccess') return Native.usageAccess();
  if (n === 'screen') return Native.screenOn();
  if (n === 'shizuku') return Native.shizukuState() === 'ready';
  if (n === 'locationAlways') return Native.hasPermission('android.permission.ACCESS_FINE_LOCATION') && Native.hasPermission('android.permission.ACCESS_BACKGROUND_LOCATION');
  return Native.canExact();
}

/** Asks for it (a prompt) or opens Android's page for it. The same page switches it off again. */
export async function openNeed(n: Need): Promise<void> {
  if (n === 'dnd') await Native.dnd.openSettings();
  if (n === 'notifications' || n === 'listening') await ensureNotificationPermission();
  if (n === 'nearby') await PermissionsAndroid.request('android.permission.BLUETOOTH_CONNECT');
  if (n === 'notificationAccess') await Native.openNotificationAccess();
  if (n === 'usageAccess') await Native.openUsageAccess();
  if (n === 'screen') await Native.openScreenSettings();
  if (n === 'shizuku') {
    if (Native.shizukuState() === 'denied') await Native.shizukuRequest();
    else await Linking.openURL('https://shizuku.rikka.app/download/');
  }
  if (n === 'locationAlways') {
    // Android asks in two steps: while in use first, then "Allow all the time" on its own page.
    const fine = await PermissionsAndroid.request('android.permission.ACCESS_FINE_LOCATION');
    if (fine === 'granted') await PermissionsAndroid.request('android.permission.ACCESS_BACKGROUND_LOCATION');
  }
}

/** The strong powers Settings lists when Android has allowed them (switching them off is on Android's page). */
export const STRONG_POWERS: Need[] = ['dnd', 'notificationAccess', 'usageAccess', 'screen', 'locationAlways', 'nearby', 'shizuku'];

/** Opens Android's page where a power is switched off (for location and nearby: the app's permissions). */
export async function openPowerSettings(n: Need): Promise<void> {
  if (n === 'locationAlways' || n === 'nearby' || n === 'shizuku') await Native.openAppInfo();
  else await openNeed(n);
}
