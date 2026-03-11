import { useState } from "react";
import { Alert, Button, Card, CardContent, Input, Label } from "@tyrum/operator-ui";
import type { MobileBootstrapConfig } from "./mobile-config.js";
import { getDefaultActionSettings } from "./mobile-config.js";

type MobileSetupPageProps = {
  initialConfig?: Partial<MobileBootstrapConfig> | null;
  errorMessage?: string | null;
  busy?: boolean;
  onSubmit: (config: MobileBootstrapConfig) => Promise<void>;
};

function inferWsUrl(httpBaseUrl: string): string {
  const normalized = httpBaseUrl.trim().replace(/\/+$/, "");
  if (normalized.startsWith("https://")) {
    return `${normalized.replace(/^https:\/\//, "wss://")}/ws`;
  }
  if (normalized.startsWith("http://")) {
    return `${normalized.replace(/^http:\/\//, "ws://")}/ws`;
  }
  return normalized;
}

export function MobileSetupPage({
  initialConfig,
  errorMessage,
  busy = false,
  onSubmit,
}: MobileSetupPageProps) {
  const [httpBaseUrl, setHttpBaseUrl] = useState(initialConfig?.httpBaseUrl ?? "");
  const [wsUrl, setWsUrl] = useState(initialConfig?.wsUrl ?? "");
  const [token, setToken] = useState(initialConfig?.token ?? "");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const disabled = busy || saving;

  return (
    <div className="min-h-screen bg-bg px-4 py-8 text-fg">
      <div className="mx-auto grid max-w-xl gap-4">
        <Card>
          <CardContent className="grid gap-5 pt-6">
            <div className="grid gap-1">
              <h1 className="text-lg font-semibold">Connect Tyrum Mobile</h1>
              <p className="text-sm text-fg-muted">
                Connect this app to an existing Tyrum gateway and use the phone as a local mobile
                node for iOS or Android actions.
              </p>
            </div>

            {errorMessage ? (
              <Alert variant="error" title="Connection failed" description={errorMessage} />
            ) : null}
            {saveError ? (
              <Alert variant="error" title="Save failed" description={saveError} />
            ) : null}

            <div className="grid gap-2">
              <Label htmlFor="mobile-http-base-url">Gateway HTTP base URL</Label>
              <Input
                id="mobile-http-base-url"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                value={httpBaseUrl}
                placeholder="https://gateway.example"
                onChange={(event) => {
                  const nextValue = event.currentTarget.value;
                  setHttpBaseUrl(nextValue);
                  if (wsUrl.trim().length === 0) {
                    setWsUrl(inferWsUrl(nextValue));
                  }
                }}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="mobile-ws-url">Gateway WebSocket URL</Label>
              <Input
                id="mobile-ws-url"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                value={wsUrl}
                placeholder="wss://gateway.example/ws"
                onChange={(event) => {
                  setWsUrl(event.currentTarget.value);
                }}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="mobile-gateway-token">Gateway bearer token</Label>
              <Input
                id="mobile-gateway-token"
                type="password"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                value={token}
                placeholder="tyrum-token..."
                onChange={(event) => {
                  setToken(event.currentTarget.value);
                }}
              />
            </div>

            <div className="flex justify-end">
              <Button
                isLoading={saving}
                disabled={disabled}
                onClick={() => {
                  const normalizedHttp = httpBaseUrl.trim().replace(/\/+$/, "");
                  const normalizedWs = wsUrl.trim();
                  const normalizedToken = token.trim();
                  if (!normalizedHttp || !normalizedWs || !normalizedToken) {
                    setSaveError("HTTP URL, WebSocket URL, and token are required.");
                    return;
                  }

                  setSaving(true);
                  setSaveError(null);
                  void onSubmit({
                    httpBaseUrl: normalizedHttp,
                    wsUrl: normalizedWs,
                    token: normalizedToken,
                    nodeEnabled: initialConfig?.nodeEnabled ?? true,
                    actionSettings: initialConfig?.actionSettings ?? getDefaultActionSettings(),
                  })
                    .catch((error: unknown) => {
                      setSaveError(error instanceof Error ? error.message : String(error));
                    })
                    .finally(() => {
                      setSaving(false);
                    });
                }}
              >
                Save and connect
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
