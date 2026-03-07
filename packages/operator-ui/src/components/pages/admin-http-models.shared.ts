import type { AdminHttpClient } from "./admin-http-shared.js";

export const EXECUTION_PROFILE_IDS = [
  "interaction",
  "explorer_ro",
  "reviewer_ro",
  "planner",
  "jury",
  "executor_rw",
  "integrator",
] as const;

export type ExecutionProfileId = (typeof EXECUTION_PROFILE_IDS)[number];

export const EXECUTION_PROFILE_LABELS: Record<ExecutionProfileId, string> = {
  interaction: "Interaction",
  explorer_ro: "Explorer",
  reviewer_ro: "Reviewer",
  planner: "Planner",
  jury: "Jury",
  executor_rw: "Executor",
  integrator: "Integrator",
};

export const REASONING_OPTIONS = [
  { value: "", label: "Default" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
] as const;

export type ModelPreset = Awaited<
  ReturnType<AdminHttpClient["modelConfig"]["listPresets"]>
>["presets"][number];
export type AvailableModel = Awaited<
  ReturnType<AdminHttpClient["modelConfig"]["listAvailable"]>
>["models"][number];
export type Assignment = Awaited<
  ReturnType<AdminHttpClient["modelConfig"]["listAssignments"]>
>["assignments"][number];
export type ModelConfigHttpClient = Pick<AdminHttpClient, "modelConfig">;

export type ModelDialogState = {
  displayName: string;
  modelRef: string;
  reasoningEffort: "" | "low" | "medium" | "high";
};

export type DeletePresetDialogState = {
  preset: ModelPreset;
  requiredExecutionProfileIds: string[];
  replacementAssignments: Record<string, string>;
} | null;

export function emptyDialogState(): ModelDialogState {
  return {
    displayName: "",
    modelRef: "",
    reasoningEffort: "",
  };
}

export function modelRefFor(availableModel: AvailableModel): string {
  return `${availableModel.provider_key}/${availableModel.model_id}`;
}

export function splitModelRef(
  modelRef: string,
): { providerKey: string; modelId: string } | null {
  const slashIndex = modelRef.indexOf("/");
  if (slashIndex <= 0 || slashIndex === modelRef.length - 1) return null;
  return {
    providerKey: modelRef.slice(0, slashIndex),
    modelId: modelRef.slice(slashIndex + 1),
  };
}

export function normalizeDialogState(input: {
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

export function presetWarning(
  preset: ModelPreset,
  availableModels: AvailableModel[],
): string | null {
  const exists = availableModels.some(
    (model) => model.provider_key === preset.provider_key && model.model_id === preset.model_id,
  );
  return exists ? null : "Provider is not currently configured for this preset.";
}
