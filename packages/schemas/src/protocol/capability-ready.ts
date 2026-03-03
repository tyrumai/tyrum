import { z } from "zod";
import { CapabilityDescriptor, ClientCapability } from "../capability.js";
import { NodeId } from "../keys.js";
import { ActionPrimitiveKind } from "../planner.js";
import {
  WsEventEnvelope,
  WsRequestEnvelope,
  WsResponseErrEnvelope,
  WsResponseOkEnvelope,
} from "./envelopes.js";

// ---------------------------------------------------------------------------
// Operation payloads (typed) — capability.ready
// ---------------------------------------------------------------------------

export const WsCapabilityReadyPayload = z
  .object({
    capabilities: z.array(CapabilityDescriptor).default([]),
  })
  .strict();
export type WsCapabilityReadyPayload = z.infer<typeof WsCapabilityReadyPayload>;

export const WsCapabilityReadyRequest = WsRequestEnvelope.extend({
  type: z.literal("capability.ready"),
  payload: WsCapabilityReadyPayload,
});
export type WsCapabilityReadyRequest = z.infer<typeof WsCapabilityReadyRequest>;

// ---------------------------------------------------------------------------
// Operation responses (typed) — capability.ready
// ---------------------------------------------------------------------------

export const WsCapabilityReadyResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("capability.ready"),
});
export type WsCapabilityReadyResponseOkEnvelope = z.infer<
  typeof WsCapabilityReadyResponseOkEnvelope
>;

export const WsCapabilityReadyResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("capability.ready"),
});
export type WsCapabilityReadyResponseErrEnvelope = z.infer<
  typeof WsCapabilityReadyResponseErrEnvelope
>;

export const WsCapabilityReadyResponseEnvelope = z.union([
  WsCapabilityReadyResponseOkEnvelope,
  WsCapabilityReadyResponseErrEnvelope,
]);
export type WsCapabilityReadyResponseEnvelope = z.infer<typeof WsCapabilityReadyResponseEnvelope>;

// ---------------------------------------------------------------------------
// Events (typed) — capability.ready
// ---------------------------------------------------------------------------

export const WsCapabilityReadyEventPayload = z
  .object({
    node_id: NodeId,
    capabilities: z.array(CapabilityDescriptor).default([]),
  })
  .strict();
export type WsCapabilityReadyEventPayload = z.infer<typeof WsCapabilityReadyEventPayload>;

export const WsCapabilityReadyEvent = WsEventEnvelope.extend({
  type: z.literal("capability.ready"),
  payload: WsCapabilityReadyEventPayload,
});
export type WsCapabilityReadyEvent = z.infer<typeof WsCapabilityReadyEvent>;

/** Maps ActionPrimitiveKind to the required client capability. */
const CAPABILITY_MAP: Partial<Record<ActionPrimitiveKind, ClientCapability>> = {
  Web: "playwright",
  Browser: "browser",
  Android: "android",
  Desktop: "desktop",
  CLI: "cli",
  Http: "http",
};

export function requiredCapability(kind: ActionPrimitiveKind): ClientCapability | undefined {
  return CAPABILITY_MAP[kind];
}
