import { matchPersonaTonePreset, PERSONA_TONE_PRESETS } from "@tyrum/contracts";
import * as React from "react";
import { cn } from "../../lib/cn.js";
import { Textarea } from "../ui/textarea.js";

export function AgentToneField({
  disabled = false,
  helperText = "Start with a preset, then edit the instructions if you want.",
  required = false,
  testIdPrefix,
  value,
  onChange,
}: {
  disabled?: boolean;
  helperText?: React.ReactNode;
  required?: boolean;
  testIdPrefix?: string;
  value: string;
  onChange: (value: string) => void;
}): React.ReactElement {
  const activePreset = matchPersonaTonePreset(value);

  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <div className="text-sm font-medium text-fg">Tone presets</div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {PERSONA_TONE_PRESETS.map((preset) => {
            const selected = preset.key === activePreset?.key;
            return (
              <button
                key={preset.key}
                type="button"
                disabled={disabled}
                data-testid={testIdPrefix ? `${testIdPrefix}-tone-preset-${preset.key}` : undefined}
                data-selected={selected ? "true" : "false"}
                onClick={() => {
                  onChange(preset.instructions);
                }}
                className={cn(
                  "flex w-full items-start rounded-lg border px-3 py-3 text-left transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                  selected
                    ? "border-primary/40 bg-primary-dim/20 text-fg"
                    : "border-border bg-bg text-fg hover:bg-bg-subtle",
                )}
              >
                <div className="grid gap-1">
                  <div className="text-sm font-medium text-fg">{preset.label}</div>
                  <div className="text-xs leading-5 text-fg-muted">{preset.description}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
      <Textarea
        label="Tone instructions"
        required={required}
        rows={4}
        disabled={disabled}
        value={value}
        helperText={helperText}
        data-testid={testIdPrefix ? `${testIdPrefix}-tone-instructions` : undefined}
        onChange={(event) => {
          onChange(event.currentTarget.value);
        }}
      />
    </div>
  );
}
