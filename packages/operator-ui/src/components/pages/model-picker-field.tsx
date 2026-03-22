import * as React from "react";
import { cn } from "../../lib/cn.js";
import { Badge } from "../ui/badge.js";
import { Label } from "../ui/label.js";
import { ScrollArea } from "../ui/scroll-area.js";
import { modelRefFor, type AvailableModel } from "./admin-http-models.shared.js";

const MODEL_PICKER_VISIBLE_COUNT = 5;
const MODEL_PICKER_ROW_REM = 4.25;

function modelOptionTestId(model: AvailableModel): string {
  return `models-model-option-${modelRefFor(model)}`;
}

export function ModelPickerField({
  filteredModels,
  filterInputRef,
  modelFilter,
  onModelFilterChange,
  onSelectModel,
  selectedModelRef,
}: {
  filteredModels: readonly AvailableModel[];
  filterInputRef?: React.Ref<HTMLInputElement>;
  modelFilter: string;
  onModelFilterChange: (value: string) => void;
  onSelectModel: (modelRef: string) => void;
  selectedModelRef: string;
}): React.ReactElement {
  const modelFilterId = React.useId();
  const pickerHeightRem =
    Math.min(Math.max(filteredModels.length, 1), MODEL_PICKER_VISIBLE_COUNT) * MODEL_PICKER_ROW_REM;

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={modelFilterId} required>
        Model
      </Label>
      <div className="overflow-hidden rounded-lg border border-border bg-bg-card/40">
        <div className="border-b border-border/70 p-2">
          <input
            ref={filterInputRef}
            id={modelFilterId}
            type="text"
            value={modelFilter}
            data-testid="models-filter-input"
            aria-label="Filter models"
            placeholder="Filter models by provider, model, or family"
            onChange={(event) => {
              onModelFilterChange(event.currentTarget.value);
            }}
            className={cn(
              "box-border flex h-8 w-full rounded-md border border-border bg-bg px-2.5 py-1 text-sm text-fg transition-[border-color,box-shadow] duration-150",
              "placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-0",
            )}
          />
        </div>
        <ScrollArea
          className="w-full"
          data-testid="models-model-picker"
          style={{ height: `${pickerHeightRem}rem` }}
        >
          <div className="grid gap-1 p-2" role="radiogroup" aria-label="Model">
            {filteredModels.length > 0 ? (
              filteredModels.map((model) => {
                const modelRef = modelRefFor(model);
                const active = modelRef === selectedModelRef;

                return (
                  <button
                    key={modelRef}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    data-testid={modelOptionTestId(model)}
                    className={cn(
                      "flex w-full items-start justify-between gap-3 rounded-md border px-3 py-2.5 text-left transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-0",
                      active
                        ? "border-primary bg-bg text-fg"
                        : "border-border bg-bg hover:bg-bg-subtle",
                    )}
                    onClick={() => {
                      onSelectModel(modelRef);
                    }}
                  >
                    <div className="grid min-w-0 gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-fg">{model.model_name}</span>
                        {model.family ? <Badge variant="outline">{model.family}</Badge> : null}
                      </div>
                      <span className="text-xs text-fg-muted">{model.provider_name}</span>
                      <span className="text-xs text-fg-muted [overflow-wrap:anywhere]">
                        {modelRef}
                      </span>
                    </div>
                    <div className="flex shrink-0 flex-wrap justify-end gap-1">
                      {model.reasoning === true ? <Badge variant="outline">Reasoning</Badge> : null}
                      {model.tool_call === true ? <Badge variant="outline">Tools</Badge> : null}
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-fg-muted">
                No models match this filter.
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
      <p className="text-sm text-fg-muted">
        Type to narrow the list. Up to five models stay visible before scrolling.
      </p>
    </div>
  );
}
