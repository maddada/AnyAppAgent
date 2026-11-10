import type { AnyAppBridge } from "../../shared/types.ts";

declare global {
  interface Window {
    anyapp: AnyAppBridge;
  }
}
export {};
