import * as React from "react";
import {
  createStructuredJsonDraftFromValue,
  serializeStructuredJsonDraft,
  structuredJsonValueSignature,
  type StructuredJsonDraft,
} from "../../utils/structured-json-draft.js";
import { EmptyStructuredJsonFieldState, JsonDraftEditor } from "./structured-json-editor.js";
import { Button } from "./button.js";
import {
  createDefaultSchemaValue,
  firstError,
  isRecord,
  mergeKnownAndAdditionalValues,
  orderedSchemaKeys,
  reorderItems,
  splitSchemaObjectValue,
  type StructuredJsonObjectSchema,
  type StructuredJsonSchema,
  updateObjectValue,
} from "./structured-json-schema-field.shared.js";
import {
  SchemaBooleanField,
  SchemaNumberField,
  SchemaSectionFrame,
  SchemaStringField,
} from "./structured-json-schema-field.scalars.js";

export function SchemaNodeEditor({
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
  schema: StructuredJsonSchema;
  value: unknown;
  onChange: (value: unknown) => void;
  onErrorChange: (errorMessage: string | null) => void;
}) {
  if (schema.type === "object") {
    return (
      <SchemaObjectEditor
        fieldKey={fieldKey}
        label={label}
        readOnly={readOnly}
        required={required}
        schema={schema as StructuredJsonObjectSchema}
        value={isRecord(value) ? value : undefined}
        onChange={onChange}
        onErrorChange={onErrorChange}
      />
    );
  }

  if (schema.type === "array") {
    return (
      <SchemaArrayEditor
        fieldKey={fieldKey}
        label={label}
        readOnly={readOnly}
        required={required}
        schema={schema}
        value={Array.isArray(value) ? value : undefined}
        onChange={onChange}
        onErrorChange={onErrorChange}
      />
    );
  }

  if (schema.type === "string") {
    return (
      <SchemaStringField
        fieldKey={fieldKey}
        label={label}
        readOnly={readOnly}
        required={required}
        schema={schema}
        value={value}
        onChange={onChange}
        onErrorChange={onErrorChange}
      />
    );
  }

  if (schema.type === "boolean") {
    return (
      <SchemaBooleanField
        label={label}
        readOnly={readOnly}
        required={required}
        schema={schema}
        value={value}
        onChange={onChange}
        onErrorChange={onErrorChange}
      />
    );
  }

  return (
    <SchemaNumberField
      fieldKey={fieldKey}
      label={label}
      readOnly={readOnly}
      required={required}
      schema={schema}
      value={value}
      onChange={onChange}
      onErrorChange={onErrorChange}
    />
  );
}

