import * as React from "react";
import { translateString, useI18n, useTranslateNode } from "../../i18n-helpers.js";
import { ElevatedModeTooltip } from "../elevated-mode/elevated-mode-tooltip.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { LoadingState } from "../ui/loading-state.js";
import { Select } from "../ui/select.js";
import {
  EXECUTION_PROFILE_IDS,
  EXECUTION_PROFILE_LABELS,
  presetWarning,
  type AvailableModel,
  type ModelPreset,
} from "./admin-http-models.shared.js";

function readReasoningVisibility(options: ModelPreset["options"]): string {
  const value = (options as Record<string, unknown>)["reasoning_visibility"];
  return value === "hidden" || value === "collapsed" || value === "expanded"
    ? value
    : "preset default";
}

export function ReplacementAssignmentsFields({
  requiredExecutionProfileIds,
  candidatePresets,
  selections,
  onChange,
}: {
  requiredExecutionProfileIds: string[];
  candidatePresets: ModelPreset[];
  selections: Record<string, string | null>;
  onChange: (profileId: string, presetKey: string | null) => void;
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
            onChange(profileId, event.currentTarget.value || null);
          }}
        >
          <option value="">None</option>
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
  assignmentDraft: Record<string, string | null>;
  onAssignmentChange: (profileId: string, presetKey: string | null) => void;
  onRefresh: () => void;
  onSaveAssignments: () => void;
  requestEnter: () => void;
}): React.ReactElement {
  const translateNode = useTranslateNode();
  return (
    <Card>
      <CardHeader className="pb-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid gap-1">
            <div className="text-sm font-medium text-fg">{translateNode("Execution profiles")}</div>
            <div className="text-sm text-fg-muted">
              {translateNode(
                "Each built-in execution profile can use a configured preset or stay set to None.",
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" isLoading={refreshing} onClick={onRefresh}>
              Refresh
            </Button>
            <ElevatedModeTooltip canMutate={canMutate} requestEnter={requestEnter}>
              <Button
                type="button"
                data-testid="models-assignments-save"
                isLoading={savingAssignments}
                disabled={!assignmentChanged}
                onClick={onSaveAssignments}
              >
                Save assignments
              </Button>
            </ElevatedModeTooltip>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {loading ? (
          <LoadingState label="Loading model config…" />
        ) : executionProfilesErrorMessage ? (
          <Alert
            variant="error"
            title="Model config failed"
            description={executionProfilesErrorMessage}
          />
        ) : (
          <div className="grid gap-4">
            {presets.length === 0 ? (
              <Alert
                variant="info"
                title="No model presets configured"
                description="Execution profiles can stay set to None until you add presets. Config health will keep surfacing unassigned profiles."
              />
            ) : null}
            <div className="grid gap-3 md:grid-cols-2">
              {EXECUTION_PROFILE_IDS.map((profileId) => (
                <Select
                  key={profileId}
                  label={EXECUTION_PROFILE_LABELS[profileId]}
                  value={assignmentDraft[profileId] ?? ""}
                  onChange={(event) => {
                    onAssignmentChange(profileId, event.currentTarget.value || null);
                  }}
                >
                  <option value="">None</option>
                  {presets.map((preset) => (
                    <option key={preset.preset_key} value={preset.preset_key}>
                      {preset.display_name} ({preset.provider_key}/{preset.model_id})
                    </option>
                  ))}
                </Select>
              ))}
            </div>
          </div>
        )}
      </CardContent>
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
  const intl = useI18n();
  const translateNode = useTranslateNode();
  return (
    <Card>
      <CardHeader className="pb-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid gap-1">
            <div className="text-sm font-medium text-fg">{translateNode("Configured models")}</div>
            <div className="text-sm text-fg-muted">
              {translateNode(
                "Save reusable model presets with curated options like reasoning effort.",
              )}
            </div>
          </div>
          <ElevatedModeTooltip canMutate={canMutate} requestEnter={requestEnter}>
            <Button
              type="button"
              data-testid="models-add-open"
              disabled={availableModels.length === 0}
              onClick={() => {
                onAdd();
              }}
            >
              Add model
            </Button>
          </ElevatedModeTooltip>
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
                      {translateString(intl, "Reasoning effort: {value}", {
                        value: preset.options.reasoning_effort ?? translateString(intl, "default"),
                      })}
                    </div>
                    <div className="text-sm text-fg-muted">
                      {translateString(intl, "Reasoning display: {value}", {
                        value: readReasoningVisibility(preset.options),
                      })}
                    </div>
                    {warning ? (
                      <Alert variant="warning" title="Provider warning" description={warning} />
                    ) : null}
                  </div>
                  <ElevatedModeTooltip canMutate={canMutate} requestEnter={requestEnter}>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          onEdit(preset);
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="danger"
                        onClick={() => {
                          onRemove(preset);
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  </ElevatedModeTooltip>
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
