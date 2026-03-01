import * as React from "react";
import { Alert } from "../ui/alert.js";
import { ConfirmDangerDialog } from "../ui/confirm-danger-dialog.js";
import { useAdminHttpClient } from "./admin-http-shared.js";
import { AdminHttpAuthPinsCard } from "./admin-http-auth-pins-card.js";
import { AdminHttpAuthProfilesCard } from "./admin-http-auth-profiles-card.js";
import { AdminHttpPolicyCard } from "./admin-http-policy-card.js";
import type { PendingMutation } from "./admin-http-panels.shared.js";

export function AdminHttpPolicyAuthPanels() {
  const http = useAdminHttpClient();
  const [pendingMutation, setPendingMutation] = React.useState<PendingMutation | null>(null);

  const openMutation = React.useCallback((mutation: PendingMutation): void => {
    setPendingMutation(mutation);
  }, []);

  const closeMutation = React.useCallback((): void => {
    setPendingMutation(null);
  }, []);

  if (!http) {
    return (
      <div className="grid gap-4" data-testid="admin-http-policy-auth-panels">
        <Alert
          variant="warning"
          title="Enter Admin Mode to continue"
          description="Admin Mode is required for this action."
        />
      </div>
    );
  }

  return (
    <div className="grid gap-4" data-testid="admin-http-policy-auth-panels">
      <AdminHttpPolicyCard http={http} openMutation={openMutation} />
      <AdminHttpAuthProfilesCard http={http} openMutation={openMutation} />
      <AdminHttpAuthPinsCard http={http} openMutation={openMutation} />

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
          if (!pendingMutation) return;
          await pendingMutation.onConfirm();
        }}
      >
        {pendingMutation?.content}
      </ConfirmDangerDialog>
    </div>
  );
}

