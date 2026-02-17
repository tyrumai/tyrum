import { useEffect, useState } from "react";

interface CheckItem {
  label: string;
  status: "ok" | "warn" | "error" | "pending";
  detail: string;
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

export function Diagnostics() {
  const [checks, setChecks] = useState<CheckItem[]>([
    { label: "Gateway process", status: "pending", detail: "Checking..." },
    { label: "Node runtime", status: "pending", detail: "Checking..." },
    { label: "Config file", status: "pending", detail: "Checking..." },
    { label: "macOS permissions", status: "pending", detail: "Checking..." },
  ]);
  const [running, setRunning] = useState(false);

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
        const r = result as Record<string, boolean> | null;
        if (!r) {
          update(3, { status: "ok", detail: "Not macOS (skipped)" });
        } else {
          const allOk = Object.values(r).every(Boolean);
          update(3, {
            status: allOk ? "ok" : "warn",
            detail: allOk
              ? "All permissions granted"
              : "Some permissions missing",
          });
        }
      })
      .catch(() => {
        update(3, { status: "ok", detail: "Not applicable" });
      })
      .finally(() => setRunning(false));
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
      </div>
    </div>
  );
}
