import { isAdminModeActive, type OperatorCore } from "@tyrum/operator-core";
import * as React from "react";
import { useApiCallState } from "../../hooks/use-api-call-state.js";
import { ApiResultCard } from "../ui/api-result-card.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardFooter, CardHeader } from "../ui/card.js";
import { Input } from "../ui/input.js";
import { useAdminMutationAccess } from "./admin-http-shared.js";

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
        <Button
          type="button"
          variant="danger"
          data-testid="admin-ws-command-run"
          isLoading={action.state.status === "loading"}
          disabled={!canMutate}
          onClick={() => {
            const trimmed = command.trim();
            if (!trimmed) {
              action.fail("Command is required.");
              return;
            }
            void action.run(async () => {
              if (!isAdminModeActive(core.adminModeStore.getSnapshot())) {
                requestEnter();
                throw new Error("Enter Admin Mode to run commands.");
              }
              return await core.ws.commandExecute(trimmed);
            });
          }}
        >
          Run command
        </Button>
        {!canMutate ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              requestEnter();
            }}
          >
            Enter Admin Mode
          </Button>
        ) : null}
      </CardFooter>
    </Card>
  );
}
