import { ConfiguredExecutionProfileId } from "@tyrum/contracts";

export const PUBLIC_EXECUTION_PROFILE_IDS = ConfiguredExecutionProfileId.options;

export type PublicExecutionProfileId = (typeof PUBLIC_EXECUTION_PROFILE_IDS)[number];

export function normalizePublicExecutionProfileId(
  raw: string | null | undefined,
): PublicExecutionProfileId | undefined {
  const normalized = raw?.trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized === "integrator") {
    return "executor_rw";
  }
  return PUBLIC_EXECUTION_PROFILE_IDS.find((profileId) => profileId === normalized);
}
