import {
  BROWSER_AUTOMATION_CAPABILITY_IDS,
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  descriptorIdsForClientCapability,
  FILESYSTEM_CAPABILITY_IDS,
} from "@tyrum/contracts";

export const SANDBOX_CAPABILITY_ALLOWLIST = [
  ...descriptorIdsForClientCapability("desktop"),
  ...FILESYSTEM_CAPABILITY_IDS,
  ...BROWSER_AUTOMATION_CAPABILITY_IDS,
].map((id) => ({
  id,
  version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
}));
