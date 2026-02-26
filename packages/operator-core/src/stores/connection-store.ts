import type { OperatorWsClient } from "../deps.js";
import { createStore, type ExternalStore } from "../store.js";

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

export interface ConnectionState {
  status: ConnectionStatus;
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
  handleTransportError: (message: string) => void;
} {
  const { store, setState } = createStore<ConnectionState>({
    status: "disconnected",
    clientId: null,
    lastDisconnect: null,
    transportError: null,
  });

  function connect(): void {
    setState((prev) => ({
      ...prev,
      status: "connecting",
      lastDisconnect: null,
      transportError: null,
    }));
    ws.connect();
  }

  function disconnect(): void {
    ws.disconnect();
    setState((prev) => ({
      ...prev,
      status: "disconnected",
      clientId: null,
    }));
  }

  function handleConnected(clientId: string | null): void {
    setState((prev) => ({
      ...prev,
      status: "connected",
      clientId,
      lastDisconnect: null,
      transportError: null,
    }));
  }

  function handleDisconnected(code: number, reason: string): void {
    setState((prev) => ({
      ...prev,
      status: "disconnected",
      clientId: null,
      lastDisconnect: { code, reason },
    }));
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
    handleTransportError,
  };
}
