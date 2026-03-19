import type { OperatorCore } from "@tyrum/operator-app";
import { AdminHttpPolicyCard } from "./admin-http-policy-card.js";
import { useAdminMutationAccess } from "./admin-http-shared.js";

export function AdminHttpPolicyAuthPanels({ core }: { core: OperatorCore }) {
  const { canMutate, requestEnter } = useAdminMutationAccess(core);

  return (
    <div className="grid gap-4" data-testid="admin-http-policy-panel">
      <AdminHttpPolicyCard core={core} canMutate={canMutate} requestEnter={requestEnter} />
    </div>
  );
}
