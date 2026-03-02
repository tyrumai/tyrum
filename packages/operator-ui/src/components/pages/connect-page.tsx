import { type OperatorCore, createGatewayAuthSession } from "@tyrum/operator-core";
import { useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import type { OperatorUiMode } from "../../app.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardFooter, CardHeader } from "../ui/card.js";
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
  hideHeader,
  onReconfigureGateway,
}: {
  core: OperatorCore;
  mode: OperatorUiMode;
  hideHeader?: boolean;
  onReconfigureGateway?: (httpUrl: string, wsUrl: string) => void;
}) {
  const connection = useOperatorStore(core.connectionStore);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [gatewayUrl, setGatewayUrl] = useState(core.httpBaseUrl);

  const tokenRef = useRef<HTMLInputElement | null>(null);
  const title = mode === "web" ? "Login" : "Connect";
  const isWeb = mode === "web";

  const loginOrConnect = async (): Promise<void> => {
    const trimmedUrl = gatewayUrl.trim();
    if (onReconfigureGateway && trimmedUrl !== core.httpBaseUrl) {
      const wsBaseUrl = trimTrailingSlashes(trimmedUrl);
      const wsUrl = wsBaseUrl.replace(/^http/, "ws") + "/ws";
      onReconfigureGateway(trimmedUrl, wsUrl);
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
    <div className="grid gap-6">
      {hideHeader ? null : (
        <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
      )}

      <Card>
        <CardHeader className="pb-4">
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
                  onClick={() => setShowToken(!showToken)}
                >
                  {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              }
            />
          ) : null}

          <Button
            data-testid="login-button"
            isLoading={loginBusy || connection.status === "connecting"}
            onClick={() => {
              void loginOrConnect();
            }}
          >
            {isWeb ? "Login" : "Connect"}
          </Button>

          {loginError ? (
            <Alert variant="error" title="Login failed" description={loginError} />
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
            <span>Connection status:</span>
            <span className="font-medium text-fg">{connection.status}</span>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3">
          {connection.transportError ? (
            <Alert
              variant="error"
              title="Transport error"
              description={connection.transportError}
            />
          ) : null}
          {connection.lastDisconnect ? (
            <Alert
              variant="error"
              title="Last disconnect"
              description={`${connection.lastDisconnect.code} ${connection.lastDisconnect.reason}`}
            />
          ) : null}
        </CardContent>
        <CardFooter className="gap-2">
          <Button
            variant="secondary"
            data-testid="connect-button"
            onClick={() => {
              core.connect();
            }}
          >
            Connect
          </Button>
          <Button
            variant="outline"
            data-testid="disconnect-button"
            onClick={() => {
              core.disconnect();
            }}
          >
            Disconnect
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
