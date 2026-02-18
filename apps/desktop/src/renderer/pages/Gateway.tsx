import { useCallback, useEffect, useRef, useState } from "react";
import { toErrorMessage } from "../lib/errors.js";

interface GatewayConfigShape {
  mode: "embedded" | "remote";
  embedded: { port: number };
  remote: { wsUrl: string };
}

interface GatewayUiUrls {
  embedUrl: string | null;
  displayUrl: string | null;
  externalUrl: string | null;
}

interface GatewayProps {
  launchOnboarding?: boolean;
  onOnboardingLaunchHandled?: () => void;
}

const headingStyle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  marginBottom: 20,
};

const cardStyle: React.CSSProperties = {
  background: "#ffffff",
  borderRadius: 8,
  padding: 16,
  marginBottom: 12,
  boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
};

const toolbarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
  marginBottom: 10,
};

const urlStyle: React.CSSProperties = {
  fontFamily: "monospace",
  fontSize: 12,
  color: "#6b7280",
  background: "#f3f4f6",
  borderRadius: 6,
  padding: "6px 8px",
  maxWidth: "100%",
};

function buttonStyle(
  variant: "primary" | "danger" | "secondary",
): React.CSSProperties {
  const palette = {
    primary: { bg: "#6c63ff", color: "#fff" },
    danger: { bg: "#ef4444", color: "#fff" },
    secondary: { bg: "#e5e7eb", color: "#374151" },
  };
  const p = palette[variant];
  return {
    border: "none",
    borderRadius: 6,
    padding: "7px 12px",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
    background: p.bg,
    color: p.color,
  };
}

const frameShellStyle: React.CSSProperties = {
  background: "#ffffff",
  borderRadius: 8,
  boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
  height: "calc(100vh - 215px)",
  minHeight: 420,
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
};

const iframeStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  border: "none",
  background: "#ffffff",
};

const placeholderStyle: React.CSSProperties = {
  padding: 20,
  fontSize: 14,
  color: "#6b7280",
};

const statusDotStyle = (color: string): React.CSSProperties => ({
  display: "inline-block",
  width: 10,
  height: 10,
  borderRadius: "50%",
  background: color,
  marginRight: 8,
  verticalAlign: "middle",
});

const STATUS_COLORS: Record<string, string> = {
  running: "#22c55e",
  starting: "#eab308",
  error: "#ef4444",
  stopped: "#9ca3af",
};

