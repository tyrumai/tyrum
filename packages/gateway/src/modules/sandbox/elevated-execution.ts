import type { PolicyBundle as PolicyBundleT } from "@tyrum/schemas";

export function deriveElevatedExecutionAvailableFromPolicyBundle(bundle: PolicyBundleT): boolean {
  const tools = bundle.tools;
  const allowCount = Array.isArray(tools?.allow) ? tools.allow.length : 0;
  const requireApprovalCount = Array.isArray(tools?.require_approval)
    ? tools.require_approval.length
    : 0;
  const denyCount = Array.isArray(tools?.deny) ? tools.deny.length : 0;
  const deniesAllTools = tools?.deny?.includes("*") ?? false;

  if (allowCount > 0 || requireApprovalCount > 0) {
    return true;
  }
  if (deniesAllTools && denyCount === 1) {
    return false;
  }
  return true;
}
