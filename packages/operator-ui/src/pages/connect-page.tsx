import type { OperatorCore } from "@tyrum/operator-core";
import { useRef, useState } from "react";
import type { OperatorUiMode } from "../app.js";
import { Button } from "../components/ui/button.js";
import { Card, CardContent, CardFooter, CardHeader } from "../components/ui/card.js";
import { Textarea } from "../components/ui/textarea.js";
import { Alert } from "../components/ui/alert.js";
import { readGatewayError } from "../utils/gateway-error.js";
import { useOperatorStore } from "../use-operator-store.js";

export function ConnectPage({ core, mode }: { core: OperatorCore; mode: OperatorUiMode }) {
  const connection = useOperatorStore(core.connectionStore);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const tokenRef = useRef<HTMLTextAreaElement | null>(null);
  const title = mode === "web" ? "Login" : "Connect";
  const isWeb = mode === "web";

  const login = async (): Promise<void> => {
    if (!isWeb) return;

    const trimmed = tokenRef.current?.value.trim() ?? "";
    if (!trimmed) {
      setLoginError("Token is required");
      return;
    }

    setLoginBusy(true);
    setLoginError(null);
    try {
      const res = await fetch("/auth/session", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ token: trimmed }),
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
      <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>

      {isWeb ? (
        <Card>
          <CardHeader className="pb-4">
            <div className="text-sm text-fg-muted">
              Enter your gateway token to start a session.
            </div>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Textarea
              data-testid="login-token"
              label="Token"
              rows={3}
              ref={tokenRef}
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
            />
            <Button
              data-testid="login-button"
              isLoading={loginBusy}
              onClick={() => {
                void login();
              }}
            >
              Login
            </Button>
            {loginError ? (
              <Alert variant="error" title="Login failed" description={loginError} />
            ) : null}
          </CardContent>
        </Card>
      ) : null}

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
