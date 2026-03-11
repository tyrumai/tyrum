import { ArrowDown, ArrowUp, ChevronDown, Plus, Trash2 } from "lucide-react";
import * as React from "react";
import type { AgentEditorSetField } from "./agents-page-editor-form.js";
import { joinList, splitList } from "./agents-page-editor-form.js";
import type { ModelPreset } from "./admin-http-models.shared.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { ScrollArea } from "../ui/scroll-area.js";
import { cn } from "../../lib/cn.js";

type LegacyPrimarySelection = {
  modelRef: string;
  optionsJson: string | null;
};

type AgentEditorModelFieldsProps = {
  model: string;
  variant: string;
  fallbacks: string;
  setField: AgentEditorSetField;
  presets: ModelPreset[];
  presetsLoading: boolean;
  presetsError: string | null;
  selectedPrimaryPreset: ModelPreset | null;
  legacyPrimarySelection: LegacyPrimarySelection | null;
  onSelectPrimaryPreset: (preset: ModelPreset) => void;
  onClearPrimaryModel: () => void;
};

type FallbackChoice = {
  modelRef: string;
  presetDisplayNames: string[];
  filterText: string;
};

function modelRefForPreset(preset: ModelPreset): string {
  return `${preset.provider_key}/${preset.model_id}`;
}

function formatReasoningEffort(preset: ModelPreset): string {
  return preset.options.reasoning_effort ?? "default";
}

function buildFallbackChoices(presets: ModelPreset[]): FallbackChoice[] {
  const grouped = new Map<string, Set<string>>();
  for (const preset of presets) {
    const modelRef = modelRefForPreset(preset);
    const displayNames = grouped.get(modelRef) ?? new Set<string>();
    displayNames.add(preset.display_name);
    grouped.set(modelRef, displayNames);
  }

  return [...grouped.entries()]
    .map(([modelRef, displayNames]) => {
      const sortedNames = [...displayNames].toSorted((left, right) => left.localeCompare(right));
      return {
        modelRef,
        presetDisplayNames: sortedNames,
        filterText: [modelRef, ...sortedNames].join(" ").toLowerCase(),
      };
    })
    .toSorted((left, right) => left.modelRef.localeCompare(right.modelRef));
}

function matchesQuery(value: string, query: string): boolean {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return true;
  return value.includes(trimmed);
}

function SelectionSummary({
  label,
  detail,
  badges,
}: {
  label: string;
  detail: string;
  badges?: React.ReactNode;
}) {
  return (
    <div className="grid gap-1 text-left">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-fg">{label}</span>
        {badges}
      </div>
      <span className="text-xs text-fg-muted">{detail}</span>
    </div>
  );
}

