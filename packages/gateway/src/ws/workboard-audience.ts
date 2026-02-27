import type { WsBroadcastAudience } from "./audience.js";

export const WORKBOARD_WS_AUDIENCE = {
  roles: ["client"],
  required_scopes: ["operator.read", "operator.write"],
} as const satisfies WsBroadcastAudience;
