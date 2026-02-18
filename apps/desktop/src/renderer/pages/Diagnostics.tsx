import { useEffect, useState } from "react";
import { toErrorMessage } from "../lib/errors.js";

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

const headingStyle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  marginBottom: 20,
};

const cardStyle: React.CSSProperties = {
  background: "#ffffff",
  borderRadius: 8,
  padding: 20,
  marginBottom: 16,
  boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
};

const sectionTitle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  marginBottom: 12,
  color: "#374151",
};

const checkRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "8px 0",
  borderBottom: "1px solid #f3f4f6",
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

const btnStyle: React.CSSProperties = {
  padding: "8px 20px",
  borderRadius: 6,
  border: "none",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  background: "#6c63ff",
  color: "#fff",
  marginTop: 12,
};

const secondaryBtnStyle: React.CSSProperties = {
  ...btnStyle,
  background: "#e5e7eb",
  color: "#374151",
  marginRight: 8,
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

  useEffect(() => {
    runChecks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <h1 style={headingStyle}>Diagnostics</h1>

      <div style={cardStyle}>
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
                <div style={{ fontSize: 12, color: "#6b7280" }}>
                  {check.detail}
                </div>
              </div>
            </div>
          );
        })}
        <button style={btnStyle} onClick={runChecks} disabled={running}>
          {running ? "Running..." : "Re-run Checks"}
        </button>
        <div style={{ ...sectionTitle, marginTop: 18, marginBottom: 8 }}>
          Permission Requests (User initiated)
        </div>
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
          Diagnostics checks never request permissions automatically. Use these
          buttons to request permissions when needed.
        </div>
        <button
          style={secondaryBtnStyle}
          onClick={() => requestPermission("accessibility")}
          disabled={requestingPermission !== null}
        >
          {requestingPermission === "accessibility"
            ? "Requesting..."
            : "Request Accessibility"}
        </button>
        <button
          style={secondaryBtnStyle}
          onClick={() => requestPermission("screenRecording")}
          disabled={requestingPermission !== null}
        >
          {requestingPermission === "screenRecording"
            ? "Opening..."
            : "Request Screen Recording"}
        </button>
        {permissionActionNote && (
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 10 }}>
            {permissionActionNote}
          </div>
        )}
      </div>
    </div>
  );
}
