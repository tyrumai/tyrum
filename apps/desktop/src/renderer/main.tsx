import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { startDesktopThemeSync } from "./theme.js";

async function bootstrap(): Promise<void> {
  if (window.tyrumDesktop?.theme) {
    void startDesktopThemeSync(window.tyrumDesktop.theme).catch((error) => {
      console.error("Failed to start desktop theme sync", error);
    });
  }

  const root = document.getElementById("root")!;
  createRoot(root).render(<App />);
}

void bootstrap();
