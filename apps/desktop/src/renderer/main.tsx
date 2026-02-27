import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { startDesktopThemeSync } from "./theme.js";

async function bootstrap(): Promise<void> {
  if (window.tyrumDesktop?.theme) {
    await startDesktopThemeSync(window.tyrumDesktop.theme);
  }

  const root = document.getElementById("root")!;
  createRoot(root).render(<App />);
}

void bootstrap();
