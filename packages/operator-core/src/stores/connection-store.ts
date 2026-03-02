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

export function createConnectionStore(ws: OperatorWsClient): {
  store: ConnectionStore;
  handleConnected: (clientId: string | null) => void;
  handleDisconnected: (code: number, reason: string) => void;
  handleReconnectScheduled: (nextRetryAtMs: number) => void;
  handleTransportError: (message: string) => void;
} {
  const RECONNECT_GRACE_MS = 10_000;
  const TERMINAL_CLOSE_CODES = new Set([4001, 4003, 4004, 4005, 4006, 4007, 4008]);

  let reconnectGraceTimer: ReturnType<typeof setTimeout> | null = null;
  let ignoreNextDisconnectedEvent = false;
  const clearReconnectGraceTimer = (): void => {
    if (reconnectGraceTimer !== null) {
      clearTimeout(reconnectGraceTimer);
      reconnectGraceTimer = null;
    }
  };

  const { store, setState } = createStore<ConnectionState>({
    status: "disconnected",
    recovering: false,
    nextRetryAtMs: null,
    clientId: null,
    lastDisconnect: null,
    transportError: null,
  });

  function connect(): void {
    ignoreNextDisconnectedEvent = false;
    clearReconnectGraceTimer();
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

  function disconnect(): void {
    ignoreNextDisconnectedEvent = true;
    ws.disconnect();
    clearReconnectGraceTimer();
    setState((prev) => ({
      ...prev,
      status: "disconnected",
      recovering: false,
      nextRetryAtMs: null,
      clientId: null,
    }));
  }

  function handleConnected(clientId: string | null): void {
    ignoreNextDisconnectedEvent = false;
    clearReconnectGraceTimer();
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

  function handleDisconnected(code: number, reason: string): void {
    if (ignoreNextDisconnectedEvent) {
      ignoreNextDisconnectedEvent = false;
      return;
    }

    const isTerminal = TERMINAL_CLOSE_CODES.has(code);
    if (isTerminal) {
      clearReconnectGraceTimer();
      setState((prev) => ({
        ...prev,
        status: "disconnected",
        recovering: false,
        nextRetryAtMs: null,
        clientId: null,
        lastDisconnect: { code, reason },
      }));
      return;
    }

    let shouldEnterRecovering = false;
    // Only re-enter recovering if we were previously connected/recovering.
    // When already gated on Connect, repeated transport retries should stay
    // in non-recovering `connecting` so the login page can show progress
    // without flashing the shell back on each attempt.
    setState((prev) => {
      shouldEnterRecovering = prev.status === "connected" || prev.recovering;
      if (!shouldEnterRecovering) {
        return {
          ...prev,
          status: "connecting",
          recovering: false,
          // Preserve any existing retry schedule until a new one arrives.
          nextRetryAtMs: prev.nextRetryAtMs,
          clientId: null,
          lastDisconnect: { code, reason },
        };
      }
      return {
        ...prev,
        status: "connecting",
        recovering: true,
        nextRetryAtMs: prev.nextRetryAtMs,
        clientId: null,
        lastDisconnect: { code, reason },
      };
    });

    if (!shouldEnterRecovering) {
      clearReconnectGraceTimer();
      return;
    }

    if (reconnectGraceTimer !== null) return;
    reconnectGraceTimer = setTimeout(() => {
      reconnectGraceTimer = null;
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

  function handleReconnectScheduled(nextRetryAtMs: number): void {
    setState((prev) => ({ ...prev, nextRetryAtMs }));
  }

  function handleTransportError(message: string): void {
    setState((prev) => ({ ...prev, transportError: message }));
  }

  return {
    store: {
      ...store,
      connect,
      disconnect,
    },
    handleConnected,
    handleDisconnected,
    handleReconnectScheduled,
    handleTransportError,
  };
}
