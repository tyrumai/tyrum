import type { WorkItem } from "@tyrum/operator-app";
import { useEffect, useState } from "react";
import { Button } from "../ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js";
import { Alert } from "../ui/alert.js";
import { Input } from "../ui/input.js";
import { Select } from "../ui/select.js";
import { StructuredJsonField } from "../ui/structured-json-field.js";
import type { StructuredJsonObjectSchema } from "../ui/structured-json-schema-field.js";

export type WorkboardEditorSubmitInput =
  | {
      mode: "create";
      item: {
        kind: WorkItem["kind"];
        title: string;
        priority: number;
        acceptance?: unknown;
        fingerprint?: WorkItem["fingerprint"];
        budgets?: Exclude<WorkItem["budgets"], null>;
        parent_work_item_id?: string;
      };
    }
  | {
      mode: "edit";
      patch: {
        title: string;
        priority: number;
        acceptance?: unknown;
        fingerprint?: WorkItem["fingerprint"];
        budgets?: WorkItem["budgets"] | null;
      };
    };

export type WorkboardItemEditorDialogProps = {
  open: boolean;
  mode: "create" | "edit";
  busy: boolean;
  error: string | null;
  item?: WorkItem | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: WorkboardEditorSubmitInput) => Promise<void>;
};

function normalizePriority(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

const WORKBOARD_BUDGET_SCHEMA: StructuredJsonObjectSchema = {
  type: "object",
  propertyOrder: ["max_usd_micros", "max_duration_ms", "max_total_tokens"],
  properties: {
    max_usd_micros: {
      type: "integer",
      title: "Max USD micros",
      description: "Maximum turn cost in USD micros. Leave blank to keep it unset.",
      minimum: 0,
    },
    max_duration_ms: {
      type: "integer",
      title: "Max duration (ms)",
      description: "Maximum wall-clock duration in milliseconds. Leave blank to keep it unset.",
      minimum: 1,
    },
    max_total_tokens: {
      type: "integer",
      title: "Max total tokens",
      description: "Maximum LLM tokens consumed by the turn. Leave blank to keep it unset.",
      minimum: 0,
    },
  },
};

const WORKBOARD_FINGERPRINT_SCHEMA: StructuredJsonObjectSchema = {
  type: "object",
  additionalProperties: true,
  propertyOrder: ["resources"],
  properties: {
    resources: {
      type: "array",
      title: "Resources",
      description: "Resource identifiers that this work item depends on.",
      items: {
        type: "string",
        title: "Resource",
      },
      maxItems: 128,
    },
  },
};

export function WorkboardItemEditorDialog({
  open,
  mode,
  busy,
  error,
  item,
  onOpenChange,
  onSubmit,
}: WorkboardItemEditorDialogProps) {
  const [kind, setKind] = useState<WorkItem["kind"]>("action");
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("0");
  const [parentWorkItemId, setParentWorkItemId] = useState("");
  const [acceptanceValue, setAcceptanceValue] = useState<unknown | undefined>(undefined);
  const [acceptanceError, setAcceptanceError] = useState<string | null>(null);
  const [fingerprintValue, setFingerprintValue] = useState<WorkItem["fingerprint"] | undefined>(
    undefined,
  );
  const [fingerprintError, setFingerprintError] = useState<string | null>(null);
  const [budgetValue, setBudgetValue] = useState<Exclude<WorkItem["budgets"], null> | undefined>(
    undefined,
  );
  const [budgetError, setBudgetError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setKind(item?.kind ?? "action");
    setTitle(item?.title ?? "");
    setPriority(String(item?.priority ?? 0));
    setParentWorkItemId(item?.parent_work_item_id ?? "");
    setAcceptanceValue(item?.acceptance);
    setAcceptanceError(null);
    setFingerprintValue(item?.fingerprint);
    setFingerprintError(null);
    setBudgetValue((item?.budgets ?? undefined) as Exclude<WorkItem["budgets"], null> | undefined);
    setBudgetError(null);
  }, [item, mode, open]);

  const titleValue = title.trim();
  const priorityValue = Number.parseInt(priority, 10);
  const hasValidPriority = Number.isInteger(priorityValue) && priorityValue >= 0;
  const canSubmit =
    titleValue.length > 0 &&
    hasValidPriority &&
    acceptanceError === null &&
    fingerprintError === null &&
    budgetError === null;

  const handleSubmit = async (): Promise<void> => {
    if (!canSubmit) {
      return;
    }

    if (mode === "create") {
      await onSubmit({
        mode: "create",
        item: {
          kind,
          title: titleValue,
          priority: normalizePriority(priority, 0),
          acceptance: acceptanceValue,
          fingerprint: fingerprintValue,
          budgets: budgetValue,
          ...(parentWorkItemId.trim()
            ? { parent_work_item_id: parentWorkItemId.trim() }
            : undefined),
        },
      });
      return;
    }

    await onSubmit({
      mode: "edit",
      patch: {
        title: titleValue,
        priority: normalizePriority(priority, item?.priority ?? 0),
        acceptance: acceptanceValue === undefined ? item?.acceptance : acceptanceValue,
        fingerprint: fingerprintValue === undefined ? item?.fingerprint : fingerprintValue,
        budgets:
          budgetValue !== undefined
            ? (budgetValue as WorkItem["budgets"] | undefined)
            : item?.budgets === undefined
              ? undefined
              : null,
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid={`workboard-${mode}-dialog`}
        className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"
        onPointerDownOutside={(e) => {
          if (busy) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (busy) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Create work item" : "Edit work item"}</DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Create backlog work using the canonical workboard capture flow."
              : "Update the editable work item fields. Active leased work stays read-only until paused."}
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <Input
            data-testid="workboard-editor-title"
            label="Title"
            required
            value={title}
            onChange={(event) => {
              setTitle(event.currentTarget.value);
            }}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            {mode === "create" ? (
              <Select
                data-testid="workboard-editor-kind"
                label="Kind"
                value={kind}
                onChange={(event) => {
                  setKind(event.currentTarget.value as WorkItem["kind"]);
                }}
              >
                <option value="action">Action</option>
                <option value="initiative">Initiative</option>
              </Select>
            ) : null}
            <Input
              data-testid="workboard-editor-priority"
              label="Priority"
              type="number"
              min={0}
              value={priority}
              error={
                priority.trim().length > 0 && !hasValidPriority
                  ? "Priority must be a non-negative integer."
                  : undefined
              }
              onChange={(event) => {
                setPriority(event.currentTarget.value);
              }}
            />
          </div>

          {mode === "create" ? (
            <Input
              data-testid="workboard-editor-parent"
              label="Parent work item ID"
              value={parentWorkItemId}
              onChange={(event) => {
                setParentWorkItemId(event.currentTarget.value);
              }}
            />
          ) : null}

          <StructuredJsonField
            data-testid="workboard-editor-acceptance"
            label="Acceptance"
            value={acceptanceValue}
            helperText={
              mode === "create"
                ? "Leave empty to omit the acceptance payload."
                : "Clear the value to keep the current acceptance payload."
            }
            onJsonChange={(nextValue, nextErrorMessage) => {
              setAcceptanceValue(nextValue);
              setAcceptanceError(nextErrorMessage);
            }}
          />

          <StructuredJsonField
            data-testid="workboard-editor-fingerprint"
            label="Fingerprint"
            schema={WORKBOARD_FINGERPRINT_SCHEMA}
            value={fingerprintValue}
            helperText={
              mode === "create"
                ? "Add resource references or other fingerprint metadata."
                : "Clear the value to keep the current fingerprint."
            }
            onJsonChange={(nextValue, nextErrorMessage) => {
              setFingerprintValue(nextValue as WorkItem["fingerprint"] | undefined);
              setFingerprintError(nextErrorMessage);
            }}
          />

          <StructuredJsonField
            data-testid="workboard-editor-budgets"
            label="Budgets"
            schema={WORKBOARD_BUDGET_SCHEMA}
            value={budgetValue}
            helperText={
              mode === "create"
                ? "Leave everything blank to omit budgets."
                : "Leave everything blank to clear existing budgets."
            }
            onJsonChange={(nextValue, nextErrorMessage) => {
              setBudgetValue(nextValue as Exclude<WorkItem["budgets"], null> | undefined);
              setBudgetError(nextErrorMessage);
            }}
          />

          {error ? <Alert variant="error" title={error} /> : null}

          <DialogFooter>
            <Button variant="secondary" type="button" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button
              data-testid="workboard-editor-submit"
              type="submit"
              isLoading={busy}
              disabled={!canSubmit}
            >
              {mode === "create" ? "Create work item" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
