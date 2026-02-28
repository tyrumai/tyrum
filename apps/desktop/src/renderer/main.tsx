import { createRoot } from "react-dom/client";
import { ErrorBoundary, ThemeProvider } from "@tyrum/operator-ui";
import "@tyrum/operator-ui/globals.css";
import { App } from "./App.js";

function bootstrap(): void {
  const root = document.getElementById("root")!;
  createRoot(root).render(
    <ThemeProvider>
      <ErrorBoundary onReloadPage={() => window.location.reload()}>
        <App />
      </ErrorBoundary>
    </ThemeProvider>,
  );
}

bootstrap();
