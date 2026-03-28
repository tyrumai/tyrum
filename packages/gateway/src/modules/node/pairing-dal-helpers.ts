import {
  CapabilityDescriptor as CapabilityDescriptorSchema,
  type CapabilityDescriptor,
  normalizeCapabilityDescriptors,
  type NodePairingTrustLevel,
} from "@tyrum/contracts";
import { createHash, randomBytes } from "node:crypto";
import { parseStoredCapabilityDescriptors } from "./stored-capability-descriptors.js";

export type NodePairingStatus =
  | "queued"
  | "reviewing"
  | "awaiting_human"
  | "approved"
  | "denied"
  | "revoked";

export function parseNodePairingMetadata(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    // Intentional: malformed node metadata should not block loading the pairing row.
    return {};
  }
}

export function parseNodeCapabilities(raw: string): CapabilityDescriptor[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parseStoredCapabilityDescriptors(parsed);
  } catch {
    // Intentional: capability decoding is best-effort for legacy or malformed stored rows.
    return [];
  }
}

export function parseCapabilityAllowlist(raw: string): CapabilityDescriptor[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return normalizeCapabilityDescriptors(
      parsed
        .map((entry) => CapabilityDescriptorSchema.safeParse(entry))
        .filter((result) => result.success)
        .map((result) => result.data),
    );
  } catch {
    // Intentional: allowlist decoding is best-effort for legacy or malformed stored rows.
    return [];
  }
}

export function parseNodePairingTrustLevel(raw: string): NodePairingTrustLevel | undefined {
  if (raw === "local" || raw === "remote") return raw;
  return undefined;
}

export function normalizeNodePairingStatus(raw: string): NodePairingStatus {
  if (
    raw === "queued" ||
    raw === "reviewing" ||
    raw === "awaiting_human" ||
    raw === "approved" ||
    raw === "denied" ||
    raw === "revoked"
  ) {
    return raw;
  }
  return "awaiting_human";
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf-8").digest("hex");
}

export function generateScopedToken(): string {
  return randomBytes(32).toString("hex");
}
