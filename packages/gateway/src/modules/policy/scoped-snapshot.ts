import type { PolicyBundle as PolicyBundleT } from "@tyrum/contracts";
import type { PolicyService } from "./service.js";

export async function loadScopedPolicySnapshot(
  policyService: PolicyService,
  input: { tenantId: string; playbookBundle?: PolicyBundleT },
) {
  const effective = await policyService.loadEffectiveBundle(input);
  return await policyService.getOrCreateSnapshot(input.tenantId, effective.bundle);
}
