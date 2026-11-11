// Native side of src/lib/ai.ts: talks to AnyAppAgent's local AI service (it holds the key).
// Use src/lib/ai.ts, not this file. Wire format: modules/ai/README.md.
import { requireNativeModule, type EventSubscription } from 'expo';

type AnyappAiNative = {
  /** JSON: { ready, reason?, provider?, model? } */
  status(): Promise<string>;
  start(id: string, request: string): Promise<boolean>;
  cancel(id: string): void;
  isAgentInstalled(): boolean;
  openSetup(): boolean;
  addListener(event: 'onEvent', listener: (e: { id: string; json: string }) => void): EventSubscription;
};

export const AiNative = requireNativeModule<AnyappAiNative>('AnyappAi');
