// Dictation's app: Hex, the free dictation app (anoma.ly/hex), or on Linux Superwhisper when it is
// installed (Omarchy ships it). Where the user stands with it, in plain words, with the one button
// that moves them on. Used by the setup step and by Settings (like Ghostex's Settings, Dictation
// row: a status line, one help line and its buttons; Superwhisper is picked when installed, and
// Hex stays one click away).
import { useState } from "react";
import { Check, CircleAlert, Download, ExternalLink, Mic, RefreshCw } from "lucide-react";
import type { DictationEngine, HexCheck } from "../../shared/types.ts";
import { DICTATE_HOTKEY } from "./dictation.ts";
import { Icon, Spinner } from "./ui.tsx";

const api = window.anyapp;
export const HEX_SITE = "https://anoma.ly/hex/";
export const SUPERWHISPER_SITE = "https://superwhisper.com/";

/** What to do in Hex, in order (Ghostex's setup lines). */
export const HEX_SETUP: [string, string][] = [
  ["Install Hex", "Click Install Hex below. It installs for you only, in about a minute, with no administrator needed."],
  ["Open Hex and allow the microphone", "Windows asks once. Turn on Open at login in Hex so it is always there."],
  ["Download a speech model in Hex", "In Hex's settings, under Models: Parakeet for English and European languages, Whisper for the rest."],
];

/** The same steps on Linux, where nothing asks for the microphone and Hex opens from the app launcher. */
const HEX_SETUP_LINUX: [string, string][] = [
  ["Install Hex", "Click Install Hex below. It installs for you only, in about a minute, with no password needed."],
  ["Open Hex and check the microphone", "Open Hex from your app launcher and check in its settings that it uses the right microphone. Turn on Launch at login in Hex so it is always there."],
  HEX_SETUP[2],
];

/** The same steps on a Mac, where Hex goes into Applications and macOS asks for the microphone. */
const HEX_SETUP_MAC: [string, string][] = [
  ["Install Hex", "Click Install Hex below. It goes into Applications in about a minute, with no password needed."],
  ["Open Hex and allow the microphone", "macOS asks once. Turn on Launch at login in Hex so it is always there."],
  HEX_SETUP[2],
];

/** The setup steps for the app dictation uses on this PC. */
export function dictationSetup(check: HexCheck): [string, string][] {
  return check.platform === "linux" ? HEX_SETUP_LINUX : check.platform === "darwin" ? HEX_SETUP_MAC : HEX_SETUP;
}

/** The name of the app dictation uses. */
export const engineName = (check?: HexCheck) => (check?.engine === "superwhisper" ? "Superwhisper" : "Hex");

interface View {
  tone: "todo" | "working" | "ready" | "problem";
  title: string;
  line: string;
}

function viewOf(hex: HexCheck): View {
  if (hex.engine === "superwhisper") {
    return { tone: "ready", title: "Superwhisper is ready", line: `Click the microphone in any text box (a chat, Make a kiwi), or press ${DICTATE_HOTKEY}. Tap to start and tap to stop, or hold and let go. Superwhisper writes it down with its own mode, language and vocabulary.` };
  }
  const install = hex.install;
  if (install?.running) return { tone: "working", title: "Installing Hex…", line: install.line ? `${install.line}. It takes a minute or two.` : "It takes a minute or two." };
  if (install?.error && hex.state === "notInstalled") return { tone: "problem", title: "Hex didn't install", line: install.error };
  switch (hex.state) {
    case "checking":
      return { tone: "working", title: "Looking for Hex…", line: "One moment." };
    case "unsupported":
      return { tone: "problem", title: "Hex can't run on this PC", line: hex.summary };
    case "notInstalled":
      return {
        tone: "todo",
        title: "Hex isn't installed",
        // On Linux Superwhisper comes first (Omarchy ships it); without it, Hex is one click away.
        line:
          hex.platform === "linux"
            ? "Superwhisper isn't on this PC either. Install Superwhisper (Omarchy comes with it), or Hex below: a free app that turns your voice into text on this PC, offline and with no account."
            : "Hex is a free app that turns your voice into text on this PC. It works offline and needs no account.",
      };
    case "notRunning":
      return { tone: "todo", title: "Hex isn't open", line: hex.platform === "linux" || hex.platform === "darwin" ? `Dictation needs Hex open. Turn on Launch at login in Hex so it starts with your ${hex.platform === "darwin" ? "Mac" : "PC"}.` : "Dictation needs Hex open. Turn on Open at login in Hex so it starts with your PC." };
    case "noModels":
      return { tone: "todo", title: "Hex has no speech model yet", line: "In Hex's settings, under Models, download one. Kiwimake finds it by itself." };
    case "ready":
      return { tone: "ready", title: "Hex is ready", line: `Click the microphone in any text box (a chat, Make a kiwi), or press ${DICTATE_HOTKEY}. Tap to start and tap to stop, or hold and let go.` };
    default:
      return { tone: "problem", title: "Hex needs attention", line: hex.summary };
  }
}

