import * as React from "react";
import { cn } from "../../lib/cn.js";
import { structuredJsonValueSignature } from "../../utils/structured-json-draft.js";
import { Button } from "./button.js";
import { Label } from "./label.js";
import { SchemaObjectEditor } from "./structured-json-schema-field.composite.js";
import {
  helperTextForSchema,
  readSchemaObjectValue,
  type StructuredJsonObjectSchema,
} from "./structured-json-schema-field.shared.js";

export type {
  StructuredJsonObjectSchema,
  StructuredJsonSchema,
  StructuredJsonSchemaProperty,
} from "./structured-json-schema-field.shared.js";

export interface StructuredJsonSchemaFieldProps extends React.HTMLAttributes<HTMLDivElement> {
  label?: React.ReactNode;
  helperText?: React.ReactNode;
  error?: React.ReactNode;
  value: unknown | undefined;
  allowUndefined?: boolean;
  readOnly?: boolean;
  schema: StructuredJsonObjectSchema;
  onJsonChange?: (value: unknown | undefined, errorMessage: string | null) => void;
}

export function StructuredJsonSchemaField({
  label,
  helperText,
  error,
  value,
  allowUndefined = true,
  readOnly = false,
  schema,
  onJsonChange,
  className,
  ...props
}: StructuredJsonSchemaFieldProps): React.ReactElement {
  const propSignature = React.useMemo(() => structuredJsonValueSignature(value), [value]);
  const [schemaValue, setSchemaValue] = React.useState<Record<string, unknown> | undefined>(() =>
    readSchemaObjectValue(schema, value),
  );
  const [editorError, setEditorError] = React.useState<string | null>(null);
  const lastAppliedPropSignature = React.useRef(propSignature);
  const lastReportedSignature = React.useRef<string | null>(null);
  const pendingPropEchoSignature = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (propSignature === lastAppliedPropSignature.current) {
      return;
    }
    lastAppliedPropSignature.current = propSignature;
    if (propSignature === pendingPropEchoSignature.current) {
      pendingPropEchoSignature.current = null;
      return;
    }
    setSchemaValue(readSchemaObjectValue(schema, value));
    setEditorError(null);
  }, [propSignature, schema, value]);

  const normalizedValue = React.useMemo(() => {
    const nextValue = readSchemaObjectValue(schema, schemaValue);
    if (allowUndefined) {
      return nextValue;
    }
    return nextValue ?? {};
  }, [allowUndefined, schema, schemaValue]);

  const emittedValue = editorError ? undefined : normalizedValue;
  const emittedSignature = React.useMemo(
    () =>
      editorError === null
        ? `value:${structuredJsonValueSignature(emittedValue)}`
        : `error:${editorError}`,
    [editorError, emittedValue],
  );

  React.useEffect(() => {
    if (emittedSignature === lastReportedSignature.current) {
      return;
    }
    lastReportedSignature.current = emittedSignature;
    pendingPropEchoSignature.current = onJsonChange
      ? structuredJsonValueSignature(emittedValue)
      : null;
    onJsonChange?.(emittedValue, editorError);
  }, [editorError, emittedSignature, emittedValue, onJsonChange]);

  const message = editorError ?? error ?? helperTextForSchema(schema, helperText);

  return (
    <div className={cn("grid gap-1.5", className)} {...props}>
      {label ? <Label>{label}</Label> : null}
      <div className="grid gap-3 rounded-lg border border-border/70 bg-bg-card/40 p-3">
        {!readOnly && allowUndefined && normalizedValue !== undefined ? (
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setSchemaValue(undefined);
                setEditorError(null);
              }}
            >
              Clear value
            </Button>
          </div>
        ) : null}
        <SchemaObjectEditor
          fieldKey="root"
          forceExpanded
          label={typeof label === "string" && label.trim().length > 0 ? label : "Value"}
          readOnly={readOnly}
          required={!allowUndefined}
          schema={schema}
          showHeader={false}
          value={schemaValue}
          onChange={setSchemaValue}
          onErrorChange={setEditorError}
        />
      </div>
      {message ? (
        <div className={cn("text-sm", editorError || error ? "text-error" : "text-fg-muted")}>
          {message}
        </div>
      ) : null}
    </div>
  );
}
