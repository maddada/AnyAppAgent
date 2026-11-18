import { NativeModule, requireOptionalNativeModule } from "expo";

export type AiProvider = "anthropic" | "openrouter";

export interface AiConfig {
  provider: AiProvider;
  model: string;
  defaultModel: string;
  /** The key's last 4 characters, to recognise it. The key itself never comes back to JS. */
  hint: string;
  savedAt: number;
  /** True while the adb-only test server switch is on (development). */
  testServer: boolean;
}

export interface AiTestResult {
  ok: boolean;
  code?: string;
  message?: string;
  model?: string;
  testServer?: boolean;
}

export interface AiAppUsage {
  packageName: string;
  label: string;
  installed: boolean;
  enabled: boolean;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  lastUsed: number;
  /** Calls refused because the app was switched off or over its limit. */
  refused: number;
}

type Events = {
  /** One event of a web app's AI call (webChat): `json` is a neutral event, the last is done or error. */
  onWebAiEvent: (event: { id: string; json: string }) => void;
};

declare class AnyAppAiModule extends NativeModule<Events> {
  getConfig(): AiConfig | null;
  detectProvider(key: string): AiProvider | null;
  defaultModel(provider: AiProvider): string;
  /** Encrypts and stores the key (Android Keystore). `provider` null = detect from the key. */
  save(key: string, provider: AiProvider | null, model: string | null): boolean;
  /** null = back to the provider's default. */
  setModel(model: string | null): void;
  remove(): void;
  test(): Promise<AiTestResult>;
  apps(): AiAppUsage[];
  setAppEnabled(packageName: string, enabled: boolean): void;
  forgetApp(packageName: string): void;

  // AI for web apps (docs/WEB-APPS.md): the same rules as the proxy Android apps bind to. `key` is
  // "web:<slug>", `label` "<App name> (web)" (Settings shows it). Missing on older native builds.
  /** JSON { ready, reason?, provider?, model? }. */
  webStatus?(key: string, label: string): string;
  /** Starts a call: `request` is the neutral request as JSON; its events come as onWebAiEvent with this `id`. */
  webChat?(key: string, label: string, id: string, request: string): void;
  webCancel?(key: string, id: string): void;
}

/** Null when the native side is missing (web, Expo Go). */
export const AnyAppAi = requireOptionalNativeModule<AnyAppAiModule>("AnyAppAi");