export function HexCard({ hex, hexModel }: { hex: HexCheck; hexModel: string }) {
  const [openError, setOpenError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const v = viewOf(hex);
  const installing = !!hex.install?.running;
  const open = async () => {
    setOpening(true);
    setOpenError(null);
    const r = await api.hexOpen();
    setOpening(false);
    if (!r.ok) setOpenError(r.error ?? "Hex couldn't be opened.");
  };
  const superwhisper = hex.engine === "superwhisper";
  const site = (
    <button className="btn btn-text label" onClick={() => api.openExternal(superwhisper ? SUPERWHISPER_SITE : HEX_SITE)}>
      {superwhisper ? "Superwhisper's website" : "Hex's website"} <Icon of={ExternalLink} size="sm" />
    </button>
  );
  // Linux with Superwhisper installed: pick it or Hex (Ghostex's engine picker).
  const picker = hex.superwhisper ? (
    <label className="row hex-model">
      <span className="label secondary">Dictate with</span>
      <select className="field" value={hex.engine ?? "hex"} onChange={(e) => api.setSetting("dictationEngine", e.target.value as DictationEngine)}>
        <option value="superwhisper">Superwhisper</option>
        <option value="hex">Hex</option>
      </select>
    </label>
  ) : null;
  const action =
    superwhisper || installing || hex.state === "checking" ? undefined : hex.state === "notInstalled" ? (
      <button className="btn btn-primary" onClick={() => api.hexInstall()}>
        <Icon of={Download} size="button" /> {hex.install?.error ? "Try again" : "Install Hex"}
      </button>
    ) : hex.state === "notRunning" ? (
      <button className="btn btn-primary" onClick={open} disabled={opening}>
        {opening ? <Spinner /> : null} Open Hex
      </button>
    ) : hex.state === "ready" ? undefined : (
      <button className="btn btn-quiet btn-sm" onClick={() => api.hexCheck()}>
        <Icon of={RefreshCw} size="sm" /> Check again
      </button>
    );
  return (
    <>
      <div className="card check-card" role="status">
        <span className={`badge ${v.tone === "ready" ? "ready" : v.tone === "problem" ? "problem" : ""}`}>
          {v.tone === "ready" ? <Icon of={Check} size="md" /> : v.tone === "working" ? <Spinner /> : v.tone === "problem" ? <Icon of={CircleAlert} size="md" /> : <Icon of={Mic} size="md" />}
        </span>
        <div className="check-text">
          <strong>{v.title}</strong>
          <span className={v.tone === "problem" ? "problem-text hex-line" : "hex-line"}>{v.line}</span>
        </div>
        {action ? <div className="notice-actions">{action}</div> : null}
      </div>
      <div className="under-card">
        {picker}
        {!superwhisper && hex.state === "ready" && hex.models.length > 0 && (
          <label className="row hex-model">
            <span className="label secondary">Speech model</span>
            <select className="field" value={hexModel && hex.models.some((m) => m.id === hexModel) ? hexModel : (hex.model ?? "")} onChange={(e) => api.setSetting("hexModel", e.target.value)}>
              {hex.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <span className="label tertiary">{hex.version ? `Hex ${hex.version}` : ""}</span>
          </label>
        )}
        {openError && <p className="label problem-text">{openError}</p>}
        <div className="row wrap" style={{ gap: "var(--aa-space-lg)" }}>
          {site}
        </div>
      </div>
    </>
  );
}
