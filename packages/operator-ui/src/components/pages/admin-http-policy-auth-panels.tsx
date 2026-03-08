import type { OperatorCore } from "@tyrum/operator-core";
import * as React from "react";
import { ConfirmDangerDialog } from "../ui/confirm-danger-dialog.js";
import { AdminHttpPolicyCard } from "./admin-http-policy-card.js";
import type { PendingMutation } from "./admin-http-panels.shared.js";
import { useAdminHttpClient, useAdminMutationAccess } from "./admin-http-shared.js";

export function AdminHttpPolicyAuthPanels({ core }: { core: OperatorCore }) {
  const { canMutate, requestEnter } = useAdminMutationAccess(core);
  const http = useAdminHttpClient() ?? core.http;
  const [pendingMutation, setPendingMutation] = React.useState<PendingMutation | null>(null);

  const openMutation = React.useCallback(
    (mutation: PendingMutation): void => {
      if (!canMutate) {
        requestEnter();
        return;
      }
      setPendingMutation(mutation);
    },
    [canMutate, requestEnter],
  );

  const closeMutation = React.useCallback((): void => {
    setPendingMutation(null);
  }, []);

  return (
    <div className="grid gap-4" data-testid="admin-http-policy-panel">
      <AdminHttpPolicyCard
        http={http}
        openMutation={openMutation}
        canMutate={canMutate}
        requestEnter={requestEnter}
      />

      <ConfirmDangerDialog
        open={pendingMutation !== null}
        onOpenChange={(open) => {
          if (open) return;
          closeMutation();
        }}
        title={pendingMutation?.title ?? "Confirm"}
        description={pendingMutation?.description}
        confirmLabel={pendingMutation?.confirmLabel}
        confirmationLabel={pendingMutation?.confirmationLabel}
        onConfirm={async () => {
          if (!canMutate) {
            requestEnter();
            throw new Error("Enter Elevated Mode to perform this action.");
          }
          if (!pendingMutation) return;
          await pendingMutation.onConfirm();
        }}
      >
        {pendingMutation?.content}
      </ConfirmDangerDialog>
    </div>
  );
}
