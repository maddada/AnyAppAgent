// Updates for people the app is shared with (Kiwimake docs/DISTRIBUTION.md). It works by
// itself: when the app is shared, it checks for a new version when it opens and once a day, and
// shows a notification; a tap downloads, checks and installs it. Use this only to show an update
// line or a "Check for updates" button. Do not remove the module.
import { requireNativeModule } from 'expo';

type Native = {
  check(): Promise<string>;
  open(): void;
  isOn(): boolean;
  channel(): string;
  setChannel(channel: string): void;
  changeVisible(): Promise<boolean>;
  changeOwner(): string;
  openChange(screen: string | null): void;
};

const native = requireNativeModule<Native>('AnyappUpdates');

export type UpdateStatus =
  | { state: 'off' } // the app is not shared: no updates here
  | { state: 'up-to-date' }
  | { state: 'anyappagent' } // Kiwimake on this phone handles this app's updates
  | { state: 'available'; version: string; notes: string; build: number }
  | { state: 'problem'; message: string };

/** Looks for a new version now (network). */
export async function checkForUpdate(): Promise<UpdateStatus> {
  return JSON.parse(await native.check()) as UpdateStatus;
}

/** Opens the update box: downloads, checks and installs the new version. */
export function openUpdate(): void {
  native.open();
}

/** True when this build can get updates (the app is shared). */
export function updatesOn(): boolean {
  return native.isOn();
}

export function getUpdateChannel(): 'stable' | 'testing' {
  return native.channel() === 'testing' ? 'testing' : 'stable';
}

/** "testing" also offers test versions the owner published for testing. */
export function setUpdateChannel(channel: 'stable' | 'testing'): void {
  native.setChannel(channel);
}

// ---------- "Change this app" (built in: src/components/ChangeThisApp.tsx is the row; keep it)

/** Whether the "Change this app" row shows on this phone: always for the owner, else unless they hid it. */
export function changeVisible(): Promise<boolean> {
  return native.changeVisible();
}

/** The owner's name as the PC wrote it into this build ("" when unknown). */
export function changeOwner(): string {
  return native.changeOwner();
}

/** Opens Kiwimake at this app (or, without Kiwimake, the explanation sheet). */
export function openChange(screen?: string): void {
  native.openChange(screen ?? null);
}
