import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import type { WebSocket } from "ws";
import {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  descriptorIdForClientCapability,
  deviceIdFromSha256Digest,
} from "@tyrum/schemas";
import { expect } from "vitest";

function waitForJsonMessageMatching(
  ws: WebSocket,
  predicate: (msg: Record<string, unknown>) => boolean,
  timeoutMs = 5_000,
  label = "unknown",
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", onMessage);
      reject(new Error(`message timeout (${label})`));
    }, timeoutMs);

    const onMessage = (data: unknown) => {
      try {
        const msg = JSON.parse(String(data)) as Record<string, unknown>;
        if (!predicate(msg)) return;
        clearTimeout(timer);
        ws.off("message", onMessage);
        resolve(msg);
      } catch {
        // ignore malformed frames
      }
    };

    ws.on("message", onMessage);
  });
}

export function computeDeviceId(pubkeyDer: Buffer): string {
  const digest = createHash("sha256").update(pubkeyDer).digest();
  return deviceIdFromSha256Digest(digest);
}

export type HandshakeIdentity = {
  deviceId: string;
  privateKey: KeyObject;
  pubkey: string;
};

export function createHandshakeIdentity(): HandshakeIdentity {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pubkeyDer = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  return {
    deviceId: computeDeviceId(pubkeyDer),
    privateKey,
    pubkey: pubkeyDer.toString("base64url"),
  };
}

export function buildTranscript(input: {
  protocolRev: number;
  role: "client" | "node";
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

export async function completeHandshake(
  ws: WebSocket,
  input: {
    requestIdPrefix: string;
    role: "client" | "node";
    capabilities: Parameters<typeof descriptorIdForClientCapability>[0][];
    label?: string;
    protocolRev?: number;
    identity?: HandshakeIdentity;
  },
): Promise<{ clientId: string; deviceId: string }> {
  const protocolRev = input.protocolRev ?? 2;
  const identity = input.identity ?? createHandshakeIdentity();

  ws.send(
    JSON.stringify({
      request_id: `${input.requestIdPrefix}-init`,
      type: "connect.init",
      payload: {
        protocol_rev: protocolRev,
        role: input.role,
        device: {
          device_id: identity.deviceId,
          pubkey: identity.pubkey,
          label: input.label ?? "test",
        },
        capabilities: input.capabilities.map((capability) => ({
          id: descriptorIdForClientCapability(capability),
          version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
        })),
      },
    }),
  );

  const initRes = await waitForJsonMessageMatching(
    ws,
    (msg) =>
      msg["type"] === "connect.init" &&
      msg["request_id"] === `${input.requestIdPrefix}-init` &&
      Object.prototype.hasOwnProperty.call(msg, "ok"),
    5_000,
    "connect.init",
  );
  expect(initRes["ok"], JSON.stringify(initRes)).toBe(true);
  const initResult = initRes["result"] as Record<string, unknown>;
  const connectionId = String(initResult["connection_id"]);
  const challenge = String(initResult["challenge"]);

  const transcript = buildTranscript({
    protocolRev,
    role: input.role,
    deviceId: identity.deviceId,
    connectionId,
    challenge,
  });
  const signature = sign(null, transcript, identity.privateKey);

  ws.send(
    JSON.stringify({
      request_id: `${input.requestIdPrefix}-proof`,
      type: "connect.proof",
      payload: { connection_id: connectionId, proof: signature.toString("base64url") },
    }),
  );

  const proofRes = await waitForJsonMessageMatching(
    ws,
    (msg) =>
      msg["type"] === "connect.proof" &&
      msg["request_id"] === `${input.requestIdPrefix}-proof` &&
      Object.prototype.hasOwnProperty.call(msg, "ok"),
    5_000,
    "connect.proof",
  );
  expect(proofRes["ok"], JSON.stringify(proofRes)).toBe(true);

  return { clientId: connectionId, deviceId: identity.deviceId };
}
