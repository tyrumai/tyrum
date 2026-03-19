import { z } from "zod";
import { PresenceBeacon, PresenceEntry } from "../presence.js";
import {
  WsEventEnvelope,
  WsRequestEnvelope,
  WsResponseErrEnvelope,
  WsResponseOkEnvelope,
} from "./envelopes.js";

// ---------------------------------------------------------------------------
// Operation payloads (typed) — presence
// ---------------------------------------------------------------------------

export const WsPresenceBeaconPayload = PresenceBeacon;
export type WsPresenceBeaconPayload = z.infer<typeof WsPresenceBeaconPayload>;

export const WsPresenceBeaconRequest = WsRequestEnvelope.extend({
  type: z.literal("presence.beacon"),
  payload: WsPresenceBeaconPayload,
});
export type WsPresenceBeaconRequest = z.infer<typeof WsPresenceBeaconRequest>;

export const WsPresenceBeaconResult = z
  .object({
    entry: PresenceEntry,
  })
  .strict();
export type WsPresenceBeaconResult = z.infer<typeof WsPresenceBeaconResult>;

// ---------------------------------------------------------------------------
// Operation responses (typed) — presence
// ---------------------------------------------------------------------------

export const WsPresenceBeaconResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("presence.beacon"),
  result: WsPresenceBeaconResult,
});
export type WsPresenceBeaconResponseOkEnvelope = z.infer<typeof WsPresenceBeaconResponseOkEnvelope>;

export const WsPresenceBeaconResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("presence.beacon"),
});
export type WsPresenceBeaconResponseErrEnvelope = z.infer<
  typeof WsPresenceBeaconResponseErrEnvelope
>;

export const WsPresenceBeaconResponseEnvelope = z.union([
  WsPresenceBeaconResponseOkEnvelope,
  WsPresenceBeaconResponseErrEnvelope,
]);
export type WsPresenceBeaconResponseEnvelope = z.infer<typeof WsPresenceBeaconResponseEnvelope>;

// ---------------------------------------------------------------------------
// Events (typed) — presence
// ---------------------------------------------------------------------------

export const WsPresenceUpsertedEventPayload = z
  .object({
    entry: PresenceEntry,
  })
  .strict();
export type WsPresenceUpsertedEventPayload = z.infer<typeof WsPresenceUpsertedEventPayload>;

export const WsPresenceUpsertedEvent = WsEventEnvelope.extend({
  type: z.literal("presence.upserted"),
  payload: WsPresenceUpsertedEventPayload,
});
export type WsPresenceUpsertedEvent = z.infer<typeof WsPresenceUpsertedEvent>;

export const WsPresencePrunedEventPayload = z
  .object({
    instance_id: z.string().trim().min(1),
  })
  .strict();
export type WsPresencePrunedEventPayload = z.infer<typeof WsPresencePrunedEventPayload>;

export const WsPresencePrunedEvent = WsEventEnvelope.extend({
  type: z.literal("presence.pruned"),
  payload: WsPresencePrunedEventPayload,
});
export type WsPresencePrunedEvent = z.infer<typeof WsPresencePrunedEvent>;
