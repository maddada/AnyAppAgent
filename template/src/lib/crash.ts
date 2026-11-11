// Crash catcher: when the app crashes, AnyAppAgent on the phone shows "<app> crashed. Fix it?" and
// one tap sends the crash to the app's agent. Set up in App.tsx (installCrashCatcher, CrashBoundary,
// setCurrentScreen): leave that in place. Native crashes are caught by modules/diary by itself.
//
// For an error you catch but want fixed:  reportError(error)
import { DiaryNative } from '../../modules/diary';

let currentScreen: string | undefined;

/** The screen the person is on (App.tsx keeps it up to date), sent with a crash. */
export function setCurrentScreen(name: string | undefined): void {
  currentScreen = name;
}

function describe(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) return { message: `${error.name}: ${error.message}`, ...(error.stack ? { stack: error.stack } : {}) };
  return { message: String(error) };
}

function send(kind: 'crash' | 'error', error: unknown, fatal: boolean): void {
  try {
    const report = { kind, ...describe(error), ...(currentScreen ? { screen: currentScreen } : {}) };
    DiaryNative?.report(JSON.stringify(report), fatal);
  } catch {
    // never get in the way of the error itself
  }
}

/** Reports an error the app caught and survived (it shows on the crash card as an error). */
export function reportError(error: unknown): void {
  send('error', error, false);
}

type ErrorUtilsShape = {
  getGlobalHandler(): (error: unknown, isFatal?: boolean) => void;
  setGlobalHandler(handler: (error: unknown, isFatal?: boolean) => void): void;
};

let installed = false;

/** Reports fatal JavaScript errors (with the screen) before the app closes. Call once, at start. */
export function installCrashCatcher(): void {
  const utils = (globalThis as unknown as { ErrorUtils?: ErrorUtilsShape }).ErrorUtils;
  if (installed || !utils) return;
  installed = true;
  const previous = utils.getGlobalHandler();
  utils.setGlobalHandler((error, isFatal) => {
    send(isFatal ? 'crash' : 'error', error, Boolean(isFatal));
    previous(error, isFatal);
  });
}
