import type { OperatorCore } from "@tyrum/operator-core";
import * as React from "react";
import { Alert } from "../ui/alert.js";
import { Button } from "../ui/button.js";
import { ConfirmDangerDialog } from "../ui/confirm-danger-dialog.js";
import { AdminHttpAuthPinsCard } from "./admin-http-auth-pins-card.js";
import { AdminHttpAuthProfilesCard } from "./admin-http-auth-profiles-card.js";
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
    <div className="grid gap-4" data-testid="admin-http-policy-auth-panels">
      {!canMutate ? (
        <div className="grid gap-3">
          <Alert
            variant="info"
            title="Read-only mode"
            description="Mutation actions are disabled until Admin Mode is active."
          />
          <div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                requestEnter();
              }}
            >
              Enter Admin Mode
            </Button>
          </div>
        </div>
      ) : null}

      <AdminHttpPolicyCard http={http} openMutation={openMutation} canMutate={canMutate} />
      <AdminHttpAuthProfilesCard http={http} openMutation={openMutation} canMutate={canMutate} />
      <AdminHttpAuthPinsCard http={http} openMutation={openMutation} canMutate={canMutate} />

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
            throw new Error("Enter Admin Mode to perform this action.");
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
