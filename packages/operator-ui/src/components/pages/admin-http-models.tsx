import type { OperatorCore } from "@tyrum/operator-core";
import * as React from "react";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import { ConfirmDangerDialog } from "../ui/confirm-danger-dialog.js";
import { ModelPresetDialog } from "./admin-http-models-preset-dialog.js";
import {
  ConfiguredModelsCard,
  ExecutionProfilesCard,
  ReplacementAssignmentsFields,
} from "./admin-http-models-sections.js";
import {
  EXECUTION_PROFILE_IDS,
  type Assignment,
  type AvailableModel,
  type DeletePresetDialogState,
  type ModelConfigHttpClient,
  type ModelPreset,
} from "./admin-http-models.shared.js";
import { useAdminHttpClient, useAdminMutationAccess } from "./admin-http-shared.js";

function normalizeAssignments(assignments: Assignment[]): Assignment[] {
  const assignmentsByProfileId = new Map(
    assignments.map((assignment) => [assignment.execution_profile_id, assignment]),
  );
  return EXECUTION_PROFILE_IDS.map((executionProfileId) => {
    const assignment = assignmentsByProfileId.get(executionProfileId);
    return (
      assignment ?? {
        execution_profile_id: executionProfileId,
        preset_key: null,
        preset_display_name: null,
        provider_key: null,
        model_id: null,
      }
    );
  });
}

