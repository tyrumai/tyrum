import type { OperatorCore } from "@tyrum/operator-core";
import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import type { OperatorUiMode } from "../../app.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { Input } from "../ui/input.js";
import { Alert } from "../ui/alert.js";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import { useOperatorStore } from "../../use-operator-store.js";
import type { WebAuthPersistence } from "../../web-auth.js";

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
  webAuthPersistence,
}: {
  core: OperatorCore;
  mode: OperatorUiMode;
  onReconfigureGateway?: (httpUrl: string, wsUrl: string) => void;
  webAuthPersistence?: WebAuthPersistence;
}) {
  const connection = useOperatorStore(core.connectionStore);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [gatewayUrl, setGatewayUrl] = useState(core.httpBaseUrl);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const tokenRef = useRef<HTMLInputElement | null>(null);
  const isWeb = mode === "web";
  const hasSavedWebToken = isWeb && webAuthPersistence?.hasStoredToken === true;

  const [disconnectDismissed, setDisconnectDismissed] = useState(false);

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
    setDisconnectDismissed(false);
  }, [lastDisconnect, connection.transportError]);

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
      if (hasSavedWebToken) {
        setLoginError(null);
        core.connect();
        return;
      }
      setLoginError("Token is required");
      return;
    }

    setLoginBusy(true);
    setLoginError(null);
    try {
      if (!webAuthPersistence) {
        throw new Error("Browser token storage is unavailable.");
      }
      await webAuthPersistence.saveToken(trimmed);
      if (tokenRef.current) {
        tokenRef.current.value = "";
      }
    } catch (error) {
      setLoginError(formatErrorMessage(error));
    } finally {
      setLoginBusy(false);
    }
  };

  const forgetSavedToken = async (): Promise<void> => {
    if (!hasSavedWebToken) return;
    setLoginBusy(true);
    setLoginError(null);
    try {
      if (!webAuthPersistence) {
        throw new Error("Browser token storage is unavailable.");
      }
      await webAuthPersistence.clearToken();
      if (tokenRef.current) {
        tokenRef.current.value = "";
      }
    } catch (error) {
      setLoginError(formatErrorMessage(error));
    } finally {
      setLoginBusy(false);
    }
  };

  return (
    <div className="grid gap-5">
      <Card>
        <CardHeader className="grid gap-2 pb-2.5">
          <div className="text-lg font-semibold text-fg">Connect to Tyrum</div>
          <div className="text-sm text-fg-muted">
            {isWeb
              ? "Enter a tenant admin token to connect to Tyrum."
              : "Connect to the local gateway."}
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          {isWeb ? (
            <Alert
              title="Need a gateway token?"
              description={
                <>
                  Use the <code>default-tenant-admin</code> token printed when the gateway starts
                  for the first time. If you need a new one, run{" "}
                  <code>tyrum tokens issue-default-tenant-admin</code>.
                </>
              }
            />
          ) : null}

          {hasSavedWebToken ? (
            <Alert
              variant="info"
              title="Saved token available"
              description="Leave the token field blank to reconnect with the saved token, paste a new token to replace it, or forget the saved token."
            />
          ) : null}

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
              helperText="Default local gateway URL is prefilled. Change it only if the gateway is running elsewhere."
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
              helperText={
                hasSavedWebToken
                  ? "Leave blank to reconnect with the saved token, or paste a new token to replace it."
                  : "Paste the tenant admin token from gateway startup or a newly issued recovery token."
              }
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

          <div className="grid gap-2">
            <Button
              data-testid="login-button"
              isLoading={connectButtonBusy}
              onClick={() => {
                void loginOrConnect();
              }}
            >
              {connectButtonLabel}
            </Button>
            {hasSavedWebToken ? (
              <Button
                data-testid="forget-saved-token-button"
                variant="secondary"
                disabled={connectButtonBusy}
                onClick={() => {
                  void forgetSavedToken();
                }}
              >
                Forget saved token
              </Button>
            ) : null}
          </div>
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
            <Alert
              variant="error"
              title="Login failed"
              description={loginError}
              onDismiss={() => setLoginError(null)}
            />
          ) : null}

          {disconnectDescription && !disconnectDismissed ? (
            <Alert
              variant="error"
              title="Disconnected"
              description={disconnectDescription}
              onDismiss={() => setDisconnectDismissed(true)}
            />
          ) : connection.transportError && !disconnectDismissed ? (
            <Alert
              variant="error"
              title="Transport error"
              description={connection.transportError}
              onDismiss={() => setDisconnectDismissed(true)}
            />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
