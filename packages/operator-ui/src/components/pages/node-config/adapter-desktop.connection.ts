import { useCallback, useMemo, useRef, useState } from "react";
import type { DesktopApi, DesktopBackgroundState } from "../../../desktop-api.js";
import { formatErrorMessage } from "../../../utils/format-error-message.js";
import {
  type ConnectionState,
  buildConnectionSavePartial,
  cloneConnectionState,
  hasConnectionSettingsChanged,
  needsEmbeddedGatewayRestart,
  validateConnectionState,
} from "../node-configure-page.shared.js";
import type { DesktopConnectionFields } from "./node-config-page.types.js";

// ─── Return type ────────────────────────────────────────────────────────────

export interface DesktopConnectionResult {
  setConnection: React.Dispatch<React.SetStateAction<ConnectionState>>;
  /** Ref to the initial (saved) connection snapshot, written during config load. */
  initialConnectionRef: React.RefObject<ConnectionState | null>;
  /** Refresh the live operator connection info (token, mode). */
  refreshCurrentOperatorConnection: () => Promise<void>;
  setBackgroundState: React.Dispatch<React.SetStateAction<DesktopBackgroundState | null>>;
  /** Fully assembled connection fields for the UI. */
  connectionFields: DesktopConnectionFields;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useDesktopConnectionState(
  api: DesktopApi,
  onReloadPage: (() => void) | undefined,
  mountedRef: React.RefObject<boolean>,
): DesktopConnectionResult {
  // ── Connection state ────────────────────────────────────────────────────
  const [connection, setConnection] = useState<ConnectionState>({
    mode: "embedded",
    port: 8788,
    remoteUrl: "ws://127.0.0.1:8788/ws",
    remoteToken: "",
    remoteTlsCertFingerprint256: "",
    remoteTlsAllowSelfSigned: false,
    hasSavedRemoteToken: false,
  });

  const [currentOperatorConnection, setCurrentOperatorConnection] = useState<{
    mode: ConnectionState["mode"];
    token: string;
  } | null>(null);
  const [currentTokenLoading, setCurrentTokenLoading] = useState(false);
  const [currentTokenError, setCurrentTokenError] = useState<string | null>(null);

  const [backgroundState, setBackgroundState] = useState<DesktopBackgroundState | null>(null);
  const [backgroundBusy, setBackgroundBusy] = useState(false);
  const [backgroundError, setBackgroundError] = useState<string | null>(null);

  const [generalSaving, setGeneralSaving] = useState(false);
  const [generalSaved, setGeneralSaved] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);

  const initialConnectionRef = useRef<ConnectionState | null>(null);
  const operatorConnectionRequestRef = useRef(0);
  const saveInFlightRef = useRef(false);

  // ── Operator connection refresh ─────────────────────────────────────────

  const refreshCurrentOperatorConnection = useCallback(async (): Promise<void> => {
    const getOperatorConnection = api.gateway.getOperatorConnection;
    if (typeof getOperatorConnection !== "function") {
      setCurrentOperatorConnection(null);
      setCurrentTokenError("Current gateway token is unavailable in this desktop build.");
      setCurrentTokenLoading(false);
      return;
    }

    const requestId = operatorConnectionRequestRef.current + 1;
    operatorConnectionRequestRef.current = requestId;
    setCurrentTokenLoading(true);
    setCurrentTokenError(null);

    try {
      const operatorConnection = await getOperatorConnection();
      if (!mountedRef.current || operatorConnectionRequestRef.current !== requestId) return;
      setCurrentOperatorConnection({
        mode: operatorConnection.mode,
        token: operatorConnection.token,
      });
    } catch (error) {
      if (!mountedRef.current || operatorConnectionRequestRef.current !== requestId) return;
      setCurrentOperatorConnection(null);
      setCurrentTokenError(formatErrorMessage(error));
    } finally {
      if (mountedRef.current && operatorConnectionRequestRef.current === requestId) {
        setCurrentTokenLoading(false);
      }
    }
  }, [api.gateway, mountedRef]);

  // ── General dirty check ─────────────────────────────────────────────────

  const generalDirty =
    initialConnectionRef.current === null
      ? false
      : hasConnectionSettingsChanged(initialConnectionRef.current, connection);

  // ── Save general (connection) settings ──────────────────────────────────

