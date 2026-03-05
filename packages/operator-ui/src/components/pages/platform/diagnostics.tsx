import { useCallback, useEffect, useState } from "react";
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

type MacPermissionName = "accessibility" | "screenRecording";
type CheckUpdate = Partial<CheckItem>;

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
  const { checks, running, runChecks } = useDiagnosticsChecks(api);
  const { permissionActionNote, requestingPermission, requestPermission } = usePermissionRequests(
    api,
    runChecks,
  );

  useEffect(() => {
    runChecks();
  }, [runChecks]);

  return (
    <div className="grid gap-6">
      <EnvironmentChecksCard
        checks={checks}
        running={running}
        onRunChecks={runChecks}
        requestingPermission={requestingPermission}
        onRequestPermission={requestPermission}
        permissionActionNote={permissionActionNote}
      />

      <DesktopUpdatesCard api={api} title="Desktop Updates" />
    </div>
  );
}

function EnvironmentChecksCard(props: {
  checks: CheckItem[];
  running: boolean;
  onRunChecks: () => void;
  requestingPermission: MacPermissionName | null;
  onRequestPermission: (permission: MacPermissionName) => void;
  permissionActionNote: string | null;
}) {
  return (
    <Card>
      <CardContent className="grid gap-4 pt-6">
        <div className="text-sm font-semibold text-fg">Environment Checks</div>
        <EnvironmentCheckList checks={props.checks} running={props.running} />
        <Button onClick={props.onRunChecks} isLoading={props.running} disabled={props.running}>
          {props.running ? "Running..." : "Re-run Checks"}
        </Button>
        <PermissionRequestSection
          requestingPermission={props.requestingPermission}
          onRequestPermission={props.onRequestPermission}
          permissionActionNote={props.permissionActionNote}
        />
      </CardContent>
    </Card>
  );
}

