// Fills public/gallery.json (Ready apps, docs/GALLERY.md) from gallery-apps.json, the hand-kept list
// of which apps go in and their words, and each app's published update.json on its public releases
// repo: the latest version and build, and the signing certificate (update.json's `signer`). The
// certificate is never typed by hand or read from a keystore: it comes from what was published.
//
//   node website/gallery-refresh.mjs            # writes public/gallery.json
//   node website/gallery-refresh.mjs --check    # prints what would change, writes nothing
//
// An app whose certificate differs from the one already in gallery.json is refused (a key that
// changed, or a releases repo someone else took over) unless --accept-new-key <package> names it.
// No em dashes in the words (the user's rule): the shared reader turns them into commas anyway.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readGallery } from "../shared/chat/gallery.ts";

const here = dirname(fileURLToPath(import.meta.url));

/** One app's entry from its curated words and its published feed. */
export async function refreshGallery({ wanted, current, fetchImpl = fetch, acceptNewKey = [], now = new Date() }) {
  const known = new Map((current?.apps ?? []).map((a) => [a.package, a]));
  const apps = [];
  const problems = [];
  for (const w of wanted.apps) {
    const feedUrl = `https://github.com/${w.repo}/releases/latest/download/update.json`;
    let feed;
    try {
      const r = await fetchImpl(feedUrl, { redirect: "follow" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      feed = await r.json();
    } catch (error) {
      problems.push(`${w.name}: no published version at ${feedUrl} (${error.message})`);
      continue;
    }
    if (feed.package !== w.package) {
      problems.push(`${w.name}: its update.json is for ${feed.package}, not ${w.package}`);
      continue;
    }
    const signer = String(feed.signer ?? "").toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(signer)) {
      problems.push(`${w.name}: its update.json names no signing certificate`);
      continue;
    }
    const before = known.get(w.package);
    if (before && before.certSha256 !== signer && !acceptNewKey.includes(w.package)) {
      problems.push(`${w.name}: signed by another key than the gallery knows (${before.certSha256.slice(0, 12)}... now ${signer.slice(0, 12)}...). Pass --accept-new-key ${w.package} only if you moved its key yourself.`);
      continue;
    }
    apps.push({
      package: w.package,
      name: w.name,
      line: w.line,
      icon: w.icon ?? `https://raw.githubusercontent.com/${w.repo}/HEAD/icon.png`,
      repo: w.repo,
      ...(w.code ? { code: w.code } : {}),
      certSha256: signer,
      latest: { version: String(feed.version ?? feed.build), build: Number(feed.build) },
    });
  }
  const list = { format: 1, updatedAt: now.toISOString(), maker: wanted.maker ?? "Kiwimake", apps };
  // What the apps will read: the shared reader must keep every entry.
  const read = readGallery(list);
  if (read.apps.length !== apps.length) problems.push(`the shared reader dropped ${apps.length - read.apps.length} entries: check package names and repos`);
  return { list, problems };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const accept = [];
  for (let i = 0; i < args.length; i += 1) if (args[i] === "--accept-new-key") accept.push(args[i + 1]);
  const wanted = JSON.parse(readFileSync(join(here, "gallery-apps.json"), "utf8"));
  const file = join(here, "public", "gallery.json");
  const current = JSON.parse(readFileSync(file, "utf8"));
  const { list, problems } = await refreshGallery({ wanted, current, acceptNewKey: accept });
  for (const p of problems) console.error(`- ${p}`);
  for (const a of list.apps) console.log(`${a.name}: ${a.latest.version} (build ${a.latest.build}), certificate ${a.certSha256.slice(0, 12)}...`);
  if (problems.length > 0) {
    console.error("Not written: fix the problems above first.");
    process.exit(1);
  }
  if (args.includes("--check")) console.log("--check: nothing written.");
  else {
    writeFileSync(file, `${JSON.stringify(list, null, 2)}\n`);
    console.log(`Wrote ${file} (${list.apps.length} apps).`);
  }
}
