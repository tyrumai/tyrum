import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { HandshakeStateMachine } from "../../src/ws/handshake.js";
import { buildTranscript } from "../../src/ws/device-identity.js";

// Generate Ed25519 keypair for crypto tests
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicKeyHex = publicKey
  .export({ type: "spki", format: "der" })
  .subarray(12)
  .toString("hex");

function signChallenge(
  challenge: string,
  deviceId: string,
  protocolRev = "v2",
  role = "client",
): string {
  const msg = Buffer.from(
    buildTranscript({
      challenge,
      protocol_rev: protocolRev,
      role,
      device_id: deviceId,
    }),
  );
  return sign(null, msg, privateKey).toString("base64");
}

describe("HandshakeStateMachine", () => {
  it("starts in waiting state", () => {
    const hsm = new HandshakeStateMachine();
    expect(hsm.getState()).toBe("waiting");
  });

  it("init without device_id completes immediately", () => {
    const hsm = new HandshakeStateMachine();
    const result = hsm.handleInit({ protocol_rev: "v2" });
    expect(result.state).toBe("connected");
    expect(result.protocolRev).toBe("v2");
  });

  it("init with device_id generates challenge", () => {
    const hsm = new HandshakeStateMachine();
    const result = hsm.handleInit({
      protocol_rev: "v2",
      device_id: "device-1",
    });
    expect(result.state).toBe("challenged");
    expect(result.challenge).toBeDefined();
    expect(result.challenge!.challenge_id).toBeDefined();
    expect(result.challenge!.challenge).toBeDefined();
  });

  // Legacy path: no public_key → accepts any non-empty proof
  it("valid proof without public_key completes handshake (legacy)", () => {
    const hsm = new HandshakeStateMachine();
    const initResult = hsm.handleInit({
      protocol_rev: "v2",
      device_id: "device-1",
    });
    expect(initResult.state).toBe("challenged");

    const proofResult = hsm.handleProof({
      challenge_id: initResult.challenge!.challenge_id,
      proof: "some-proof-value",
      device_id: "device-1",
    });
    expect(proofResult.state).toBe("connected");
    expect(proofResult.deviceId).toBe("device-1");
  });

  // Crypto path: public_key provided → Ed25519 verification
  it("valid Ed25519 proof with public_key completes handshake", () => {
    const hsm = new HandshakeStateMachine();
    const deviceId = "device-crypto-1";
    const initResult = hsm.handleInit({
      protocol_rev: "v2",
      device_id: deviceId,
      public_key: publicKeyHex,
      role: "client",
    });
    expect(initResult.state).toBe("challenged");

    const proof = signChallenge(initResult.challenge!.challenge, deviceId);
    const proofResult = hsm.handleProof({
      challenge_id: initResult.challenge!.challenge_id,
      proof,
      device_id: deviceId,
    });
    expect(proofResult.state).toBe("connected");
    expect(proofResult.deviceId).toBe(deviceId);
  });

  it("invalid Ed25519 proof with public_key fails", () => {
    const hsm = new HandshakeStateMachine();
    const initResult = hsm.handleInit({
      protocol_rev: "v2",
      device_id: "device-crypto-2",
      public_key: publicKeyHex,
      role: "client",
    });
    expect(initResult.state).toBe("challenged");

    const proofResult = hsm.handleProof({
      challenge_id: initResult.challenge!.challenge_id,
      proof: "not-a-valid-signature",
      device_id: "device-crypto-2",
    });
    expect(proofResult.state).toBe("failed");
    expect(proofResult.error).toBe("invalid_proof");
  });

  it("proof signed for wrong challenge fails", () => {
    const hsm = new HandshakeStateMachine();
    const deviceId = "device-crypto-3";
    const initResult = hsm.handleInit({
      protocol_rev: "v2",
      device_id: deviceId,
      public_key: publicKeyHex,
      role: "client",
    });
    expect(initResult.state).toBe("challenged");

    // Sign a different challenge
    const proof = signChallenge("wrong-challenge", deviceId);
    const proofResult = hsm.handleProof({
      challenge_id: initResult.challenge!.challenge_id,
      proof,
      device_id: deviceId,
    });
    expect(proofResult.state).toBe("failed");
    expect(proofResult.error).toBe("invalid_proof");
  });

  it("wrong challenge_id fails", () => {
    const hsm = new HandshakeStateMachine();
    hsm.handleInit({ protocol_rev: "v2", device_id: "device-1" });

    const result = hsm.handleProof({
      challenge_id: "wrong-id",
      proof: "some-proof",
    });
    expect(result.state).toBe("failed");
    expect(result.error).toBe("challenge_mismatch");
  });

  it("empty proof fails", () => {
    const hsm = new HandshakeStateMachine();
    const initResult = hsm.handleInit({
      protocol_rev: "v2",
      device_id: "device-1",
    });

    const result = hsm.handleProof({
      challenge_id: initResult.challenge!.challenge_id,
      proof: "",
    });
    expect(result.state).toBe("failed");
  });

  it("proof before init fails", () => {
    const hsm = new HandshakeStateMachine();
    const result = hsm.handleProof({
      challenge_id: "any",
      proof: "any",
    });
    expect(result.state).toBe("failed");
    expect(result.error).toBe("unexpected_proof");
  });

  it("double init fails", () => {
    const hsm = new HandshakeStateMachine();
    hsm.handleInit({ protocol_rev: "v2" }); // completes immediately
    const result = hsm.handleInit({ protocol_rev: "v2" });
    expect(result.state).toBe("failed");
  });

  it("reset returns to waiting state", () => {
    const hsm = new HandshakeStateMachine();
    hsm.handleInit({ protocol_rev: "v2" });
    hsm.reset();
    expect(hsm.getState()).toBe("waiting");
  });
});
