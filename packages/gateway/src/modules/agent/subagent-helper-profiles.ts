export const HELPER_EXECUTION_PROFILES = ["explorer_ro", "reviewer_ro", "jury"] as const;

export type HelperExecutionProfile = (typeof HELPER_EXECUTION_PROFILES)[number];

export function isHelperExecutionProfile(value: string): value is HelperExecutionProfile {
  return (HELPER_EXECUTION_PROFILES as readonly string[]).includes(value);
}

export function requireHelperExecutionProfile(
  raw: string | undefined,
  options?: { toolId?: string },
): HelperExecutionProfile {
  const executionProfile = raw?.trim();
  if (!executionProfile) {
    throw new Error("execution_profile is required");
  }
  if (!isHelperExecutionProfile(executionProfile)) {
    const fieldName = options?.toolId ? `${options.toolId} execution_profile` : "execution_profile";
    throw new Error(`${fieldName} must be one of: ${HELPER_EXECUTION_PROFILES.join(", ")}`);
  }
  return executionProfile;
}
