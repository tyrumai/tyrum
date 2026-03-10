import { type OperatorCore, createGatewayAuthSession } from "@tyrum/operator-core";
import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import type { OperatorUiMode } from "../../app.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { Input } from "../ui/input.js";
import { Alert } from "../ui/alert.js";
import { readGatewayError } from "../../utils/gateway-error.js";
import { useOperatorStore } from "../../use-operator-store.js";

function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) {
    end--;
  }
  return value.slice(0, end);
}

export function ConnectPage({
  core,
  mode,
  onReconfigureGateway,
}: {
  core: OperatorCore;
  mode: OperatorUiMode;
  onReconfigureGateway?: (httpUrl: string, wsUrl: string) => void;
}) {
  const connection = useOperatorStore(core.connectionStore);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [gatewayUrl, setGatewayUrl] = useState(core.httpBaseUrl);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const tokenRef = useRef<HTMLInputElement | null>(null);
  const isWeb = mode === "web";

  const lastDisconnect = connection.lastDisconnect;
  const nextRetryAtMs = connection.nextRetryAtMs;
  const hasScheduledRetry = typeof nextRetryAtMs === "number";
  const isConnecting = connection.status === "connecting" || hasScheduledRetry;
  const connectButtonBusy = loginBusy || isConnecting;
  const disconnectDescription = lastDisconnect
    ? lastDisconnect.reason.trim().length > 0
      ? `${lastDisconnect.reason} (code ${lastDisconnect.code})`
      : `Code ${lastDisconnect.code}`
    : null;

  useEffect(() => {
    if (!hasScheduledRetry) return;
    setNowMs(Date.now());
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 1_000);
    return () => {
      clearInterval(timer);
    };
  }, [hasScheduledRetry, nextRetryAtMs]);

  const retryCountdownSeconds =
    hasScheduledRetry && nextRetryAtMs !== null
      ? Math.max(0, Math.ceil((nextRetryAtMs - nowMs) / 1_000))
      : null;
  const connectButtonLabel = isConnecting
    ? retryCountdownSeconds !== null
      ? `Connecting (${String(retryCountdownSeconds)}s)`
      : "Connecting"
    : "Connect";

  const loginOrConnect = async (): Promise<void> => {
    const trimmedUrl = gatewayUrl.trim();
    const normalizedHttpUrl = trimTrailingSlashes(trimmedUrl);
    const normalizedCoreHttpUrl = trimTrailingSlashes(core.httpBaseUrl.trim());
    if (onReconfigureGateway && normalizedHttpUrl !== normalizedCoreHttpUrl) {
      const wsUrl =
        normalizedHttpUrl.replace(/^https?/i, (protocol) =>
          protocol.toLowerCase() === "https" ? "wss" : "ws",
        ) + "/ws";
      onReconfigureGateway(normalizedHttpUrl, wsUrl);
      return;
    }

    if (!isWeb) {
      core.connect();
      return;
    }

    const trimmed = tokenRef.current?.value.trim() ?? "";
    if (!trimmed) {
      setLoginError("Token is required");
      return;
    }

    setLoginBusy(true);
    setLoginError(null);
    try {
      const res = await createGatewayAuthSession({
        token: trimmed,
        httpBaseUrl: core.httpBaseUrl,
      });
      if (!res.ok) {
        setLoginError(await readGatewayError(res));
        return;
      }
      if (tokenRef.current) {
        tokenRef.current.value = "";
      }
      core.connect();
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoginBusy(false);
    }
  };

  return (
    <div className="grid gap-5">
      <Card>
        <CardHeader className="pb-2.5">
          <div className="text-sm text-fg-muted">
            {isWeb
              ? "Enter your gateway token to start a session."
              : "Connect to the local operator gateway."}
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          {onReconfigureGateway ? (
            <Input
              id="gateway-url"
              data-testid="gateway-url"
              label="Gateway URL"
              value={gatewayUrl}
              onChange={(e) => setGatewayUrl(e.target.value)}
              type="url"
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
            />
          ) : null}

          {isWeb ? (
            <Input
              id="login-token"
              data-testid="login-token"
              label="Token"
              ref={tokenRef}
              type={showToken ? "text" : "password"}
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
              suffix={
                <button
                  type="button"
                  data-testid="toggle-token-visibility"
                  className="hover:text-fg"
                  aria-label="Toggle token visibility"
                  aria-pressed={showToken}
                  onClick={() => setShowToken(!showToken)}
                >
                  {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              }
            />
          ) : null}

          <Button
            data-testid="login-button"
            isLoading={connectButtonBusy}
            onClick={() => {
              void loginOrConnect();
            }}
          >
            {connectButtonLabel}
          </Button>
          {isConnecting ? (
            <Button
              data-testid="cancel-connect-button"
              variant="secondary"
              onClick={() => {
                core.disconnect();
              }}
            >
              Cancel
            </Button>
          ) : null}

          {loginError ? (
            <Alert variant="error" title="Login failed" description={loginError} />
          ) : null}

          {disconnectDescription ? (
            <Alert variant="error" title="Disconnected" description={disconnectDescription} />
          ) : connection.transportError ? (
            <Alert
              variant="error"
              title="Transport error"
              description={connection.transportError}
            />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
