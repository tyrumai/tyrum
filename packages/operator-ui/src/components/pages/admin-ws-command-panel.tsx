import type { OperatorCore } from "@tyrum/operator-core";
import * as React from "react";
import { useApiCallState } from "../../hooks/use-api-call-state.js";
import { ElevatedModeTooltip } from "../elevated-mode/elevated-mode-tooltip.js";
import { ApiResultCard } from "../ui/api-result-card.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardFooter, CardHeader } from "../ui/card.js";
import { Input } from "../ui/input.js";
import { executeAdminWsCommand, useAdminMutationAccess } from "./admin-http-shared.js";

export function AdminWsCommandPanel({ core }: { core: OperatorCore }): React.ReactElement {
  const { canMutate, requestEnter } = useAdminMutationAccess(core);
  const [command, setCommand] = React.useState("/help");
  const action = useApiCallState();

  return (
    <Card data-testid="admin-ws-command-panel">
      <CardHeader>
        <div className="text-sm font-medium text-fg">Commands</div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Input
          label="Command"
          data-testid="admin-ws-command-input"
          value={command}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          onChange={(event) => {
            setCommand(event.currentTarget.value);
          }}
        />
        <ApiResultCard
          heading="Command result"
          value={action.state.status === "success" ? action.state.value : undefined}
          error={action.state.status === "error" ? action.state.error : undefined}
        />
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        <ElevatedModeTooltip canMutate={canMutate} requestEnter={requestEnter}>
          <Button
            type="button"
            variant="danger"
            data-testid="admin-ws-command-run"
            isLoading={action.state.status === "loading"}
            onClick={() => {
              const trimmed = command.trim();
              if (!trimmed) {
                action.fail("Command is required.");
                return;
              }
              void action.run(async () => {
                if (!canMutate) {
                  requestEnter();
                  throw new Error("Authorize admin access to run commands.");
                }
                return await executeAdminWsCommand({ core, command: trimmed });
              });
            }}
          >
            Run command
          </Button>
        </ElevatedModeTooltip>
      </CardFooter>
    </Card>
  );
}
