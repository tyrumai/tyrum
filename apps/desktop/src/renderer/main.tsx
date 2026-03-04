import { createRoot } from "react-dom/client";
import {
  Alert,
  Button,
  Card,
  CardContent,
  ErrorBoundary,
  Input,
  OperatorUiApp,
  OperatorUiHostProvider,
  ThemeProvider,
  getDesktopApi,
} from "@tyrum/operator-ui";
import "@tyrum/operator-ui/globals.css";
import { useState } from "react";
import { toErrorMessage } from "./lib/errors.js";
import { useDesktopOperatorCore } from "./lib/desktop-operator-core.js";

function DesktopSetupWizard({ onConfigured }: { onConfigured: () => void }) {
  const api = window.tyrumDesktop;
  const [mode, setMode] = useState<"embedded" | "remote">("embedded");
  const [remoteWsUrl, setRemoteWsUrl] = useState("ws://127.0.0.1:8788/ws");
  const [remoteToken, setRemoteToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const saveConfig = async (): Promise<void> => {
    if (!api || busy) return;

    setBusy(true);
    setErrorMessage(null);
    try {
      if (mode === "embedded") {
        await api.setConfig({ mode: "embedded" });
      } else {
        const wsUrl = remoteWsUrl.trim();
        const token = remoteToken.trim();

        if (!wsUrl) {
          setErrorMessage("Remote WebSocket URL is required.");
          return;
        }
        try {
          const parsed = new URL(wsUrl);
          if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
            throw new Error("invalid protocol");
          }
        } catch {
          setErrorMessage("Remote WebSocket URL must be a valid ws:// or wss:// URL.");
          return;
        }
        if (!token) {
          setErrorMessage("A gateway token is required for remote mode.");
          return;
        }

        await api.setConfig({ mode: "remote", remote: { wsUrl, tokenRef: token } });
      }

      onConfigured();
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto mt-20 max-w-md w-full px-4" data-testid="desktop-setup-wizard">
      <Card>
        <CardContent className="grid gap-4 py-6">
          <Alert
            title="Set up Tyrum Desktop"
            description="Choose Embedded or Remote mode to continue."
          />

          <div className="flex gap-2">
            <Button
              variant={mode === "embedded" ? "primary" : "secondary"}
              disabled={busy}
              onClick={() => setMode("embedded")}
            >
              Embedded
            </Button>
            <Button
              variant={mode === "remote" ? "primary" : "secondary"}
              disabled={busy}
              onClick={() => setMode("remote")}
            >
              Remote
            </Button>
          </div>

          {mode === "remote" ? (
            <div className="grid gap-4">
              <Input
                label="Gateway WebSocket URL"
                type="text"
                value={remoteWsUrl}
                onChange={(e) => setRemoteWsUrl(e.target.value)}
                placeholder="wss://host:port/ws"
                disabled={busy}
                required
              />
              <Input
                label="Gateway token"
                type="password"
                value={remoteToken}
                onChange={(e) => setRemoteToken(e.target.value)}
                placeholder="Bearer token"
                disabled={busy}
                required
              />
            </div>
          ) : (
            <div className="text-sm text-fg-muted">
              Embedded mode runs an Operator gateway locally on this machine.
            </div>
          )}

          {errorMessage ? (
            <Alert variant="error" title="Setup error" description={errorMessage} />
          ) : null}

          <Button
            isLoading={busy}
            onClick={() => {
              void saveConfig();
            }}
          >
            Continue
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function DesktopBootstrap() {
  const operatorCore = useDesktopOperatorCore();
  const hostApi = { kind: "desktop" as const, api: getDesktopApi() };

  if (operatorCore.needsConfiguration) {
    return <DesktopSetupWizard onConfigured={operatorCore.retry} />;
  }

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
