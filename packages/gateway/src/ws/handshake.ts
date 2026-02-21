/**
 * Handshake state machine for WS connection establishment.
 *
 * Supports both legacy (v1 connect) and new (v2 connect.init/connect.proof)
 * handshake flows.
 */

import { randomUUID } from "node:crypto";
import { verifyDeviceProof } from "./device-identity.js";

export type HandshakeState = "waiting" | "challenged" | "connected" | "failed";

export interface HandshakeChallenge {
  challenge_id: string;
  challenge: string;
  created_at: number;
  expires_at: number;
}

export interface HandshakeResult {
  state: HandshakeState;
  clientId?: string;
  deviceId?: string;
  protocolRev?: string;
  error?: string;
  challenge?: HandshakeChallenge;
}

const CHALLENGE_TTL_MS = 30_000; // 30 seconds

export class HandshakeStateMachine {
  private state: HandshakeState = "waiting";
  private challenge: HandshakeChallenge | undefined;
  private deviceId: string | undefined;
  private publicKeyHex: string | undefined;
  private role: string | undefined;
  private protocolRev: string | undefined;

  getState(): HandshakeState {
    return this.state;
  }

  /**
   * Handle connect.init — generate a challenge for the client.
   */
  handleInit(payload: {
    protocol_rev?: string;
    device_id?: string;
    public_key?: string;
    role?: string;
    capabilities?: string[];
  }): HandshakeResult {
    if (this.state !== "waiting") {
      return { state: "failed", error: "unexpected_init" };
    }

    this.protocolRev = payload.protocol_rev ?? "v2";
    this.deviceId = payload.device_id;
    this.publicKeyHex = payload.public_key;
    this.role = payload.role;

    // If no device_id, skip challenge and complete immediately
    if (!payload.device_id) {
      this.state = "connected";
      return {
        state: "connected",
        protocolRev: this.protocolRev,
      };
    }

    // Generate challenge
    const now = Date.now();
    this.challenge = {
      challenge_id: randomUUID(),
      challenge: randomUUID(),
      created_at: now,
      expires_at: now + CHALLENGE_TTL_MS,
    };
    this.state = "challenged";

    return {
      state: "challenged",
      protocolRev: this.protocolRev,
      challenge: this.challenge,
    };
  }

  /**
   * Handle connect.proof — validate the client's proof response.
   */
  handleProof(payload: {
    challenge_id: string;
    proof: string;
    device_id?: string;
  }): HandshakeResult {
    if (this.state !== "challenged") {
      return { state: "failed", error: "unexpected_proof" };
    }

    if (!this.challenge) {
      return { state: "failed", error: "no_challenge" };
    }

    // Validate challenge_id matches
    if (payload.challenge_id !== this.challenge.challenge_id) {
      this.state = "failed";
      return { state: "failed", error: "challenge_mismatch" };
    }

    // Check expiry
    if (Date.now() > this.challenge.expires_at) {
      this.state = "failed";
      return { state: "failed", error: "challenge_expired" };
    }

    if (!payload.proof || payload.proof.length === 0) {
      this.state = "failed";
      return { state: "failed", error: "empty_proof" };
    }

    // Verify Ed25519 signature when public key is available
    if (this.publicKeyHex) {
      const valid = verifyDeviceProof(payload.proof, this.publicKeyHex, {
        challenge: this.challenge.challenge,
        protocol_rev: this.protocolRev ?? "v2",
        role: this.role ?? "client",
        device_id: this.deviceId ?? "",
      });
      if (!valid) {
        this.state = "failed";
        return { state: "failed", error: "invalid_proof" };
      }
    }

    this.state = "connected";
    this.deviceId = payload.device_id ?? this.deviceId;

    return {
      state: "connected",
      deviceId: this.deviceId,
      protocolRev: this.protocolRev,
    };
  }

  reset(): void {
    this.state = "waiting";
    this.challenge = undefined;
    this.deviceId = undefined;
    this.publicKeyHex = undefined;
    this.role = undefined;
    this.protocolRev = undefined;
  }
}
