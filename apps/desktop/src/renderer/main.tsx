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
} from "@tyrum/operator-ui";
import "@tyrum/operator-ui/globals.css";
import { useState } from "react";
import { toErrorMessage } from "./lib/errors.js";
import { useDesktopOperatorCore } from "./lib/desktop-operator-core.js";

type SetupMode = "embedded" | "remote";

type RemoteSetupConfig = {
  wsUrl: string;
  tokenRef: string;
};

type RemoteSetupValidationResult =
  | { ok: true; config: RemoteSetupConfig }
  | { ok: false; errorMessage: string };

function validateRemoteSetupConfig({
  wsUrl,
  token,
}: {
  wsUrl: string;
  token: string;
}): RemoteSetupValidationResult {
  const trimmedWsUrl = wsUrl.trim();
  const trimmedToken = token.trim();

  if (!trimmedWsUrl) {
    return { ok: false, errorMessage: "Remote WebSocket URL is required." };
  }
  try {
    const parsed = new URL(trimmedWsUrl);
    if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
      throw new Error("invalid protocol");
    }
  } catch {
    return {
      ok: false,
      errorMessage: "Remote WebSocket URL must be a valid ws:// or wss:// URL.",
    };
  }
  if (!trimmedToken) {
    return { ok: false, errorMessage: "A gateway token is required for remote mode." };
  }

  return { ok: true, config: { wsUrl: trimmedWsUrl, tokenRef: trimmedToken } };
}

function SetupModeButtons({
  mode,
  busy,
  onModeChange,
}: {
  mode: SetupMode;
  busy: boolean;
  onModeChange: (mode: SetupMode) => void;
}) {
  return (
    <div className="flex gap-2">
      <Button
        variant={mode === "embedded" ? "primary" : "secondary"}
        disabled={busy}
        onClick={() => onModeChange("embedded")}
      >
        Embedded
      </Button>
      <Button
        variant={mode === "remote" ? "primary" : "secondary"}
        disabled={busy}
        onClick={() => onModeChange("remote")}
      >
        Remote
      </Button>
    </div>
  );
}

function RemoteModeFields({
  wsUrl,
  token,
  busy,
  onWsUrlChange,
  onTokenChange,
}: {
  wsUrl: string;
  token: string;
  busy: boolean;
  onWsUrlChange: (wsUrl: string) => void;
  onTokenChange: (token: string) => void;
}) {
  return (
    <div className="grid gap-4">
      <Input
        label="Gateway WebSocket URL"
        type="text"
        value={wsUrl}
        onChange={(e) => onWsUrlChange(e.target.value)}
        placeholder="wss://host:port/ws"
        disabled={busy}
        required
      />
      <Input
        label="Gateway token"
        type="password"
        value={token}
        onChange={(e) => onTokenChange(e.target.value)}
        placeholder="Bearer token"
        disabled={busy}
        required
      />
    </div>
  );
}

function DesktopSetupWizard({ onConfigured }: { onConfigured: () => void }) {
  const api = window.tyrumDesktop;
  const [mode, setMode] = useState<SetupMode>("embedded");
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
        const result = validateRemoteSetupConfig({ wsUrl: remoteWsUrl, token: remoteToken });
        if (!result.ok) {
          setErrorMessage(result.errorMessage);
          return;
        }
        await api.setConfig({ mode: "remote", remote: result.config });
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
          <Alert title="Set up Tyrum" description="Choose Embedded or Remote mode to continue." />

          <SetupModeButtons mode={mode} busy={busy} onModeChange={setMode} />

          {mode === "remote" ? (
            <RemoteModeFields
              wsUrl={remoteWsUrl}
              token={remoteToken}
              busy={busy}
              onWsUrlChange={setRemoteWsUrl}
              onTokenChange={setRemoteToken}
            />
          ) : (
            <div className="text-sm text-fg-muted">
              Embedded mode runs the gateway locally on this machine.
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
  const hostApi = { kind: "desktop" as const, api: window.tyrumDesktop ?? null };

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
              title="Connection unavailable"
              description={operatorCore.errorMessage ?? "Failed to initialize Tyrum."}
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
      <OperatorUiApp
        core={operatorCore.core}
        mode="desktop"
        adminAccessController={operatorCore.adminAccessController ?? undefined}
        onReloadPage={operatorCore.retry}
      />
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
