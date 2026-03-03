import { useEffect, useState } from "react";
import type { DesktopApi } from "../../../desktop-api.js";
import { useHostApi } from "../../../host/host-api.js";
import { formatErrorMessage } from "../../../utils/format-error-message.js";
import { DesktopUpdatesCard } from "../../updates/desktop-updates-card.js";
import { Alert } from "../../ui/alert.js";
import { Button } from "../../ui/button.js";
import { Card, CardContent } from "../../ui/card.js";
import { StatusDot, type StatusDotVariant } from "../../ui/status-dot.js";

interface CheckItem {
  label: string;
  status: "ok" | "warn" | "error" | "pending";
  detail: string;
}

interface MacPermissionSnapshot {
  accessibility: boolean | null;
  screenRecording: boolean | null;
  instructions?: string;
}

const CHECK_STATUS_VARIANTS: Record<CheckItem["status"], StatusDotVariant> = {
  ok: "success",
  warn: "warning",
  error: "danger",
  pending: "neutral",
};

export function PlatformDiagnosticsPanel() {
  const host = useHostApi();
  if (host.kind !== "desktop") {
    return (
      <Alert
        variant="warning"
        title="Not available"
        description="Diagnostics are only available in the desktop app."
      />
    );
  }

  const api = host.api;
  if (!api) {
    return <Alert variant="error" title="Desktop API not available." />;
  }

  return <DesktopDiagnosticsPanel api={api} />;
}

function DesktopDiagnosticsPanel({ api }: { api: DesktopApi }) {
  const [checks, setChecks] = useState<CheckItem[]>([
    { label: "Gateway process", status: "pending", detail: "Checking..." },
    { label: "Node runtime", status: "pending", detail: "Checking..." },
    { label: "Config file", status: "pending", detail: "Checking..." },
    { label: "macOS permissions", status: "pending", detail: "Checking..." },
  ]);
  const [running, setRunning] = useState(false);
  const [requestingPermission, setRequestingPermission] = useState<
    "accessibility" | "screenRecording" | null
  >(null);
  const [permissionActionNote, setPermissionActionNote] = useState<string | null>(null);

  const runChecks = () => {
    setRunning(true);

    const update = (index: number, patch: Partial<CheckItem>) => {
      setChecks((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
    };

    void api
      .getConfig()
      .then((cfg) => {
        const c = cfg as Record<string, unknown>;
        const mode = (c?.["mode"] as string) ?? "unknown";
        update(2, {
          status: "ok",
          detail: `Loaded (mode: ${mode})`,
        });

        update(0, {
          status: "ok",
          detail: `Mode: ${mode}`,
        });

        update(1, {
          status: "ok",
          detail: "Runtime reachable via IPC",
        });
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "Unknown error";
        update(0, { status: "error", detail: msg });
        update(1, { status: "error", detail: msg });
        update(2, { status: "error", detail: msg });
      });

    if (!api.checkMacPermissions) {
      update(3, { status: "ok", detail: "Not applicable" });
      setRunning(false);
      return;
    }

    void api
      .checkMacPermissions()
      .then((result) => {
        const r = result as MacPermissionSnapshot | null;
        if (!r) {
          update(3, { status: "ok", detail: "Not macOS (skipped)" });
        } else {
          const accessibility = r.accessibility === true;
          const screenRecording = r.screenRecording === true;
          const allOk = accessibility && screenRecording;
          const missing = [
            !accessibility ? "Accessibility" : null,
            !screenRecording ? "Screen Recording" : null,
          ]
            .filter(Boolean)
            .join(", ");
          const instructions =
            typeof r.instructions === "string" && r.instructions.trim().length > 0
              ? ` ${r.instructions.trim()}`
              : "";
          update(3, {
            status: allOk ? "ok" : "warn",
            detail: allOk ? "All permissions granted" : `Missing: ${missing}.${instructions}`,
          });
        }
      })
      .catch(() => {
        update(3, { status: "ok", detail: "Not applicable" });
      })
      .finally(() => setRunning(false));
  };

  const requestPermission = (permission: "accessibility" | "screenRecording") => {
    if (!api.requestMacPermission) {
      setPermissionActionNote("Permission requests are not available in this build.");
      return;
    }

    setPermissionActionNote(null);
    setRequestingPermission(permission);
    void api
      .requestMacPermission(permission)
      .then((result) => {
        const r = result as { granted: boolean; instructions?: string };
        if (r.granted) {
          setPermissionActionNote(`${permission} permission is granted.`);
          return;
        }
        setPermissionActionNote(r.instructions ?? `${permission} permission was not granted.`);
      })
      .catch((error: unknown) => {
        setPermissionActionNote(formatErrorMessage(error));
      })
      .finally(() => {
        setRequestingPermission(null);
        runChecks();
      });
  };

  useEffect(() => {
    runChecks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="grid gap-6">
      <Card>
        <CardContent className="grid gap-4 pt-6">
          <div className="text-sm font-semibold text-fg">Environment Checks</div>
          <div className="grid gap-2">
            {checks.map((check) => (
              <div
                key={check.label}
                className="flex items-start gap-3 border-b border-border py-2 last:border-b-0"
              >
                <StatusDot
                  variant={CHECK_STATUS_VARIANTS[check.status] ?? "neutral"}
                  pulse={check.status === "pending" && running}
                  className="mt-1"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-fg">{check.label}</div>
                  <div className="text-sm text-fg-muted">{check.detail}</div>
                </div>
              </div>
            ))}
          </div>
          <Button onClick={runChecks} isLoading={running} disabled={running}>
            {running ? "Running..." : "Re-run Checks"}
          </Button>

          <div className="grid gap-2 pt-2">
            <div className="text-sm font-semibold text-fg">
              Permission Requests (User initiated)
            </div>
            <div className="text-sm text-fg-muted">
              Diagnostics checks never request permissions automatically. Use these buttons to
              request permissions when needed.
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => requestPermission("accessibility")}
                isLoading={requestingPermission === "accessibility"}
                disabled={requestingPermission !== null}
              >
                {requestingPermission === "accessibility"
                  ? "Requesting..."
                  : "Request Accessibility"}
              </Button>
              <Button
                variant="secondary"
                onClick={() => requestPermission("screenRecording")}
                isLoading={requestingPermission === "screenRecording"}
                disabled={requestingPermission !== null}
              >
                {requestingPermission === "screenRecording"
                  ? "Opening..."
                  : "Request Screen Recording"}
              </Button>
            </div>
            {permissionActionNote ? (
              <Alert variant="info" title="Permission request" description={permissionActionNote} />
            ) : null}
          </div>
        </CardContent>
      </Card>

      <DesktopUpdatesCard api={api} title="Desktop Updates" />
    </div>
  );
}