function EnvironmentCheckList(props: { checks: CheckItem[]; running: boolean }) {
  return (
    <div className="grid gap-2">
      {props.checks.map((check) => (
        <div
          key={check.label}
          className="flex items-start gap-3 border-b border-border py-2 last:border-b-0"
        >
          <StatusDot
            variant={CHECK_STATUS_VARIANTS[check.status] ?? "neutral"}
            pulse={check.status === "pending" && props.running}
            className="mt-1"
          />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-fg">{check.label}</div>
            <div className="text-sm text-fg-muted">{check.detail}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function PermissionRequestSection(props: {
  requestingPermission: MacPermissionName | null;
  onRequestPermission: (permission: MacPermissionName) => void;
  permissionActionNote: string | null;
}) {
  return (
    <div className="grid gap-2 pt-2">
      <div className="text-sm font-semibold text-fg">Permission Requests (User initiated)</div>
      <div className="text-sm text-fg-muted">
        Diagnostics checks never request permissions automatically. Use these buttons to request
        permissions when needed.
      </div>
      <div className="flex flex-wrap gap-2">
        <PermissionRequestButton
          permission="accessibility"
          label="Request Accessibility"
          loadingLabel="Requesting..."
          requestingPermission={props.requestingPermission}
          onRequestPermission={props.onRequestPermission}
        />
        <PermissionRequestButton
          permission="screenRecording"
          label="Request Screen Recording"
          loadingLabel="Opening..."
          requestingPermission={props.requestingPermission}
          onRequestPermission={props.onRequestPermission}
        />
      </div>
      {props.permissionActionNote ? (
        <Alert variant="info" title="Permission request" description={props.permissionActionNote} />
      ) : null}
    </div>
  );
}

function PermissionRequestButton(props: {
  permission: MacPermissionName;
  label: string;
  loadingLabel: string;
  requestingPermission: MacPermissionName | null;
  onRequestPermission: (permission: MacPermissionName) => void;
}) {
  const isLoading = props.requestingPermission === props.permission;
  return (
    <Button
      variant="secondary"
      onClick={() => props.onRequestPermission(props.permission)}
      isLoading={isLoading}
      disabled={props.requestingPermission !== null}
    >
      {isLoading ? props.loadingLabel : props.label}
    </Button>
  );
}

function useDiagnosticsChecks(api: DesktopApi) {
  const [checks, setChecks] = useState<CheckItem[]>(createPendingChecks);
  const [running, setRunning] = useState(false);

  const updateCheck = useCallback((index: number, patch: CheckUpdate) => {
    setChecks((prev) => patchCheck(prev, index, patch));
  }, []);

  const runChecks = useCallback(() => {
    setRunning(true);
    void api
      .getConfig()
      .then((cfg) => applyConfigCheckResult(updateCheck, cfg))
      .catch((error: unknown) => applyConfigCheckError(updateCheck, error));

    if (!api.checkMacPermissions) {
      updateCheck(3, { status: "ok", detail: "Not applicable" });
      setRunning(false);
      return;
    }

    void api
      .checkMacPermissions()
      .then((result) =>
        updateCheck(3, describeMacPermissionCheck(result as MacPermissionSnapshot | null)),
      )
      .catch(() => updateCheck(3, { status: "ok", detail: "Not applicable" }))
      .finally(() => setRunning(false));
  }, [api, updateCheck]);

  return { checks, running, runChecks };
}

function usePermissionRequests(api: DesktopApi, runChecks: () => void) {
  const [requestingPermission, setRequestingPermission] = useState<MacPermissionName | null>(null);
  const [permissionActionNote, setPermissionActionNote] = useState<string | null>(null);

  const requestPermission = (permission: MacPermissionName) => {
    if (!api.requestMacPermission) {
      setPermissionActionNote("Permission requests are not available in this build.");
      return;
    }

    setPermissionActionNote(null);
    setRequestingPermission(permission);
    void api
      .requestMacPermission(permission)
      .then((result) =>
        setPermissionActionNote(
          describePermissionRequestResult(
            permission,
            result as { granted: boolean; instructions?: string },
          ),
        ),
      )
      .catch((error: unknown) => setPermissionActionNote(formatErrorMessage(error)))
      .finally(() => {
        setRequestingPermission(null);
        runChecks();
      });
  };

  return { permissionActionNote, requestingPermission, requestPermission };
}

function createPendingChecks(): CheckItem[] {
  return [
    { label: "Gateway process", status: "pending", detail: "Checking..." },
    { label: "Node runtime", status: "pending", detail: "Checking..." },
    { label: "Config file", status: "pending", detail: "Checking..." },
    { label: "macOS permissions", status: "pending", detail: "Checking..." },
  ];
}

function patchCheck(checks: CheckItem[], index: number, patch: CheckUpdate): CheckItem[] {
  return checks.map((check, currentIndex) =>
    currentIndex === index ? { ...check, ...patch } : check,
  );
}

function applyConfigCheckResult(
  updateCheck: (index: number, patch: CheckUpdate) => void,
  config: unknown,
) {
  const mode = ((config as Record<string, unknown>)?.["mode"] as string) ?? "unknown";
  updateCheck(0, { status: "ok", detail: `Mode: ${mode}` });
  updateCheck(1, { status: "ok", detail: "Runtime reachable via IPC" });
  updateCheck(2, { status: "ok", detail: `Loaded (mode: ${mode})` });
}

function applyConfigCheckError(
  updateCheck: (index: number, patch: CheckUpdate) => void,
  error: unknown,
) {
  const detail = error instanceof Error ? error.message : "Unknown error";
  updateCheck(0, { status: "error", detail });
  updateCheck(1, { status: "error", detail });
  updateCheck(2, { status: "error", detail });
}

function describeMacPermissionCheck(snapshot: MacPermissionSnapshot | null): CheckUpdate {
  if (!snapshot) {
    return { status: "ok", detail: "Not macOS (skipped)" };
  }

  const missingPermissions = [
    snapshot.accessibility === true ? null : "Accessibility",
    snapshot.screenRecording === true ? null : "Screen Recording",
  ].filter((permission): permission is string => permission !== null);
  if (missingPermissions.length === 0) {
    return { status: "ok", detail: "All permissions granted" };
  }

  const instructions =
    typeof snapshot.instructions === "string" && snapshot.instructions.trim().length > 0
      ? ` ${snapshot.instructions.trim()}`
      : "";
  return {
    status: "warn",
    detail: `Missing: ${missingPermissions.join(", ")}.${instructions}`,
  };
}

function describePermissionRequestResult(
  permission: MacPermissionName,
  result: { granted: boolean; instructions?: string },
): string {
  if (result.granted) {
    return `${permission} permission is granted.`;
  }
  return result.instructions ?? `${permission} permission was not granted.`;
}
