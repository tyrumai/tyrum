import { createPublicKey, verify } from "node:crypto";
import {
  type CapabilityDescriptor,
  type DevicePlatform,
  type DeviceType,
  normalizeCapabilityDescriptors,
  type WsEventEnvelope,
  type WsPeerRole,
} from "@tyrum/contracts";
import type { PresenceRow } from "../../modules/presence/dal.js";
import { PAIRING_WS_AUDIENCE } from "../../ws/audience.js";
import type { ConnectionManager } from "../../ws/connection-manager.js";

export const PAIRING_REQUESTED_AUDIENCE = PAIRING_WS_AUDIENCE;

export interface PendingInit {
  protocolRev: number;
  role: WsPeerRole;
  deviceId: string;
  pubkey: string;
  label?: string;
  platform?: string;
  version?: string;
  mode?: string;
  deviceType?: DeviceType;
  devicePlatform?: DevicePlatform;
  deviceModel?: string;
  capabilities: CapabilityDescriptor[];
  connectionId: string;
  challenge: string;
}

function buildConnectProofTranscript(input: {
  protocolRev: number;
  role: WsPeerRole;
  deviceId: string;
  connectionId: string;
  challenge: string;
}): Buffer {
  const text =
    `tyrum-connect-proof\n` +
    `protocol_rev=${String(input.protocolRev)}\n` +
    `role=${input.role}\n` +
    `device_id=${input.deviceId}\n` +
    `connection_id=${input.connectionId}\n` +
    `challenge=${input.challenge}\n`;
  return Buffer.from(text, "utf-8");
}

export function parseCapabilitiesFromInit(payload: {
  capabilities: CapabilityDescriptor[];
}): CapabilityDescriptor[] {
  return normalizeCapabilityDescriptors(payload.capabilities);
}

export function verifyConnectProof(pending: PendingInit, proof: string): boolean {
  try {
    const pubkeyDer = Buffer.from(pending.pubkey, "base64url");
    const key = createPublicKey({ key: pubkeyDer, format: "der", type: "spki" });
    const sig = Buffer.from(proof, "base64url");
    const transcript = buildConnectProofTranscript({
      protocolRev: pending.protocolRev,
      role: pending.role,
      deviceId: pending.deviceId,
      connectionId: pending.connectionId,
      challenge: pending.challenge,
    });
    return verify(null, transcript, key, sig);
  } catch (err) {
    void err;
    return false;
  }
}

export function createPresenceUpsertedEvent(row: PresenceRow): WsEventEnvelope {
  return {
    event_id: crypto.randomUUID(),
    type: "presence.upserted",
    occurred_at: new Date().toISOString(),
    payload: {
      entry: {
        instance_id: row.instance_id,
        role: row.role,
        host: row.host ?? undefined,
        ip: row.ip ?? undefined,
        version: row.version ?? undefined,
        mode: row.mode ?? undefined,
        last_seen_at: new Date(row.last_seen_at_ms).toISOString(),
        last_input_seconds: row.last_input_seconds ?? undefined,
        reason: "connect",
        metadata: row.metadata,
      },
    },
  };
}

export function broadcastLocalEvent(
  connectionManager: ConnectionManager,
  event: WsEventEnvelope,
): void {
  const payload = JSON.stringify(event);
  for (const peer of connectionManager.allClients()) {
    try {
      peer.ws.send(payload);
    } catch (err) {
      void err;
    }
  }
}
