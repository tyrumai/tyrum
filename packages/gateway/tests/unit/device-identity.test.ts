import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildTranscript,
  deriveDeviceId,
  verifyDeviceProof,
} from "../../src/ws/device-identity.js";

// Generate a test Ed25519 keypair
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicKeyHex = publicKey
  .export({ type: "spki", format: "der" })
  .subarray(12) // strip DER prefix to get raw 32-byte key
  .toString("hex");

const transcript = {
  challenge: "test-challenge-nonce",
  protocol_rev: "v2",
  role: "client",
  device_id: "tyrum-testdevice",
};

function signTranscript(t: typeof transcript): string {
  const message = Buffer.from(buildTranscript(t));
  return sign(null, message, privateKey).toString("base64");
}

describe("deriveDeviceId", () => {
  it("returns a string starting with 'tyrum-'", () => {
    const id = deriveDeviceId(publicKeyHex);
    expect(id).toMatch(/^tyrum-[a-z2-7]+$/);
  });

  it("is deterministic for the same key", () => {
    expect(deriveDeviceId(publicKeyHex)).toBe(deriveDeviceId(publicKeyHex));
  });

  it("produces different IDs for different keys", () => {
    const { publicKey: pk2 } = generateKeyPairSync("ed25519");
    const hex2 = pk2
      .export({ type: "spki", format: "der" })
      .subarray(12)
      .toString("hex");
    expect(deriveDeviceId(publicKeyHex)).not.toBe(deriveDeviceId(hex2));
  });
});

describe("buildTranscript", () => {
  it("produces deterministic transcript string", () => {
    const t = buildTranscript(transcript);
    expect(t).toBe(
      "tyrum-proof::test-challenge-nonce::v2::client::tyrum-testdevice",
    );
  });
});

describe("verifyDeviceProof", () => {
  it("verifies a valid Ed25519 signature", () => {
    const proof = signTranscript(transcript);
    expect(verifyDeviceProof(proof, publicKeyHex, transcript)).toBe(true);
  });

  it("rejects an invalid signature", () => {
    expect(verifyDeviceProof("badsig", publicKeyHex, transcript)).toBe(false);
  });

  it("rejects empty proof", () => {
    expect(verifyDeviceProof("", publicKeyHex, transcript)).toBe(false);
  });

  it("rejects empty public key", () => {
    const proof = signTranscript(transcript);
    expect(verifyDeviceProof(proof, "", transcript)).toBe(false);
  });

  it("rejects signature with wrong challenge", () => {
    const proof = signTranscript(transcript);
    const wrongTranscript = { ...transcript, challenge: "wrong-challenge" };
    expect(verifyDeviceProof(proof, publicKeyHex, wrongTranscript)).toBe(false);
  });

  it("rejects signature with wrong device_id", () => {
    const proof = signTranscript(transcript);
    const wrongTranscript = { ...transcript, device_id: "wrong-device" };
    expect(verifyDeviceProof(proof, publicKeyHex, wrongTranscript)).toBe(false);
  });

  it("rejects signature from different keypair", () => {
    const { publicKey: otherPub } = generateKeyPairSync("ed25519");
    const otherHex = otherPub
      .export({ type: "spki", format: "der" })
      .subarray(12)
      .toString("hex");
    const proof = signTranscript(transcript);
    expect(verifyDeviceProof(proof, otherHex, transcript)).toBe(false);
  });
});
