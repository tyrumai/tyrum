/**
 * WebSocket connection manager — tracks connected clients and their capabilities.
 *
 * Stateless with respect to plan orchestration; it only manages the set of
 * live WebSocket connections and exposes capability-based routing helpers.
 */

import type { WebSocket } from "ws";
import type { ClientCapability, WsEventEnvelope, WsRequestEnvelope } from "@tyrum/schemas";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConnectedClient {
  readonly id: string;
  readonly ws: WebSocket;
  readonly role: "client" | "node";
  readonly device_id?: string;
  readonly protocol_rev: number;
  readonly capabilities: readonly ClientCapability[];
  readyCapabilities: Set<ClientCapability>;
  lastPong: number;
}

export interface ConnectionStats {
  totalClients: number;
  capabilityCounts: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Clients that have not responded to a ping within this window are evicted. */
const HEARTBEAT_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// ConnectionManager
// ---------------------------------------------------------------------------

export class ConnectionManager {
  private readonly clients = new Map<string, ConnectedClient>();

  /**
   * Register a new client after a successful `connect` handshake.
   *
   * @returns the generated client id (UUID v4).
   */
  addClient(
    ws: WebSocket,
    capabilities: readonly ClientCapability[],
    opts?: {
      id?: string;
      role?: "client" | "node";
      deviceId?: string;
      protocolRev?: number;
    },
  ): string {
    const id = opts?.id ?? crypto.randomUUID();
    const role = opts?.role ?? "client";
    const readyCapabilities = new Set<ClientCapability>(capabilities);
    const client: ConnectedClient = {
      id,
      ws,
      role,
      device_id: opts?.deviceId,
      protocol_rev: opts?.protocolRev ?? 1,
      capabilities,
      readyCapabilities,
      lastPong: Date.now(),
    };
    ws.on("pong", () => {
      client.lastPong = Date.now();
    });
    this.clients.set(id, client);
    return id;
  }

  /** Replace the ready capabilities set for a connected peer. */
  setReadyCapabilities(id: string, capabilities: readonly ClientCapability[]): void {
    const client = this.clients.get(id);
    if (!client) return;
    client.readyCapabilities = new Set<ClientCapability>(capabilities);
  }

  /** Remove a client (e.g. on disconnect or eviction). */
  removeClient(id: string): void {
    this.clients.delete(id);
  }

  /** Return the first connected client that advertises the given capability. */
  getClientForCapability(
    capability: ClientCapability,
  ): ConnectedClient | undefined {
    for (const client of this.clients.values()) {
      if (client.capabilities.includes(capability)) {
        return client;
      }
    }
    return undefined;
  }

  /** Send a message to every client that advertises `capability`. */
  broadcastToCapable(
    capability: ClientCapability,
    message: WsRequestEnvelope | WsEventEnvelope,
  ): void {
    const payload = JSON.stringify(message);
    for (const client of this.clients.values()) {
      if (client.capabilities.includes(capability)) {
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

    for (const [id, client] of this.clients) {
      // Drop sockets that are no longer open (close event cleanup is best-effort).
      if (client.ws.readyState !== 1) {
        this.clients.delete(id);
        continue;
      }
      if (now - client.lastPong > HEARTBEAT_TIMEOUT_MS) {
        try {
          client.ws.terminate();
        } catch {
          // ignore
        }
        this.clients.delete(id);
      } else {
        try {
          client.ws.ping();
        } catch {
          try {
            client.ws.terminate();
          } catch {
            // ignore
          }
          this.clients.delete(id);
        }
      }
    }
  }

  /** Snapshot of current connection statistics. */
  getStats(): ConnectionStats {
    const capabilityCounts: Record<string, number> = {};
    for (const client of this.clients.values()) {
      for (const cap of client.capabilities) {
        capabilityCounts[cap] = (capabilityCounts[cap] ?? 0) + 1;
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
