import type { OperatorCore } from "@tyrum/operator-core";
import * as React from "react";
import { ApiResultCard } from "../ui/api-result-card.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardFooter, CardHeader } from "../ui/card.js";
import { ConfirmDangerDialog } from "../ui/confirm-danger-dialog.js";
import { useAdminHttpClient, useAdminMutationAccess } from "./admin-http-shared.js";

export function AdminHttpModelsRefreshPanel({ core }: { core: OperatorCore }): React.ReactElement {
  const { canMutate, requestEnter } = useAdminMutationAccess(core);
  const http = useAdminHttpClient() ?? core.http;
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [value, setValue] = React.useState<unknown>(undefined);
  const [error, setError] = React.useState<unknown>(undefined);

  const runRefresh = async (): Promise<void> => {
    if (busy) return;
    if (!canMutate) {
      requestEnter();
      throw new Error("Enter Admin Mode to refresh models.");
    }
    setBusy(true);
    setValue(undefined);
    setError(undefined);
    try {
      const next = await http.models.refresh();
      setValue(next);
    } catch (caught) {
      setError(caught);
      throw caught;
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card data-testid="admin-http-models-refresh">
        <CardHeader>
          <div className="text-sm font-medium text-fg">Models refresh</div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <ApiResultCard heading="Refresh result" value={value} error={error} />
        </CardContent>
        <CardFooter className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="danger"
            data-testid="admin-http-models-refresh-open"
            disabled={!canMutate}
            onClick={() => {
              setOpen(true);
            }}
          >
            Refresh models
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

      <ConfirmDangerDialog
        open={open}
        onOpenChange={setOpen}
        title="Refresh model catalog"
        description="This forces providers to refresh model availability and may disrupt active workflows."
        confirmLabel="Refresh models"
        onConfirm={runRefresh}
        isLoading={busy}
      />
    </>
  );
}
