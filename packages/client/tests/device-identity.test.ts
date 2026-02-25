import { describe, expect, it, vi } from "vitest";
import {
  buildConnectProofTranscript,
  computeDeviceIdFromPublicKeyDer,
  createDeviceIdentity,
  DeviceIdentityError,
  loadOrCreateDeviceIdentity,
  signProofWithPrivateKey,
} from "../src/index.js";

describe("device identity helpers", () => {
  it("exports fromBase64Url for internal reuse", async () => {
    const mod = (await import("../src/device-identity.js")) as unknown as Record<string, unknown>;
    expect(typeof mod["fromBase64Url"]).toBe("function");
  });

  it("creates an identity and derives device id from public key", async () => {
    const identity = await createDeviceIdentity();
    expect(identity.deviceId).toMatch(/^dev_[a-z2-7]+$/);
    expect(identity.publicKey).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(identity.privateKey).toMatch(/^[A-Za-z0-9\-_]+$/);

    const pubkeyDer = Buffer.from(identity.publicKey, "base64url");
    const expectedDeviceId = await computeDeviceIdFromPublicKeyDer(pubkeyDer);
    expect(identity.deviceId).toBe(expectedDeviceId);
  });

  it("loads existing identity from storage before creating a new one", async () => {
    const existing = {
      deviceId: "dev_existing",
      publicKey: "public-key",
      privateKey: "private-key",
    };
    const load = vi.fn(async () => existing);
    const save = vi.fn(async () => {});
    const identity = await loadOrCreateDeviceIdentity({ load, save });
    expect(identity).toEqual(existing);
    expect(save).not.toHaveBeenCalled();
  });

  it("creates and saves identity when storage is empty", async () => {
    const load = vi.fn(async () => null);
    const save = vi.fn(async () => {});
    const identity = await loadOrCreateDeviceIdentity({ load, save });
    expect(identity.deviceId).toMatch(/^dev_[a-z2-7]+$/);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("builds proof transcript and signs it", async () => {
    const identity = await createDeviceIdentity();
    const transcript = buildConnectProofTranscript({
      protocolRev: 2,
      role: "client",
      deviceId: identity.deviceId,
      connectionId: "conn-1",
      challenge: "nonce-1",
    });
    const rendered = new TextDecoder().decode(transcript);
    expect(rendered).toContain("tyrum-connect-proof");
    expect(rendered).toContain("connection_id=conn-1");

    const proof = await signProofWithPrivateKey(identity.privateKey, transcript);
    expect(proof).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  it("does not mask DeviceIdentityError thrown by storage.load()", async () => {
    const load = vi.fn(() => {
      throw new DeviceIdentityError(
        "device_identity_invalid_stored_value",
        "stored device identity corrupted",
      );
    });
    const save = vi.fn(async () => {});

    await expect(loadOrCreateDeviceIdentity({ load, save })).rejects.toMatchObject({
      name: "DeviceIdentityError",
      code: "device_identity_invalid_stored_value",
    } satisfies Partial<DeviceIdentityError>);
  });

  it("throws structured error when WebCrypto subtle API is unavailable", async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: undefined });
    try {
      await expect(createDeviceIdentity()).rejects.toMatchObject({
        name: "DeviceIdentityError",
        code: "device_identity_webcrypto_unavailable",
      } satisfies Partial<DeviceIdentityError>);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(globalThis, "crypto", originalDescriptor);
      } else {
        // If there was no crypto before, avoid leaking a new property into other test files.
        void Reflect.deleteProperty(globalThis as unknown as Record<string, unknown>, "crypto");
      }
    }
  });
});
