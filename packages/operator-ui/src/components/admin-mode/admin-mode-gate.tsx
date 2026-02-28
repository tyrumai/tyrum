import { isAdminModeActive } from "@tyrum/operator-core";
import type { ReactNode } from "react";
import { Button } from "../ui/button.js";
import { Alert } from "../ui/alert.js";
import { Card, CardContent, CardFooter } from "../ui/card.js";
import { useOperatorStore } from "../../use-operator-store.js";
import { useAdminModeUiContext } from "./admin-mode-provider.js";

export function AdminModeGate({ children }: { children: ReactNode }) {
  const { core, requestEnter } = useAdminModeUiContext();
  const adminMode = useOperatorStore(core.adminModeStore);

  if (isAdminModeActive(adminMode)) {
    return <>{children}</>;
  }

  return (
    <div data-testid="admin-mode-gate">
      <Card>
        <CardContent className="grid gap-4 pt-6">
          <Alert
            variant="warning"
            title="Enter Admin Mode to continue"
            description="Admin Mode is required for this action."
          />
        </CardContent>
        <CardFooter>
          <Button
            data-testid="admin-mode-enter"
            onClick={() => {
              requestEnter();
            }}
          >
            Enter Admin Mode
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