export function Gateway({
  launchOnboarding = false,
  onOnboardingLaunchHandled,
}: GatewayProps) {
  const [config, setConfig] = useState<GatewayConfigShape>({
    mode: "embedded",
    embedded: { port: 8080 },
    remote: { wsUrl: "ws://127.0.0.1:8080/ws" },
  });
  const [gatewayStatus, setGatewayStatus] = useState("stopped");
  const [busy, setBusy] = useState(false);
  const [openingExternal, setOpeningExternal] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [gatewayUrls, setGatewayUrls] = useState<GatewayUiUrls>({
    embedUrl: null,
    displayUrl: null,
    externalUrl: null,
  });

  const api = window.tyrumDesktop;
  const startOnboardingRef = useRef(launchOnboarding);

  useEffect(() => {
    if (launchOnboarding) {
      startOnboardingRef.current = true;
    }
  }, [launchOnboarding]);

  const refreshGatewayUrls = useCallback(async (options?: { startOnboarding?: boolean }) => {
    if (!api) return;
    try {
      const urls = await api.gateway.getUiUrls(options);
      setGatewayUrls(urls);
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    }
  }, [api]);

  useEffect(() => {
    if (!api) return;
    let disposed = false;

    void api
      .getConfig()
      .then((rawConfig) => {
        const cfg = rawConfig as Record<string, unknown>;
        const mode = cfg["mode"] === "remote" ? "remote" : "embedded";
        const embeddedRaw =
          cfg["embedded"] && typeof cfg["embedded"] === "object"
            ? (cfg["embedded"] as Record<string, unknown>)
            : {};
        const remoteRaw =
          cfg["remote"] && typeof cfg["remote"] === "object"
            ? (cfg["remote"] as Record<string, unknown>)
            : {};

        const embeddedPort =
          typeof embeddedRaw["port"] === "number" ? embeddedRaw["port"] : 8080;
        const remoteWsUrl =
          typeof remoteRaw["wsUrl"] === "string"
            ? remoteRaw["wsUrl"]
            : "ws://127.0.0.1:8080/ws";

        if (disposed) return;
        setConfig({
          mode,
          embedded: { port: embeddedPort },
          remote: { wsUrl: remoteWsUrl },
        });
      })
      .catch((error) => {
        if (!disposed) {
          setErrorMessage(toErrorMessage(error));
        }
      });

    void api.gateway
      .getStatus()
      .then((snapshot) => {
        if (disposed) return;
        setGatewayStatus(snapshot.status);
        setConfig((prev) => ({
          ...prev,
          embedded: { ...prev.embedded, port: snapshot.port },
        }));
        if (snapshot.status === "running" || snapshot.status === "stopped") {
          setErrorMessage(null);
        }
      })
      .catch(() => {
        // Ignore snapshot failures; status events and actions still drive this view.
      });
    void refreshGatewayUrls({
      startOnboarding: startOnboardingRef.current,
    });

    const unsubscribe = api.onStatusChange((statusRaw) => {
      const status = statusRaw as Record<string, unknown>;
      let shouldRefreshUrls = false;
      if (typeof status["gatewayStatus"] === "string") {
        const next = status["gatewayStatus"] as string;
        setGatewayStatus(next);
        shouldRefreshUrls = true;
        if (next === "running" || next === "stopped") {
          setErrorMessage(null);
        }
      }
      if (typeof status["port"] === "number") {
        setConfig((prev) => ({
          ...prev,
          embedded: { ...prev.embedded, port: status["port"] as number },
        }));
        shouldRefreshUrls = true;
      }

      if (shouldRefreshUrls) {
        void refreshGatewayUrls({
          startOnboarding: startOnboardingRef.current,
        });
      }
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [api, refreshGatewayUrls]);

  useEffect(() => {
    if (!launchOnboarding) {
      return;
    }
    if (!gatewayUrls.embedUrl?.includes("next=%2Fapp%2Fonboarding%2Fstart")) {
      return;
    }
    startOnboardingRef.current = false;
    onOnboardingLaunchHandled?.();
  }, [gatewayUrls.embedUrl, launchOnboarding, onOnboardingLaunchHandled]);

  useEffect(() => {
    if (!api || config.mode !== "embedded") {
      return;
    }
    const expectedOrigin = `http://127.0.0.1:${config.embedded.port}`;

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== expectedOrigin) {
        return;
      }
      if (!event.data || typeof event.data !== "object" || Array.isArray(event.data)) {
        return;
      }

      const payload = event.data as Record<string, unknown>;
      if (payload["type"] !== "tyrum:onboarding-mode-selected") {
        return;
      }

      const mode = payload["mode"];
      if (mode !== "embedded" && mode !== "remote") {
        return;
      }

      void api.onboarding.selectMode(mode).catch((error) => {
        setErrorMessage(toErrorMessage(error));
      });
    };

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [api, config.mode, config.embedded.port]);

  const appUrl = gatewayUrls.embedUrl;
  const appDisplayUrl = gatewayUrls.displayUrl;
  const externalUrl = gatewayUrls.externalUrl ?? appDisplayUrl;
  const canEmbed =
    appUrl != null &&
    (config.mode === "remote" || gatewayStatus === "running");

  const startGateway = async () => {
    if (!api || busy) return;
    setBusy(true);
    setErrorMessage(null);
    try {
      const port = config.embedded.port;
      await api.setConfig({ mode: "embedded", embedded: { port } });
      setConfig((prev) => ({ ...prev, mode: "embedded" }));
      const result = await api.gateway.start();
      setGatewayStatus(result.status);
      setConfig((prev) => ({
        ...prev,
        embedded: { ...prev.embedded, port: result.port },
      }));
      await refreshGatewayUrls();
    } catch (error) {
      setGatewayStatus("error");
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const stopGateway = async () => {
    if (!api || busy) return;
    setBusy(true);
    try {
      const result = await api.gateway.stop();
      setGatewayStatus(result.status);
      setErrorMessage(null);
      await refreshGatewayUrls();
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const openInBrowser = async () => {
    if (!api || !externalUrl || openingExternal) return;
    setOpeningExternal(true);
    try {
      await api.openExternal(externalUrl);
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setOpeningExternal(false);
    }
  };

  return (
    <div>
      <h1 style={headingStyle}>Gateway</h1>

      <div style={cardStyle}>
        <div style={toolbarStyle}>
          <span
            style={statusDotStyle(STATUS_COLORS[gatewayStatus] ?? STATUS_COLORS["stopped"]!)}
          />
          <strong style={{ marginRight: 8 }}>
            {gatewayStatus.charAt(0).toUpperCase() + gatewayStatus.slice(1)}
          </strong>
          {config.mode === "embedded" ? (
            gatewayStatus === "running" || gatewayStatus === "starting" ? (
              <button style={buttonStyle("danger")} onClick={stopGateway} disabled={busy}>
                {busy ? "Stopping..." : "Stop Gateway"}
              </button>
            ) : (
              <button style={buttonStyle("primary")} onClick={startGateway} disabled={busy}>
                {busy ? "Starting..." : "Start Gateway"}
              </button>
            )
          ) : (
            <span style={{ color: "#6b7280", fontSize: 13 }}>
              Remote mode (no local start/stop)
            </span>
          )}

          <button
            style={buttonStyle("secondary")}
            onClick={() => setReloadKey((k) => k + 1)}
            disabled={!canEmbed}
          >
            Reload
          </button>
          <button
            style={buttonStyle("secondary")}
            onClick={openInBrowser}
            disabled={!externalUrl || openingExternal}
          >
            {openingExternal ? "Opening..." : "Open in Browser"}
          </button>
        </div>

        <div style={urlStyle}>
          {appDisplayUrl ?? "No valid Gateway URL available"}
        </div>
        {errorMessage && (
          <div style={{ color: "#b91c1c", marginTop: 10, fontSize: 13 }}>
            Reason: {errorMessage}
          </div>
        )}
      </div>

      <div style={frameShellStyle}>
        {canEmbed ? (
          <iframe
            key={`${appUrl}:${reloadKey}`}
            style={iframeStyle}
            src={appUrl ?? undefined}
            title="Tyrum Gateway"
          />
        ) : (
          <div style={placeholderStyle}>
            {config.mode === "embedded"
              ? "Start the embedded gateway to load the integrated web app."
              : "Set a valid remote gateway URL in Connection to load the integrated web app."}
          </div>
        )}
      </div>
    </div>
  );
}
