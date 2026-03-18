import {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  descriptorIdsForClientCapability,
} from "@tyrum/schemas";

export const DESKTOP_CAPABILITY_ALLOWLIST = descriptorIdsForClientCapability("desktop").map(
  (id) => ({
    id,
    version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  }),
);
