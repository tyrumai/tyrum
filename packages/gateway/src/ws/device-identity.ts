/**
 * Device identity: Ed25519 key derivation and proof verification.
 *
 * device_id = "tyrum-" + base32(sha256(publicKey))
 * proof = Ed25519 sign(transcript, privateKey)
 * transcript = "tyrum-proof::" + challenge + "::" + protocol_rev + "::" + role + "::" + device_id
 */

import { createHash, createPublicKey, verify } from "node:crypto";

// ---------- base32 (RFC 4648, lowercase, no padding) ----------

const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32_ALPHABET[(value >>> bits) & 0x1f];
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return out;
}

// ---------- Device ID derivation ----------

/**
 * Derive a stable device ID from an Ed25519 public key.
 *
 * @param publicKeyHex - The Ed25519 public key as a hex string (64 hex chars = 32 bytes).
 * @returns "tyrum-" + base32(sha256(rawPublicKeyBytes))
 */
export function deriveDeviceId(publicKeyHex: string): string {
  const rawKey = Buffer.from(publicKeyHex, "hex");
  const hash = createHash("sha256").update(rawKey).digest();
  return "tyrum-" + base32Encode(hash);
}

// ---------- Transcript ----------

export interface DeviceTranscript {
  challenge: string;
  protocol_rev: string;
  role: string;
  device_id: string;
}

/**
 * Build the canonical transcript string that the proof signs over.
 * Binding all four fields prevents replay across connections.
 */
export function buildTranscript(t: DeviceTranscript): string {
  return `tyrum-proof::${t.challenge}::${t.protocol_rev}::${t.role}::${t.device_id}`;
}

// ---------- Proof verification ----------

/**
 * Verify a device's Ed25519 proof against a challenge and transcript.
 *
 * @param proof - Base64-encoded Ed25519 signature
 * @param publicKeyHex - Ed25519 public key as hex (64 hex chars)
 * @param transcript - The transcript fields to reconstruct the signed message
 * @returns true if the signature is valid
 */
export function verifyDeviceProof(
  proof: string,
  publicKeyHex: string,
  transcript: DeviceTranscript,
): boolean {
  if (!proof || proof.length === 0) return false;
  if (!publicKeyHex || publicKeyHex.length === 0) return false;

  try {
    const message = Buffer.from(buildTranscript(transcript));
    const signature = Buffer.from(proof, "base64");
    const rawKey = Buffer.from(publicKeyHex, "hex");

    const keyObject = createPublicKey({
      key: Buffer.concat([
        // DER prefix for Ed25519 public key (RFC 8410)
        Buffer.from("302a300506032b6570032100", "hex"),
        rawKey,
      ]),
      format: "der",
      type: "spki",
    });

    return verify(null, message, keyObject, signature);
  } catch {
    return false;
  }
}