export function AdminHttpModelsPanel({ core }: { core: OperatorCore }): React.ReactElement {
  const { canMutate, requestEnter } = useAdminMutationAccess(core);
  const mutationHttp = useAdminHttpClient() ?? core.http;
  const readHttp = core.http;
  const [presets, setPresets] = React.useState<ModelPreset[]>([]);
  const [availableModels, setAvailableModels] = React.useState<AvailableModel[]>([]);
  const [assignments, setAssignments] = React.useState<Assignment[]>([]);
  const [assignmentDraft, setAssignmentDraft] = React.useState<Record<string, string | null>>({});
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [savingAssignments, setSavingAssignments] = React.useState(false);
  const [executionProfilesErrorMessage, setExecutionProfilesErrorMessage] = React.useState<
    string | null
  >(null);
  const [availableModelsErrorMessage, setAvailableModelsErrorMessage] = React.useState<
    string | null
  >(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editingPreset, setEditingPreset] = React.useState<ModelPreset | null>(null);
  const [deletingPreset, setDeletingPreset] = React.useState<DeletePresetDialogState>(null);

  const refresh = React.useCallback(
    async (httpClient: ModelConfigHttpClient = readHttp): Promise<void> => {
      setRefreshing(true);
      setExecutionProfilesErrorMessage(null);
      setAvailableModelsErrorMessage(null);

      const [presetResult, availableResult, assignmentResult] = await Promise.allSettled([
        httpClient.modelConfig.listPresets(),
        httpClient.modelConfig.listAvailable(),
        httpClient.modelConfig.listAssignments(),
      ]);

      let nextExecutionProfilesErrorMessage: string | null = null;
      let nextAvailableModelsErrorMessage: string | null = null;
      let nextPresetCount = 0;

      if (presetResult.status === "fulfilled") {
        setPresets(presetResult.value.presets);
        nextPresetCount = presetResult.value.presets.length;
      } else {
        nextExecutionProfilesErrorMessage = formatErrorMessage(presetResult.reason);
        setPresets([]);
      }

      if (availableResult.status === "fulfilled") {
        setAvailableModels(availableResult.value.models);
      } else {
        nextAvailableModelsErrorMessage = formatErrorMessage(availableResult.reason);
        setAvailableModels([]);
      }

      if (assignmentResult.status === "fulfilled") {
        const normalizedAssignments = normalizeAssignments(assignmentResult.value.assignments);
        setAssignments(normalizedAssignments);
        setAssignmentDraft(
          Object.fromEntries(
            normalizedAssignments.map((assignment) => [
              assignment.execution_profile_id,
              assignment.preset_key,
            ]),
          ),
        );
      } else {
        setAssignments(normalizeAssignments([]));
        setAssignmentDraft({});
        if (!nextExecutionProfilesErrorMessage && nextPresetCount > 0) {
          nextExecutionProfilesErrorMessage = formatErrorMessage(assignmentResult.reason);
        }
      }

      setExecutionProfilesErrorMessage(nextExecutionProfilesErrorMessage);
      setAvailableModelsErrorMessage(nextAvailableModelsErrorMessage);
      setLoading(false);
      setRefreshing(false);
    },
    [readHttp],
  );

  React.useEffect(() => {
    void refresh(readHttp);
  }, [readHttp, refresh]);

  const assignmentPresetKeys = new Map(
    assignments.map((assignment) => [assignment.execution_profile_id, assignment.preset_key]),
  );
  const assignmentChanged = EXECUTION_PROFILE_IDS.some(
    (profileId) =>
      (assignmentDraft[profileId] ?? null) !== (assignmentPresetKeys.get(profileId) ?? null),
  );

  const saveAssignments = async (): Promise<void> => {
    if (!canMutate) {
      requestEnter();
      return;
    }
    setSavingAssignments(true);
    setExecutionProfilesErrorMessage(null);
    try {
      await mutationHttp.modelConfig.updateAssignments({ assignments: assignmentDraft });
      await refresh(mutationHttp);
    } catch (error) {
      setExecutionProfilesErrorMessage(formatErrorMessage(error));
    } finally {
      setSavingAssignments(false);
    }
  };

  const removePreset = async (): Promise<void> => {
    if (!deletingPreset) return;
    if (
      deletingPreset.requiredExecutionProfileIds.some(
        (profileId) => !(profileId in deletingPreset.replacementAssignments),
      )
    ) {
      throw new Error("Choose a replacement preset or None for every required execution profile.");
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
      throw new Error("Choose replacement presets or None before removing this model.");
    }

    setDeletingPreset(null);
    await refresh(mutationHttp);
  };

  const candidatePresets = deletingPreset
    ? presets.filter((preset) => preset.preset_key !== deletingPreset.preset.preset_key)
    : [];

  return (
    <section className="grid gap-4" data-testid="admin-http-models">
      <ExecutionProfilesCard
        loading={loading}
        refreshing={refreshing}
        savingAssignments={savingAssignments}
        executionProfilesErrorMessage={executionProfilesErrorMessage}
        canMutate={canMutate}
        assignmentChanged={assignmentChanged}
        presets={presets}
        assignmentDraft={assignmentDraft}
        onAssignmentChange={(profileId, presetKey) => {
          setAssignmentDraft((current) => ({
            ...current,
            [profileId]: presetKey,
          }));
        }}
        onRefresh={() => {
          void refresh(readHttp);
        }}
        onSaveAssignments={() => {
          void saveAssignments();
        }}
        requestEnter={requestEnter}
      />

      <ConfiguredModelsCard
        availableModelsErrorMessage={availableModelsErrorMessage}
        availableModels={availableModels}
        presets={presets}
        canMutate={canMutate}
        onAdd={() => {
          setEditingPreset(null);
          setDialogOpen(true);
        }}
        onEdit={(preset) => {
          setEditingPreset(preset);
          setDialogOpen(true);
        }}
        onRemove={(preset) => {
          setDeletingPreset({
            preset,
            requiredExecutionProfileIds: assignments
              .filter((assignment) => assignment.preset_key === preset.preset_key)
              .map((assignment) => assignment.execution_profile_id),
            replacementAssignments: {},
          });
        }}
        requestEnter={requestEnter}
      />

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
        onSaved={async () => {
          await refresh(mutationHttp);
        }}
        canMutate={canMutate}
        api={mutationHttp.modelConfig}
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