  const saveGeneral = useCallback(() => {
    if (saveInFlightRef.current || generalSaving || !generalDirty) return;

    const validationError = validateConnectionState(connection);
    if (validationError) {
      setGeneralError(validationError);
      setGeneralSaved(false);
      return;
    }

    saveInFlightRef.current = true;
    setGeneralSaving(true);
    setGeneralError(null);
    setGeneralSaved(false);

    const previousConnection = initialConnectionRef.current
      ? cloneConnectionState(initialConnectionRef.current)
      : null;
    const partial = buildConnectionSavePartial(connection);
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
            // Best-effort disconnect.
          });
          if (shouldStopEmbeddedGateway) {
            await api.gateway.stop().catch(() => {
              // Best-effort stop.
            });
          }
          onReloadPage();
          return;
        }

        await refreshCurrentOperatorConnection();
        setGeneralError(null);
        setGeneralSaved(true);
        setTimeout(() => setGeneralSaved(false), 2_000);
      })
      .catch((error: unknown) => setGeneralError(formatErrorMessage(error)))
      .finally(() => {
        saveInFlightRef.current = false;
        setGeneralSaving(false);
      });
  }, [
    api,
    connection,
    generalDirty,
    generalSaving,
    onReloadPage,
    refreshCurrentOperatorConnection,
  ]);

  // ── Background mode toggle ──────────────────────────────────────────────

  const toggleBackgroundMode = useCallback(
    (enabled: boolean) => {
      if (!api.background || backgroundBusy) return;
      setBackgroundBusy(true);
      setBackgroundError(null);
      void api.background
        .setEnabled(enabled)
        .then((state) => setBackgroundState(state))
        .catch((error: unknown) => setBackgroundError(formatErrorMessage(error)))
        .finally(() => setBackgroundBusy(false));
    },
    [api.background, backgroundBusy],
  );

  // ── Connection fields memo ──────────────────────────────────────────────

  const connectionFields: DesktopConnectionFields = useMemo(
    () => ({
      connectionMode: connection.mode,
      savedConnectionMode: currentOperatorConnection?.mode ?? connection.mode,
      port: connection.port,
      remoteUrl: connection.remoteUrl,
      remoteToken: connection.remoteToken,
      remoteTlsCertFingerprint256: connection.remoteTlsCertFingerprint256,
      remoteTlsAllowSelfSigned: connection.remoteTlsAllowSelfSigned,
      hasSavedRemoteToken: connection.hasSavedRemoteToken,
      currentToken: currentOperatorConnection?.token ?? null,
      currentTokenLoading,
      currentTokenError,
      backgroundState,
      backgroundBusy,
      backgroundError,

      onConnectionModeChange: (mode: "embedded" | "remote") => {
        setConnection((current) => ({ ...current, mode }));
        setGeneralSaved(false);
      },
      onPortChange: (port: number) => {
        setConnection((current) => ({ ...current, port }));
        setGeneralSaved(false);
      },
      onRemoteUrlChange: (url: string) => {
        setConnection((current) => ({ ...current, remoteUrl: url }));
        setGeneralSaved(false);
      },
      onRemoteTokenChange: (token: string) => {
        setConnection((current) => ({ ...current, remoteToken: token }));
        setGeneralSaved(false);
      },
      onRemoteTlsFingerprintChange: (fingerprint: string) => {
        setConnection((current) => ({
          ...current,
          remoteTlsCertFingerprint256: fingerprint,
        }));
        setGeneralSaved(false);
      },
      onRemoteTlsAllowSelfSignedChange: (allow: boolean) => {
        setConnection((current) => ({
          ...current,
          remoteTlsAllowSelfSigned: allow,
        }));
        setGeneralSaved(false);
      },
      onToggleBackgroundMode: toggleBackgroundMode,

      dirty: generalDirty,
      saving: generalSaving,
      saved: generalSaved,
      saveError: generalError,
      onSave: saveGeneral,
    }),
    [
      backgroundBusy,
      backgroundError,
      backgroundState,
      connection,
      currentOperatorConnection?.token,
      currentTokenError,
      currentTokenLoading,
      generalDirty,
      generalError,
      generalSaved,
      generalSaving,
      saveGeneral,
      toggleBackgroundMode,
    ],
  );

  // ── Return ──────────────────────────────────────────────────────────────

  return {
    setConnection,
    initialConnectionRef,
    refreshCurrentOperatorConnection,
    setBackgroundState,
    connectionFields,
  };
}
