import * as React from "react";
import { Button } from "./button.js";
import { Input } from "./input.js";
import { Select } from "./select.js";
import type { StructuredJsonSchema } from "./structured-json-schema-field.shared.js";

export function SchemaSectionFrame({
  label,
  description,
  readOnly,
  addLabel = "Add value",
  children,
  onAdd,
  onClear,
}: {
  label: string;
  description?: string;
  readOnly: boolean;
  addLabel?: string;
  children?: React.ReactNode;
  onAdd?: () => void;
  onClear?: () => void;
}) {
  return (
    <div className="grid gap-3 rounded-md border border-border/70 bg-bg px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <div className="text-sm font-medium text-fg">{label}</div>
          {description ? <div className="text-sm text-fg-muted">{description}</div> : null}
        </div>
        {!readOnly ? (
          <div className="flex flex-wrap gap-2">
            {onAdd ? (
              <Button type="button" size="sm" variant="outline" onClick={onAdd}>
                {addLabel}
              </Button>
            ) : null}
            {onClear ? (
              <Button type="button" size="sm" variant="outline" onClick={onClear}>
                Clear
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function SchemaStringField({
  fieldKey,
  label,
  readOnly,
  required,
  schema,
  value,
  onChange,
  onErrorChange,
}: {
  fieldKey: string;
  label: string;
  readOnly: boolean;
  required: boolean;
  schema: Extract<StructuredJsonSchema, { type: "string" }>;
  value: unknown;
  onChange: (value: unknown) => void;
  onErrorChange: (errorMessage: string | null) => void;
}) {
  const [rawValue, setRawValue] = React.useState(typeof value === "string" ? value : "");

  React.useEffect(() => {
    setRawValue(typeof value === "string" ? value : "");
  }, [value]);

  const trimmed = rawValue.trim();
  const errorMessage =
    (required && trimmed.length === 0 ? `${label} is required.` : null) ??
    (schema.enum && trimmed.length > 0 && !schema.enum.includes(rawValue)
      ? `${label} must match one of the allowed values.`
      : null);

  React.useEffect(() => {
    onErrorChange(errorMessage);
  }, [errorMessage, onErrorChange]);

  if (schema.enum) {
    return (
      <Select
        label={label}
        required={required}
        disabled={readOnly}
        helperText={schema.description}
        value={trimmed.length > 0 ? rawValue : ""}
        onChange={(event) => {
          const nextValue = event.currentTarget.value;
          setRawValue(nextValue);
          onChange(nextValue.trim().length > 0 ? nextValue : undefined);
        }}
      >
        {!required ? <option value="">Unset</option> : null}
        {schema.enum.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </Select>
    );
  }

  return (
    <Input
      data-testid={`structured-json-schema-field-${fieldKey}`}
      label={label}
      required={required}
      readOnly={readOnly}
      helperText={schema.description}
      value={rawValue}
      onChange={(event) => {
        const nextValue = event.currentTarget.value;
        setRawValue(nextValue);
        onChange(nextValue.trim().length > 0 ? nextValue : undefined);
      }}
    />
  );
}

export function SchemaBooleanField({
  label,
  readOnly,
  required,
  schema,
  value,
  onChange,
  onErrorChange,
}: {
  label: string;
  readOnly: boolean;
  required: boolean;
  schema: Extract<StructuredJsonSchema, { type: "boolean" }>;
  value: unknown;
  onChange: (value: unknown) => void;
  onErrorChange: (errorMessage: string | null) => void;
}) {
  const currentValue =
    typeof value === "boolean" ? (value ? "true" : "false") : required ? "false" : "";

  React.useEffect(() => {
    onErrorChange(required && currentValue.length === 0 ? `${label} is required.` : null);
  }, [currentValue, label, onErrorChange, required]);

  return (
    <Select
      label={label}
      required={required}
      disabled={readOnly}
      helperText={schema.description}
      value={currentValue}
      onChange={(event) => {
        const nextValue = event.currentTarget.value;
        if (nextValue === "true") {
          onChange(true);
          return;
        }
        if (nextValue === "false") {
          onChange(false);
          return;
        }
        onChange(undefined);
      }}
    >
      {!required ? <option value="">Unset</option> : null}
      <option value="true">True</option>
      <option value="false">False</option>
    </Select>
  );
}

export function SchemaNumberField({
  fieldKey,
  label,
  readOnly,
  required,
  schema,
  value,
  onChange,
  onErrorChange,
}: {
  fieldKey: string;
  label: string;
  readOnly: boolean;
  required: boolean;
  schema: Extract<StructuredJsonSchema, { type: "integer" | "number" }>;
  value: unknown;
  onChange: (value: unknown) => void;
  onErrorChange: (errorMessage: string | null) => void;
}) {
  const [rawValue, setRawValue] = React.useState(typeof value === "number" ? String(value) : "");

  React.useEffect(() => {
    setRawValue(typeof value === "number" ? String(value) : "");
  }, [value]);

  const trimmed = rawValue.trim();
  const parsed = trimmed.length > 0 ? Number(trimmed) : NaN;
  const errorMessage =
    (trimmed.length === 0 && required ? `${label} is required.` : null) ??
    (trimmed.length > 0 && !Number.isFinite(parsed) ? `${label} must be a valid number.` : null) ??
    (schema.type === "integer" && trimmed.length > 0 && !Number.isInteger(parsed)
      ? `${label} must be an integer.`
      : null) ??
    (schema.minimum !== undefined && trimmed.length > 0 && parsed < schema.minimum
      ? `${label} must be at least ${String(schema.minimum)}.`
      : null) ??
    (schema.maximum !== undefined && trimmed.length > 0 && parsed > schema.maximum
      ? `${label} must be at most ${String(schema.maximum)}.`
      : null);

  React.useEffect(() => {
    onErrorChange(errorMessage);
  }, [errorMessage, onErrorChange]);

  return (
    <Input
      data-testid={`structured-json-schema-field-${fieldKey}`}
      label={label}
      required={required}
      readOnly={readOnly}
      type="number"
      step={schema.type === "integer" ? "1" : "any"}
      helperText={schema.description}
      value={rawValue}
      onChange={(event) => {
        const nextRawValue = event.currentTarget.value;
        setRawValue(nextRawValue);
        const nextTrimmed = nextRawValue.trim();
        if (nextTrimmed.length === 0) {
          onChange(undefined);
          return;
        }
        const nextParsed = Number(nextTrimmed);
        onChange(Number.isFinite(nextParsed) ? nextParsed : undefined);
      }}
    />
  );
}
