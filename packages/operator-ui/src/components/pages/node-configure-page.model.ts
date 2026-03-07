import { useEffect, useMemo, useRef, useState } from "react";
import type { DesktopApi, DesktopBackgroundState } from "../../desktop-api.js";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import { getAllowlistMode, type CapFlags } from "../../utils/permission-profile.js";
import {
  DEFAULT_CAPABILITIES,
  DEFAULT_CLI_CONFIG,
  DEFAULT_PROFILE,
  DEFAULT_WEB_CONFIG,
  type AllowlistDraftState,
  type CliConfig,
  type ConnectionState,
  type DisplayProfile,
  type MacPermissionSnapshot,
  type SaveResetTimers,
  type SecurityState,
  areSecurityStatesEqual,
  buildGeneralSavePartial,
  cloneConnectionState,
  cloneSecurityState,
  createAllowlistDraftState,
  createProfilePreset,
  describeMacPermissionSummary,
  hasConnectionSettingsChanged,
  isSecurityPresetMatch,
  needsEmbeddedGatewayRestart,
  readConnectionState,
  readSecurityState,
  splitAllowlistLines,
  validateConnectionState,
} from "./node-configure-page.shared.js";

export function useDesktopNodeConfigureModel(api: DesktopApi, onReloadPage?: () => void) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [security, setSecurity] = useState<SecurityState>({
    profile: DEFAULT_PROFILE,
    overrides: {},
    capabilities: DEFAULT_CAPABILITIES,
    cli: DEFAULT_CLI_CONFIG,
    web: DEFAULT_WEB_CONFIG,
  });
  const [connection, setConnection] = useState<ConnectionState>({
    mode: "embedded",
    port: 8788,
    remoteUrl: "ws://127.0.0.1:8788/ws",
    remoteToken: "",
    remoteTlsCertFingerprint256: "",
    remoteTlsAllowSelfSigned: false,
    hasSavedRemoteToken: false,
  });
  const [backgroundState, setBackgroundState] = useState<DesktopBackgroundState | null>(null);
  const [backgroundBusy, setBackgroundBusy] = useState(false);
  const [backgroundError, setBackgroundError] = useState<string | null>(null);
  const [generalSaving, setGeneralSaving] = useState(false);
  const [generalSaved, setGeneralSaved] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [securitySaving, setSecuritySaving] = useState(false);
  const [securitySaved, setSecuritySaved] = useState(false);
  const [securityError, setSecurityError] = useState<string | null>(null);
  const [macPermissionSummary, setMacPermissionSummary] = useState<string | null>(null);
  const [macPermissionChecking, setMacPermissionChecking] = useState(false);
  const [requestingMacPermission, setRequestingMacPermission] = useState<
    "accessibility" | "screenRecording" | null
  >(null);
  const [macPermissionError, setMacPermissionError] = useState<string | null>(null);
  const [allowlistDrafts, setAllowlistDrafts] = useState<AllowlistDraftState>({
    browserDomains: "",
    cliCommands: "",
    cliWorkingDirs: "",
  });
  const saveResetTimers = useRef<SaveResetTimers>({
    general: null,
    security: null,
  });
  const initialSecurityRef = useRef<SecurityState | null>(null);
  const initialConnectionRef = useRef<ConnectionState | null>(null);
  const saveInFlightRef = useRef<"general" | "security" | null>(null);

  useEffect(() => {
    return () => {
      for (const key of ["general", "security"] as const) {
        if (saveResetTimers.current[key]) {
          clearTimeout(saveResetTimers.current[key]);
          saveResetTimers.current[key] = null;
        }
      }
    };
  }, []);

  useEffect(() => {
    let disposed = false;

    void api
      .getConfig()
      .then((config) => {
        if (disposed) return;
        const nextSecurity = readSecurityState(config);
        const nextConnection = readConnectionState(config);
        setSecurity(nextSecurity);
        setAllowlistDrafts(createAllowlistDraftState(nextSecurity));
        setConnection(nextConnection);
        initialSecurityRef.current = cloneSecurityState(nextSecurity);
        initialConnectionRef.current = cloneConnectionState(nextConnection);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (disposed) return;
        setLoadError(formatErrorMessage(error));
      })
      .finally(() => {
        if (!disposed) {
          setLoading(false);
        }
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
  }, [api]);

  const displayProfile = useMemo<DisplayProfile>(
    () => (isSecurityPresetMatch(security.profile, security) ? security.profile : "custom"),
    [security],
  );
  const allowlistMode = useMemo(
    () => getAllowlistMode(security.profile, security.capabilities),
    [security.capabilities, security.profile],
  );
  const securityDirty =
    initialSecurityRef.current === null
      ? false
      : !areSecurityStatesEqual(initialSecurityRef.current, security);
  const generalDirty =
    initialConnectionRef.current === null
      ? false
      : hasConnectionSettingsChanged(initialConnectionRef.current, connection);

  const saveSucceeded = (
    channel: keyof SaveResetTimers,
    setSaved: (saved: boolean) => void,
    setError: (message: string | null) => void,
  ) => {
    setError(null);
    setSaved(true);
    if (saveResetTimers.current[channel]) {
      clearTimeout(saveResetTimers.current[channel]);
    }
    saveResetTimers.current[channel] = setTimeout(() => {
      setSaved(false);
      saveResetTimers.current[channel] = null;
    }, 2_000);
  };

  const persistSecurity = async (): Promise<void> => {
    await api.setConfig({
      permissions: {
        profile: security.profile,
        overrides: security.overrides,
      },
      capabilities: security.capabilities,
      cli: security.cli,
      web: security.web,
    });
    initialSecurityRef.current = cloneSecurityState(security);
  };

  const saveSecurity = () => {
    if (saveInFlightRef.current || securitySaving || !securityDirty) return;
    saveInFlightRef.current = "security";
    setSecuritySaving(true);
    setSecurityError(null);
    setSecuritySaved(false);
    void persistSecurity()
      .then(() => saveSucceeded("security", setSecuritySaved, setSecurityError))
      .catch((error: unknown) => setSecurityError(formatErrorMessage(error)))
      .finally(() => {
        saveInFlightRef.current = null;
        setSecuritySaving(false);
      });
  };

  const saveGeneral = () => {
    if (saveInFlightRef.current || generalSaving || (!generalDirty && !securityDirty)) return;

    const validationError = validateConnectionState(connection);
    if (validationError) {
      setGeneralError(validationError);
      setGeneralSaved(false);
      return;
    }

    saveInFlightRef.current = "general";
    setGeneralSaving(true);
    setGeneralError(null);
    setGeneralSaved(false);

    const previousConnection = initialConnectionRef.current
      ? cloneConnectionState(initialConnectionRef.current)
      : null;
    const partial = buildGeneralSavePartial(security, connection);
    const shouldReload = previousConnection
      ? hasConnectionSettingsChanged(previousConnection, connection)
      : true;
    const shouldStopEmbeddedGateway =
      previousConnection !== null &&
      shouldReload &&
      needsEmbeddedGatewayRestart(previousConnection, connection);

    void api
      .setConfig(partial)
      .then(async () => {
        initialSecurityRef.current = cloneSecurityState(security);
        initialConnectionRef.current = cloneConnectionState({
          ...connection,
          remoteToken: "",
          hasSavedRemoteToken:
            connection.mode === "remote"
              ? connection.hasSavedRemoteToken || connection.remoteToken.trim().length > 0
              : connection.hasSavedRemoteToken,
        });
        setConnection((current) => ({
          ...current,
          remoteToken: "",
          hasSavedRemoteToken:
            current.mode === "remote"
              ? current.hasSavedRemoteToken || current.remoteToken.trim().length > 0
              : current.hasSavedRemoteToken,
        }));

        if (shouldReload && onReloadPage) {
          await api.node.disconnect().catch(() => {
            // Retry bootstrap will recreate the node connection; disconnect is best-effort.
          });
          if (shouldStopEmbeddedGateway) {
            await api.gateway.stop().catch(() => {
              // Best-effort stop; retry bootstrap will surface any follow-up connection issue.
            });
          }
          onReloadPage();
          return;
        }

        saveSucceeded("general", setGeneralSaved, setGeneralError);
      })
      .catch((error: unknown) => setGeneralError(formatErrorMessage(error)))
      .finally(() => {
        saveInFlightRef.current = null;
        setGeneralSaving(false);
      });
  };

  const toggleBackgroundMode = (enabled: boolean) => {
    if (!api.background || backgroundBusy) return;
    setBackgroundBusy(true);
    setBackgroundError(null);
    void api.background
      .setEnabled(enabled)
      .then((state) => setBackgroundState(state))
      .catch((error: unknown) => setBackgroundError(formatErrorMessage(error)))
      .finally(() => setBackgroundBusy(false));
  };

  const checkMacPermissions = () => {
    if (!api.checkMacPermissions || macPermissionChecking) return;
    setMacPermissionChecking(true);
    setMacPermissionError(null);
    void api
      .checkMacPermissions()
      .then((snapshot) =>
        setMacPermissionSummary(
          describeMacPermissionSummary(snapshot as MacPermissionSnapshot | null),
        ),
      )
      .catch((error: unknown) => setMacPermissionError(formatErrorMessage(error)))
      .finally(() => setMacPermissionChecking(false));
  };

  const requestMacPermission = (permission: "accessibility" | "screenRecording") => {
    if (!api.requestMacPermission || requestingMacPermission !== null) return;
    setRequestingMacPermission(permission);
    setMacPermissionError(null);
    void api
      .requestMacPermission(permission)
      .then(() => {
        checkMacPermissions();
      })
      .catch((error: unknown) => setMacPermissionError(formatErrorMessage(error)))
      .finally(() => setRequestingMacPermission(null));
  };

  return {
    loading,
    loadError,
    security,
    connection,
    displayProfile,
    backgroundState,
    backgroundBusy,
    backgroundError,
    generalSaving,
    generalSaved,
    generalError,
    generalDirty,
    securitySaving,
    securitySaved,
    securityError,
    securityDirty,
    browserAllowlistActive: allowlistMode.web === "active",
    shellAllowlistActive: allowlistMode.cli === "active",
    browserDomainsDraft: allowlistDrafts.browserDomains,
    cliCommandsDraft: allowlistDrafts.cliCommands,
    cliWorkingDirsDraft: allowlistDrafts.cliWorkingDirs,
    macPermissionSummary,
    macPermissionChecking,
    requestingMacPermission,
    macPermissionError,
    applyProfile: (profile: DisplayProfile) => {
      if (profile === "custom") return;
      const nextSecurity = createProfilePreset(profile);
      setSecurity(nextSecurity);
      setAllowlistDrafts(createAllowlistDraftState(nextSecurity));
      setGeneralSaved(false);
      setSecuritySaved(false);
    },
    setCapability: (key: keyof CapFlags, nextEnabled: boolean) => {
      setSecurity((current) => ({
        ...current,
        capabilities: { ...current.capabilities, [key]: nextEnabled },
      }));
      setGeneralSaved(false);
      setSecuritySaved(false);
    },
    updateCliField: (field: keyof CliConfig, value: string) => {
      setSecurity((current) => ({
        ...current,
        cli: { ...current.cli, [field]: splitAllowlistLines(value) },
      }));
      setAllowlistDrafts((current) => ({
        ...current,
        [field === "allowedCommands" ? "cliCommands" : "cliWorkingDirs"]: value,
      }));
      setGeneralSaved(false);
      setSecuritySaved(false);
    },
    updateBrowserDomains: (value: string) => {
      setSecurity((current) => ({
        ...current,
        web: { ...current.web, allowedDomains: splitAllowlistLines(value) },
      }));
      setAllowlistDrafts((current) => ({ ...current, browserDomains: value }));
      setGeneralSaved(false);
      setSecuritySaved(false);
    },
    setBrowserHeadless: (headless: boolean) => {
      setSecurity((current) => ({
        ...current,
        web: { ...current.web, headless },
      }));
      setGeneralSaved(false);
      setSecuritySaved(false);
    },
    setMode: (mode: ConnectionState["mode"]) => {
      setConnection((current) => ({ ...current, mode }));
      setGeneralSaved(false);
    },
    setPort: (port: number) => {
      setConnection((current) => ({ ...current, port }));
      setGeneralSaved(false);
    },
    setRemoteUrl: (remoteUrl: string) => {
      setConnection((current) => ({ ...current, remoteUrl }));
      setGeneralSaved(false);
    },
    setRemoteToken: (remoteToken: string) => {
      setConnection((current) => ({ ...current, remoteToken }));
      setGeneralSaved(false);
    },
    setRemoteTlsCertFingerprint256: (remoteTlsCertFingerprint256: string) => {
      setConnection((current) => ({ ...current, remoteTlsCertFingerprint256 }));
      setGeneralSaved(false);
    },
    setRemoteTlsAllowSelfSigned: (remoteTlsAllowSelfSigned: boolean) => {
      setConnection((current) => ({ ...current, remoteTlsAllowSelfSigned }));
      setGeneralSaved(false);
    },
    saveSecurity,
    saveGeneral,
    toggleBackgroundMode,
    checkMacPermissions,
    requestMacPermission,
  };
}
