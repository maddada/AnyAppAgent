// Which packages the phone rechecks with Android (installer.ts refreshPackages). Pure functions, no
// React: dev/packages.test.mjs runs them with `node --test`.
import type { App } from "./protocol";

/**
 * Every package to ask Android about: the apps in the list, and the ones only the cache still
 * knows. An app deleted from the list (and maybe uninstalled with it) keeps its cache entry; if
 * nothing rechecked it, a restore would show its tile as installed ("Open") after the uninstall.
 */
export function packagesToCheck(apps: Record<string, Pick<App, "packageName">>, cached: Record<string, unknown>): string[] {
  const names = new Set<string>(Object.keys(cached));
  for (const app of Object.values(apps)) names.add(app.packageName);
  return [...names];
}

/**
 * The packages of apps that come back into the list (restored, unhidden, or new to it, from this
 * phone or from another device): their cache entry may be from before they left, so recheck them.
 */
export function packagesComingBack(before: Record<string, Pick<App, "id" | "hidden">>, incoming: Pick<App, "id" | "packageName" | "hidden">[]): string[] {
  return incoming.filter((app) => !app.hidden && (!before[app.id] || before[app.id].hidden)).map((app) => app.packageName);
}
