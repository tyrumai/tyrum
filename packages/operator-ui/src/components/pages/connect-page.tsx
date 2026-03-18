import type { OperatorCore } from "@tyrum/operator-core";
import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import type { OperatorUiMode } from "../../app.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { Input } from "../ui/input.js";
import { Alert } from "../ui/alert.js";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip.js";
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
  const [tokenValue, setTokenValue] = useState("");
  const [savedTokenValue, setSavedTokenValue] = useState<string | null>(null);
  const [loadingSavedToken, setLoadingSavedToken] = useState(
    mode === "web" &&
      webAuthPersistence?.hasStoredToken === true &&
      !!webAuthPersistence?.readToken,
  );
  const [nowMs, setNowMs] = useState(() => Date.now());

  const tokenEditedRef = useRef(false);
  const isWeb = mode === "web";
  const hasSavedWebToken = isWeb && webAuthPersistence?.hasStoredToken === true;

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

  useEffect(() => {
    tokenEditedRef.current = false;
    setSavedTokenValue(null);
    setTokenValue("");
    if (!hasSavedWebToken || !webAuthPersistence?.readToken) {
      setLoadingSavedToken(false);
      return;
    }
    const { readToken } = webAuthPersistence;
    let cancelled = false;
    setLoadingSavedToken(true);
    void Promise.resolve()
      .then(() => readToken())
      .then((storedToken) => {
        if (cancelled) return;
        const normalizedToken =
          typeof storedToken === "string" && storedToken.trim().length > 0
            ? storedToken.trim()
            : null;
        setSavedTokenValue(normalizedToken);
        if (!tokenEditedRef.current) {
          setTokenValue(normalizedToken ?? "");
        }
      })
      .catch(() => {
        if (cancelled) return;
        setSavedTokenValue(null);
        if (!tokenEditedRef.current) {
          setTokenValue("");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingSavedToken(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [hasSavedWebToken, webAuthPersistence]);

  const retryCountdownSeconds =
    hasScheduledRetry && nextRetryAtMs !== null
      ? Math.max(0, Math.ceil((nextRetryAtMs - nowMs) / 1_000))
      : null;
  const connectButtonLabel = isConnecting
    ? retryCountdownSeconds !== null
      ? `Connecting (${String(retryCountdownSeconds)}s)`
      : "Connecting"
    : "Connect";
  const tokenHelperText = !isWeb
    ? undefined
    : loadingSavedToken
      ? "Loading saved token..."
      : hasSavedWebToken
        ? tokenValue.trim().length === 0
          ? "Paste a replacement token, or forget the saved token below."
          : savedTokenValue !== null && tokenValue.trim() === savedTokenValue
            ? "Saved token loaded. Connect to reuse it, or replace it with a new one."
            : "This token will replace the saved token when you connect."
        : "Paste a tenant admin token.";

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

    if (loadingSavedToken) {
      return;
    }
    const trimmed = tokenValue.trim();
    if (!trimmed) {
      if (hasSavedWebToken && !tokenEditedRef.current) {
        setLoginError(null);
        core.connect();
        return;
      }
      setLoginError("Token is required");
      return;
    }
    if (hasSavedWebToken && savedTokenValue !== null && trimmed === savedTokenValue) {
      setLoginError(null);
      core.connect();
      return;
    }

    setLoginBusy(true);
    setLoginError(null);
    try {
      if (!webAuthPersistence) {
        throw new Error("Browser token storage is unavailable.");
      }
      await webAuthPersistence.saveToken(trimmed);
      tokenEditedRef.current = false;
      setTokenValue("");
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
              className="pr-20"
              value={tokenValue}
              onChange={(event) => {
                tokenEditedRef.current = true;
                setTokenValue(event.currentTarget.value);
              }}
              type={showToken ? "text" : "password"}
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
              helperText={tokenHelperText}
              suffix={
                <div className="flex items-center gap-1">
                  <TooltipProvider delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          data-testid="login-token-help"
                          className="rounded-md p-1 text-fg-muted transition-colors duration-150 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                          aria-label="How to get a gateway token"
                        >
                          <span aria-hidden="true" className="text-xs font-semibold leading-none">
                            ?
                          </span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-72 text-left leading-relaxed">
                        Use the <code>default-tenant-admin</code> token printed when the gateway
                        starts for the first time. Need a new one? Run{" "}
                        <code>tyrum tokens issue-default-tenant-admin</code>.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <button
                    type="button"
                    data-testid="toggle-token-visibility"
                    className="rounded-md p-1 text-fg-muted transition-colors duration-150 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                    aria-label="Toggle token visibility"
                    aria-pressed={showToken}
                    onClick={() => setShowToken(!showToken)}
                  >
                    {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              }
            />
          ) : null}

          <div className="grid gap-2">
            <Button
              data-testid="login-button"
              isLoading={connectButtonBusy}
              disabled={loadingSavedToken}
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
                disabled={connectButtonBusy || loadingSavedToken}
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
