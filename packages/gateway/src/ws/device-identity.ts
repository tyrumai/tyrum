/**
 * Device identity verification.
 *
 * Placeholder for cryptographic proof verification.
 * Currently accepts any non-empty proof string.
 */

/**
 * Verify a device's proof against a challenge.
 *
 * @param proof - The proof string from the client
 * @param challenge - The challenge string that was sent
 * @returns true if the proof is valid
 */
export function verifyDeviceProof(proof: string, challenge: string): boolean {
  // Placeholder: accept any non-empty proof
  // TODO: Implement actual cryptographic verification when device keys are added
  // Expected: verify(signature=proof, message=challenge, publicKey=devicePublicKey)
  if (!proof || proof.length === 0) return false;
  if (!challenge || challenge.length === 0) return false;
  return true;
}
