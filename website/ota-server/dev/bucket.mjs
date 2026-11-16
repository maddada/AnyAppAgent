// A stand-in for the R2 bucket the update server uses (env.OTA), kept in a folder on disk, so the
// Worker (src/worker.js) runs unchanged in Node for tests and the local proof (dev/local.mjs).
// Only what the Worker calls: get, head, put, list.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

export function folderBucket(root) {
  mkdirSync(root, { recursive: true });
  const file = (key) => join(root, ...key.split("/"));
  const meta = (key) => `${file(key)}.meta.json`;

  function describe(key) {
    const path = file(key);
    if (!existsSync(path) || statSync(path).isDirectory()) return null;
    const bytes = readFileSync(path);
    const httpMetadata = existsSync(meta(key)) ? JSON.parse(readFileSync(meta(key), "utf8")) : {};
    return { key, size: bytes.length, httpMetadata, httpEtag: `"${createHash("md5").update(bytes).digest("hex")}"`, bytes };
  }

  function walk(dir) {
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return walk(path);
      return entry.name.endsWith(".meta.json") ? [] : [relative(root, path).split(sep).join("/")];
    });
  }

  return {
    async head(key) {
      const found = describe(key);
      if (found === null) return null;
      const { bytes: _bytes, ...rest } = found;
      return rest;
    },
    async get(key) {
      const found = describe(key);
      if (found === null) return null;
      const { bytes, ...rest } = found;
      return { ...rest, body: new Uint8Array(bytes), text: async () => bytes.toString("utf8") };
    },
    async put(key, value, options = {}) {
      mkdirSync(dirname(file(key)), { recursive: true });
      const bytes = typeof value === "string" ? Buffer.from(value) : Buffer.from(value instanceof ArrayBuffer ? new Uint8Array(value) : value);
      writeFileSync(file(key), bytes);
      writeFileSync(meta(key), JSON.stringify(options.httpMetadata ?? {}));
    },
    async list({ prefix = "" } = {}) {
      const objects = walk(root)
        .filter((key) => key.startsWith(prefix))
        .sort()
        .map((key) => ({ key }));
      return { objects, truncated: false };
    },
  };
}
