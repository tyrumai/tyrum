import * as React from "react";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardFooter, CardHeader } from "../ui/card.js";
import { Select } from "../ui/select.js";
import {
  EXECUTION_PROFILE_IDS,
  EXECUTION_PROFILE_LABELS,
  presetWarning,
  type AvailableModel,
  type ModelPreset,
} from "./admin-http-models.shared.js";

export function ReplacementAssignmentsFields({
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

export function ExecutionProfilesCard({
  loading,
  refreshing,
  savingAssignments,
  executionProfilesErrorMessage,
  canMutate,
  assignmentChanged,
  presets,
  assignmentDraft,
  onAssignmentChange,
  onRefresh,
  onSaveAssignments,
  requestEnter,
}: {
  loading: boolean;
  refreshing: boolean;
  savingAssignments: boolean;
  executionProfilesErrorMessage: string | null;
  canMutate: boolean;
  assignmentChanged: boolean;
  presets: ModelPreset[];
  assignmentDraft: Record<string, string>;
  onAssignmentChange: (profileId: string, presetKey: string) => void;
  onRefresh: () => void;
  onSaveAssignments: () => void;
  requestEnter: () => void;
}): React.ReactElement {
  return (
    <Card>
      <CardHeader className="pb-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid gap-1">
            <div className="text-sm font-medium text-fg">Execution profiles</div>
            <div className="text-sm text-fg-muted">
              Each built-in execution profile must point at a configured model preset.
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" isLoading={refreshing} onClick={onRefresh}>
              Refresh
            </Button>
            <Button
              type="button"
              data-testid="models-assignments-save"
              isLoading={savingAssignments}
              disabled={!canMutate || !assignmentChanged || presets.length === 0}
              onClick={onSaveAssignments}
            >
              Save assignments
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {loading ? (
          <div className="text-sm text-fg-muted">Loading model config…</div>
        ) : executionProfilesErrorMessage ? (
          <Alert
            variant="error"
            title="Model config failed"
            description={executionProfilesErrorMessage}
          />
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
                  onAssignmentChange(profileId, event.currentTarget.value);
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
  );
}

export function ConfiguredModelsCard({
  availableModelsErrorMessage,
  availableModels,
  presets,
  canMutate,
  onAdd,
  onEdit,
  onRemove,
  requestEnter,
}: {
  availableModelsErrorMessage: string | null;
  availableModels: AvailableModel[];
  presets: ModelPreset[];
  canMutate: boolean;
  onAdd: () => void;
  onEdit: (preset: ModelPreset) => void;
  onRemove: (preset: ModelPreset) => void;
  requestEnter: () => void;
}): React.ReactElement {
  return (
    <Card>
      <CardHeader className="pb-2.5">
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
              onAdd();
            }}
          >
            Add model
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {availableModelsErrorMessage ? (
          <Alert
            variant="error"
            title="Available model discovery failed"
            description={availableModelsErrorMessage}
          />
        ) : null}

        {!availableModelsErrorMessage && availableModels.length === 0 ? (
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
                className="grid gap-3 rounded-lg border border-border bg-bg p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="grid gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-medium text-fg">{preset.display_name}</div>
                      <Badge variant="outline">{preset.preset_key}</Badge>
                      {warning ? <Badge variant="warning">Provider unavailable</Badge> : null}
                    </div>
                    <div className="break-words text-sm text-fg-muted [overflow-wrap:anywhere]">
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
                        onEdit(preset);
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
                        onRemove(preset);
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
  );
}
