import { createServer, type Server } from "node:http";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { WebSocket } from "ws";
import { capabilityDescriptorsForClientCapability, deviceIdFromSha256Digest } from "@tyrum/schemas";
import { expect } from "vitest";

import { createWsHandler } from "../../src/routes/ws.js";

type ConnectRole = "client" | "node";
type ClientCapability = "cli" | "playwright" | "ios" | "android" | "desktop" | "http";

function authProtocols(token: string): string[] {
  return ["tyrum-v1", `tyrum-auth.${Buffer.from(token, "utf-8").toString("base64url")}`];
}

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }
    const timer = setTimeout(() => reject(new Error("open timeout")), 5_000);
    ws.once("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function computeDeviceId(pubkeyDer: Buffer): string {
  const digest = createHash("sha256").update(pubkeyDer).digest();
  return deviceIdFromSha256Digest(digest);
}

function buildTranscript(input: {
  protocolRev: number;
  role: ConnectRole;
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

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function waitForJsonMessageMatching(
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

export async function listen(
  handler: ReturnType<typeof createWsHandler>,
): Promise<{ server: Server; port: number }> {
  const server = createServer();
  server.on("upgrade", (req, socket, head) => {
    handler.handleUpgrade(req, socket, head);
  });

  const port = await new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : 0);
    });
  });

  return { server, port };
}

export async function connectClientWithProof(input: {
  port: number;
  token: string;
  role: ConnectRole;
  capabilities: ClientCapability[];
}): Promise<{ ws: WebSocket; connectionId: string; deviceId: string }> {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const pubkeyDer = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  const pubkey = pubkeyDer.toString("base64url");
  const deviceId = computeDeviceId(pubkeyDer);

  const ws = new WebSocket(`ws://127.0.0.1:${input.port}/ws`, authProtocols(input.token));
  await waitForOpen(ws);

  ws.send(
    JSON.stringify({
      request_id: "r-init",
      type: "connect.init",
      payload: {
        protocol_rev: 2,
        role: input.role,
        device: { device_id: deviceId, pubkey, label: "test" },
        capabilities: input.capabilities.flatMap((capability) =>
          capabilityDescriptorsForClientCapability(capability),
        ),
      },
    }),
  );

  const initRes = await waitForJsonMessageMatching(
    ws,
    (msg) => msg["type"] === "connect.init" && msg["ok"] === true,
    5_000,
    "connect.init",
  );
  const initResult = initRes["result"] as Record<string, unknown>;
  const connectionId = String(initResult["connection_id"]);
  const challenge = String(initResult["challenge"]);
  expect(connectionId).toBeTruthy();
  expect(challenge).toBeTruthy();

  const transcript = buildTranscript({
    protocolRev: 2,
    role: input.role,
    deviceId,
    connectionId,
    challenge,
  });
  const proof = sign(null, transcript, privateKey).toString("base64url");

  ws.send(
    JSON.stringify({
      request_id: "r-proof",
      type: "connect.proof",
      payload: { connection_id: connectionId, proof },
    }),
  );

  const proofRes = await waitForJsonMessageMatching(
    ws,
    (msg) => msg["type"] === "connect.proof" && msg["ok"] === true,
    5_000,
    "connect.proof",
  );
  const proofResult = proofRes["result"] as Record<string, unknown>;
  expect(String(proofResult["client_id"])).toBe(connectionId);
  expect(String(proofResult["device_id"])).toBe(deviceId);

  return { ws, connectionId, deviceId };
}
