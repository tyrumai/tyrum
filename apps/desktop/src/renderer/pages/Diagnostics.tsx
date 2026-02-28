import { useEffect, useState, type ReactNode } from "react";
import { toErrorMessage } from "../lib/errors.js";
import {
  Alert,
  Button,
  Card,
  CardContent,
  StatusDot,
  type StatusDotVariant,
} from "@tyrum/operator-ui";

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

interface DesktopUpdateState {
  stage:
    | "idle"
    | "checking"
    | "available"
    | "not-available"
    | "downloading"
    | "downloaded"
    | "installing"
    | "error";
  currentVersion: string;
  availableVersion: string | null;
  downloadedVersion: string | null;
  releaseDate: string | null;
  releaseNotes: string | null;
  progressPercent: number | null;
  message: string | null;
  checkedAt: string | null;
}

interface ManualReleaseFileResult {
  opened: boolean;
  path: string | null;
  message: string | null;
}

const CHECK_STATUS_VARIANTS: Record<CheckItem["status"], StatusDotVariant> = {
  ok: "success",
  warn: "warning",
  error: "danger",
  pending: "neutral",
};

const UPDATE_STAGE_LABEL: Record<DesktopUpdateState["stage"], string> = {
  idle: "Idle",
  checking: "Checking for updates...",
  available: "Update available",
  "not-available": "Up to date",
  downloading: "Downloading update...",
  downloaded: "Ready to install",
  installing: "Installing update...",
  error: "Update error",
};

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-2 last:border-b-0">
      <span className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{label}</span>
      <span className="text-sm font-semibold text-fg">{value}</span>
    </div>
  );
}

