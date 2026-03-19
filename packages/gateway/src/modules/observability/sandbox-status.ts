import type { PolicyService } from "@tyrum/runtime-policy";
import type { SandboxHardeningProfile } from "../sandbox/hardening.js";
import { deriveElevatedExecutionAvailableFromPolicyBundle } from "../sandbox/elevated-execution.js";
import type { SandboxStatus } from "./status-details.js";

export async function loadSandboxStatus(input: {
  tenantId: string;
  policyService: PolicyService | undefined;
  policyStatus?: { observe_only: boolean; effective_sha256: string };
  toolrunnerHardeningProfile?: SandboxHardeningProfile;
}): Promise<SandboxStatus | null> {
  if (!input.policyService) return null;

  const status =
    input.policyStatus ?? (await input.policyService.getStatus({ tenantId: input.tenantId }));
  let elevatedExecutionAvailable: boolean | null = null;
  try {
    elevatedExecutionAvailable = deriveElevatedExecutionAvailableFromPolicyBundle(
      (await input.policyService.loadEffectiveBundle({ tenantId: input.tenantId })).bundle,
    );
  } catch {
    // Intentional: status sampling is best-effort; treat elevated execution availability as unknown.
    elevatedExecutionAvailable = null;
  }

  return {
    mode: status.observe_only ? "observe" : "enforce",
    policy_observe_only: status.observe_only,
    effective_policy_sha256: status.effective_sha256,
    hardening_profile: input.toolrunnerHardeningProfile ?? "baseline",
    elevated_execution_available: elevatedExecutionAvailable,
  };
}