export function SchemaObjectEditor({
  fieldKey,
  forceExpanded = false,
  label,
  readOnly,
  required,
  schema,
  showHeader = true,
  value,
  onChange,
  onErrorChange,
}: {
  fieldKey: string;
  forceExpanded?: boolean;
  label: string;
  readOnly: boolean;
  required: boolean;
  schema: StructuredJsonObjectSchema;
  showHeader?: boolean;
  value: Record<string, unknown> | undefined;
  onChange: (value: Record<string, unknown> | undefined) => void;
  onErrorChange: (errorMessage: string | null) => void;
}) {
  const [childErrors, setChildErrors] = React.useState<Record<string, string | null>>({});
  const [additionalError, setAdditionalError] = React.useState<string | null>(null);
  const objectValue = React.useMemo(() => (isRecord(value) ? value : undefined), [value]);
  const { additionalValues, knownValues } = React.useMemo(
    () =>
      splitSchemaObjectValue({
        schema,
        value: objectValue,
      }),
    [objectValue, schema],
  );
  const isExpanded = forceExpanded || required || objectValue !== undefined;
  const localError = firstError(childErrors) ?? additionalError;

  React.useEffect(() => {
    onErrorChange(isExpanded ? localError : null);
  }, [isExpanded, localError, onErrorChange]);

  if (!isExpanded) {
    return (
      <SchemaSectionFrame
        label={label}
        description={schema.description}
        readOnly={readOnly}
        onAdd={
          readOnly
            ? undefined
            : () => {
                onChange({});
              }
        }
      >
        <div className="text-sm text-fg-muted">No value set.</div>
      </SchemaSectionFrame>
    );
  }

  return (
    <div className="grid gap-3">
      {showHeader ? (
        <SchemaSectionFrame
          label={label}
          description={schema.description}
          readOnly={readOnly}
          onClear={
            !readOnly && !required
              ? () => {
                  onChange(undefined);
                  setChildErrors({});
                  setAdditionalError(null);
                }
              : undefined
          }
        />
      ) : null}

      <div className="grid gap-3">
        {orderedSchemaKeys(schema).map((key) => {
          const propertySchema = schema.properties[key]!;
          const propertyLabel = propertySchema.title ?? key;
          const propertyValue = knownValues?.[key];
          const propertyRequired = schema.required?.includes(key) ?? false;
          return (
            <SchemaNodeEditor
              key={key}
              fieldKey={`${fieldKey}-${key}`}
              label={propertyLabel}
              readOnly={readOnly}
              required={propertyRequired}
              schema={propertySchema}
              value={propertyValue}
              onChange={(nextValue) => {
                onChange(updateObjectValue(objectValue, key, nextValue));
              }}
              onErrorChange={(nextError) => {
                setChildErrors((current) =>
                  current[key] === nextError
                    ? current
                    : {
                        ...current,
                        [key]: nextError,
                      },
                );
              }}
            />
          );
        })}

        {schema.additionalProperties !== false ? (
          <SchemaAdditionalPropertiesEditor
            label="Additional fields"
            readOnly={readOnly}
            value={additionalValues}
            onChange={(nextAdditionalValues) => {
              onChange(
                mergeKnownAndAdditionalValues({
                  additionalValues: nextAdditionalValues,
                  knownValues,
                }),
              );
            }}
            onErrorChange={setAdditionalError}
          />
        ) : null}
      </div>
    </div>
  );
}

function SchemaArrayEditor({
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
  schema: Extract<StructuredJsonSchema, { type: "array" }>;
  value: unknown[] | undefined;
  onChange: (value: unknown[] | undefined) => void;
  onErrorChange: (errorMessage: string | null) => void;
}) {
  const [itemErrors, setItemErrors] = React.useState<Record<string, string | null>>({});
  const items = value ?? [];
  const itemSchema = schema.items;
  const itemLabelBase = itemSchema?.title ?? "Item";
  const arrayError =
    (required && items.length === 0 ? `${label} is required.` : null) ??
    (schema.minItems !== undefined && items.length < schema.minItems
      ? `${label} must contain at least ${String(schema.minItems)} item(s).`
      : null) ??
    (schema.maxItems !== undefined && items.length > schema.maxItems
      ? `${label} must contain at most ${String(schema.maxItems)} item(s).`
      : null) ??
    firstError(itemErrors);

  React.useEffect(() => {
    onErrorChange(arrayError);
  }, [arrayError, onErrorChange]);

  const pushItem = (): void => {
    onChange([...(value ?? []), createDefaultSchemaValue(itemSchema)]);
  };

  return (
    <SchemaSectionFrame
      label={label}
      description={schema.description}
      readOnly={readOnly}
      onAdd={!readOnly ? pushItem : undefined}
      addLabel={`Add ${itemLabelBase.toLowerCase()}`}
      onClear={
        !readOnly && !required && items.length > 0
          ? () => {
              onChange(undefined);
              setItemErrors({});
            }
          : undefined
      }
    >
      {items.length === 0 ? (
        <div className="text-sm text-fg-muted">No items yet.</div>
      ) : !itemSchema ? (
        <div className="text-sm text-fg-muted">Items schema unavailable.</div>
      ) : (
        <div className="grid gap-3">
          {items.map((itemValue, index) => {
            const itemKey = `${fieldKey}-${String(index)}`;
            return (
              <div
                key={itemKey}
                className="grid gap-2 rounded-md border border-border/70 bg-bg-subtle/50 px-3 py-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">
                    {`${itemLabelBase} ${String(index + 1)}`}
                  </div>
                  {!readOnly ? (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={index === 0}
                        onClick={() => {
                          onChange(reorderItems(items, index, index - 1));
                          setItemErrors({});
                        }}
                      >
                        Move up
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={index === items.length - 1}
                        onClick={() => {
                          onChange(reorderItems(items, index, index + 1));
                          setItemErrors({});
                        }}
                      >
                        Move down
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const nextItems = items.filter(
                            (_, candidateIndex) => candidateIndex !== index,
                          );
                          onChange(nextItems.length > 0 ? nextItems : undefined);
                          setItemErrors({});
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  ) : null}
                </div>
                <SchemaNodeEditor
                  fieldKey={itemKey}
                  label={`${itemLabelBase} ${String(index + 1)}`}
                  readOnly={readOnly}
                  required
                  schema={itemSchema}
                  value={itemValue}
                  onChange={(nextValue) => {
                    const nextItems = [...items];
                    nextItems[index] = nextValue;
                    onChange(nextItems);
                  }}
                  onErrorChange={(nextError) => {
                    setItemErrors((current) =>
                      current[itemKey] === nextError
                        ? current
                        : {
                            ...current,
                            [itemKey]: nextError,
                          },
                    );
                  }}
                />
              </div>
            );
          })}
        </div>
      )}
    </SchemaSectionFrame>
  );
}

