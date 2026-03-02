import type { OperatorCore } from "@tyrum/operator-core";
import * as React from "react";
import { ApiResultCard } from "../ui/api-result-card.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { ConfirmDangerDialog } from "../ui/confirm-danger-dialog.js";
import { Input } from "../ui/input.js";
import { JsonTextarea } from "../ui/json-textarea.js";
import { Label } from "../ui/label.js";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs.js";
import { optionalString, useApiAction } from "./admin-http-shared.js";
import { useAdminMutationAccess } from "../pages/admin-http-shared.js";

const DEFAULT_RESULT_VIEWER_PROPS = {
  defaultExpandedDepth: 1,
  contentClassName: "max-h-[420px]",
} as const;

function AuditExportTab({ core }: { core: OperatorCore }) {
  const auditApi = core.http.audit;
  const [planId, setPlanId] = React.useState("");
  const action = useApiAction<unknown>();
  const resolvedPlanId = optionalString(planId);

  return (
    <>
      <Input
        label="Plan ID"
        placeholder="agent-turn-default-..."
        value={planId}
        onChange={(event) => {
          setPlanId(event.target.value);
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          isLoading={action.isLoading}
          disabled={!resolvedPlanId}
          onClick={() => {
            if (!resolvedPlanId) return;
            void action.run(() => auditApi.exportReceiptBundle(resolvedPlanId));
          }}
        >
          Export receipt bundle
        </Button>
        <Button
          variant="secondary"
          disabled={action.isLoading}
          onClick={() => {
            action.reset();
          }}
        >
          Clear
        </Button>
      </div>
      <ApiResultCard
        heading="Export result"
        value={action.value}
        error={action.error}
        jsonViewerProps={DEFAULT_RESULT_VIEWER_PROPS}
      />
    </>
  );
}

function AuditVerifyTab({ core }: { core: OperatorCore }) {
  const auditApi = core.http.audit;
  const [raw, setRaw] = React.useState("");
  const [value, setValue] = React.useState<unknown | undefined>(undefined);
  const [error, setError] = React.useState<string | null>(null);
  const action = useApiAction<unknown>();

  return (
    <>
      <JsonTextarea
        label="Verify request JSON"
        placeholder='{"events":[{"id":1,"plan_id":"...","step_index":0,"occurred_at":"2026-01-01T00:00:00.000Z","action":"...","prev_hash":null,"event_hash":null}]}'
        rows={6}
        value={raw}
        onChange={(event) => {
          setRaw(event.target.value);
        }}
        onJsonChange={(nextValue, errorMessage) => {
          if (errorMessage) {
            setValue(undefined);
            setError(errorMessage);
            return;
          }
          setError(null);
          setValue(nextValue);
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          isLoading={action.isLoading}
          disabled={error !== null || typeof value === "undefined"}
          onClick={() => {
            void action.run(() => auditApi.verify(value as never));
          }}
        >
          Verify chain
        </Button>
        <Button
          variant="secondary"
          disabled={action.isLoading}
          onClick={() => {
            action.reset();
          }}
        >
          Clear
        </Button>
      </div>
      <ApiResultCard
        heading="Verify result"
        value={action.value}
        error={action.error}
        jsonViewerProps={DEFAULT_RESULT_VIEWER_PROPS}
      />
    </>
  );
}

function AuditForgetDecisionFieldset({
  decision,
  onDecisionChange,
}: {
  decision: "delete" | "anonymize" | "retain";
  onDecisionChange: (next: "delete" | "anonymize" | "retain") => void;
}) {
  return (
    <fieldset className="grid gap-3">
      <legend className="text-sm font-medium leading-none text-fg">Decision</legend>
      <RadioGroup
        value={decision}
        onValueChange={(value) => {
          if (value === "delete" || value === "anonymize" || value === "retain") {
            onDecisionChange(value);
          }
        }}
        className="flex flex-wrap gap-4"
      >
        {(["delete", "anonymize", "retain"] as const).map((option) => {
          const id = `audit-forget-${option}`;
          return (
            <div key={option} className="flex items-center gap-2">
              <RadioGroupItem id={id} value={option} />
              <Label htmlFor={id} className="text-sm font-normal text-fg">
                {option}
              </Label>
            </div>
          );
        })}
      </RadioGroup>
    </fieldset>
  );
}

function AuditForgetDialogSummary({
  entityType,
  entityId,
  decision,
}: {
  entityType: string | undefined;
  entityId: string | undefined;
  decision: "delete" | "anonymize" | "retain";
}) {
  return (
    <div className="grid gap-2 text-sm text-fg">
      <div>
        <span className="text-fg-muted">Entity:</span>{" "}
        <span className="font-mono">
          {entityType ?? "<missing>"}:{entityId ?? "<missing>"}
        </span>
      </div>
      <div>
        <span className="text-fg-muted">Decision:</span>{" "}
        <span className="font-mono">{decision}</span>
      </div>
    </div>
  );
}

function AuditForgetConfirmDialog({
  open,
  onOpenChange,
  isLoading,
  onConfirm,
  entityType,
  entityId,
  decision,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isLoading: boolean;
  onConfirm: () => Promise<void>;
  entityType: string | undefined;
  entityId: string | undefined;
  decision: "delete" | "anonymize" | "retain";
}) {
  return (
    <ConfirmDangerDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Forget audit receipts?"
      description="This action may delete or anonymize audit receipts and cannot be undone."
      confirmLabel="Forget"
      onConfirm={onConfirm}
      isLoading={isLoading}
    >
      <AuditForgetDialogSummary entityType={entityType} entityId={entityId} decision={decision} />
    </ConfirmDangerDialog>
  );
}

function AuditForgetTab({
  core,
  canMutate,
  requestEnter,
}: {
  core: OperatorCore;
  canMutate: boolean;
  requestEnter: () => void;
}) {
  const auditApi = core.http.audit;

  const [entityType, setEntityType] = React.useState("");
  const [entityId, setEntityId] = React.useState("");
  const [decision, setDecision] = React.useState<"delete" | "anonymize" | "retain">("delete");
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const action = useApiAction<unknown>();

  const resolvedEntityType = optionalString(entityType);
  const resolvedEntityId = optionalString(entityId);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Entity type"
          placeholder="user | session | ..."
          value={entityType}
          onChange={(event) => {
            setEntityType(event.target.value);
          }}
        />
        <Input
          label="Entity id"
          placeholder="..."
          value={entityId}
          onChange={(event) => {
            setEntityId(event.target.value);
          }}
        />
      </div>

      <AuditForgetDecisionFieldset decision={decision} onDecisionChange={setDecision} />

      <div className="flex flex-wrap gap-2">
        <Button
          variant="danger"
          disabled={!canMutate || !resolvedEntityType || !resolvedEntityId}
          onClick={() => {
            setDialogOpen(true);
          }}
        >
          Forget…
        </Button>
        {!canMutate ? (
          <Button
            variant="secondary"
            onClick={() => {
              requestEnter();
            }}
          >
            Enter Admin Mode
          </Button>
        ) : null}
        <Button
          variant="secondary"
          disabled={action.isLoading}
          onClick={() => {
            action.reset();
          }}
        >
          Clear
        </Button>
      </div>

      <ApiResultCard
        heading="Forget result"
        value={action.value}
        error={action.error}
        jsonViewerProps={DEFAULT_RESULT_VIEWER_PROPS}
      />

      <AuditForgetConfirmDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        isLoading={action.isLoading}
        onConfirm={async () => {
          if (!canMutate) {
            requestEnter();
            throw new Error("Enter Admin Mode to forget audit receipts.");
          }
          if (!resolvedEntityType || !resolvedEntityId) return;
          await action.run(
            () =>
              auditApi.forget({
                confirm: "FORGET",
                entity_type: resolvedEntityType,
                entity_id: resolvedEntityId,
                decision,
              }),
            { throwOnError: true },
          );
        }}
        entityType={resolvedEntityType}
        entityId={resolvedEntityId}
        decision={decision}
      />
    </>
  );
}

export function AuditPanel({ core }: { core: OperatorCore }) {
  const { canMutate, requestEnter } = useAdminMutationAccess(core);
  return (
    <Card data-testid="admin-http-audit-panel">
      <CardHeader>
        <div className="text-sm font-medium text-fg">Audit</div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Tabs defaultValue="export" className="grid gap-3">
          <TabsList aria-label="Audit endpoints">
            <TabsTrigger value="export">Export</TabsTrigger>
            <TabsTrigger value="verify">Verify</TabsTrigger>
            <TabsTrigger value="forget">Forget</TabsTrigger>
          </TabsList>

          <TabsContent value="export" forceMount className="grid gap-3">
            <AuditExportTab core={core} />
          </TabsContent>

          <TabsContent value="verify" forceMount className="grid gap-3">
            <AuditVerifyTab core={core} />
          </TabsContent>

          <TabsContent value="forget" forceMount className="grid gap-3">
            <AuditForgetTab core={core} canMutate={canMutate} requestEnter={requestEnter} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
