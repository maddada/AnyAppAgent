import { useEffect, useState } from "react";
import type { Snapshot } from "../../shared/types.ts";
import { MainWindow } from "./MainWindow.tsx";
import { Onboarding, type StepId } from "./Onboarding.tsx";

const api = window.anyapp;

export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  // null: decide from settings. A step: the setup is open at that step.
  const [setupAt, setSetupAt] = useState<StepId | null>(null);
  const [connectRequest, setConnectRequest] = useState(0);

  useEffect(() => {
    void api.getSnapshot().then(setSnapshot);
    const off = api.onSnapshot(setSnapshot);
    const offNav = api.onNavigate((where) => {
      if (where === "connect-phone") setConnectRequest((n) => n + 1);
    });
    return () => {
      off();
      offNav();
    };
  }, []);

  useEffect(() => {
    (window as unknown as { __app: unknown }).__app = { setup: (step: StepId | null) => setSetupAt(step) };
  });

  if (!snapshot) return null;
  const showSetup = setupAt !== null || !snapshot.settings.onboardingDone;
  if (showSetup) {
    return (
      <Onboarding
        key={setupAt ?? "first"}
        snapshot={snapshot}
        start={setupAt ?? "welcome"}
        onClose={snapshot.settings.onboardingDone ? () => setSetupAt(null) : undefined}
        onFinish={() => {
          void api.setSetting("onboardingDone", true);
          setSetupAt(null);
        }}
      />
    );
  }
  return <MainWindow s={snapshot} openSetup={(step) => setSetupAt(step)} connectRequest={connectRequest} />;
}
