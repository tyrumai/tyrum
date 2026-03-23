import * as React from "react";
import { cn } from "../../lib/cn.js";
import {
  createStructuredJsonDraft,
  createStructuredJsonDraftFromValue,
  serializeStructuredJsonDraft,
  structuredJsonValueSignature,
  type StructuredJsonDraft,
  type StructuredJsonDraftKind,
} from "../../utils/structured-json-draft.js";
import { Button } from "./button.js";
import { Label } from "./label.js";
import {
  ALL_STRUCTURED_JSON_DRAFT_KINDS,
  EmptyStructuredJsonFieldState,
  JsonDraftEditor,
} from "./structured-json-editor.js";
import {
  StructuredJsonSchemaField,
  type StructuredJsonObjectSchema,
} from "./structured-json-schema-field.js";

export type JsonEditorMode = "schema-form" | "tree";

export interface StructuredJsonFieldProps extends React.HTMLAttributes<HTMLDivElement> {
  label?: React.ReactNode;
  helperText?: React.ReactNode;
  error?: React.ReactNode;
  value: unknown | undefined;
  defaultRootKind?: StructuredJsonDraftKind;
  allowedRootKinds?: readonly StructuredJsonDraftKind[];
  allowUndefined?: boolean;
  readOnly?: boolean;
  schema?: StructuredJsonObjectSchema;
  onJsonChange?: (value: unknown | undefined, errorMessage: string | null) => void;
}

type StructuredJsonTreeFieldProps = Omit<StructuredJsonFieldProps, "schema">;

function StructuredJsonTreeField({
  label,
  helperText,
  error,
  value,
  defaultRootKind = "object",
  allowedRootKinds = ALL_STRUCTURED_JSON_DRAFT_KINDS,
  allowUndefined = true,
  readOnly = false,
  onJsonChange,
  className,
  ...props
}: StructuredJsonTreeFieldProps): React.ReactElement {
  const rootKinds = React.useMemo(
    () =>
      allowedRootKinds.length > 0
        ? allowedRootKinds
        : (ALL_STRUCTURED_JSON_DRAFT_KINDS as readonly StructuredJsonDraftKind[]),
    [allowedRootKinds],
  );
  const propSignature = React.useMemo(() => structuredJsonValueSignature(value), [value]);
  const [draft, setDraft] = React.useState<StructuredJsonDraft | null>(() =>
    value === undefined ? null : createStructuredJsonDraftFromValue(value, defaultRootKind),
  );
  const lastAppliedPropSignature = React.useRef(propSignature);

  React.useEffect(() => {
    if (propSignature === lastAppliedPropSignature.current) {
      return;
    }
    lastAppliedPropSignature.current = propSignature;
    setDraft(
      value === undefined ? null : createStructuredJsonDraftFromValue(value, defaultRootKind),
    );
  }, [defaultRootKind, propSignature, value]);

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
  const lastReportedSignature = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (parsedSignature === lastReportedSignature.current) {
      return;
    }
    lastReportedSignature.current = parsedSignature;
    onJsonChange?.(parsed.value, parsed.errorMessage);
  }, [onJsonChange, parsed.errorMessage, parsed.value, parsedSignature]);

  const message = parsed.errorMessage ?? error ?? helperText;

  return (
    <div className={cn("grid gap-1.5", className)} {...props}>
      {label ? <Label>{label}</Label> : null}
      <div className="grid gap-3 rounded-lg border border-border/70 bg-bg-card/40 p-3">
        {draft ? (
          <>
            {allowUndefined ? (
              !readOnly ? (
                <div className="flex justify-end">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setDraft(null);
                    }}
                  >
                    Clear value
                  </Button>
                </div>
              ) : null
            ) : null}
            <JsonDraftEditor
              allowedKinds={rootKinds}
              depth={0}
              draft={draft}
              pathLabel="Value"
              readOnly={readOnly}
              onChange={setDraft}
            />
          </>
        ) : (
          <EmptyStructuredJsonFieldState
            readOnly={readOnly}
            rootKinds={rootKinds}
            onAdd={(kind) => {
              setDraft(createStructuredJsonDraft(kind));
            }}
          />
        )}
      </div>
      {message ? (
        <div
          className={cn("text-sm", parsed.errorMessage || error ? "text-error" : "text-fg-muted")}
        >
          {message}
        </div>
      ) : null}
    </div>
  );
}

export function StructuredJsonField({
  schema,
  ...props
}: StructuredJsonFieldProps): React.ReactElement {
  const mode: JsonEditorMode = schema ? "schema-form" : "tree";

  if (schema && mode === "schema-form") {
    return <StructuredJsonSchemaField {...props} schema={schema} />;
  }

  return <StructuredJsonTreeField {...props} />;
}