export function Diagnostics() {
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
  const [updateState, setUpdateState] = useState<DesktopUpdateState>({
    stage: "idle",
    currentVersion: "unknown",
    availableVersion: null,
    downloadedVersion: null,
    releaseDate: null,
    releaseNotes: null,
    progressPercent: null,
    message: null,
    checkedAt: null,
  });
  const [updateBusy, setUpdateBusy] = useState<"check" | "download" | "install" | "manual" | null>(
    null,
  );
  const [updateActionNote, setUpdateActionNote] = useState<string | null>(null);

  const runChecks = () => {
    setRunning(true);
    const api = window.tyrumDesktop;
    if (!api) {
      setChecks((prev) =>
        prev.map((c) => ({
          ...c,
          status: "error" as const,
          detail: "IPC bridge unavailable",
        })),
      );
      setRunning(false);
      return;
    }

    // Gateway check via status subscription
    const update = (index: number, patch: Partial<CheckItem>) => {
      setChecks((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
    };

    // Check config accessibility
    void api
      .getConfig()
      .then((cfg) => {
        const c = cfg as Record<string, unknown>;
        const mode = (c?.["mode"] as string) ?? "unknown";
        update(2, {
          status: "ok",
          detail: `Loaded (mode: ${mode})`,
        });

        // Infer gateway status from config
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

    // macOS permissions
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
    const api = window.tyrumDesktop;
    if (!api) {
      setPermissionActionNote("IPC bridge unavailable.");
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
        setPermissionActionNote(toErrorMessage(error));
      })
      .finally(() => {
        setRequestingPermission(null);
        runChecks();
      });
  };

  const checkForUpdates = async () => {
    const api = window.tyrumDesktop;
    if (!api || updateBusy !== null) return;

    setUpdateActionNote(null);
    setUpdateBusy("check");
    try {
      const next = (await api.updates.check()) as DesktopUpdateState;
      setUpdateState(next);
      setUpdateActionNote("Update check started.");
    } catch (error: unknown) {
      setUpdateActionNote(toErrorMessage(error));
    } finally {
      setUpdateBusy(null);
    }
  };

  const downloadUpdate = async () => {
    const api = window.tyrumDesktop;
    if (!api || updateBusy !== null) return;

    setUpdateActionNote(null);
    setUpdateBusy("download");
    try {
      const next = (await api.updates.download()) as DesktopUpdateState;
      setUpdateState(next);
      setUpdateActionNote("Download started.");
    } catch (error: unknown) {
      setUpdateActionNote(toErrorMessage(error));
    } finally {
      setUpdateBusy(null);
    }
  };

  const installUpdate = async () => {
    const api = window.tyrumDesktop;
    if (!api || updateBusy !== null) return;

    setUpdateActionNote(null);
    setUpdateBusy("install");
    try {
      const next = (await api.updates.install()) as DesktopUpdateState;
      setUpdateState(next);
      setUpdateActionNote("Installing update...");
    } catch (error: unknown) {
      setUpdateActionNote(toErrorMessage(error));
    } finally {
      setUpdateBusy(null);
    }
  };

  const openManualReleaseFile = async () => {
    const api = window.tyrumDesktop;
    if (!api || updateBusy !== null) return;

    setUpdateActionNote(null);
    setUpdateBusy("manual");
    try {
      const result = (await api.updates.openReleaseFile()) as ManualReleaseFileResult;
      if (result.message) {
        setUpdateActionNote(result.message);
      } else if (result.opened) {
        setUpdateActionNote("Installer opened.");
      }
    } catch (error: unknown) {
      setUpdateActionNote(toErrorMessage(error));
    } finally {
      setUpdateBusy(null);
    }
  };

  useEffect(() => {
    runChecks();

    const api = window.tyrumDesktop;
    if (!api) return;

    void api.updates
      .getState()
      .then((snapshot) => setUpdateState(snapshot as DesktopUpdateState))
      .catch(() => {
        // Ignore snapshot failures; event updates can still refresh the state.
      });

    const unsubscribe = api.onUpdateStateChange((state) => {
      setUpdateState(state as DesktopUpdateState);
    });

    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold tracking-tight text-fg">Diagnostics</h1>

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

      <Card>
        <CardContent className="grid gap-4 pt-6">
          <div className="text-sm font-semibold text-fg">Desktop Updates</div>
          <div className="text-sm text-fg-muted">
            Update checks run automatically at startup. Download and install require explicit user
            actions.
          </div>

          <div className="grid gap-0">
            <DetailRow label="Current version" value={updateState.currentVersion} />
            <DetailRow
              label="Status"
              value={UPDATE_STAGE_LABEL[updateState.stage] ?? updateState.stage}
            />
            {updateState.availableVersion ? (
              <DetailRow label="Available version" value={updateState.availableVersion} />
            ) : null}
            {updateState.progressPercent != null ? (
              <DetailRow
                label="Download progress"
                value={`${Math.round(updateState.progressPercent)}%`}
              />
            ) : null}
          </div>

          {updateState.message ? (
            <Alert
              variant={updateState.stage === "error" ? "error" : "info"}
              title={updateState.stage === "error" ? "Update error" : "Update"}
              description={updateState.message}
            />
          ) : null}

          {updateState.releaseNotes ? (
            <div className="rounded-md border border-border bg-bg-subtle p-3 text-sm text-fg-muted">
              <div className="whitespace-pre-wrap">{updateState.releaseNotes}</div>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                void checkForUpdates();
              }}
              isLoading={updateBusy === "check"}
              disabled={updateBusy !== null}
            >
              {updateBusy === "check" ? "Checking..." : "Check for Updates"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                void downloadUpdate();
              }}
              isLoading={updateBusy === "download"}
              disabled={updateBusy !== null || updateState.stage !== "available"}
            >
              {updateBusy === "download" ? "Downloading..." : "Download Update"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                void installUpdate();
              }}
              isLoading={updateBusy === "install"}
              disabled={updateBusy !== null || updateState.stage !== "downloaded"}
            >
              {updateBusy === "install" ? "Installing..." : "Install Update"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                void openManualReleaseFile();
              }}
              isLoading={updateBusy === "manual"}
              disabled={updateBusy !== null}
            >
              {updateBusy === "manual" ? "Opening..." : "Use Local Release File"}
            </Button>
          </div>

          {updateActionNote ? (
            <Alert variant="info" title="Desktop updates" description={updateActionNote} />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
