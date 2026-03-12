import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@tyrum/operator-ui";
import type { MobileBootstrapConfig } from "./mobile-config.js";
import {
  getDefaultActionSettings,
  getDefaultLocationStreamingConfig,
  inferGatewayWsUrl,
  normalizeHttpBaseUrl,
  normalizeWsUrl,
  sameMobileBootstrapConfig,
} from "./mobile-config.js";

type MobileSetupPageProps = {
  initialConfig?: Partial<MobileBootstrapConfig> | null;
  existingConfig?: MobileBootstrapConfig | null;
  intentMessage?: string | null;
  intentErrorMessage?: string | null;
  errorMessage?: string | null;
  busy?: boolean;
  scanQrAvailable?: boolean;
  scanQrBusy?: boolean;
  onScanQr?: () => Promise<void>;
  onCancel?: () => void;
  onSubmit: (config: MobileBootstrapConfig) => Promise<void>;
};

export function MobileSetupPage({
  initialConfig,
  existingConfig,
  intentMessage,
  intentErrorMessage,
  errorMessage,
  busy = false,
  scanQrAvailable = false,
  scanQrBusy = false,
  onScanQr,
  onCancel,
  onSubmit,
}: MobileSetupPageProps) {
  const [httpBaseUrl, setHttpBaseUrl] = useState(initialConfig?.httpBaseUrl ?? "");
  const [wsUrl, setWsUrl] = useState(initialConfig?.wsUrl ?? "");
  const [token, setToken] = useState(initialConfig?.token ?? "");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingSubmit, setPendingSubmit] = useState<MobileBootstrapConfig | null>(null);
  const submitInFlightRef = useRef(false);
  const initialHttpBaseUrl = initialConfig?.httpBaseUrl ?? "";
  const initialWsUrl = initialConfig?.wsUrl ?? "";
  const initialToken = initialConfig?.token ?? "";

  useEffect(() => {
    setHttpBaseUrl(initialHttpBaseUrl);
    setWsUrl(initialWsUrl);
    setToken(initialToken);
    setSaveError(null);
    setConfirmOpen(false);
    setPendingSubmit(null);
  }, [initialHttpBaseUrl, initialToken, initialWsUrl]);

  const disabled = busy || saving || scanQrBusy;

  const submitConfig = async (config: MobileBootstrapConfig): Promise<void> => {
    if (submitInFlightRef.current) {
      return;
    }

    submitInFlightRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      await onSubmit(config);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      submitInFlightRef.current = false;
      setSaving(false);
      setPendingSubmit(null);
      setConfirmOpen(false);
    }
  };

  const handleSave = (): void => {
    const normalizedHttp = normalizeHttpBaseUrl(httpBaseUrl);
    const normalizedWs = normalizeWsUrl(wsUrl);
    const normalizedToken = token.trim();
    if (!normalizedHttp || !normalizedWs || !normalizedToken) {
      setSaveError("HTTP URL, WebSocket URL, and token are required.");
      return;
    }

    const nextConfig: MobileBootstrapConfig = {
      httpBaseUrl: normalizedHttp,
      wsUrl: normalizedWs,
      token: normalizedToken,
      nodeEnabled: initialConfig?.nodeEnabled ?? true,
      actionSettings: initialConfig?.actionSettings ?? getDefaultActionSettings(),
      locationStreaming: initialConfig?.locationStreaming ?? getDefaultLocationStreamingConfig(),
    };

    if (existingConfig && !sameMobileBootstrapConfig(existingConfig, nextConfig)) {
      setPendingSubmit(nextConfig);
      setConfirmOpen(true);
      return;
    }

    void submitConfig(nextConfig);
  };

  const handleConfirmOpenChange = (open: boolean): void => {
    setConfirmOpen(open);
    if (!open) {
      setPendingSubmit(null);
    }
  };

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
            {intentMessage ? (
              <Alert variant="info" title="Mobile bootstrap loaded" description={intentMessage} />
            ) : null}
            {intentErrorMessage ? (
              <Alert
                variant="error"
                title="Bootstrap import failed"
                description={intentErrorMessage}
              />
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
                    setWsUrl(inferGatewayWsUrl(nextValue));
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

            <div className="flex flex-wrap justify-end gap-2">
              {scanQrAvailable && onScanQr ? (
                <Button
                  variant="outline"
                  isLoading={scanQrBusy}
                  disabled={disabled}
                  onClick={() => {
                    void onScanQr();
                  }}
                >
                  Scan QR
                </Button>
              ) : null}
              {onCancel ? (
                <Button variant="outline" disabled={disabled} onClick={onCancel}>
                  Cancel
                </Button>
              ) : null}
              <Button
                isLoading={saving}
                disabled={disabled}
                onClick={() => {
                  handleSave();
                }}
              >
                Save and connect
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={confirmOpen} onOpenChange={handleConfirmOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Replace saved mobile config?</DialogTitle>
            <DialogDescription>
              This will replace the current saved gateway connection and reconnect Tyrum Mobile to
              the new endpoint.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              onClick={() => {
                setConfirmOpen(false);
                setPendingSubmit(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              isLoading={saving}
              disabled={disabled || !pendingSubmit}
              onClick={() => {
                if (!pendingSubmit) return;
                void submitConfig(pendingSubmit);
              }}
            >
              Replace and connect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
