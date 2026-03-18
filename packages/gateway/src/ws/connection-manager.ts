import type { WebSocket } from "ws";
import type {
  CapabilityDescriptor,
  DevicePlatform,
  DeviceType,
  NodeCapabilityState,
  WsEventEnvelope,
  WsRequestEnvelope,
} from "@tyrum/schemas";
import type { AuthTokenClaims } from "@tyrum/schemas";
import { gatewayMetrics, type MetricsRegistry } from "../modules/observability/metrics.js";

export interface ConnectedClient {
  readonly id: string;
  readonly ws: WebSocket;
  readonly role: "client" | "node";
  readonly device_id?: string;
  readonly device_type?: DeviceType;
  readonly device_platform?: DevicePlatform;
  readonly device_model?: string;
  readonly auth_claims?: AuthTokenClaims;
  readonly protocol_rev: number;
  readonly capabilities: readonly CapabilityDescriptor[];
  readyCapabilities: CapabilityDescriptor[];
  capabilityStates: Map<string, NodeCapabilityState>;
  lastWsPongAt: number;
}

export interface ConnectionStats {
  totalClients: number;
  capabilityCounts: Record<string, number>;
}

const HEARTBEAT_TIMEOUT_MS = 10_000;

export class ConnectionManager {
  private readonly clients = new Map<string, ConnectedClient>();
  private readonly dispatchedAttemptExecutors = new Map<string, string>();

  constructor(private readonly metrics: MetricsRegistry = gatewayMetrics) {}

  private updateWsConnectionsActive(): void {
    this.metrics.wsConnectionsActive.set(this.clients.size);
  }

  /**
   * Register a new peer after a successful WebSocket handshake.
   *
   * @returns the generated client id (UUID v4).
   */
  addClient(
    ws: WebSocket,
    capabilities: readonly CapabilityDescriptor[],
    opts?: {
      id?: string;
      role?: "client" | "node";
      deviceId?: string;
      deviceType?: DeviceType;
      devicePlatform?: DevicePlatform;
      deviceModel?: string;
      authClaims?: AuthTokenClaims;
      protocolRev?: number;
    },
  ): string {
    const id = opts?.id ?? crypto.randomUUID();
    const role = opts?.role ?? "client";
    const readyCapabilities = [...capabilities];
    const client: ConnectedClient = {
      id,
      ws,
      role,
      device_id: opts?.deviceId,
      device_type: opts?.deviceType,
      device_platform: opts?.devicePlatform,
      device_model: opts?.deviceModel,
      auth_claims: opts?.authClaims,
      protocol_rev: opts?.protocolRev ?? 1,
      capabilities,
      readyCapabilities,
      capabilityStates: new Map(),
      lastWsPongAt: Date.now(),
    };
    ws.on("pong", () => {
      client.lastWsPongAt = Date.now();
    });
    this.clients.set(id, client);
    this.updateWsConnectionsActive();
    return id;
  }

  recordDispatchedAttemptExecutor(attemptId: string, nodeId: string): void {
    const normalizedAttemptId = attemptId.trim();
    const normalizedNodeId = nodeId.trim();
    if (normalizedAttemptId.length === 0) return;
    if (normalizedNodeId.length === 0) return;

    // Refresh insertion order for simple eviction.
    this.dispatchedAttemptExecutors.delete(normalizedAttemptId);
    this.dispatchedAttemptExecutors.set(normalizedAttemptId, normalizedNodeId);

    const maxEntries = 10_000;
    while (this.dispatchedAttemptExecutors.size > maxEntries) {
      const oldest = this.dispatchedAttemptExecutors.keys().next().value as string | undefined;
      if (!oldest) break;
      this.dispatchedAttemptExecutors.delete(oldest);
    }
  }

  getDispatchedAttemptExecutor(attemptId: string): string | undefined {
    return this.dispatchedAttemptExecutors.get(attemptId.trim());
  }

