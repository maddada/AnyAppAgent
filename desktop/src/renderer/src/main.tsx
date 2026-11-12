import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// The shared Kiwimake theme: every --aa-* variable and the bundled fonts (shared/theme/README.md).
import "../../../../shared/theme/theme.css";
import { App } from "./App.tsx";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
