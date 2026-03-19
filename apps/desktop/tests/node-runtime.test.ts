import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  descriptorIdsForClientCapability,
  deviceIdFromSha256Digest,
  migrateCapabilityDescriptorId,
  type ActionPrimitive,
  type CapabilityDescriptor,
  type ClientCapability,
} from "@tyrum/contracts";
import type { CapabilityProvider, TaskResult } from "@tyrum/client";
import type { WsCapabilityReadyPayload } from "@tyrum/contracts";
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

function readAdvertisedDescriptors(runtime: NodeRuntime): CapabilityDescriptor[] {
  return (
    runtime as unknown as { getAdvertisedCapabilityDescriptors: () => CapabilityDescriptor[] }
  ).getAdvertisedCapabilityDescriptors();
}

function readCapabilityReadyPayload(runtime: NodeRuntime): WsCapabilityReadyPayload {
  return (
    runtime as unknown as { getCapabilityReadyPayload: () => WsCapabilityReadyPayload }
  ).getCapabilityReadyPayload();
}

/** Builds expected descriptors for a ClientCapability, applying legacy migration. */
function expectedDescriptorsFor(...capabilities: ClientCapability[]): CapabilityDescriptor[] {
  const seen = new Set<string>();
  const descriptors: CapabilityDescriptor[] = [];
  for (const cap of capabilities) {
    const ids = descriptorIdsForClientCapability(cap).flatMap(migrateCapabilityDescriptorId);
    for (const id of ids) {
      if (!seen.has(id)) {
        seen.add(id);
        descriptors.push({ id, version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION });
      }
    }
  }
  return descriptors;
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
        },
      },
      resolvePermissions("balanced", {}),
      callbacks,
    );

    runtime.registerProvider(makeProvider("desktop"));

    expect(readAdvertisedDescriptors(runtime)).toEqual(expectedDescriptorsFor("desktop"));
  });

  it("deduplicates capability advertisement by provider capability", () => {
    const runtime = new NodeRuntime(DEFAULT_CONFIG, resolvePermissions("balanced", {}), callbacks);

    runtime.registerProvider(makeProvider("desktop"));
    runtime.registerProvider(makeProvider("desktop"));

    expect(readAdvertisedDescriptors(runtime)).toEqual(expectedDescriptorsFor("desktop"));
  });

  it("uses capabilityIds when provider declares them directly", () => {
    const runtime = new NodeRuntime(DEFAULT_CONFIG, resolvePermissions("balanced", {}), callbacks);

    runtime.registerProvider({
      capabilityIds: ["tyrum.browser.navigate", "tyrum.browser.close"],
      execute: async () => ({ success: true }),
    });

    const descriptors = readAdvertisedDescriptors(runtime);
    expect(descriptors).toEqual([
      { id: "tyrum.browser.navigate", version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION },
      { id: "tyrum.browser.close", version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION },
    ]);
  });

  it("getCapabilityReadyPayload wraps descriptors with empty capability_states", () => {
    const runtime = new NodeRuntime(DEFAULT_CONFIG, resolvePermissions("balanced", {}), callbacks);

    runtime.registerProvider(makeProvider("desktop"));

    const payload = readCapabilityReadyPayload(runtime);
    expect(payload.capabilities).toEqual(expectedDescriptorsFor("desktop"));
    expect(payload.capability_states).toEqual([]);
  });

  it("provider with no capability or capabilityIds produces no descriptors", () => {
    const runtime = new NodeRuntime(DEFAULT_CONFIG, resolvePermissions("balanced", {}), callbacks);

    runtime.registerProvider({
      execute: async () => ({ success: true }),
    });

    const descriptors = readAdvertisedDescriptors(runtime);
    expect(descriptors).toEqual([]);
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

    const device = (
      runtime as unknown as { ensureDeviceIdentity: () => NonNullable<unknown> }
    ).ensureDeviceIdentity();
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

    const device = (
      runtime as unknown as { ensureDeviceIdentity: () => NonNullable<unknown> }
    ).ensureDeviceIdentity();
    expect(device).toBeTruthy();

    const { deviceId } = device as { deviceId: string };
    expect(deviceId).toBe(computeDeviceIdFromPublicKey(publicKey));
  });
});
