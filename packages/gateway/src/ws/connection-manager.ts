/**
 * WebSocket connection manager — tracks connected clients and their capabilities.
 *
 * Stateless with respect to plan orchestration; it only manages the set of
 * live WebSocket connections and exposes capability-based routing helpers.
 */

import type { WebSocket } from "ws";
import type {
  ClientCapability,
  DeviceDescriptor,
  PeerRole,
  WsEventEnvelope,
  WsRequestEnvelope,
} from "@tyrum/schemas";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConnectedClient {
  readonly id: string;
  readonly ws: WebSocket;
  readonly role: PeerRole;
  readonly instance_id: string;
  readonly device: DeviceDescriptor;
  readonly capabilities: readonly ClientCapability[];
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
   * Register a new peer after a successful handshake.
   *
   * @returns the connection id.
   */
  addClient(params: {
    connectionId: string;
    ws: WebSocket;
    role: PeerRole;
    instanceId: string;
    device: DeviceDescriptor;
    capabilities: readonly ClientCapability[];
  }): string {
    const id = params.connectionId;
    const client: ConnectedClient = {
      id,
      ws: params.ws,
      role: params.role,
      instance_id: params.instanceId,
      device: params.device,
      capabilities: params.capabilities,
      lastPong: Date.now(),
    };
    this.clients.set(id, client);
    return id;
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
   * Heartbeat tick: send a `ping` frame to all clients and evict those that
   * have not responded with a `pong` within {@link HEARTBEAT_TIMEOUT_MS}.
   */
  heartbeat(): void {
    const now = Date.now();
    const pingPayload = JSON.stringify({
      request_id: `ping-${crypto.randomUUID()}`,
      type: "ping",
      payload: {},
    } satisfies WsRequestEnvelope);

    for (const [id, client] of this.clients) {
      if (now - client.lastPong > HEARTBEAT_TIMEOUT_MS) {
        client.ws.close();
        this.clients.delete(id);
      } else {
        client.ws.send(pingPayload);
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
