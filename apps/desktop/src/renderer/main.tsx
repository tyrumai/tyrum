import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@tyrum/operator-ui";
import "@tyrum/operator-ui/globals.css";
import { App } from "./App.js";
import { startDesktopThemeSync } from "./theme.js";

function bootstrap(): void {
  if (window.tyrumDesktop?.theme) {
    void startDesktopThemeSync(window.tyrumDesktop.theme).catch((error) => {
      console.error("Failed to start desktop theme sync", error);
    });
  }

  const root = document.getElementById("root")!;
  createRoot(root).render(
    <ThemeProvider>
      <App />
    </ThemeProvider>,
  );
}

bootstrap();
