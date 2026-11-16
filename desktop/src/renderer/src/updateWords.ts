// The words for Kiwimake's own update (Update.tsx). No React and no window, for test/updates.test.ts.
import type { UpdateState } from "../../shared/types.ts";
import type { UiState } from "./ui.tsx";

/** The words for an update state: a title, a line under it, and what Settings shows. Pure, for the tests. */
export function updateWords(u: UpdateState): { title: string; body: string; status: string; state: UiState } | null {
  const v = u.version ? `Kiwimake ${u.version}` : "The new Kiwimake";
  const password = u.kind === "deb" ? " Your PC asks for your password to install it." : "";
  switch (u.phase) {
    case "off":
      return { title: "", body: "", status: u.note ?? "This copy does not update itself.", state: "idle" };
    case "idle":
      return { title: "", body: "", status: `This is Kiwimake ${u.current}.`, state: "idle" };
    case "checking":
      return { title: "", body: "", status: "Looking for a new version…", state: "working" };
    case "latest":
      return { title: "", body: "", status: `Kiwimake ${u.current} is the newest version.`, state: "ready" };
    case "downloading":
      return { title: "", body: "", status: `Downloading ${v}${u.percent ? `: ${u.percent}%` : "…"}`, state: "working" };
    case "ready":
      return { title: `${v} is ready`, body: `Restart Kiwimake to update. Your apps, phones and settings stay as they are.${password}`, status: `${v} is downloaded and ready to install.`, state: "ready" };
    case "waiting":
      return { title: `${v} installs soon`, body: `Kiwimake restarts to update as soon as this is done: ${u.waitingFor ?? "an app is being made"}.`, status: `Waiting to restart: ${u.waitingFor ?? "an app is being made"}.`, state: "working" };
    case "installing":
      return { title: `Installing ${v}`, body: `Kiwimake closes and opens again in a moment.${password}`, status: `Installing ${v}…`, state: "working" };
    case "error":
      return { title: u.version ? `${v} did not install` : "Kiwimake could not update", body: u.error ?? "Something went wrong.", status: u.error ?? "Something went wrong.", state: "problem" };
  }
}

