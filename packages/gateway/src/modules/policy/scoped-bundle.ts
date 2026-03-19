import type { PolicyBundle as PolicyBundleT } from "@tyrum/contracts";
import type { PolicyService } from "@tyrum/runtime-policy";

export async function loadScopedPolicyBundle(
  policyService: PolicyService,
  scope: { tenantId: string; agentId?: string; playbookBundle?: PolicyBundleT },
) {
  return await policyService.loadEffectiveBundle(scope);
}
