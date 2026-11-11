// Receiving shares: with "shares" in app.json (modules/abilities/app.plugin.js) the app shows up
// in Android's share sheet. A share opens the app, and useIncomingShare gets it.
import { useEffect, useRef } from 'react';

import { native } from './native';

export type SharedFile = {
  /** file:// address of the app's own copy: works in <Image source={{ uri }} /> and fetch. */
  uri: string;
  path: string;
  mimeType: string;
  name: string;
  size: number;
};

export type IncomingShare = {
  /** Shared text (a link from a browser comes as text). */
  text: string | null;
  subject: string | null;
  /** The first web link in the text, if any. */
  url: string | null;
  mimeType: string | null;
  /** Images and other files, already copied into the app (they stay until deleteSharedFile). */
  files: SharedFile[];
};

/** In a component (usually the first screen): [handler] gets every share, including the one that opened the app. */
export function useIncomingShare(handler: (share: IncomingShare) => void): void {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    const drain = () => {
      const raw = native.takeShare();
      if (raw) ref.current(JSON.parse(raw) as IncomingShare);
    };
    drain();
    const sub = native.addListener('onShare', drain);
    return () => sub.remove();
  }, []);
}

/** Deletes the app's copy of a shared file it does not keep. */
export function deleteSharedFile(file: SharedFile | string): boolean {
  return native.deleteSharedFile(typeof file === 'string' ? file : file.path);
}
