import type { OperatorCore } from "@tyrum/operator-core";
import * as React from "react";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardFooter, CardHeader } from "../ui/card.js";
import { ConfirmDangerDialog } from "../ui/confirm-danger-dialog.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js";
import { Input } from "../ui/input.js";
import { Select } from "../ui/select.js";
import {
  useAdminHttpClient,
  useAdminMutationAccess,
  type AdminHttpClient,
} from "./admin-http-shared.js";

const EXECUTION_PROFILE_IDS = [
  "interaction",
  "explorer_ro",
  "reviewer_ro",
  "planner",
  "jury",
  "executor_rw",
  "integrator",
] as const;

const EXECUTION_PROFILE_LABELS: Record<(typeof EXECUTION_PROFILE_IDS)[number], string> = {
  interaction: "Interaction",
  explorer_ro: "Explorer",
  reviewer_ro: "Reviewer",
  planner: "Planner",
  jury: "Jury",
  executor_rw: "Executor",
  integrator: "Integrator",
};

const REASONING_OPTIONS = [
  { value: "", label: "Default" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
] as const;

type ModelPreset = Awaited<
  ReturnType<AdminHttpClient["modelConfig"]["listPresets"]>
>["presets"][number];
type AvailableModel = Awaited<
  ReturnType<AdminHttpClient["modelConfig"]["listAvailable"]>
>["models"][number];
type Assignment = Awaited<
  ReturnType<AdminHttpClient["modelConfig"]["listAssignments"]>
>["assignments"][number];

type ModelDialogState = {
  displayName: string;
  modelRef: string;
  reasoningEffort: "" | "low" | "medium" | "high";
};

type DeletePresetDialogState = {
  preset: ModelPreset;
  requiredExecutionProfileIds: string[];
  replacementAssignments: Record<string, string>;
} | null;

function emptyDialogState(): ModelDialogState {
  return {
    displayName: "",
    modelRef: "",
    reasoningEffort: "",
  };
}

function modelRefFor(availableModel: AvailableModel): string {
  return `${availableModel.provider_key}/${availableModel.model_id}`;
}

function splitModelRef(modelRef: string): { providerKey: string; modelId: string } | null {
  const slashIndex = modelRef.indexOf("/");
  if (slashIndex <= 0 || slashIndex === modelRef.length - 1) return null;
  return {
    providerKey: modelRef.slice(0, slashIndex),
    modelId: modelRef.slice(slashIndex + 1),
  };
}

function normalizeDialogState(input: {
  preset?: ModelPreset | null;
  availableModels: AvailableModel[];
}): ModelDialogState {
  if (input.preset) {
    return {
      displayName: input.preset.display_name,
      modelRef: `${input.preset.provider_key}/${input.preset.model_id}`,
      reasoningEffort: (input.preset.options.reasoning_effort ?? "") as
        | ""
        | "low"
        | "medium"
        | "high",
    };
  }

  return {
    displayName: "",
    modelRef: input.availableModels[0] ? modelRefFor(input.availableModels[0]) : "",
    reasoningEffort: "",
  };
}

function presetWarning(preset: ModelPreset, availableModels: AvailableModel[]): string | null {
  const exists = availableModels.some(
    (model) => model.provider_key === preset.provider_key && model.model_id === preset.model_id,
  );
  return exists ? null : "Provider is not currently configured for this preset.";
}

function ReplacementAssignmentsFields({
  requiredExecutionProfileIds,
  candidatePresets,
  selections,
  onChange,
}: {
  requiredExecutionProfileIds: string[];
  candidatePresets: ModelPreset[];
  selections: Record<string, string>;
  onChange: (profileId: string, presetKey: string) => void;
}): React.ReactElement | null {
  if (requiredExecutionProfileIds.length === 0) return null;

  return (
    <div className="grid gap-3">
      <Alert
        variant="warning"
        title="Execution profile replacements required"
        description="This preset is currently assigned to execution profiles. Pick replacements before removing it."
      />
      {requiredExecutionProfileIds.map((profileId) => (
        <Select
          key={profileId}
          label={`${EXECUTION_PROFILE_LABELS[profileId as keyof typeof EXECUTION_PROFILE_LABELS] ?? profileId} replacement`}
          value={selections[profileId] ?? ""}
          onChange={(event) => {
            onChange(profileId, event.currentTarget.value);
          }}
        >
          <option value="">Select a preset</option>
          {candidatePresets.map((preset) => (
            <option key={preset.preset_key} value={preset.preset_key}>
              {preset.display_name} ({preset.provider_key}/{preset.model_id})
            </option>
          ))}
        </Select>
      ))}
    </div>
  );
}

function ModelPresetDialog({
  open,
  onOpenChange,
  preset,
  availableModels,
  onSaved,
  canMutate,
  core,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preset: ModelPreset | null;
  availableModels: AvailableModel[];
  onSaved: () => Promise<void>;
  canMutate: boolean;
  core: OperatorCore;
}): React.ReactElement {
  const api = (useAdminHttpClient() ?? core.http).modelConfig;
  const [state, setState] = React.useState<ModelDialogState>(emptyDialogState());
  const [saving, setSaving] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const selectedModel = availableModels.find((model) => modelRefFor(model) === state.modelRef);

  React.useEffect(() => {
    if (!open) return;
    setState(normalizeDialogState({ preset, availableModels }));
    setSaving(false);
    setErrorMessage(null);
  }, [availableModels, open, preset]);

  const submit = async (): Promise<void> => {
    if (!canMutate) {
      throw new Error("Enter Elevated Mode to configure models.");
    }
    if (!state.displayName.trim()) {
      setErrorMessage("Display name is required.");
      return;
    }
    if (!preset && !selectedModel) {
      setErrorMessage("Choose a model.");
      return;
    }

    setSaving(true);
    setErrorMessage(null);
    try {
      const options =
        state.reasoningEffort === "" ? {} : { reasoning_effort: state.reasoningEffort };
      if (preset) {
        await api.updatePreset(preset.preset_key, {
          display_name: state.displayName.trim(),
          options,
        });
      } else {
        const parsedModel = splitModelRef(state.modelRef);
        if (!parsedModel) {
          throw new Error("Choose a valid model.");
        }
        await api.createPreset({
          display_name: state.displayName.trim(),
          provider_key: parsedModel.providerKey,
          model_id: parsedModel.modelId,
          options,
        });
      }
      onOpenChange(false);
      await onSaved();
    } catch (error) {
      setErrorMessage(formatErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="models-preset-dialog">
        <DialogHeader>
          <DialogTitle>{preset ? "Edit model preset" : "Add model"}</DialogTitle>
          <DialogDescription>
            {preset
              ? "Adjust the preset name and curated model options."
              : "Pick a model from your configured providers and save it as a reusable preset."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <Input
            label="Display name"
            required
            value={state.displayName}
            onChange={(event) => {
              setState((current) => ({
                ...current,
                displayName: event.currentTarget.value,
              }));
            }}
          />

          {preset ? (
            <Input
              label="Model"
              readOnly
              value={`${preset.provider_key}/${preset.model_id}`}
              helperText="The underlying model is fixed after creation."
            />
          ) : (
            <Select
              label="Model"
              value={state.modelRef}
              onChange={(event) => {
                setState((current) => ({
                  ...current,
                  modelRef: event.currentTarget.value,
                  displayName:
                    current.displayName.trim().length > 0
                      ? current.displayName
                      : (availableModels.find(
                          (model) => modelRefFor(model) === event.currentTarget.value,
                        )?.model_name ?? current.displayName),
                }));
              }}
            >
              {availableModels.map((model) => (
                <option key={modelRefFor(model)} value={modelRefFor(model)}>
                  {model.provider_name} / {model.model_name}
                </option>
              ))}
            </Select>
          )}

          <Select
            label="Reasoning effort"
            value={state.reasoningEffort}
            onChange={(event) => {
              setState((current) => ({
                ...current,
                reasoningEffort: event.currentTarget.value as ModelDialogState["reasoningEffort"],
              }));
            }}
          >
            {REASONING_OPTIONS.map((option) => (
              <option key={option.value || "default"} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>

          {selectedModel && !preset ? (
            <div className="text-sm text-fg-muted">
              Selected: {selectedModel.provider_name} / {selectedModel.model_name}
            </div>
          ) : null}

          {errorMessage ? (
            <Alert variant="error" title="Unable to save" description={errorMessage} />
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            disabled={saving}
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button
            type="button"
            data-testid="models-save"
            isLoading={saving}
            disabled={!canMutate || !state.displayName.trim() || (!preset && !state.modelRef)}
            onClick={() => {
              void submit();
            }}
          >
            {preset ? "Save preset" : "Add model"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AdminHttpModelsPanel({ core }: { core: OperatorCore }): React.ReactElement {
  const { canMutate, requestEnter } = useAdminMutationAccess(core);
  const mutationHttp = useAdminHttpClient() ?? core.http;
  const readHttp = core.http;
  const [presets, setPresets] = React.useState<ModelPreset[]>([]);
  const [availableModels, setAvailableModels] = React.useState<AvailableModel[]>([]);
  const [assignments, setAssignments] = React.useState<Assignment[]>([]);
  const [assignmentDraft, setAssignmentDraft] = React.useState<Record<string, string>>({});
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [savingAssignments, setSavingAssignments] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editingPreset, setEditingPreset] = React.useState<ModelPreset | null>(null);
  const [deletingPreset, setDeletingPreset] = React.useState<DeletePresetDialogState>(null);

  const refresh = React.useCallback(async (): Promise<void> => {
    setRefreshing(true);
    setErrorMessage(null);
    try {
      const [presetResult, availableResult, assignmentResult] = await Promise.all([
        readHttp.modelConfig.listPresets(),
        readHttp.modelConfig.listAvailable(),
        readHttp.modelConfig.listAssignments(),
      ]);
      setPresets(presetResult.presets);
      setAvailableModels(availableResult.models);
      setAssignments(assignmentResult.assignments);
      setAssignmentDraft(
        Object.fromEntries(
          assignmentResult.assignments.map((assignment) => [
            assignment.execution_profile_id,
            assignment.preset_key,
          ]),
        ),
      );
    } catch (error) {
      setErrorMessage(formatErrorMessage(error));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [readHttp.modelConfig]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const assignmentChanged = assignments.some(
    (assignment) => assignmentDraft[assignment.execution_profile_id] !== assignment.preset_key,
  );

  const saveAssignments = async (): Promise<void> => {
    if (!canMutate) {
      requestEnter();
      return;
    }
    setSavingAssignments(true);
    setErrorMessage(null);
    try {
      await mutationHttp.modelConfig.updateAssignments({ assignments: assignmentDraft });
      await refresh();
    } catch (error) {
      setErrorMessage(formatErrorMessage(error));
    } finally {
      setSavingAssignments(false);
    }
  };

  const removePreset = async (): Promise<void> => {
    if (!deletingPreset) return;
    if (
      deletingPreset.requiredExecutionProfileIds.some(
        (profileId) => !deletingPreset.replacementAssignments[profileId],
      )
    ) {
      throw new Error("Select a replacement preset for every required execution profile.");
    }
    const replacementAssignments =
      deletingPreset.requiredExecutionProfileIds.length > 0
        ? deletingPreset.replacementAssignments
        : undefined;
    const result = await mutationHttp.modelConfig.deletePreset(
      deletingPreset.preset.preset_key,
      replacementAssignments ? { replacement_assignments: replacementAssignments } : undefined,
    );
    if ("error" in result) {
      setDeletingPreset((current) =>
        current
          ? {
              ...current,
              requiredExecutionProfileIds: result.required_execution_profile_ids,
            }
          : current,
      );
      throw new Error("Select replacement presets before removing this model.");
    }

    setDeletingPreset(null);
    await refresh();
  };

  const candidatePresets = deletingPreset
    ? presets.filter((preset) => preset.preset_key !== deletingPreset.preset.preset_key)
    : [];

  return (
    <section className="grid gap-4" data-testid="admin-http-models">
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="grid gap-1">
              <div className="text-sm font-medium text-fg">Execution profiles</div>
              <div className="text-sm text-fg-muted">
                Each built-in execution profile must point at a configured model preset.
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                isLoading={refreshing}
                onClick={() => {
                  void refresh();
                }}
              >
                Refresh
              </Button>
              <Button
                type="button"
                data-testid="models-assignments-save"
                isLoading={savingAssignments}
                disabled={!canMutate || !assignmentChanged || presets.length === 0}
                onClick={() => {
                  void saveAssignments();
                }}
              >
                Save assignments
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          {errorMessage ? (
            <Alert variant="error" title="Model config failed" description={errorMessage} />
          ) : null}

          {loading ? (
            <div className="text-sm text-fg-muted">Loading model config…</div>
          ) : presets.length === 0 ? (
            <Alert
              variant="info"
              title="No models configured"
              description="Add a model preset before assigning execution profiles."
            />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {EXECUTION_PROFILE_IDS.map((profileId) => (
                <Select
                  key={profileId}
                  label={EXECUTION_PROFILE_LABELS[profileId]}
                  value={assignmentDraft[profileId] ?? ""}
                  onChange={(event) => {
                    const nextPresetKey = event.currentTarget.value;
                    setAssignmentDraft((current) => ({
                      ...current,
                      [profileId]: nextPresetKey,
                    }));
                  }}
                >
                  <option value="">Select a preset</option>
                  {presets.map((preset) => (
                    <option key={preset.preset_key} value={preset.preset_key}>
                      {preset.display_name} ({preset.provider_key}/{preset.model_id})
                    </option>
                  ))}
                </Select>
              ))}
            </div>
          )}
        </CardContent>
        {!canMutate ? (
          <CardFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                requestEnter();
              }}
            >
              Enter Elevated Mode
            </Button>
          </CardFooter>
        ) : null}
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="grid gap-1">
              <div className="text-sm font-medium text-fg">Configured models</div>
              <div className="text-sm text-fg-muted">
                Save reusable model presets with curated options like reasoning effort.
              </div>
            </div>
            <Button
              type="button"
              data-testid="models-add-open"
              disabled={!canMutate || availableModels.length === 0}
              onClick={() => {
                if (!canMutate) {
                  requestEnter();
                  return;
                }
                setEditingPreset(null);
                setDialogOpen(true);
              }}
            >
              Add model
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          {availableModels.length === 0 ? (
            <Alert
              variant="warning"
              title="No configured provider models available"
              description="Add and enable a provider account before creating model presets."
            />
          ) : null}

          {presets.length === 0 ? (
            <div className="text-sm text-fg-muted">No model presets saved yet.</div>
          ) : (
            presets.map((preset) => {
              const warning = presetWarning(preset, availableModels);
              return (
                <div
                  key={preset.preset_key}
                  className="grid gap-3 rounded-xl border border-border/60 bg-bg-card/40 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="grid gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-medium text-fg">{preset.display_name}</div>
                        <Badge variant="outline">{preset.preset_key}</Badge>
                        {warning ? <Badge variant="warning">Provider unavailable</Badge> : null}
                      </div>
                      <div className="text-sm text-fg-muted">
                        {preset.provider_key}/{preset.model_id}
                      </div>
                      <div className="text-sm text-fg-muted">
                        Reasoning effort: {preset.options.reasoning_effort ?? "default"}
                      </div>
                      {warning ? (
                        <Alert variant="warning" title="Provider warning" description={warning} />
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={!canMutate}
                        onClick={() => {
                          if (!canMutate) {
                            requestEnter();
                            return;
                          }
                          setEditingPreset(preset);
                          setDialogOpen(true);
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="danger"
                        disabled={!canMutate}
                        onClick={() => {
                          if (!canMutate) {
                            requestEnter();
                            return;
                          }
                          setDeletingPreset({
                            preset,
                            requiredExecutionProfileIds: assignments
                              .filter((assignment) => assignment.preset_key === preset.preset_key)
                              .map((assignment) => assignment.execution_profile_id),
                            replacementAssignments: {},
                          });
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <ModelPresetDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setEditingPreset(null);
          }
        }}
        preset={editingPreset}
        availableModels={availableModels}
        onSaved={refresh}
        canMutate={canMutate}
        core={core}
      />

      <ConfirmDangerDialog
        open={deletingPreset !== null}
        onOpenChange={(open) => {
          if (open) return;
          setDeletingPreset(null);
        }}
        title="Remove model preset"
        description={
          deletingPreset
            ? `Remove ${deletingPreset.preset.display_name} (${deletingPreset.preset.provider_key}/${deletingPreset.preset.model_id}).`
            : undefined
        }
        confirmLabel="Remove model"
        onConfirm={removePreset}
      >
        {deletingPreset ? (
          <ReplacementAssignmentsFields
            requiredExecutionProfileIds={deletingPreset.requiredExecutionProfileIds}
            candidatePresets={candidatePresets}
            selections={deletingPreset.replacementAssignments}
            onChange={(profileId, presetKey) => {
              setDeletingPreset((current) =>
                current
                  ? {
                      ...current,
                      replacementAssignments: {
                        ...current.replacementAssignments,
                        [profileId]: presetKey,
                      },
                    }
                  : current,
              );
            }}
          />
        ) : null}
      </ConfirmDangerDialog>
    </section>
  );
}
