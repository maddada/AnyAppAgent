// Turns the builder's log lines (npm, expo prebuild, Gradle) into one plain progress line a
// non-technical person understands, for the `build` chat item. Never shows tool output itself.
// While a long step runs quietly, the line says how long it has been, so the build never looks
// stuck.

export interface ProgressStep {
  key: string;
  text: string;
}

const STEPS: { key: string; test: RegExp; text: (firstBuild: boolean) => string }[] = [
  { key: "install", test: /Dependencies changed|npm install/i, text: () => "Adding the new parts your app needs" },
  { key: "prebuild", test: /expo prebuild|Generating the native project|Native config changed/i, text: () => "Preparing your app's settings" },
  {
    key: "gradle",
    test: /Running Gradle/i,
    text: (first) => (first ? "Putting your app together. The first time takes a few minutes" : "Putting your app together"),
  },
  {
    key: "native",
    test: /> Task :.*(configureCMake|buildCMake|externalNativeBuild|compile.*Kotlin)/i,
    text: (first) => (first ? "Building the parts that run on the phone. This is the slow part the first time" : "Building the parts that run on the phone"),
  },
  { key: "bundle", test: /> Task :app:createBundleRelease(JsAndAssets)?/i, text: () => "Packing in your app's screens" },
  { key: "package", test: /> Task :app:(package|assemble)Release/i, text: () => "Packaging the new version" },
  { key: "verify", test: /APK ready/i, text: () => "Checking the new version" },
  { key: "retry", test: /Retrying Gradle/i, text: () => "Trying that step once more" },
];

const ORDER = ["start", "install", "prebuild", "gradle", "native", "bundle", "package", "verify"];

export class BuildProgress {
  private current: ProgressStep;
  private stepStartedAt = Date.now();
  private readonly firstBuild: boolean;

  constructor(firstBuild: boolean) {
    this.firstBuild = firstBuild;
    this.current = { key: "start", text: "Getting things ready" };
  }

  get text(): string {
    return this.withElapsed(this.current.text);
  }

  /** Feeds one log line; returns true when the visible step changed. */
  line(raw: string): boolean {
    const step = STEPS.find((s) => s.test.test(raw));
    if (!step) return false;
    if (step.key !== "retry" && ORDER.indexOf(step.key) <= ORDER.indexOf(this.current.key)) return false;
    this.current = { key: step.key, text: step.text(this.firstBuild) };
    this.stepStartedAt = Date.now();
    return true;
  }

  private withElapsed(text: string): string {
    const seconds = Math.round((Date.now() - this.stepStartedAt) / 1000);
    if (seconds < 60) return text;
    const minutes = Math.floor(seconds / 60);
    return `${text} (${minutes} minute${minutes === 1 ? "" : "s"} so far)`;
  }
}

/** One plain sentence for a failed build, for the person (the details go to the agent). */
export function plainBuildError(message: string): string {
  if (/error TS\d+|Type check failed/i.test(message)) return "A mistake in the app's code stopped the build.";
  if (/Metro|Unable to resolve module|SyntaxError|bundl/i.test(message)) return "A mistake in the app's code stopped the build.";
  if (/ERESOLVE|npm install failed/i.test(message)) return "One of the app's parts could not be added.";
  if (/prebuild|config plugin/i.test(message)) return "The app's settings could not be prepared.";
  if (/Kotlin|Java|compile|Gradle|What went wrong/i.test(message)) return "The app could not be put together.";
  return "The build stopped with a problem.";
}

/** Failures the agent cannot fix by changing the app's code: no point sending them back. */
export function isEnvironmentFailure(message: string): boolean {
  return /No JDK found|No Android SDK found|already running|ENOSPC|EBUSY|EPERM|not enough space|Could not reserve enough space/i.test(message);
}
