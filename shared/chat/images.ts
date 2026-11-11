// Pictures sent with a chat message: the limits both apps apply before sending (they downscale on
// the device) and the companion checks again. Within what Claude takes per image: at most 5 MB
// encoded, and nothing is gained above 1568 px on the long edge (it is scaled down to that anyway).

/** Most pictures in one message. */
export const MAX_IMAGES = 6;
/** Longest edge after downscaling on the device, in pixels. */
export const MAX_IMAGE_EDGE = 1568;
/** Largest picture the companion takes, decoded bytes (base64 of this stays under Claude's 5 MB). */
export const MAX_IMAGE_BYTES = 3_700_000;
/** JPEG quality used when a picture is re-encoded on the device. */
export const IMAGE_QUALITY = 0.85;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

/** The size to scale a picture to so its long edge is at most `max` (never scaled up). */
export function fitWithin(width: number, height: number, max = MAX_IMAGE_EDGE): { width: number; height: number; scaled: boolean } {
  const long = Math.max(width, height);
  if (!(long > max) || width <= 0 || height <= 0) return { width, height, scaled: false };
  const k = max / long;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)), scaled: true };
}

/** Decoded size of a base64 string, in bytes. */
export function base64Bytes(data: string): number {
  const clean = data.replace(/\s/g, "");
  const pad = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - pad;
}

/** The file extension the companion stores a picture under. */
export function imageExtension(mimeType: string): string {
  return mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : mimeType === "image/gif" ? "gif" : "png";
}

/** Why these pictures cannot be sent, in a plain sentence, or null when they can. */
export function checkImages(images: readonly { mimeType: string; data: string }[]): string | null {
  if (images.length > MAX_IMAGES) return `Send at most ${MAX_IMAGES} pictures at a time.`;
  for (const img of images) {
    if (!(IMAGE_TYPES as readonly string[]).includes(img.mimeType)) return "Only PNG, JPEG, WebP and GIF pictures can be sent.";
    if (base64Bytes(img.data) > MAX_IMAGE_BYTES) return "One of the pictures is too big, even after making it smaller. Try a screenshot instead.";
  }
  return null;
}

/** The app's last-message line for a message that is only pictures. */
export function picturesLabel(count: number): string {
  return count === 1 ? "Sent a picture" : `Sent ${count} pictures`;
}

/** Splits a data URL ("data:image/png;base64,....") into its type and base64 data. */
export function parseDataUrl(url: string): { mimeType: string; data: string } | null {
  const m = /^data:([^;,]+)(?:;[^,]*)?;base64,(.*)$/s.exec(url);
  return m ? { mimeType: m[1].toLowerCase(), data: m[2] } : null;
}
