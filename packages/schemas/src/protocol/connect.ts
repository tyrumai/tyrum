import { z } from "zod";
import { CapabilityDescriptor, CapabilityKind } from "../capability.js";
import { WsRequestEnvelope, WsResponseErrEnvelope, WsResponseOkEnvelope } from "./envelopes.js";

// ---------------------------------------------------------------------------
// Operation payloads (typed) — connect + ping
// ---------------------------------------------------------------------------

export const WsPeerRole = z.enum(["client", "node"]);
export type WsPeerRole = z.infer<typeof WsPeerRole>;

export const WsDeviceDescriptor = z
  .object({
    device_id: z.string().trim().min(1),
    pubkey: z.string().trim().min(1),
    label: z.string().trim().min(1).optional(),
    platform: z.string().trim().min(1).optional(),
    version: z.string().trim().min(1).optional(),
    mode: z.string().trim().min(1).optional(),
  })
  .strict();
export type WsDeviceDescriptor = z.infer<typeof WsDeviceDescriptor>;

export const WsConnectInitPayload = z
  .object({
    protocol_rev: z.number().int().min(1),
    role: WsPeerRole,
    device: WsDeviceDescriptor,
    capabilities: z.array(CapabilityDescriptor).default([]),
  })
  .strict();
export type WsConnectInitPayload = z.infer<typeof WsConnectInitPayload>;

export const WsConnectInitRequest = WsRequestEnvelope.extend({
  type: z.literal("connect.init"),
  payload: WsConnectInitPayload,
});
export type WsConnectInitRequest = z.infer<typeof WsConnectInitRequest>;

export const WsConnectInitResult = z
  .object({
    connection_id: z.string().trim().min(1),
    challenge: z.string().trim().min(1),
  })
  .strict();
export type WsConnectInitResult = z.infer<typeof WsConnectInitResult>;

export const WsConnectProofPayload = z
  .object({
    connection_id: z.string().trim().min(1),
    proof: z.string().trim().min(1),
  })
  .strict();
export type WsConnectProofPayload = z.infer<typeof WsConnectProofPayload>;

export const WsConnectProofRequest = WsRequestEnvelope.extend({
  type: z.literal("connect.proof"),
  payload: WsConnectProofPayload,
});
export type WsConnectProofRequest = z.infer<typeof WsConnectProofRequest>;

export const WsConnectProofResult = z
  .object({
    client_id: z.string().trim().min(1),
    device_id: z.string().trim().min(1),
    role: WsPeerRole,
  })
  .strict();
export type WsConnectProofResult = z.infer<typeof WsConnectProofResult>;

/**
 * @deprecated Legacy handshake payload. Prefer `connect.init/connect.proof`.
 */
export const WsConnectPayload = z
  .object({
    capabilities: z.array(CapabilityKind).default([]),
    client_id: z.string().min(1).optional(),
  })
  .strict();
export type WsConnectPayload = z.infer<typeof WsConnectPayload>;

/**
 * @deprecated Legacy handshake request. Prefer `connect.init/connect.proof`.
 */
export const WsConnectRequest = WsRequestEnvelope.extend({
  type: z.literal("connect"),
  payload: WsConnectPayload,
});
export type WsConnectRequest = z.infer<typeof WsConnectRequest>;

/**
 * @deprecated Legacy handshake result. Prefer `connect.init/connect.proof`.
 */
export const WsConnectResult = z
  .object({
    client_id: z.string().min(1),
  })
  .strict();
export type WsConnectResult = z.infer<typeof WsConnectResult>;

export const WsPingPayload = z.object({}).strict();
export type WsPingPayload = z.infer<typeof WsPingPayload>;

export const WsPingRequest = WsRequestEnvelope.extend({
  type: z.literal("ping"),
  payload: WsPingPayload,
});
export type WsPingRequest = z.infer<typeof WsPingRequest>;

// ---------------------------------------------------------------------------
// Operation responses (typed) — connect + ping
// ---------------------------------------------------------------------------

export const WsConnectInitResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("connect.init"),
  result: WsConnectInitResult,
});
export type WsConnectInitResponseOkEnvelope = z.infer<typeof WsConnectInitResponseOkEnvelope>;

export const WsConnectInitResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("connect.init"),
});
export type WsConnectInitResponseErrEnvelope = z.infer<typeof WsConnectInitResponseErrEnvelope>;

export const WsConnectInitResponseEnvelope = z.union([
  WsConnectInitResponseOkEnvelope,
  WsConnectInitResponseErrEnvelope,
]);
export type WsConnectInitResponseEnvelope = z.infer<typeof WsConnectInitResponseEnvelope>;

export const WsConnectProofResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("connect.proof"),
  result: WsConnectProofResult,
});
export type WsConnectProofResponseOkEnvelope = z.infer<typeof WsConnectProofResponseOkEnvelope>;

export const WsConnectProofResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("connect.proof"),
});
export type WsConnectProofResponseErrEnvelope = z.infer<typeof WsConnectProofResponseErrEnvelope>;

export const WsConnectProofResponseEnvelope = z.union([
  WsConnectProofResponseOkEnvelope,
  WsConnectProofResponseErrEnvelope,
]);
export type WsConnectProofResponseEnvelope = z.infer<typeof WsConnectProofResponseEnvelope>;

export const WsConnectResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("connect"),
  result: WsConnectResult,
});
export type WsConnectResponseOkEnvelope = z.infer<typeof WsConnectResponseOkEnvelope>;

export const WsConnectResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("connect"),
});
export type WsConnectResponseErrEnvelope = z.infer<typeof WsConnectResponseErrEnvelope>;

export const WsConnectResponseEnvelope = z.union([
  WsConnectResponseOkEnvelope,
  WsConnectResponseErrEnvelope,
]);
export type WsConnectResponseEnvelope = z.infer<typeof WsConnectResponseEnvelope>;

export const WsPingResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("ping"),
});
export type WsPingResponseOkEnvelope = z.infer<typeof WsPingResponseOkEnvelope>;

export const WsPingResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("ping"),
});
export type WsPingResponseErrEnvelope = z.infer<typeof WsPingResponseErrEnvelope>;

export const WsPingResponseEnvelope = z.union([
  WsPingResponseOkEnvelope,
  WsPingResponseErrEnvelope,
]);
export type WsPingResponseEnvelope = z.infer<typeof WsPingResponseEnvelope>;
