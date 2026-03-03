import { useEffect, useState } from "react";
import { toErrorMessage } from "../lib/errors.js";
import {
  Alert,
  Button,
  Card,
  CardContent,
  ConnectPage as OperatorConnectPage,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@tyrum/operator-ui";
import type { OperatorCore } from "@tyrum/operator-core";

type Tab = "embedded" | "remote" | "operator";

export interface ConnectionPageProps {
  core: OperatorCore | null;
  busy: boolean;
  errorMessage: string | null;
  retry: () => void;
  configExists: boolean;
  refreshConfigState: () => Promise<void>;
  setupGateActive: boolean;
}

function summarizeOperatorConnection(core: OperatorCore | null): string | null {
  if (!core) return null;
  const snapshot = core.connectionStore.getSnapshot() as {
    status?: unknown;
    transportError?: unknown;
    lastDisconnect?: unknown;
  };

  const status = snapshot.status;
  const transportError = snapshot.transportError;
  const lastDisconnect = snapshot.lastDisconnect;

  if (typeof transportError === "string" && transportError.trim().length > 0) {
    return transportError;
  }

  if (lastDisconnect && typeof lastDisconnect === "object" && !Array.isArray(lastDisconnect)) {
    const reason = (lastDisconnect as Record<string, unknown>)["reason"];
    if (typeof reason === "string" && reason.trim().length > 0) {
      return reason;
    }
  }

  if (typeof status === "string" && status !== "connected") {
    return `Operator connection is ${status}.`;
  }

  return null;
}

function formatSetupError(errorMessage: string): string {
  const msg = errorMessage.trim();
  if (/\bEADDRINUSE\b/i.test(msg) || /address already in use/i.test(msg)) {
    return `${msg}\n\nAnother gateway is likely already running on this port. Either stop it, or switch to Remote mode and connect to that gateway instead.`;
  }
  return msg;
}

export function ConnectionPage({
  core,
  busy: operatorBusy,
  errorMessage,
  retry,
  configExists,
  refreshConfigState,
  setupGateActive,
}: ConnectionPageProps) {
  const [tab, setTab] = useState<Tab>("embedded");
  const [mode, setMode] = useState<string>("embedded");
  const [port, setPort] = useState(8788);
  const [gatewayStatus, setGatewayStatus] = useState("stopped");
  const [remoteUrl, setRemoteUrl] = useState("ws://127.0.0.1:8788/ws");
  const [remoteToken, setRemoteToken] = useState("");
  const [remoteTlsCertFingerprint256, setRemoteTlsCertFingerprint256] = useState("");
  const [hasSavedRemoteToken, setHasSavedRemoteToken] = useState(false);
  const [nodeStatus, setNodeStatus] = useState("disconnected");
  const [actionBusy, setActionBusy] = useState(false);
  const [gatewayError, setGatewayError] = useState<string | null>(null);

  const busy = operatorBusy || actionBusy;
  const operatorConnectionSummary = summarizeOperatorConnection(core);

  useEffect(() => {
    const api = window.tyrumDesktop;
    if (!api) return;

    void api.getConfig().then((cfg) => {
      const c = cfg as Record<string, unknown>;
      const m = (c?.["mode"] as string) ?? "embedded";
      setMode(m);
      setTab(m === "remote" ? "remote" : "embedded");

      const embedded = c?.["embedded"] as Record<string, unknown> | undefined;
      if (embedded?.["port"]) setPort(embedded["port"] as number);

      const remote = c?.["remote"] as Record<string, unknown> | undefined;
      if (remote?.["wsUrl"]) setRemoteUrl(remote["wsUrl"] as string);
      if (remote?.["tokenRef"]) setHasSavedRemoteToken(true);
      if (typeof remote?.["tlsCertFingerprint256"] === "string") {
        setRemoteTlsCertFingerprint256(remote["tlsCertFingerprint256"] as string);
      }
    });

    void api.gateway
      .getStatus()
      .then((snapshot) => {
        setGatewayStatus(snapshot.status);
        setPort(snapshot.port);
        if (snapshot.status === "running" || snapshot.status === "stopped") {
          setGatewayError(null);
        }
      })
      .catch(() => {
        // Ignore snapshot failures; live status events and actions still update the view.
      });

    const unsubscribe = api.onStatusChange((s) => {
      const info = s as Record<string, unknown>;
      if (info["gatewayStatus"]) {
        const nextGatewayStatus = info["gatewayStatus"] as string;
        setGatewayStatus(nextGatewayStatus);
        if (nextGatewayStatus === "running" || nextGatewayStatus === "stopped") {
          setGatewayError(null);
        }
      }
      if (info["nodeStatus"]) setNodeStatus(info["nodeStatus"] as string);
      if (info["port"]) setPort(info["port"] as number);
    });
    return unsubscribe;
  }, []);

  const api = window.tyrumDesktop;

  const startGateway = async () => {
    if (!api || busy) return;
    setActionBusy(true);
    setGatewayError(null);
    try {
      await api.setConfig({ mode: "embedded", embedded: { port } });
      setMode("embedded");
      await refreshConfigState();
      retry();
      const result = await api.gateway.start();
      setGatewayStatus(result.status);
      setPort(result.port);
    } catch (error) {
      setGatewayStatus("error");
      setGatewayError(toErrorMessage(error));
    } finally {
      setActionBusy(false);
    }
  };

  const stopGateway = async () => {
    if (!api || busy) return;
    setActionBusy(true);
    try {
      const result = await api.gateway.stop();
      setGatewayStatus(result.status);
      setGatewayError(null);
    } finally {
      setActionBusy(false);
    }
  };

  const connectNode = async () => {
    if (!api || busy) return;
    setActionBusy(true);
    try {
      const trimmedToken = remoteToken.trim();
      const trimmedFingerprint = remoteTlsCertFingerprint256.trim();
      const remoteConfig: Record<string, unknown> = { wsUrl: remoteUrl };
      if (trimmedToken.length > 0) {
        remoteConfig["tokenRef"] = trimmedToken;
        setHasSavedRemoteToken(true);
      }
      remoteConfig["tlsCertFingerprint256"] = trimmedFingerprint;

      await api.setConfig({ mode: "remote", remote: remoteConfig });
      setMode("remote");
      await refreshConfigState();
      retry();
      const result = await api.node.connect();
      setNodeStatus(result.status);
    } finally {
      setActionBusy(false);
    }
  };

  const disconnectNode = async () => {
    if (!api || busy) return;
    setActionBusy(true);
    try {
      const result = await api.node.disconnect();
      setNodeStatus(result.status);
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold tracking-tight text-fg">Connection</h1>

      {setupGateActive ? (
        <Alert
          variant={configExists ? "error" : "warning"}
          title={configExists ? "Connection required" : "Setup required"}
          description={
            !configExists
              ? "Choose whether to run an embedded gateway inside the Desktop app, or connect to an existing remote gateway."
              : errorMessage
                ? formatSetupError(errorMessage)
                : (operatorConnectionSummary ??
                  "Unable to connect to the configured gateway. Check your settings and try again.")
          }
        />
      ) : null}
      {setupGateActive && configExists ? (
        <div className="flex">
          <Button size="sm" onClick={retry} disabled={busy} isLoading={operatorBusy}>
            Retry
          </Button>
        </div>
      ) : null}

      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
        <TabsList>
          <TabsTrigger value="embedded">Embedded</TabsTrigger>
          <TabsTrigger value="remote">Remote</TabsTrigger>
          <TabsTrigger value="operator">Operator</TabsTrigger>
        </TabsList>

        <TabsContent value="embedded">
          <Card>
            <CardContent className="grid gap-4 pt-6">
              <Input
                label="Port"
                type="number"
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
                min={1024}
                max={65535}
              />

              <div className="flex gap-2">
                {gatewayStatus === "stopped" || gatewayStatus === "error" ? (
                  <Button onClick={startGateway} disabled={busy} isLoading={busy}>
                    {busy ? "Starting..." : "Start Gateway"}
                  </Button>
                ) : (
                  <Button variant="danger" onClick={stopGateway} disabled={busy} isLoading={busy}>
                    {busy ? "Stopping..." : "Stop Gateway"}
                  </Button>
                )}
              </div>

              <div className="text-sm text-fg-muted">
                Status: {gatewayStatus} {mode === "embedded" ? "(active mode)" : ""}
              </div>

              {gatewayError ? (
                <Alert variant="error" title="Gateway error" description={gatewayError} />
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="remote">
          <Card>
            <CardContent className="grid gap-4 pt-6">
              <Input
                label="Gateway WebSocket URL"
                type="text"
                value={remoteUrl}
                onChange={(e) => setRemoteUrl(e.target.value)}
                placeholder="ws://host:port/ws"
              />

              <Input
                label="Token"
                type="password"
                value={remoteToken}
                onChange={(e) => setRemoteToken(e.target.value)}
                placeholder="Bearer token"
                helperText={
                  hasSavedRemoteToken && remoteToken.trim() === ""
                    ? "A token is already saved. Leave blank to reuse it, or enter a new token to replace it."
                    : undefined
                }
              />

              <Input
                label="TLS certificate fingerprint (SHA-256, optional)"
                type="text"
                value={remoteTlsCertFingerprint256}
                onChange={(e) => setRemoteTlsCertFingerprint256(e.target.value)}
                placeholder="AA:BB:CC:…"
              />

              <div className="flex gap-2">
                {nodeStatus === "disconnected" || nodeStatus === "error" ? (
                  <Button onClick={connectNode} disabled={busy} isLoading={busy}>
                    {busy ? "Connecting..." : "Connect"}
                  </Button>
                ) : (
                  <Button
                    variant="danger"
                    onClick={disconnectNode}
                    disabled={busy}
                    isLoading={busy}
                  >
                    {busy ? "Disconnecting..." : "Disconnect"}
                  </Button>
                )}
              </div>

              <div className="text-sm text-fg-muted">Node status: {nodeStatus}</div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="operator">
          {core ? (
            <OperatorConnectPage core={core} mode="desktop" hideHeader />
          ) : (
            <Card>
              <CardContent className="py-6 text-center text-sm text-fg-muted">
                Operator connection not available. Start the gateway to connect.
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
