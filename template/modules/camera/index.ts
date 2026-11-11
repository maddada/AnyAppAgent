// Camera smarts: scan a QR code or barcode, read printed text from a picture, on the phone (no
// internet, no cost). Off until app.json switches it on (modules/camera/app.plugin.js), so apps
// that do not use it stay small. See "Camera smarts" in AGENTS.md.
import { requireNativeModule } from 'expo';

type Native = {
  status(): { codes: boolean; text: boolean };
  scanCode(): Promise<ScannedCode | null>;
  readCodes(uri: string): Promise<ScannedCode[]>;
  readText(uri: string): Promise<ReadText>;
};

const native = requireNativeModule<Native>('AnyappCamera');

export type ScannedCode = {
  /** The code's text: a web address, a product number, any text. */
  value: string;
  /** "qr", "ean13", "ean8", "upca", "upce", "code128", "code39", "datamatrix", "pdf417", ... */
  format: string;
  /** What it holds: "url", "product", "text", "wifi", "contact", "phone", "email", ... */
  kind: string;
};

export type ReadText = {
  /** All the text, lines separated by "\n". */
  text: string;
  /** Each line, top to bottom. */
  lines: string[];
  /** Paragraph-like blocks. */
  blocks: string[];
};

/** Which parts are on in this build. */
export function cameraSmarts(): { codes: boolean; text: boolean } {
  return native.status();
}

/**
 * Opens a full-screen scanner (Google's, it needs no camera permission) and gives back the first
 * code it sees, or null if the person closed it. The first scan on a phone may wait a moment while
 * Google Play services fetches the scanner. Throws if it cannot open.
 */
export function scanCode(): Promise<ScannedCode | null> {
  return native.scanCode();
}

/** Finds every QR code and barcode in a picture (a file:// or content:// address), e.g. a screenshot. */
export function readCodes(uri: string): Promise<ScannedCode[]> {
  return native.readCodes(uri);
}

/**
 * Reads printed text (Latin letters) from a picture: a file:// or content:// address, for example
 * from expo-image-picker's launchCameraAsync. Throws if the picture cannot be read.
 */
export function readText(uri: string): Promise<ReadText> {
  return native.readText(uri);
}
