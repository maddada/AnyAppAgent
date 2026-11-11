// Pictures for a chat message on the PC (paste, drag and drop, or the pick button), downscaled
// here to the shared limits (shared/chat/images.ts), and the sent pictures fetched for the bubble.
import { fitWithin, IMAGE_QUALITY, IMAGE_TYPES, parseDataUrl } from "../../../../shared/chat/index.ts";
import type { ImageUpload } from "../../shared/types.ts";

export interface Attachment extends ImageUpload {
  key: string;
  preview: string; // data URL shown in the composer
}

let counter = 0;

/** Image files out of a paste or a drop (other files are ignored). */
export function imageFiles(list: FileList | File[] | null | undefined): File[] {
  return Array.from(list ?? []).filter((f) => f.type.startsWith("image/"));
}

/** Downscales to at most 1568 px on the long edge. Keeps PNG for small PNGs (sharp screenshots), else JPEG. */
export async function prepare(file: File): Promise<Attachment> {
  const bitmap = await createImageBitmap(file);
  const fit = fitWithin(bitmap.width, bitmap.height);
  const keepPng = file.type === "image/png" && !fit.scaled && file.size < 1_500_000;
  const keepAsIs = (IMAGE_TYPES as readonly string[]).includes(file.type) && !fit.scaled && file.size < 1_500_000 && file.type !== "image/gif";
  let url: string;
  if (keepPng || keepAsIs) {
    url = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error("That picture could not be read."));
      r.readAsDataURL(file);
    });
  } else {
    const canvas = document.createElement("canvas");
    canvas.width = fit.width;
    canvas.height = fit.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("That picture could not be read.");
    ctx.drawImage(bitmap, 0, 0, fit.width, fit.height);
    url = canvas.toDataURL("image/jpeg", IMAGE_QUALITY);
  }
  bitmap.close();
  const parsed = parseDataUrl(url);
  if (!parsed) throw new Error("That picture could not be read.");
  counter += 1;
  return { key: `p${Date.now()}-${counter}`, preview: url, mimeType: parsed.mimeType, data: parsed.data, width: fit.width, height: fit.height };
}

const cache = new Map<string, Promise<string | undefined>>();

/** A sent picture as a data URL, fetched once through the main process. */
export function sentPicture(appId: string, imageId: string): Promise<string | undefined> {
  const key = `${appId}/${imageId}`;
  let p = cache.get(key);
  if (!p) {
    p = window.anyapp.getImage(appId, imageId).then((url) => {
      if (!url) cache.delete(key);
      return url;
    });
    cache.set(key, p);
  }
  return p;
}
