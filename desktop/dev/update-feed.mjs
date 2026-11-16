// The update feeds the desktop app reads (src/main/updates.ts, electron-updater's generic provider at
// https://github.com/maddada/Kiwimake/releases/latest/download): latest.yml (Windows),
// latest-mac.yml (both Macs) and latest-linux.yml (AppImage and .deb). Written from the final,
// signed and stapled files under their stable release names, so each SHA-512 is the one a person
// downloads (docs/RELEASING.md, "Updates of the desktop app").
//
//   node dev/update-feed.mjs write <feed.yml> --version <x.y.z> <file>...   first file is the default
//   node dev/update-feed.mjs verify <feed.yml> <folder> [--version <x.y.z>]  sizes and SHA-512 match
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The feed names electron-updater asks for, and what each must carry. */
export const FEEDS = {
  "latest.yml": [/^Kiwimake-Setup\.exe$/],
  "latest-mac.yml": [/^Kiwimake-mac-arm64\.zip$/, /^Kiwimake-mac-x64\.zip$/],
  "latest-linux.yml": [/^Kiwimake-x86_64\.AppImage$/, /^kiwimake_amd64\.deb$/],
};

const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** SHA-512 in base64, as electron-updater checks it. */
export function sha512(file) {
  return createHash("sha512").update(readFileSync(file)).digest("base64");
}

export function feedYaml({ version, files, releaseDate }) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`version must be MAJOR.MINOR.PATCH, got ${version}`);
  if (!files.length) throw new Error("a feed needs at least one file");
  const lines = [`version: ${quote(version)}`, "files:"];
  for (const f of files) lines.push(`  - url: ${quote(f.name)}`, `    sha512: ${quote(f.sha512)}`, `    size: ${f.size}`);
  // The legacy single-file fields: the first file.
  lines.push(`path: ${quote(files[0].name)}`, `sha512: ${quote(files[0].sha512)}`, `releaseDate: ${quote(releaseDate)}`);
  return `${lines.join("\n")}\n`;
}

/** Reads a feed written by feedYaml (not a general YAML parser). */
export function parseFeed(text) {
  const unquote = (v) => (v.startsWith("'") ? v.slice(1, -1).replace(/''/g, "'") : v);
  const feed = { files: [] };
  for (const line of text.split("\n")) {
    let m;
    if ((m = /^ {2}- url: (.+)$/.exec(line))) feed.files.push({ name: unquote(m[1]) });
    else if ((m = /^ {4}sha512: (.+)$/.exec(line))) feed.files.at(-1).sha512 = unquote(m[1]);
    else if ((m = /^ {4}size: (\d+)$/.exec(line))) feed.files.at(-1).size = Number(m[1]);
    else if ((m = /^(version|path|sha512|releaseDate): (.+)$/.exec(line))) feed[m[1]] = unquote(m[2]);
  }
  return feed;
}

/** Problems with a feed against the files in a folder (empty when it is right). */
export function checkFeed(feedName, text, dir, version) {
  const feed = parseFeed(text);
  const problems = [];
  const want = FEEDS[feedName];
  if (!want) problems.push(`${feedName} is not a feed the desktop app reads`);
  if (version && feed.version !== version) problems.push(`${feedName} says version ${feed.version}, expected ${version}`);
  for (const re of want ?? []) if (!feed.files.some((f) => re.test(f.name))) problems.push(`${feedName} lists no file matching ${re}`);
  for (const f of feed.files) {
    let size;
    try {
      size = statSync(join(dir, f.name)).size;
    } catch {
      problems.push(`${f.name} is missing`);
      continue;
    }
    if (size !== f.size) problems.push(`${f.name}: size ${size}, feed says ${f.size}`);
    else if (sha512(join(dir, f.name)) !== f.sha512) problems.push(`${f.name}: SHA-512 differs from the feed`);
  }
  if (feed.files[0] && (feed.path !== feed.files[0].name || feed.sha512 !== feed.files[0].sha512)) problems.push(`${feedName}: path and sha512 must be the first file's`);
  return problems;
}

function main(argv) {
  const [cmd, feedPath, ...rest] = argv;
  const vi = rest.indexOf("--version");
  const version = vi >= 0 ? rest.splice(vi, 2)[1] : undefined;
  if (cmd === "write") {
    if (!feedPath || !version || !rest.length) throw new Error("usage: write <feed.yml> --version <x.y.z> <file>...");
    const files = rest.map((file) => ({ name: basename(file), size: statSync(file).size, sha512: sha512(file) }));
    const text = feedYaml({ version, files, releaseDate: new Date().toISOString() });
    const problems = checkFeed(basename(feedPath), text, join(rest[0], ".."), version);
    if (problems.length) throw new Error(problems.join("\n"));
    writeFileSync(feedPath, text);
    console.log(`${feedPath}: ${version}, ${files.map((f) => f.name).join(", ")}`);
  } else if (cmd === "verify") {
    const [dir] = rest;
    if (!feedPath || !dir) throw new Error("usage: verify <feed.yml> <folder> [--version <x.y.z>]");
    const problems = checkFeed(basename(feedPath), readFileSync(feedPath, "utf8"), dir, version);
    if (problems.length) {
      console.error(problems.join("\n"));
      process.exit(1);
    }
    console.log(`${feedPath}: every file matches (${parseFeed(readFileSync(feedPath, "utf8")).files.length} files)`);
  } else throw new Error("usage: update-feed.mjs write|verify ...");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
