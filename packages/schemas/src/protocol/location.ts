import { z } from "zod";
import { LocationBeacon, LocationBeaconResult } from "../location.js";
import { WsRequestEnvelope, WsResponseErrEnvelope, WsResponseOkEnvelope } from "./envelopes.js";

export const WsLocationBeaconPayload = LocationBeacon;
export type WsLocationBeaconPayload = z.infer<typeof WsLocationBeaconPayload>;

export const WsLocationBeaconRequest = WsRequestEnvelope.extend({
  type: z.literal("location.beacon"),
  payload: WsLocationBeaconPayload,
});
export type WsLocationBeaconRequest = z.infer<typeof WsLocationBeaconRequest>;

export const WsLocationBeaconResult = LocationBeaconResult;
export type WsLocationBeaconResult = z.infer<typeof WsLocationBeaconResult>;

export const WsLocationBeaconResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("location.beacon"),
  result: WsLocationBeaconResult,
});
export type WsLocationBeaconResponseOkEnvelope = z.infer<typeof WsLocationBeaconResponseOkEnvelope>;

export const WsLocationBeaconResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("location.beacon"),
});
export type WsLocationBeaconResponseErrEnvelope = z.infer<
  typeof WsLocationBeaconResponseErrEnvelope
>;

export const WsLocationBeaconResponseEnvelope = z.union([
  WsLocationBeaconResponseOkEnvelope,
  WsLocationBeaconResponseErrEnvelope,
]);
export type WsLocationBeaconResponseEnvelope = z.infer<typeof WsLocationBeaconResponseEnvelope>;