  /** Replace the ready capabilities set for a connected peer. */
  setReadyCapabilities(id: string, capabilities: readonly CapabilityDescriptor[]): void {
    const client = this.clients.get(id);
    if (!client) return;
    client.readyCapabilities = [...capabilities];
  }

  setCapabilityStates(id: string, capabilityStates: readonly NodeCapabilityState[]): void {
    const client = this.clients.get(id);
    if (!client) return;
    client.capabilityStates = new Map(
      capabilityStates.map((state) => [state.capability.id, state] as const),
    );
  }

  /** Remove a client (e.g. on disconnect or eviction). */
  removeClient(id: string): void {
    this.clients.delete(id);
    this.updateWsConnectionsActive();
  }

  closeClientsForTokenId(
    tokenId: string,
    opts?: {
      code?: number;
      reason?: string;
    },
  ): void {
    const normalizedTokenId = tokenId.trim();
    if (!normalizedTokenId) return;

    let changed = false;
    for (const [id, client] of this.clients) {
      if (client.auth_claims?.token_id !== normalizedTokenId) continue;
      try {
        client.ws.close(opts?.code ?? 4001, opts?.reason ?? "token invalidated");
      } catch (_closeErr) {
        void _closeErr;
        try {
          client.ws.terminate();
        } catch (_terminateErr) {
          void _terminateErr;
        }
      }
      this.clients.delete(id);
      changed = true;
    }

    if (changed) {
      this.updateWsConnectionsActive();
    }
  }

  /** Return the first connected client that advertises the given capability. */
  getClientForCapability(capabilityId: string): ConnectedClient | undefined {
    for (const client of this.clients.values()) {
      if (client.capabilities.some((capability) => capability.id === capabilityId)) {
        return client;
      }
    }
    return undefined;
  }

  /** Send a message to every client that advertises `capability`. */
  broadcastToCapable(capabilityId: string, message: WsRequestEnvelope | WsEventEnvelope): void {
    const payload = JSON.stringify(message);
    for (const client of this.clients.values()) {
      if (client.capabilities.some((capability) => capability.id === capabilityId)) {
        client.ws.send(payload);
      }
    }
  }

  /**
   * Heartbeat tick: send a WebSocket-level ping control frame to all clients
   * and evict those that have not responded with a pong within
   * {@link HEARTBEAT_TIMEOUT_MS}.
   */
  heartbeat(): void {
    const now = Date.now();
    let changed = false;

    for (const [id, client] of this.clients) {
      // Drop sockets that are no longer open (close event cleanup is best-effort).
      if (client.ws.readyState !== 1) {
        this.clients.delete(id);
        changed = true;
        continue;
      }
      if (now - client.lastWsPongAt > HEARTBEAT_TIMEOUT_MS) {
        try {
          client.ws.terminate();
        } catch (_err) {
          void _err;
          // Intentional: termination can throw during disconnect races; evict client anyway.
        }
        this.clients.delete(id);
        changed = true;
      } else {
        try {
          client.ws.ping();
        } catch (_err) {
          void _err;
          try {
            client.ws.terminate();
          } catch (_terminateErr) {
            void _terminateErr;
            // Intentional: termination can throw during disconnect races; evict client anyway.
          }
          this.clients.delete(id);
          changed = true;
        }
      }
    }

    if (changed) {
      this.updateWsConnectionsActive();
    }
  }

  /** Snapshot of current connection statistics. */
  getStats(): ConnectionStats {
    const capabilityCounts: Record<string, number> = {};
    for (const client of this.clients.values()) {
      for (const cap of client.capabilities) {
        capabilityCounts[cap.id] = (capabilityCounts[cap.id] ?? 0) + 1;
      }
    }
    return { totalClients: this.clients.size, capabilityCounts };
  }

  /** Retrieve a client by id (used internally by protocol handler). */
  getClient(id: string): ConnectedClient | undefined {
    return this.clients.get(id);
  }

  /** Iterate over all connected clients. */
  allClients(): IterableIterator<ConnectedClient> {
    return this.clients.values();
  }
}
