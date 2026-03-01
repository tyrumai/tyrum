import type { OperatorCore } from "@tyrum/operator-core";
import * as React from "react";
import { isRecord } from "../../utils/is-record.js";
import { ApiResultCard } from "../ui/api-result-card.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardFooter, CardHeader } from "../ui/card.js";
import { ConfirmDangerDialog } from "../ui/confirm-danger-dialog.js";
import { Input } from "../ui/input.js";
import { JsonTextarea } from "../ui/json-textarea.js";

export function AdminHttpRoutingConfigPanel({ core }: { core: OperatorCore }): React.ReactElement {
  const api = core.http.routingConfig;

  const [getResult, setGetResult] = React.useState<unknown>(undefined);
  const [getError, setGetError] = React.useState<unknown>(undefined);
  const [getBusy, setGetBusy] = React.useState(false);

  const [updateOpen, setUpdateOpen] = React.useState(false);
  const [updateConfigRaw, setUpdateConfigRaw] = React.useState("");
  const [updateConfigValue, setUpdateConfigValue] = React.useState<unknown | undefined>(undefined);
  const [updateConfigError, setUpdateConfigError] = React.useState<string | null>(null);
  const [updateReason, setUpdateReason] = React.useState("");
  const [updateResult, setUpdateResult] = React.useState<unknown>(undefined);
  const [updateError, setUpdateError] = React.useState<unknown>(undefined);

  const [revertOpen, setRevertOpen] = React.useState(false);
  const [revertRevisionRaw, setRevertRevisionRaw] = React.useState("");
  const [revertReason, setRevertReason] = React.useState("");
  const [revertResult, setRevertResult] = React.useState<unknown>(undefined);
  const [revertError, setRevertError] = React.useState<unknown>(undefined);

  const canUpdate = updateConfigError === null && isRecord(updateConfigValue);

  const parsedRevertRevision = Number(revertRevisionRaw);
  const canRevert =
    Number.isInteger(parsedRevertRevision) &&
    Number.isFinite(parsedRevertRevision) &&
    parsedRevertRevision > 0;

  const runGet = async (): Promise<void> => {
    if (getBusy) return;
    setGetBusy(true);
    setGetResult(undefined);
    setGetError(undefined);
    try {
      if (!api) {
        throw new Error("Routing config API unavailable.");
      }
      const result = await api.get();
      setGetResult(result);
    } catch (error) {
      setGetError(error);
    } finally {
      setGetBusy(false);
    }
  };

  const runUpdate = async (): Promise<void> => {
    setUpdateResult(undefined);
    setUpdateError(undefined);
    if (!api) {
      setUpdateError(new Error("Routing config API unavailable."));
      return;
    }
    if (!canUpdate) {
      setUpdateError(new Error("A valid config JSON object is required."));
      return;
    }

    const reason = updateReason.trim();
    try {
      const result = await api.update({
        config: updateConfigValue,
        ...(reason ? { reason } : {}),
      });
      setUpdateResult(result);
    } catch (error) {
      setUpdateError(error);
      throw error;
    }
  };

  const runRevert = async (): Promise<void> => {
    setRevertResult(undefined);
    setRevertError(undefined);
    if (!api) {
      setRevertError(new Error("Routing config API unavailable."));
      return;
    }
    if (!canRevert) {
      setRevertError(new Error("A positive revision number is required."));
      return;
    }

    const reason = revertReason.trim();
    try {
      const result = await api.revert({
        revision: parsedRevertRevision,
        ...(reason ? { reason } : {}),
      });
      setRevertResult(result);
    } catch (error) {
      setRevertError(error);
      throw error;
    }
  };

  return (
    <section className="grid gap-3" data-testid="admin-http-routing-config">
      <div className="text-sm font-medium text-fg">Routing config</div>

      <Card>
        <CardHeader>
          <div className="text-sm font-medium text-fg">Get</div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Button
            type="button"
            variant="secondary"
            data-testid="routing-config-get"
            isLoading={getBusy}
            onClick={() => {
              void runGet();
            }}
          >
            Fetch routing config
          </Button>
          <ApiResultCard heading="Routing config" value={getResult} error={getError} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="text-sm font-medium text-fg">Update</div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Input
            label="Reason"
            placeholder="Optional"
            value={updateReason}
            onChange={(event) => {
              setUpdateReason(event.target.value);
            }}
          />
          <JsonTextarea
            data-testid="routing-config-update-json"
            label="Config JSON"
            rows={10}
            value={updateConfigRaw}
            onChange={(event) => {
              setUpdateConfigRaw(event.target.value);
            }}
            onJsonChange={(value, errorMessage) => {
              setUpdateConfigValue(value);
              setUpdateConfigError(errorMessage);
            }}
            helperText='Example: { "v": 1 }'
            placeholder='{\n  "v": 1\n}\n'
          />
          <ApiResultCard heading="Update result" value={updateResult} error={updateError} />
        </CardContent>
        <CardFooter>
          <Button
            type="button"
            variant="danger"
            data-testid="routing-config-update-open"
            disabled={!canUpdate}
            onClick={() => {
              setUpdateOpen(true);
            }}
          >
            Update routing config
          </Button>
        </CardFooter>
      </Card>

      <ConfirmDangerDialog
        open={updateOpen}
        onOpenChange={setUpdateOpen}
        title="Update routing config"
        description="This will create a new routing config revision."
        confirmLabel="Update"
        onConfirm={runUpdate}
      />

      <Card>
        <CardHeader>
          <div className="text-sm font-medium text-fg">Revert</div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Input
            label="Revision"
            placeholder="e.g. 12"
            inputMode="numeric"
            value={revertRevisionRaw}
            onChange={(event) => {
              setRevertRevisionRaw(event.target.value);
            }}
          />
          <Input
            label="Reason"
            placeholder="Optional"
            value={revertReason}
            onChange={(event) => {
              setRevertReason(event.target.value);
            }}
          />
          <ApiResultCard heading="Revert result" value={revertResult} error={revertError} />
        </CardContent>
        <CardFooter>
          <Button
            type="button"
            variant="danger"
            data-testid="routing-config-revert-open"
            disabled={!canRevert}
            onClick={() => {
              setRevertOpen(true);
            }}
          >
            Revert routing config
          </Button>
        </CardFooter>
      </Card>

      <ConfirmDangerDialog
        open={revertOpen}
        onOpenChange={setRevertOpen}
        title="Revert routing config"
        description="This will create a new routing config revision from a previous revision."
        confirmLabel="Revert"
        onConfirm={runRevert}
      />
    </section>
  );
}
