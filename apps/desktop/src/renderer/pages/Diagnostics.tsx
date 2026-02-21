import { useEffect, useState } from "react";
import { toErrorMessage } from "../lib/errors.js";
import { colors, heading, card, sectionTitle, btn as btnFn, labelRow, labelKey, labelValue } from "../theme.js";

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

const checkRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "8px 0",
  borderBottom: `1px solid ${colors.border}`,
};

const STATUS_ICONS: Record<string, { symbol: string; color: string }> = {
  ok: { symbol: "\u2713", color: "#22c55e" },
  warn: { symbol: "!", color: "#eab308" },
  error: { symbol: "\u2717", color: "#ef4444" },
  pending: { symbol: "\u2026", color: "#9ca3af" },
};

function iconStyle(status: string): React.CSSProperties {
  const s = STATUS_ICONS[status] ?? STATUS_ICONS["pending"]!;
  return {
    width: 22,
    height: 22,
    borderRadius: "50%",
    background: s.color,
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 12,
    fontWeight: 700,
    flexShrink: 0,
  };
}

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
  const [permissionActionNote, setPermissionActionNote] = useState<string | null>(
    null,
  );
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
  const [updateBusy, setUpdateBusy] = useState<
    "check" | "download" | "install" | "manual" | null
  >(null);
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
      setChecks((prev) =>
        prev.map((c, i) => (i === index ? { ...c, ...patch } : c)),
      );
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
            detail: allOk
              ? "All permissions granted"
              : `Missing: ${missing}.${instructions}`,
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
        setPermissionActionNote(
          r.instructions ?? `${permission} permission was not granted.`,
        );
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
      const result =
        (await api.updates.openReleaseFile()) as ManualReleaseFileResult;
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

    void api
      .updates
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
    <div>
      <h1 style={heading}>Diagnostics</h1>

      <div style={card}>
        <div style={sectionTitle}>Environment Checks</div>
        {checks.map((check) => {
          const si = STATUS_ICONS[check.status] ?? STATUS_ICONS["pending"]!;
          return (
            <div key={check.label} style={checkRowStyle}>
              <div style={iconStyle(check.status)}>{si.symbol}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>
                  {check.label}
                </div>
                <div style={{ fontSize: 12, color: colors.fgMuted }}>
                  {check.detail}
                </div>
              </div>
            </div>
          );
        })}
        <button style={{ ...btnFn("primary"), marginTop: 12 }} onClick={runChecks} disabled={running}>
          {running ? "Running..." : "Re-run Checks"}
        </button>
        <div style={{ ...sectionTitle, marginTop: 18, marginBottom: 8 }}>
          Permission Requests (User initiated)
        </div>
        <div style={{ fontSize: 12, color: colors.fgMuted, marginBottom: 8 }}>
          Diagnostics checks never request permissions automatically. Use these
          buttons to request permissions when needed.
        </div>
        <button
          style={{ ...btnFn("secondary"), marginRight: 8 }}
          onClick={() => requestPermission("accessibility")}
          disabled={requestingPermission !== null}
        >
          {requestingPermission === "accessibility"
            ? "Requesting..."
            : "Request Accessibility"}
        </button>
        <button
          style={{ ...btnFn("secondary"), marginRight: 8 }}
          onClick={() => requestPermission("screenRecording")}
          disabled={requestingPermission !== null}
        >
          {requestingPermission === "screenRecording"
            ? "Opening..."
            : "Request Screen Recording"}
        </button>
        {permissionActionNote && (
          <div style={{ fontSize: 12, color: colors.fgMuted, marginTop: 10 }}>
            {permissionActionNote}
          </div>
        )}
      </div>

      <div style={card}>
        <div style={sectionTitle}>Desktop Updates</div>
        <div style={{ fontSize: 12, color: colors.fgMuted, marginBottom: 10 }}>
          Update checks run automatically at startup. Download and install require
          explicit user actions.
        </div>

        <div style={labelRow}>
          <span style={labelKey}>Current version</span>
          <span style={labelValue}>{updateState.currentVersion}</span>
        </div>
        <div style={labelRow}>
          <span style={labelKey}>Status</span>
          <span style={labelValue}>
            {UPDATE_STAGE_LABEL[updateState.stage] ?? updateState.stage}
          </span>
        </div>
        {updateState.availableVersion && (
          <div style={labelRow}>
            <span style={labelKey}>Available version</span>
            <span style={labelValue}>{updateState.availableVersion}</span>
          </div>
        )}
        {updateState.progressPercent != null && (
          <div style={labelRow}>
            <span style={labelKey}>Download progress</span>
            <span style={labelValue}>
              {Math.round(updateState.progressPercent)}%
            </span>
          </div>
        )}
        {updateState.message && (
          <div style={{ fontSize: 12, color: colors.error, marginTop: 8 }}>
            {updateState.message}
          </div>
        )}
        {updateState.releaseNotes && (
          <div
            style={{
              marginTop: 10,
              padding: "8px 10px",
              background: colors.bgSubtle,
              borderRadius: 6,
              fontSize: 12,
              color: colors.fgMuted,
              border: `1px solid ${colors.border}`,
              whiteSpace: "pre-wrap",
            }}
          >
            {updateState.releaseNotes}
          </div>
        )}

        <div style={{ marginTop: 12 }}>
          <button
            style={btnFn("primary")}
            onClick={checkForUpdates}
            disabled={updateBusy !== null}
          >
            {updateBusy === "check" ? "Checking..." : "Check for Updates"}
          </button>
        </div>
        <div style={{ marginTop: 8 }}>
          <button
            style={{ ...btnFn("secondary"), marginRight: 8 }}
            onClick={downloadUpdate}
            disabled={updateBusy !== null || updateState.stage !== "available"}
          >
            {updateBusy === "download" ? "Downloading..." : "Download Update"}
          </button>
          <button
            style={{ ...btnFn("secondary"), marginRight: 8 }}
            onClick={installUpdate}
            disabled={updateBusy !== null || updateState.stage !== "downloaded"}
          >
            {updateBusy === "install" ? "Installing..." : "Install Update"}
          </button>
          <button
            style={{ ...btnFn("secondary"), marginRight: 8 }}
            onClick={openManualReleaseFile}
            disabled={updateBusy !== null}
          >
            {updateBusy === "manual" ? "Opening..." : "Use Local Release File"}
          </button>
        </div>
        {updateActionNote && (
          <div style={{ fontSize: 12, color: colors.fgMuted, marginTop: 10 }}>
            {updateActionNote}
          </div>
        )}
      </div>
    </div>
  );
}
