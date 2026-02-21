import { describe, expect, it } from "vitest";
import { HandshakeStateMachine } from "../../src/ws/handshake.js";

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
    const result = hsm.handleInit({ protocol_rev: "v2", device_id: "device-1" });
    expect(result.state).toBe("challenged");
    expect(result.challenge).toBeDefined();
    expect(result.challenge!.challenge_id).toBeDefined();
    expect(result.challenge!.challenge).toBeDefined();
  });

  it("valid proof after challenge completes handshake", () => {
    const hsm = new HandshakeStateMachine();
    const initResult = hsm.handleInit({ protocol_rev: "v2", device_id: "device-1" });
    expect(initResult.state).toBe("challenged");

    const proofResult = hsm.handleProof({
      challenge_id: initResult.challenge!.challenge_id,
      proof: "some-proof-value",
      device_id: "device-1",
    });
    expect(proofResult.state).toBe("connected");
    expect(proofResult.deviceId).toBe("device-1");
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
    const initResult = hsm.handleInit({ protocol_rev: "v2", device_id: "device-1" });

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
