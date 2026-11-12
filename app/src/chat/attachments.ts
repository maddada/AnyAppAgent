// Pictures for a chat message on the phone: from the gallery, the camera or the clipboard,
// downscaled here to the shared limits (shared/chat/images.ts) before they are sent.
import * as Clipboard from "expo-clipboard";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { fitWithin, IMAGE_QUALITY, MAX_IMAGES, parseDataUrl } from "@shared/chat/index";
import type { ImageUpload } from "@/lib/protocol";

export interface Attachment {
  key: string;
  uri: string; // shown in the composer
  mimeType: string;
  data: string; // base64
  width: number;
  height: number;
}

let counter = 0;

/** Downscales to at most 1568 px on the long edge and re-encodes as JPEG with its base64. */
export async function prepare(uri: string, width: number, height: number): Promise<Attachment> {
  const fit = fitWithin(width, height);
  const out = await manipulateAsync(uri, fit.scaled ? [{ resize: { width: fit.width, height: fit.height } }] : [], {
    compress: IMAGE_QUALITY,
    format: SaveFormat.JPEG,
    base64: true,
  });
  if (!out.base64) throw new Error("That picture could not be read.");
  counter += 1;
  return { key: `a${Date.now()}-${counter}`, uri: out.uri, mimeType: "image/jpeg", data: out.base64, width: out.width, height: out.height };
}

/** Pictures from the gallery (Android's photo picker: no permission needed). */
export async function pickFromGallery(room: number): Promise<Attachment[]> {
  if (room <= 0) return [];
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: room > 1,
    selectionLimit: Math.min(room, MAX_IMAGES),
    quality: 1,
  });
  if (result.canceled) return [];
  return Promise.all(result.assets.slice(0, room).map((a) => prepare(a.uri, a.width, a.height)));
}

/** One photo from the camera. */
export async function takePhoto(): Promise<Attachment[]> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) throw new Error("Kiwimake may not use the camera. Allow it in the phone's settings.");
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1 });
  if (result.canceled) return [];
  return Promise.all(result.assets.slice(0, 1).map((a) => prepare(a.uri, a.width, a.height)));
}

export const clipboardHasImage = () => Clipboard.hasImageAsync().catch(() => false);

/** The picture on the clipboard (a copied screenshot, for example), or null. */
export async function pastePicture(): Promise<Attachment | null> {
  const image = await Clipboard.getImageAsync({ format: "png" });
  if (!image) return null;
  const parsed = parseDataUrl(image.data);
  if (!parsed) return null;
  return prepare(image.data, image.size.width, image.size.height);
}

export const toUploads = (list: Attachment[]): ImageUpload[] => list.map(({ mimeType, data, width, height }) => ({ mimeType, data, width, height }));
