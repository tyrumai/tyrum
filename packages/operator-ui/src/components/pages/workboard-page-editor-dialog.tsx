import type { WorkItem } from "@tyrum/operator-app";
import { useEffect, useMemo, useState } from "react";
import { parseJsonInput } from "../../utils/parse-json-input.js";
import { Button } from "../ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js";
import { Input } from "../ui/input.js";
import { Textarea } from "../ui/textarea.js";
import { Select } from "../ui/select.js";

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

function stringifyJson(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  return JSON.stringify(value, null, 2);
}

function normalizePriority(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

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
  const [acceptanceText, setAcceptanceText] = useState("");
  const [fingerprintText, setFingerprintText] = useState("");
  const [budgetsText, setBudgetsText] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }
    setKind(item?.kind ?? "action");
    setTitle(item?.title ?? "");
    setPriority(String(item?.priority ?? 0));
    setParentWorkItemId(item?.parent_work_item_id ?? "");
    setAcceptanceText(stringifyJson(item?.acceptance));
    setFingerprintText(stringifyJson(item?.fingerprint));
    setBudgetsText(stringifyJson(item?.budgets));
  }, [item, mode, open]);

  const acceptance = useMemo(() => parseJsonInput(acceptanceText), [acceptanceText]);
  const fingerprint = useMemo(() => parseJsonInput(fingerprintText), [fingerprintText]);
  const budgets = useMemo(() => parseJsonInput(budgetsText), [budgetsText]);

  const titleValue = title.trim();
  const priorityValue = Number.parseInt(priority, 10);
  const hasValidPriority = Number.isInteger(priorityValue) && priorityValue >= 0;
  const canSubmit =
    titleValue.length > 0 &&
    hasValidPriority &&
    acceptance.errorMessage === null &&
    fingerprint.errorMessage === null &&
    budgets.errorMessage === null;

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
          acceptance: acceptance.value,
          fingerprint: fingerprint.value as WorkItem["fingerprint"] | undefined,
          budgets:
            budgets.value === null
              ? undefined
              : (budgets.value as Exclude<WorkItem["budgets"], null> | undefined),
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
        acceptance: acceptanceText.trim() ? acceptance.value : item?.acceptance,
        fingerprint: fingerprintText.trim()
          ? (fingerprint.value as WorkItem["fingerprint"] | undefined)
          : item?.fingerprint,
        budgets:
          budgetsText.trim().length > 0
            ? (budgets.value as WorkItem["budgets"] | undefined)
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

          <Input
            data-testid="workboard-editor-title"
            label="Title"
            required
            value={title}
            onChange={(event) => {
              setTitle(event.currentTarget.value);
            }}
          />

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

          <Textarea
            data-testid="workboard-editor-acceptance"
            label="Acceptance JSON"
            rows={6}
            value={acceptanceText}
            helperText="Leave empty for no acceptance payload."
            error={acceptance.errorMessage ? `Invalid JSON: ${acceptance.errorMessage}` : undefined}
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            onChange={(event) => {
              setAcceptanceText(event.currentTarget.value);
            }}
          />

          <Textarea
            data-testid="workboard-editor-fingerprint"
            label="Fingerprint JSON"
            rows={4}
            value={fingerprintText}
            helperText={'Use an object such as {"resources": ["repo:path"]}.'}
            error={
              fingerprint.errorMessage ? `Invalid JSON: ${fingerprint.errorMessage}` : undefined
            }
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            onChange={(event) => {
              setFingerprintText(event.currentTarget.value);
            }}
          />

          <Textarea
            data-testid="workboard-editor-budgets"
            label="Budgets JSON"
            rows={4}
            value={budgetsText}
            helperText="Leave empty to omit budgets on create or clear them on edit."
            error={budgets.errorMessage ? `Invalid JSON: ${budgets.errorMessage}` : undefined}
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            onChange={(event) => {
              setBudgetsText(event.currentTarget.value);
            }}
          />

          {error ? <div className="text-sm text-error">{error}</div> : null}

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
