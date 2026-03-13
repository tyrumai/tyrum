import * as React from "react";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import { Alert } from "../ui/alert.js";
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
  modelRefFor,
  normalizeDialogState,
  REASONING_OPTIONS,
  REASONING_VISIBILITY_OPTIONS,
  splitModelRef,
  type AvailableModel,
  type ModelConfigHttpClient,
  type ModelDialogState,
  type ModelPreset,
} from "./admin-http-models.shared.js";

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
      throw new Error("Authorize admin access to configure models.");
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
