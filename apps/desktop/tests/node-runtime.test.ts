import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deviceIdFromSha256Digest, type ActionPrimitive, type ClientCapability } from "@tyrum/schemas";
import type { CapabilityProvider, TaskResult } from "@tyrum/client";
import { NodeRuntime } from "../src/main/node-runtime.js";
import { resolvePermissions } from "../src/main/config/permissions.js";
import { DEFAULT_CONFIG } from "../src/main/config/schema.js";
import { encryptToken } from "../src/main/config/token-store.js";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function makeProvider(capability: ClientCapability): CapabilityProvider {
  return {
    capability,
    execute: async (_action: ActionPrimitive): Promise<TaskResult> => ({
      success: true,
    }),
  };
}

function readEnabledCapabilities(runtime: NodeRuntime): ClientCapability[] {
  return (
    runtime as unknown as { getEnabledCapabilities: () => ClientCapability[] }
  ).getEnabledCapabilities();
}

function computeDeviceIdFromPublicKey(publicKey: string): string {
  const pubDer = Buffer.from(publicKey, "base64url");
  const digest = createHash("sha256").update(pubDer).digest();
  return deviceIdFromSha256Digest(digest);
}

describe("NodeRuntime capability advertisement", () => {
  const callbacks = {
    onStatusChange: () => {},
    onConsentRequest: () => {},
    onPlanUpdate: () => {},
    onLog: () => {},
  };

  it("advertises only capabilities with registered providers", () => {
    const runtime = new NodeRuntime(
      {
        ...DEFAULT_CONFIG,
        capabilities: {
          desktop: true,
          playwright: true,
          cli: true,
          http: true,
        },
      },
      resolvePermissions("balanced", {}),
      callbacks,
    );

    runtime.registerProvider(makeProvider("desktop"));
    runtime.registerProvider(makeProvider("cli"));

    expect(readEnabledCapabilities(runtime)).toEqual(["desktop", "cli"]);
  });

  it("deduplicates capability advertisement by provider capability", () => {
    const runtime = new NodeRuntime(
      DEFAULT_CONFIG,
      resolvePermissions("balanced", {}),
      callbacks,
    );

    runtime.registerProvider(makeProvider("desktop"));
    runtime.registerProvider(makeProvider("desktop"));

    expect(readEnabledCapabilities(runtime)).toEqual(["desktop"]);
  });
});

describe("NodeRuntime device identity", () => {
  let tmpHome: string;
  let origHome: string | undefined;

  const callbacks = {
    onStatusChange: () => {},
    onConsentRequest: () => {},
    onPlanUpdate: () => {},
    onLog: () => {},
  };

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "tyrum-node-runtime-test-"));
    origHome = process.env["TYRUM_HOME"];
    process.env["TYRUM_HOME"] = tmpHome;
  });

  afterEach(() => {
    if (origHome === undefined) {
      delete process.env["TYRUM_HOME"];
    } else {
      process.env["TYRUM_HOME"] = origHome;
    }
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it("recomputes deviceId when regenerating a keypair", () => {
    const runtime = new NodeRuntime(
      {
        ...DEFAULT_CONFIG,
        device: {
          ...DEFAULT_CONFIG.device,
          enabled: true,
          deviceId: "stale-device-id",
          publicKey: "old-public-key",
          privateKeyRef: Buffer.from("   ", "utf-8").toString("base64"),
          privateKey: "",
        },
      },
      resolvePermissions("balanced", {}),
      callbacks,
    );

    const device = (runtime as unknown as { ensureDeviceIdentity: () => NonNullable<unknown> }).ensureDeviceIdentity();
    expect(device).toBeTruthy();

    const { deviceId, publicKey } = device as { deviceId: string; publicKey: string };
    expect(deviceId).toBe(computeDeviceIdFromPublicKey(publicKey));
  });

  it("repairs a stale deviceId when it does not match the current public key", () => {
    const { publicKey: pub, privateKey: priv } = generateKeyPairSync("ed25519");
    const pubDer = pub.export({ format: "der", type: "spki" }) as Buffer;
    const privDer = priv.export({ format: "der", type: "pkcs8" }) as Buffer;
    const publicKey = pubDer.toString("base64url");
    const privateKey = privDer.toString("base64url");

    const runtime = new NodeRuntime(
      {
        ...DEFAULT_CONFIG,
        device: {
          ...DEFAULT_CONFIG.device,
          enabled: true,
          deviceId: "stale-device-id",
          publicKey,
          privateKeyRef: encryptToken(privateKey),
          privateKey: "",
        },
      },
      resolvePermissions("balanced", {}),
      callbacks,
    );

    const device = (runtime as unknown as { ensureDeviceIdentity: () => NonNullable<unknown> }).ensureDeviceIdentity();
    expect(device).toBeTruthy();

    const { deviceId } = device as { deviceId: string };
    expect(deviceId).toBe(computeDeviceIdFromPublicKey(publicKey));
  });
});
