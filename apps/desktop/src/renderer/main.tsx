import { createRoot } from "react-dom/client";
import {
  Alert,
  Button,
  Card,
  CardContent,
  ErrorBoundary,
  OperatorUiApp,
  OperatorUiHostProvider,
  ThemeProvider,
  getDesktopApi,
} from "@tyrum/operator-ui";
import "@tyrum/operator-ui/globals.css";
import { useDesktopOperatorCore } from "./lib/desktop-operator-core.js";

function DesktopBootstrap() {
  const operatorCore = useDesktopOperatorCore();
  const hostApi = { kind: "desktop" as const, api: getDesktopApi() };

  if (operatorCore.busy && !operatorCore.core) {
    return (
      <div className="mx-auto mt-20 max-w-md w-full px-4">
        <Card>
          <CardContent className="grid gap-4 py-6">
            <div className="text-sm font-semibold text-fg">Starting…</div>
            <div className="text-sm text-fg-muted">Bootstrapping desktop connection.</div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!operatorCore.core) {
    return (
      <div className="mx-auto mt-20 max-w-md w-full px-4">
        <Card>
          <CardContent className="grid gap-4 py-6">
            <Alert
              variant="error"
              title="Operator connection unavailable"
              description={operatorCore.errorMessage ?? "Failed to initialize operator core."}
            />
            <Button
              onClick={() => {
                operatorCore.retry();
              }}
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <OperatorUiHostProvider value={hostApi}>
      <OperatorUiApp core={operatorCore.core} mode="desktop" onReloadPage={operatorCore.retry} />
    </OperatorUiHostProvider>
  );
}

function bootstrap(): void {
  const root = document.getElementById("root")!;
  createRoot(root).render(
    <ThemeProvider>
      <ErrorBoundary onReloadPage={() => window.location.reload()}>
        <DesktopBootstrap />
      </ErrorBoundary>
    </ThemeProvider>,
  );
}

bootstrap();
