import { isElevatedModeActive } from "@tyrum/operator-core";
import type { ReactNode } from "react";
import { Button } from "../ui/button.js";
import { Alert } from "../ui/alert.js";
import { Card, CardContent, CardFooter } from "../ui/card.js";
import { useOperatorStore } from "../../use-operator-store.js";
import { useElevatedModeUiContext } from "./elevated-mode-provider.js";

export function ElevatedModeGate({ children }: { children: ReactNode }) {
  const { core, requestEnter } = useElevatedModeUiContext();
  const elevatedMode = useOperatorStore(core.elevatedModeStore);

  if (isElevatedModeActive(elevatedMode)) {
    return <>{children}</>;
  }

  return (
    <div data-testid="elevated-mode-gate">
      <Card>
        <CardContent className="grid gap-4 pt-6">
          <Alert
            variant="warning"
            title="Enter Elevated Mode to continue"
            description="Elevated Mode is required for this action."
          />
        </CardContent>
        <CardFooter>
          <Button
            data-testid="elevated-mode-enter"
            onClick={() => {
              requestEnter();
            }}
          >
            Enter Elevated Mode
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
