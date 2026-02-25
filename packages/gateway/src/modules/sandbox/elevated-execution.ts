import type { PolicyBundle as PolicyBundleT } from "@tyrum/schemas";

export function deriveElevatedExecutionAvailableFromPolicyBundle(bundle: PolicyBundleT): boolean {
  const tools = bundle.tools;
  const toolsDefault = tools?.default ?? "deny";
  const allowCount = Array.isArray(tools?.allow) ? tools.allow.length : 0;
  const requireApprovalCount = Array.isArray(tools?.require_approval)
    ? tools.require_approval.length
    : 0;
  return toolsDefault !== "deny" || allowCount > 0 || requireApprovalCount > 0;
}
