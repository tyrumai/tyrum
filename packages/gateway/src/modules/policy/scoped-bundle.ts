import type { PolicyBundle as PolicyBundleT } from "@tyrum/schemas";
import type { PolicyService } from "./service.js";

export async function loadScopedPolicyBundle(
  policyService: PolicyService,
  scope: { tenantId: string; agentId?: string; playbookBundle?: PolicyBundleT },
) {
  return await policyService.loadEffectiveBundle(scope);
}
