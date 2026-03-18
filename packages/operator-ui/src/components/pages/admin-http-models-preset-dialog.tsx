import * as React from "react";
import { toast } from "sonner";
import { formatErrorMessage } from "../../utils/format-error-message.js";
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
import { Select } from "../ui/select.js";
import {
  emptyDialogState,
  filterAvailableModels,
  modelRefFor,
  normalizeDialogState,
  reconcileModelDialogState,
  REASONING_OPTIONS,
  REASONING_VISIBILITY_OPTIONS,
  selectModelDialogState,
  splitModelRef,
  type AvailableModel,
  type ModelConfigHttpClient,
  type ModelDialogState,
  type ModelPreset,
} from "./admin-http-models.shared.js";
import { ModelPickerField } from "./model-picker-field.js";

export function ModelPresetDialog({
  open,
  onOpenChange,
  preset,
  availableModels,
  onSaved,
  canMutate,
  api,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preset: ModelPreset | null;
  availableModels: AvailableModel[];
  onSaved: () => Promise<void>;
  canMutate: boolean;
  api: ModelConfigHttpClient["modelConfig"];
}): React.ReactElement {
  const [state, setState] = React.useState<ModelDialogState>(emptyDialogState());
  const [modelFilter, setModelFilter] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const selectedModel = availableModels.find((model) => modelRefFor(model) === state.modelRef);
  const filteredAvailableModels = React.useMemo(
    () => filterAvailableModels(availableModels, modelFilter),
    [availableModels, modelFilter],
  );

  React.useEffect(() => {
    if (!open) return;
    setState(normalizeDialogState({ preset, availableModels }));
    setModelFilter("");
    setSaving(false);
  }, [availableModels, open, preset]);

  React.useEffect(() => {
    if (!open || preset) return;
    setState((current) =>
      reconcileModelDialogState({
        currentState: current,
        filteredModels: filteredAvailableModels,
        availableModels,
      }),
    );
  }, [availableModels, filteredAvailableModels, open, preset]);

  const applyModelSelection = React.useCallback(
    (modelRef: string) => {
      setState((current) =>
        selectModelDialogState({
          currentState: current,
          modelRef,
          availableModels,
        }),
      );
    },
    [availableModels],
  );

  const submit = async (): Promise<void> => {
    if (!canMutate) {
      throw new Error("Authorize admin access to configure models.");
    }
    if (!state.displayName.trim()) {
      toast.error("Unable to save", { description: "Display name is required." });
      return;
    }
    if (!preset && !selectedModel) {
      toast.error("Unable to save", { description: "Choose a model." });
      return;
    }

    setSaving(true);
    try {
      const options = {
        ...(state.reasoningEffort === "" ? {} : { reasoning_effort: state.reasoningEffort }),
        ...(state.reasoningVisibility === ""
          ? {}
          : { reasoning_visibility: state.reasoningVisibility }),
      };
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
      toast.error("Unable to save", { description: formatErrorMessage(error) });
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
            <ModelPickerField
              filteredModels={filteredAvailableModels}
              modelFilter={modelFilter}
              onModelFilterChange={setModelFilter}
              onSelectModel={applyModelSelection}
              selectedModelRef={state.modelRef}
            />
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

          <Select
            label="Reasoning display"
            value={state.reasoningVisibility}
            onChange={(event) => {
              setState((current) => ({
                ...current,
                reasoningVisibility: event.currentTarget
                  .value as ModelDialogState["reasoningVisibility"],
              }));
            }}
          >
            {REASONING_VISIBILITY_OPTIONS.map((option) => (
              <option key={option.value || "default"} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
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
