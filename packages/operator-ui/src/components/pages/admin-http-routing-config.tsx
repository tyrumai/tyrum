import type { OperatorCore } from "@tyrum/operator-core";
import * as React from "react";
import { isRecord } from "../../utils/is-record.js";
import { ApiResultCard } from "../ui/api-result-card.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardFooter, CardHeader } from "../ui/card.js";
import { ConfirmDangerDialog } from "../ui/confirm-danger-dialog.js";
import { Input } from "../ui/input.js";
import { JsonTextarea } from "../ui/json-textarea.js";

type RoutingConfigApi = OperatorCore["http"]["routingConfig"];

export function AdminHttpRoutingConfigPanel({ core }: { core: OperatorCore }): React.ReactElement {
  const api = core.http.routingConfig;

  return (
    <section className="grid gap-3" data-testid="admin-http-routing-config">
      <div className="text-sm font-medium text-fg">Routing config</div>

      <RoutingConfigGetCard api={api} />
      <RoutingConfigUpdateCard api={api} />
      <RoutingConfigRevertCard api={api} />
    </section>
  );
}

function RoutingConfigGetCard({ api }: { api: RoutingConfigApi }): React.ReactElement {
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<unknown>(undefined);
  const [error, setError] = React.useState<unknown>(undefined);

  const runGet = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setResult(undefined);
    setError(undefined);
    try {
      if (!api) throw new Error("Routing config API unavailable.");
      setResult(await api.get());
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="text-sm font-medium text-fg">Get</div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Button
          type="button"
          variant="secondary"
          data-testid="routing-config-get"
          isLoading={busy}
          onClick={() => void runGet()}
        >
          Fetch routing config
        </Button>
        <ApiResultCard heading="Routing config" value={result} error={error} />
      </CardContent>
    </Card>
  );
}

function RoutingConfigUpdateCard({ api }: { api: RoutingConfigApi }): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [configRaw, setConfigRaw] = React.useState("");
  const [configValue, setConfigValue] = React.useState<unknown | undefined>(undefined);
  const [configError, setConfigError] = React.useState<string | null>(null);
  const [reasonRaw, setReasonRaw] = React.useState("");
  const [result, setResult] = React.useState<unknown>(undefined);
  const [error, setError] = React.useState<unknown>(undefined);

  const canUpdate = configError === null && isRecord(configValue);

  const runUpdate = async (): Promise<void> => {
    setResult(undefined);
    setError(undefined);
    if (!api) return void setError(new Error("Routing config API unavailable."));
    if (!canUpdate) return void setError(new Error("A valid config JSON object is required."));

    const reason = reasonRaw.trim();
    try {
      setResult(await api.update({ config: configValue, ...(reason ? { reason } : {}) }));
    } catch (e) {
      setError(e);
      throw e;
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="text-sm font-medium text-fg">Update</div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Input
            label="Reason"
            placeholder="Optional"
            value={reasonRaw}
            onChange={(e) => setReasonRaw(e.target.value)}
          />
          <JsonTextarea
            data-testid="routing-config-update-json"
            label="Config JSON"
            rows={10}
            value={configRaw}
            onChange={(e) => setConfigRaw(e.target.value)}
            onJsonChange={(value, errorMessage) => {
              setConfigValue(value);
              setConfigError(errorMessage);
            }}
            helperText='Example: { "v": 1 }'
            placeholder='{\n  "v": 1\n}\n'
          />
          <ApiResultCard heading="Update result" value={result} error={error} />
        </CardContent>
        <CardFooter>
          <Button
            type="button"
            variant="danger"
            data-testid="routing-config-update-open"
            disabled={!canUpdate}
            onClick={() => setOpen(true)}
          >
            Update routing config
          </Button>
        </CardFooter>
      </Card>

      <ConfirmDangerDialog
        open={open}
        onOpenChange={setOpen}
        title="Update routing config"
        description="This will create a new routing config revision."
        confirmLabel="Update"
        onConfirm={runUpdate}
      />
    </>
  );
}

function RoutingConfigRevertCard({ api }: { api: RoutingConfigApi }): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [revisionRaw, setRevisionRaw] = React.useState("");
  const [reasonRaw, setReasonRaw] = React.useState("");
  const [result, setResult] = React.useState<unknown>(undefined);
  const [error, setError] = React.useState<unknown>(undefined);

  const revision = Number(revisionRaw);
  const canRevert = Number.isInteger(revision) && Number.isFinite(revision) && revision > 0;

  const runRevert = async (): Promise<void> => {
    setResult(undefined);
    setError(undefined);
    if (!api) return void setError(new Error("Routing config API unavailable."));
    if (!canRevert) return void setError(new Error("A positive revision number is required."));

    const reason = reasonRaw.trim();
    try {
      setResult(await api.revert({ revision, ...(reason ? { reason } : {}) }));
    } catch (e) {
      setError(e);
      throw e;
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="text-sm font-medium text-fg">Revert</div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Input
            label="Revision"
            placeholder="e.g. 12"
            inputMode="numeric"
            value={revisionRaw}
            onChange={(e) => setRevisionRaw(e.target.value)}
          />
          <Input
            label="Reason"
            placeholder="Optional"
            value={reasonRaw}
            onChange={(e) => setReasonRaw(e.target.value)}
          />
          <ApiResultCard heading="Revert result" value={result} error={error} />
        </CardContent>
        <CardFooter>
          <Button
            type="button"
            variant="danger"
            data-testid="routing-config-revert-open"
            disabled={!canRevert}
            onClick={() => setOpen(true)}
          >
            Revert routing config
          </Button>
        </CardFooter>
      </Card>

      <ConfirmDangerDialog
        open={open}
        onOpenChange={setOpen}
        title="Revert routing config"
        description="This will create a new routing config revision from a previous revision."
        confirmLabel="Revert"
        onConfirm={runRevert}
      />
    </>
  );
}