export function AgentEditorModelFields({
  model,
  variant,
  fallbacks,
  setField,
  presets,
  presetsLoading,
  presetsError,
  selectedPrimaryPreset,
  legacyPrimarySelection,
  onSelectPrimaryPreset,
  onClearPrimaryModel,
}: AgentEditorModelFieldsProps): React.ReactElement {
  const [primaryOpen, setPrimaryOpen] = React.useState(false);
  const [primaryFilter, setPrimaryFilter] = React.useState("");
  const [fallbackPickerOpen, setFallbackPickerOpen] = React.useState(false);
  const [fallbackFilter, setFallbackFilter] = React.useState("");

  const fallbackChoices = React.useMemo(() => buildFallbackChoices(presets), [presets]);
  const fallbackValues = React.useMemo(() => splitList(fallbacks), [fallbacks]);
  const fallbackChoicesByModelRef = React.useMemo(
    () => new Map(fallbackChoices.map((choice) => [choice.modelRef, choice])),
    [fallbackChoices],
  );
  const legacyFallbacks = React.useMemo(
    () =>
      fallbackValues.filter((modelRef) => {
        return !fallbackChoicesByModelRef.has(modelRef);
      }),
    [fallbackChoicesByModelRef, fallbackValues],
  );

  const filteredPrimaryPresets = React.useMemo(
    () =>
      presets.filter((preset) => {
        const searchable = [
          preset.display_name,
          preset.preset_key,
          modelRefForPreset(preset),
          formatReasoningEffort(preset),
        ]
          .join(" ")
          .toLowerCase();
        return matchesQuery(searchable, primaryFilter);
      }),
    [presets, primaryFilter],
  );
  const availableFallbackChoices = React.useMemo(
    () =>
      fallbackChoices.filter((choice) => {
        return (
          !fallbackValues.includes(choice.modelRef) &&
          matchesQuery(choice.filterText, fallbackFilter)
        );
      }),
    [fallbackChoices, fallbackFilter, fallbackValues],
  );

  const setFallbackValues = React.useCallback(
    (nextFallbacks: string[]) => {
      setField("fallbacks", joinList(nextFallbacks));
    },
    [setField],
  );

  const addFallback = React.useCallback(
    (modelRef: string) => {
      if (fallbackValues.includes(modelRef)) return;
      setFallbackValues([...fallbackValues, modelRef]);
      setFallbackFilter("");
      setFallbackPickerOpen(false);
    },
    [fallbackValues, setFallbackValues],
  );

  const moveFallback = React.useCallback(
    (index: number, direction: -1 | 1) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= fallbackValues.length) return;
      const nextFallbacks = [...fallbackValues];
      const [entry] = nextFallbacks.splice(index, 1);
      if (!entry) return;
      nextFallbacks.splice(nextIndex, 0, entry);
      setFallbackValues(nextFallbacks);
    },
    [fallbackValues, setFallbackValues],
  );

  const removeFallback = React.useCallback(
    (index: number) => {
      setFallbackValues(fallbackValues.filter((_value, currentIndex) => currentIndex !== index));
    },
    [fallbackValues, setFallbackValues],
  );

  const primarySummary = (() => {
    if (selectedPrimaryPreset) {
      return (
        <SelectionSummary
          label={selectedPrimaryPreset.display_name}
          detail={modelRefForPreset(selectedPrimaryPreset)}
          badges={
            <Badge variant="outline">
              Reasoning: {formatReasoningEffort(selectedPrimaryPreset)}
            </Badge>
          }
        />
      );
    }
    if (legacyPrimarySelection) {
      return (
        <SelectionSummary
          label={legacyPrimarySelection.modelRef}
          detail="Legacy model selection"
          badges={<Badge variant="warning">Legacy</Badge>}
        />
      );
    }
    return (
      <SelectionSummary
        label="No primary model selected"
        detail="Choose a configured model preset."
      />
    );
  })();

  return (
    <div className="grid gap-4">
      {presetsError ? (
        <Alert variant="warning" title="Configured models unavailable" description={presetsError} />
      ) : null}
      {legacyPrimarySelection ? (
        <Alert
          variant="warning"
          title="Current primary model is not a configured preset"
          description={
            legacyPrimarySelection.optionsJson
              ? "This legacy model selection and its options will be preserved until you choose a configured preset."
              : "This legacy model selection will be preserved until you choose a configured preset."
          }
        />
      ) : null}
      {legacyFallbacks.length > 0 ? (
        <Alert
          variant="warning"
          title="Some fallback models are legacy selections"
          description="Legacy fallback entries stay in the ordered chain until you remove them. New fallback entries can only come from configured models."
        />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="agents-editor-primary-model-toggle">Primary model</Label>
          <div className="grid gap-2 rounded-lg border border-border/70 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <button
                id="agents-editor-primary-model-toggle"
                type="button"
                data-testid="agents-editor-primary-model-toggle"
                aria-expanded={primaryOpen}
                disabled={presetsLoading || Boolean(presetsError)}
                className={cn(
                  "flex min-w-0 flex-1 items-start justify-between gap-3 rounded-lg border border-border bg-bg px-3 py-2 text-left transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-0",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                )}
                onClick={() => {
                  setPrimaryOpen((current) => !current);
                }}
              >
                <div className="min-w-0 flex-1">{primarySummary}</div>
                <ChevronDown
                  aria-hidden="true"
                  className={cn(
                    "mt-0.5 h-4 w-4 shrink-0 text-fg-muted",
                    primaryOpen ? "rotate-180" : null,
                  )}
                />
              </button>
              {model.trim().length > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-testid="agents-editor-primary-model-clear"
                  onClick={() => {
                    onClearPrimaryModel();
                    setPrimaryOpen(false);
                    setPrimaryFilter("");
                  }}
                >
                  Clear
                </Button>
              ) : null}
            </div>
            {presetsLoading ? (
              <div className="text-sm text-fg-muted">Loading configured models…</div>
            ) : primaryOpen ? (
              <div className="grid gap-2">
                <Input
                  data-testid="agents-editor-primary-model-filter"
                  label="Filter configured models"
                  placeholder="Search by preset name, key, or model"
                  value={primaryFilter}
                  disabled={Boolean(presetsError)}
                  onChange={(event) => {
                    setPrimaryFilter(event.currentTarget.value);
                  }}
                />
                <ScrollArea className="h-56 rounded-lg border border-border/70">
                  <div className="grid gap-2 p-2">
                    {filteredPrimaryPresets.length > 0 ? (
                      filteredPrimaryPresets.map((preset) => {
                        const selected = selectedPrimaryPreset?.preset_key === preset.preset_key;
                        return (
                          <button
                            key={preset.preset_key}
                            type="button"
                            data-testid={`agents-editor-primary-model-option-${preset.preset_key}`}
                            className={cn(
                              "grid gap-1 rounded-lg border px-3 py-2 text-left transition-colors",
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-0",
                              selected
                                ? "border-primary bg-primary-dim/15"
                                : "border-border bg-bg hover:bg-bg-subtle",
                            )}
                            onClick={() => {
                              onSelectPrimaryPreset(preset);
                              setPrimaryFilter("");
                              setPrimaryOpen(false);
                            }}
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium text-fg">
                                {preset.display_name}
                              </span>
                              <Badge variant="outline">{preset.preset_key}</Badge>
                              <Badge variant="outline">
                                Reasoning: {formatReasoningEffort(preset)}
                              </Badge>
                            </div>
                            <span className="text-xs text-fg-muted">
                              {modelRefForPreset(preset)}
                            </span>
                          </button>
                        );
                      })
                    ) : (
                      <div className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-fg-muted">
                        No configured models match this filter.
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </div>
            ) : null}
          </div>
        </div>

        <Input
          label="Variant"
          value={variant}
          onChange={(event) => {
            setField("variant", event.currentTarget.value);
          }}
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="agents-editor-fallbacks-toggle">Fallback models</Label>
        <div className="grid gap-3 rounded-lg border border-border/70 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-fg-muted">
              Ordered fallback chain. Entries persist as model IDs, so preset-specific options apply
              only to the primary model.
            </div>
            <Button
              id="agents-editor-fallbacks-toggle"
              type="button"
              variant="secondary"
              size="sm"
              data-testid="agents-editor-fallbacks-toggle"
              disabled={presetsLoading || Boolean(presetsError)}
              aria-expanded={fallbackPickerOpen}
              onClick={() => {
                setFallbackPickerOpen((current) => !current);
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              Add fallback
            </Button>
          </div>

          {fallbackPickerOpen ? (
            <div className="grid gap-2">
              <Input
                data-testid="agents-editor-fallbacks-filter"
                label="Filter configured fallback models"
                placeholder="Search by preset name or model"
                value={fallbackFilter}
                disabled={Boolean(presetsError)}
                onChange={(event) => {
                  setFallbackFilter(event.currentTarget.value);
                }}
              />
              <ScrollArea className="h-44 rounded-lg border border-border/70">
                <div className="grid gap-2 p-2">
                  {availableFallbackChoices.length > 0 ? (
                    availableFallbackChoices.map((choice) => (
                      <button
                        key={choice.modelRef}
                        type="button"
                        data-testid={`agents-editor-fallback-option-${choice.modelRef}`}
                        className={cn(
                          "grid gap-1 rounded-lg border border-border bg-bg px-3 py-2 text-left transition-colors hover:bg-bg-subtle",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-0",
                        )}
                        onClick={() => {
                          addFallback(choice.modelRef);
                        }}
                      >
                        <span className="text-sm font-medium text-fg">{choice.modelRef}</span>
                        <span className="text-xs text-fg-muted">
                          {choice.presetDisplayNames.length === 1
                            ? choice.presetDisplayNames[0]
                            : `Configured presets: ${choice.presetDisplayNames.join(", ")}`}
                        </span>
                      </button>
                    ))
                  ) : (
                    <div className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-fg-muted">
                      No configured fallback models match this filter.
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          ) : null}

          {fallbackValues.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-fg-muted">
              No fallback models configured.
            </div>
          ) : (
            <div className="grid gap-2">
              {fallbackValues.map((modelRef, index) => {
                const choice = fallbackChoicesByModelRef.get(modelRef);
                const legacy = !choice;
                return (
                  <div
                    key={`${modelRef}-${index}`}
                    className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-bg px-3 py-2"
                  >
                    <div className="grid gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-fg">{modelRef}</span>
                        <Badge variant={legacy ? "warning" : "outline"}>
                          {legacy ? "Legacy" : `Fallback ${index + 1}`}
                        </Badge>
                      </div>
                      <span className="text-xs text-fg-muted">
                        {choice
                          ? choice.presetDisplayNames.length === 1
                            ? choice.presetDisplayNames[0]
                            : `Configured presets: ${choice.presetDisplayNames.join(", ")}`
                          : "Legacy fallback preserved from the current agent configuration."}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={index === 0}
                        data-testid={`agents-editor-fallback-move-up-${index}`}
                        onClick={() => {
                          moveFallback(index, -1);
                        }}
                        title="Move up"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={index === fallbackValues.length - 1}
                        data-testid={`agents-editor-fallback-move-down-${index}`}
                        onClick={() => {
                          moveFallback(index, 1);
                        }}
                        title="Move down"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        data-testid={`agents-editor-fallback-remove-${index}`}
                        onClick={() => {
                          removeFallback(index);
                        }}
                        title="Remove fallback"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
