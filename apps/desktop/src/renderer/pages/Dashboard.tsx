import { useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  DashboardPage as OperatorDashboard,
  Skeleton,
  StatusDot,
  type StatusDotVariant,
} from "@tyrum/operator-ui";
import type { OperatorCore } from "@tyrum/operator-core";
import { toErrorMessage } from "../lib/errors.js";

interface StatusInfo {
  gatewayMode: string;
  gatewayStatus: string;
  port: number;
  capabilities: string[];
  uptime: number;
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function resolveGatewayVariant(status: string): { variant: StatusDotVariant; pulse: boolean } {
  if (status === "running") return { variant: "success", pulse: false };
  if (status === "starting") return { variant: "warning", pulse: true };
  if (status === "error") return { variant: "danger", pulse: false };
  return { variant: "neutral", pulse: false };
}

function titleCase(value: string): string {
  if (value.length === 0) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export interface DashboardProps {
  core: OperatorCore | null;
  onNavigate?: (id: string) => void;
}

export function Dashboard({ core, onNavigate }: DashboardProps) {
  const [status, setStatus] = useState<StatusInfo>({
    gatewayMode: "embedded",
    gatewayStatus: "stopped",
    port: 0,
    capabilities: [],
    uptime: 0,
  });
  const [busy, setBusy] = useState(false);
  const [gatewayError, setGatewayError] = useState<string | null>(null);

  useEffect(() => {
    const api = window.tyrumDesktop;
    if (!api) return;

    void api.getConfig().then((cfg) => {
      const c = cfg as Record<string, unknown>;
      const mode = (c?.["mode"] as string) ?? "embedded";
      const embedded = c?.["embedded"] as Record<string, unknown> | undefined;
      const port = typeof embedded?.["port"] === "number" ? (embedded["port"] as number) : 8788;
      const capabilities: string[] = [];
      const caps = c?.["capabilities"] as Record<string, boolean> | undefined;
      if (caps) {
        for (const [k, v] of Object.entries(caps)) {
          if (v) capabilities.push(k);
        }
      }
      setStatus((prev) => ({ ...prev, gatewayMode: mode, capabilities, port }));
    });

    void api.gateway
      .getStatus()
      .then((snapshot) => {
        setStatus((prev) => ({
          ...prev,
          gatewayStatus: snapshot.status,
          port: snapshot.port,
        }));
        if (snapshot.status === "running" || snapshot.status === "stopped") {
          setGatewayError(null);
        }
      })
      .catch(() => {
        // Ignore snapshot failures; status events and user actions still drive UI updates.
      });

    const unsubscribe = api.onStatusChange((s) => {
      const info = s as Partial<StatusInfo>;
      if (info.gatewayStatus === "running" || info.gatewayStatus === "stopped") {
        setGatewayError(null);
      }
      setStatus((prev) => ({ ...prev, ...info }));
    });
    return unsubscribe;
  }, []);

  const api = window.tyrumDesktop;

  const startGateway = async () => {
    if (!api || busy) return;
    setBusy(true);
    setGatewayError(null);
    const port = status.port > 0 ? status.port : 8788;
    try {
      await api.setConfig({ mode: "embedded", embedded: { port } });
      const result = await api.gateway.start();
      setStatus((prev) => ({
        ...prev,
        gatewayMode: "embedded",
        gatewayStatus: result.status,
        port: result.port,
      }));
    } catch (error) {
      setStatus((prev) => ({ ...prev, gatewayStatus: "error" }));
      setGatewayError(toErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const stopGateway = async () => {
    if (!api || busy) return;
    setBusy(true);
    try {
      const result = await api.gateway.stop();
      setStatus((prev) => ({ ...prev, gatewayStatus: result.status }));
      setGatewayError(null);
    } catch (error) {
      setGatewayError(toErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold tracking-tight text-fg">Dashboard</h1>

      <Card>
        <CardContent className="grid gap-4 pt-6">
          <div className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Gateway</div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="grid gap-1">
              <div className="text-xs text-fg-muted">Status</div>
              <div className="flex items-center gap-2 text-sm font-medium text-fg">
                <StatusDot {...resolveGatewayVariant(status.gatewayStatus)} aria-hidden="true" />
                <span>{titleCase(status.gatewayStatus)}</span>
              </div>
            </div>

            <div className="grid gap-1">
              <div className="text-xs text-fg-muted">Mode</div>
              <div className="text-sm font-medium text-fg">
                {status.gatewayMode === "embedded" ? "Embedded" : "Remote"}
              </div>
            </div>

            {status.port > 0 ? (
              <div className="grid gap-1">
                <div className="text-xs text-fg-muted">Port</div>
                <div className="text-sm font-medium text-fg">{status.port}</div>
              </div>
            ) : null}

            {status.uptime > 0 ? (
              <div className="grid gap-1">
                <div className="text-xs text-fg-muted">Uptime</div>
                <div className="text-sm font-medium text-fg">{formatUptime(status.uptime)}</div>
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            {(status.gatewayStatus === "stopped" || status.gatewayStatus === "error") && (
              <Button size="sm" onClick={startGateway} disabled={busy} isLoading={busy}>
                {busy ? "Starting..." : "Start Gateway"}
              </Button>
            )}
            {(status.gatewayStatus === "running" || status.gatewayStatus === "starting") && (
              <Button
                size="sm"
                variant="danger"
                onClick={stopGateway}
                disabled={busy}
                isLoading={busy}
              >
                {busy ? "Stopping..." : "Stop Gateway"}
              </Button>
            )}
          </div>

          {gatewayError ? (
            <Alert variant="error" title="Gateway error" description={gatewayError} />
          ) : null}

          {status.capabilities.length > 0 ? (
            <div className="grid gap-1">
              <div className="text-xs text-fg-muted">Capabilities</div>
              <div className="flex flex-wrap gap-2">
                {status.capabilities.map((cap) => (
                  <Badge key={cap} variant="outline">
                    {cap}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {core ? (
        <OperatorDashboard core={core} onNavigate={onNavigate} />
      ) : (
        <Card>
          <CardContent className="grid gap-4 pt-6">
            <div className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
              Operator
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              <Skeleton className="h-24 rounded-xl" />
              <Skeleton className="h-24 rounded-xl" />
              <Skeleton className="h-24 rounded-xl" />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