function SchemaAdditionalPropertiesEditor({
  label,
  readOnly,
  value,
  onChange,
  onErrorChange,
}: {
  label: string;
  readOnly: boolean;
  value: Record<string, unknown> | undefined;
  onChange: (value: Record<string, unknown> | undefined) => void;
  onErrorChange: (errorMessage: string | null) => void;
}) {
  const propSignature = React.useMemo(() => structuredJsonValueSignature(value), [value]);
  const [draft, setDraft] = React.useState<StructuredJsonDraft | null>(() =>
    value === undefined ? null : createStructuredJsonDraftFromValue(value, "object"),
  );
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
    setDraft(value === undefined ? null : createStructuredJsonDraftFromValue(value, "object"));
  }, [propSignature, value]);

  const parsed = React.useMemo(
    () =>
      draft === null
        ? {
            value: undefined,
            errorMessage: null,
          }
        : serializeStructuredJsonDraft(draft),
    [draft],
  );
  const parsedSignature = React.useMemo(
    () =>
      parsed.errorMessage === null
        ? `value:${structuredJsonValueSignature(parsed.value)}`
        : `error:${parsed.errorMessage}`,
    [parsed.errorMessage, parsed.value],
  );

  React.useEffect(() => {
    if (parsedSignature === lastReportedSignature.current) {
      return;
    }
    lastReportedSignature.current = parsedSignature;
    pendingPropEchoSignature.current = structuredJsonValueSignature(
      isRecord(parsed.value) ? parsed.value : undefined,
    );
    onErrorChange(parsed.errorMessage);
    onChange(isRecord(parsed.value) ? parsed.value : undefined);
  }, [onChange, onErrorChange, parsed.errorMessage, parsed.value, parsedSignature]);

  return (
    <div className="grid gap-2 rounded-md border border-border/70 bg-bg px-3 py-3">
      <div className="text-sm font-medium text-fg">{label}</div>
      {draft ? (
        <JsonDraftEditor
          allowedKinds={["object"]}
          depth={0}
          draft={draft}
          pathLabel={label}
          readOnly={readOnly}
          onChange={setDraft}
        />
      ) : (
        <EmptyStructuredJsonFieldState
          readOnly={readOnly}
          rootKinds={["object"]}
          onAdd={() => {
            setDraft(createStructuredJsonDraftFromValue({}, "object"));
          }}
        />
      )}
    </div>
  );
}
