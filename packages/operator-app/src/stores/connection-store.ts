import type { OperatorWsClient } from "../deps.js";
import { createStore, type ExternalStore } from "../store.js";

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

export interface ConnectionState {
  status: ConnectionStatus;
  /**
   * True when recovering from an unexpected disconnect and allowing a grace
   * window for auto-reconnect before transitioning to `disconnected`.
   */
  recovering: boolean;
  nextRetryAtMs: number | null;
  clientId: string | null;
  lastDisconnect: { code: number; reason: string } | null;
  transportError: string | null;
}

export interface ConnectionStore extends ExternalStore<ConnectionState> {
  connect(): void;
  disconnect(): void;
}

const RECONNECT_GRACE_MS = 10_000;
const TERMINAL_CLOSE_CODES = new Set<number>([4001, 4003, 4004, 4005, 4006, 4007, 4008]);

type SetState<T> = (updater: (prev: T) => T) => void;

interface ConnectionInternals {
  reconnectGraceTimer: ReturnType<typeof setTimeout> | null;
  disconnectRequested: boolean;
}

function clearReconnectGraceTimer(internals: ConnectionInternals): void {
  if (internals.reconnectGraceTimer !== null) {
    clearTimeout(internals.reconnectGraceTimer);
    internals.reconnectGraceTimer = null;
  }
}

function connectImpl(
  ws: OperatorWsClient,
  setState: SetState<ConnectionState>,
  internals: ConnectionInternals,
): void {
  internals.disconnectRequested = false;
  clearReconnectGraceTimer(internals);
  setState((prev) => ({
    ...prev,
    status: "connecting",
    recovering: false,
    nextRetryAtMs: null,
    clientId: null,
    lastDisconnect: null,
    transportError: null,
  }));
  ws.connect();
}

function disconnectImpl(
  ws: OperatorWsClient,
  setState: SetState<ConnectionState>,
  internals: ConnectionInternals,
): void {
  internals.disconnectRequested = true;
  ws.disconnect();
  clearReconnectGraceTimer(internals);
  setState((prev) => ({
    ...prev,
    status: "disconnected",
    recovering: false,
    nextRetryAtMs: null,
    clientId: null,
  }));
}

function handleConnectedImpl(
  setState: SetState<ConnectionState>,
  internals: ConnectionInternals,
  clientId: string | null,
): void {
  internals.disconnectRequested = false;
  clearReconnectGraceTimer(internals);
  setState((prev) => ({
    ...prev,
    status: "connected",
    recovering: false,
    nextRetryAtMs: null,
    clientId,
    lastDisconnect: null,
    transportError: null,
  }));
}

function markDisconnectedAfterClose(
  setState: SetState<ConnectionState>,
  code: number,
  reason: string,
): void {
  setState((prev) => ({
    ...prev,
    status: "disconnected",
    recovering: false,
    nextRetryAtMs: null,
    clientId: null,
    lastDisconnect: { code, reason },
  }));
}

function transitionToConnectingAfterUnexpectedDisconnect(
  setState: SetState<ConnectionState>,
  code: number,
  reason: string,
): boolean {
  let shouldEnterRecovering = false;
  // Only re-enter recovering if we were previously connected/recovering.
  // When already gated on Connect, repeated transport retries should stay
  // in non-recovering `connecting` so the login page can show progress
  // without flashing the shell back on each attempt.
  setState((prev) => {
    shouldEnterRecovering = prev.status === "connected" || prev.recovering;
    return {
      ...prev,
      status: "connecting",
      recovering: shouldEnterRecovering,
      // Preserve any existing retry schedule until a new one arrives.
      nextRetryAtMs: prev.nextRetryAtMs,
      clientId: null,
      lastDisconnect: { code, reason },
    };
  });
  return shouldEnterRecovering;
}

function scheduleReconnectGraceExpiry(
  setState: SetState<ConnectionState>,
  internals: ConnectionInternals,
): void {
  if (internals.reconnectGraceTimer !== null) return;
  internals.reconnectGraceTimer = setTimeout(() => {
    internals.reconnectGraceTimer = null;
    setState((prev) => {
      if (prev.status !== "connecting" || !prev.recovering) {
        return prev;
      }
      return {
        ...prev,
        status: "disconnected",
        recovering: false,
        // Keep scheduled retry metadata for gated reconnect UX.
        nextRetryAtMs: prev.nextRetryAtMs,
        clientId: null,
      };
    });
  }, RECONNECT_GRACE_MS);
}

function handleDisconnectedImpl(
  setState: SetState<ConnectionState>,
  internals: ConnectionInternals,
  code: number,
  reason: string,
): void {
  if (internals.disconnectRequested) {
    internals.disconnectRequested = false;
    clearReconnectGraceTimer(internals);
    markDisconnectedAfterClose(setState, code, reason);
    return;
  }

  if (TERMINAL_CLOSE_CODES.has(code)) {
    clearReconnectGraceTimer(internals);
    markDisconnectedAfterClose(setState, code, reason);
    return;
  }

  const shouldEnterRecovering = transitionToConnectingAfterUnexpectedDisconnect(
    setState,
    code,
    reason,
  );
  if (!shouldEnterRecovering) {
    clearReconnectGraceTimer(internals);
    return;
  }

  scheduleReconnectGraceExpiry(setState, internals);
}

function handleReconnectScheduledImpl(
  setState: SetState<ConnectionState>,
  nextRetryAtMs: number,
): void {
  setState((prev) => {
    if (
      prev.status === "disconnected" &&
      prev.lastDisconnect !== null &&
      TERMINAL_CLOSE_CODES.has(prev.lastDisconnect.code)
    ) {
      return prev.nextRetryAtMs === null ? prev : { ...prev, nextRetryAtMs: null };
    }
    return { ...prev, nextRetryAtMs };
  });
}

function handleTransportErrorImpl(setState: SetState<ConnectionState>, message: string): void {
  setState((prev) => ({ ...prev, transportError: message }));
}

export function createConnectionStore(ws: OperatorWsClient): {
  store: ConnectionStore;
  handleConnected: (clientId: string | null) => void;
  handleDisconnected: (code: number, reason: string) => void;
  handleReconnectScheduled: (nextRetryAtMs: number) => void;
  handleTransportError: (message: string) => void;
} {
  const { store, setState } = createStore<ConnectionState>({
    status: "disconnected",
    recovering: false,
    nextRetryAtMs: null,
    clientId: null,
    lastDisconnect: null,
    transportError: null,
  });

  const internals: ConnectionInternals = { reconnectGraceTimer: null, disconnectRequested: false };

  return {
    store: {
      ...store,
      connect: () => connectImpl(ws, setState, internals),
      disconnect: () => disconnectImpl(ws, setState, internals),
    },
    handleConnected: (clientId) => handleConnectedImpl(setState, internals, clientId),
    handleDisconnected: (code, reason) => handleDisconnectedImpl(setState, internals, code, reason),
    handleReconnectScheduled: (nextRetryAtMs) =>
      handleReconnectScheduledImpl(setState, nextRetryAtMs),
    handleTransportError: (message) => handleTransportErrorImpl(setState, message),
  };
}
