import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DesktopApi } from "../../../desktop-api.js";
import { formatErrorMessage } from "../../../utils/format-error-message.js";
import type { CapFlags } from "../../../utils/permission-profile.js";
import {
  type SecurityState,
  cloneConnectionState,
  createAllowlistDraftState,
  readConnectionState,
  readSecurityState,
  splitAllowlistLines,
  DEFAULT_CAPABILITIES,
  DEFAULT_PROFILE,
  DEFAULT_WEB_CONFIG,
} from "../node-configure-page.shared.js";
import type { SaveStatus, UnifiedNodeConfigModel } from "./node-config-page.types.js";
import { useDesktopConnectionState } from "./adapter-desktop.connection.js";
import {
  type AllowlistDrafts,
  type DesktopTestDispatch,
  useDesktopCapabilities,
} from "./adapter-desktop.capabilities.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type { DesktopTestDispatch };

export interface UseNodeConfigDesktopOptions {
  dispatchTest?: DesktopTestDispatch;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function securityToPersistedPayload(security: SecurityState): Record<string, unknown> {
  return {
    permissions: {
      profile: security.profile,
      overrides: security.overrides,
    },
    capabilities: security.capabilities,
    web: security.web,
  };
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useNodeConfigDesktop(
  api: DesktopApi,
  onReloadPage?: () => void,
  options: UseNodeConfigDesktopOptions = {},
): UnifiedNodeConfigModel {
  const { dispatchTest } = options;

  // ── Loading state ───────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── Security state ──────────────────────────────────────────────────────
  const [security, setSecurity] = useState<SecurityState>({
    profile: DEFAULT_PROFILE,
    overrides: {},
    capabilities: DEFAULT_CAPABILITIES,
    web: DEFAULT_WEB_CONFIG,
  });
  const [allowlistDrafts, setAllowlistDrafts] = useState<AllowlistDrafts>({
    browserDomains: "",
  });

  // ── Security auto-save state ──────────────────────────────────────────
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const securityRef = useRef(security);
  // Sync ref on render so persistSecurityNow always reads current state.
  securityRef.current = security;

  /** Update security state and eagerly sync the ref so an immediate persist
   *  reads the new value before React re-renders. */
  const updateSecurity = useCallback((updater: (current: SecurityState) => SecurityState) => {
    setSecurity((current) => {
      const next = updater(current);
      securityRef.current = next;
      return next;
    });
  }, []);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Shared mounted ref ────────────────────────────────────────────────
  const mountedRef = useRef(true);

  // ── Executor state ──────────────────────────────────────────────────────
  const [executorConnected, setExecutorConnected] = useState(false);
  const [executorDeviceId, setExecutorDeviceId] = useState<string | null>(null);
  const [executorBusy, setExecutorBusy] = useState(false);
  const [executorError, setExecutorError] = useState<string | null>(null);

  // ── Cleanup ─────────────────────────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  // ── Connection state (delegated) ────────────────────────────────────────

  const {
    setConnection,
    initialConnectionRef,
    refreshCurrentOperatorConnection,
    setBackgroundState,
    connectionFields,
  } = useDesktopConnectionState(api, onReloadPage, mountedRef);

  // ── Initial load ──────────────────────────────────────────────────────

  useEffect(() => {
    let disposed = false;
    mountedRef.current = true;

    void api
      .getConfig()
      .then((config) => {
        if (disposed) return;
        const nextSecurity = readSecurityState(config);
        const nextConnection = readConnectionState(config);
        setSecurity(nextSecurity);
        setAllowlistDrafts(createAllowlistDraftState(nextSecurity));
        setConnection(nextConnection);
        initialConnectionRef.current = cloneConnectionState(nextConnection);
        setLoadError(null);
        void refreshCurrentOperatorConnection();
      })
      .catch((error: unknown) => {
        if (disposed) return;
        setLoadError(formatErrorMessage(error));
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });

    if (api.background?.getState) {
      void api.background
        .getState()
        .then((state) => {
          if (disposed) return;
          setBackgroundState(state);
        })
        .catch(() => {
          // Background mode remains unavailable.
        });
    }

    return () => {
      disposed = true;
    };
  }, [
    api,
    refreshCurrentOperatorConnection,
    setConnection,
    initialConnectionRef,
    setBackgroundState,
  ]);

  // ── Executor: initial status + subscription ─────────────────────────────

  useEffect(() => {
    let disposed = false;

    if (api.node.getStatus) {
      void api.node
        .getStatus()
        .then((status) => {
          if (disposed) return;
          setExecutorConnected(status.connected);
          setExecutorDeviceId(status.deviceId);
        })
        .catch((error: unknown) => {
          if (disposed) return;
          setExecutorError(formatErrorMessage(error));
        });
    }

    const unsubscribe = api.onStatusChange((status) => {
      if (disposed) return;
      const parsed = status as {
        connected?: boolean;
        deviceId?: string | null;
      };
      if (typeof parsed.connected === "boolean") {
        setExecutorConnected(parsed.connected);
      }
      if ("deviceId" in parsed) {
        setExecutorDeviceId(parsed.deviceId ?? null);
      }
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [api]);

  // ── Security auto-save helpers ────────────────────────────────────────

  const persistSecurityNow = useCallback(async (): Promise<void> => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaveStatus("saving");
    setSaveError(null);

    try {
      const snapshotBeforeSave = securityRef.current;
      await api.setConfig(securityToPersistedPayload(snapshotBeforeSave));
      if (!mountedRef.current) {
        savingRef.current = false;
        return;
      }

      // If state changed while save was in flight, persist again.
      savingRef.current = false;
      if (securityRef.current !== snapshotBeforeSave) {
        void persistSecurityNow();
        return;
      }

      setSaveStatus("saved");
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => {
        if (mountedRef.current) setSaveStatus("idle");
        savedTimerRef.current = null;
      }, 2_000);
    } catch (error: unknown) {
      savingRef.current = false;
      if (!mountedRef.current) return;
      setSaveStatus("error");
      setSaveError(formatErrorMessage(error));
    }
  }, [api]);

  const scheduleSecuritySave = useCallback(
    (immediate: boolean) => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      if (immediate) {
        void persistSecurityNow();
      } else {
        debounceTimerRef.current = setTimeout(() => {
          debounceTimerRef.current = null;
          void persistSecurityNow();
        }, 500);
      }
    },
    [persistSecurityNow],
  );

  // ── Capability toggle handler ─────────────────────────────────────────

  const setCapability = useCallback(
    (key: keyof CapFlags, enabled: boolean) => {
      updateSecurity((current) => ({
        ...current,
        capabilities: { ...current.capabilities, [key]: enabled },
      }));
      scheduleSecuritySave(true);
    },
    [scheduleSecuritySave, updateSecurity],
  );

  // ── Allowlist change handlers ─────────────────────────────────────────

  const updateBrowserDomains = useCallback(
    (value: string) => {
      updateSecurity((current) => ({
        ...current,
        web: { ...current.web, allowedDomains: splitAllowlistLines(value) },
      }));
      setAllowlistDrafts((current) => ({ ...current, browserDomains: value }));
      scheduleSecuritySave(false);
    },
    [scheduleSecuritySave, updateSecurity],
  );

  // ── Browser headless toggle ───────────────────────────────────────────

  const setBrowserHeadless = useCallback(
    (headless: boolean) => {
      updateSecurity((current) => ({
        ...current,
        web: { ...current.web, headless },
      }));
      scheduleSecuritySave(true);
    },
    [scheduleSecuritySave, updateSecurity],
  );

  // ── Executor toggle ───────────────────────────────────────────────────

  const onExecutorToggle = useCallback(
    (enabled: boolean) => {
      if (executorBusy) return;
      setExecutorBusy(true);
      setExecutorError(null);
      const action = enabled ? api.node.connect() : api.node.disconnect();
      void action
        .then(() => {
          if (!mountedRef.current) return;
          setExecutorConnected(enabled);
        })
        .catch((error: unknown) => {
          if (!mountedRef.current) return;
          setExecutorError(formatErrorMessage(error));
        })
        .finally(() => {
          if (mountedRef.current) setExecutorBusy(false);
        });
    },
    [api.node, executorBusy],
  );

  // ── Capabilities (delegated) ──────────────────────────────────────────

  const capabilities = useDesktopCapabilities({
    api,
    security,
    allowlistDrafts,
    saveStatus,
    saveError,
    executorDeviceId,
    dispatchTest,
    setCapability,
    setBrowserHeadless,
    updateBrowserDomains,
  });

  // ── Executor status ───────────────────────────────────────────────────

  const executorStatus = executorConnected ? "connected" : executorError ? "error" : "disconnected";

  // ── Return unified model ──────────────────────────────────────────────

  return useMemo<UnifiedNodeConfigModel>(
    () => ({
      platform: "desktop",
      loading,
      loadError,
      connection: { mode: "editable", editable: connectionFields },
      executor: {
        enabled: executorConnected,
        status: executorStatus,
        nodeId: executorDeviceId,
        error: executorError,
        busy: executorBusy,
        onToggle: onExecutorToggle,
      },
      capabilities,
    }),
    [
      capabilities,
      connectionFields,
      executorBusy,
      executorConnected,
      executorDeviceId,
      executorError,
      executorStatus,
      loadError,
      loading,
      onExecutorToggle,
    ],
  );
}
