import * as React from "react";
import { cn } from "../../lib/cn.js";
import {
  createStructuredJsonArrayItem,
  createStructuredJsonDraft,
  createStructuredJsonObjectEntry,
  type StructuredJsonDraft,
  type StructuredJsonDraftArrayItem,
  type StructuredJsonDraftKind,
  type StructuredJsonDraftObjectEntry,
} from "../../utils/structured-json-draft.js";
import { Button } from "./button.js";
import { Input } from "./input.js";
import { Select } from "./select.js";
import { Textarea } from "./textarea.js";

export const ALL_STRUCTURED_JSON_DRAFT_KINDS = [
  "object",
  "array",
  "string",
  "number",
  "boolean",
  "null",
] as const satisfies readonly StructuredJsonDraftKind[];

const KIND_LABELS: Record<StructuredJsonDraftKind, string> = {
  object: "Object",
  array: "List",
  string: "Text",
  number: "Number",
  boolean: "True / False",
  null: "Null",
};

export type JsonDraftEditorProps = {
  allowedKinds: readonly StructuredJsonDraftKind[];
  depth: number;
  draft: StructuredJsonDraft;
  pathLabel: string;
  readOnly: boolean;
  onChange: (draft: StructuredJsonDraft) => void;
};

export function EmptyStructuredJsonFieldState({
  readOnly,
  rootKinds,
  onAdd,
}: {
  readOnly: boolean;
  rootKinds: readonly StructuredJsonDraftKind[];
  onAdd: (kind: StructuredJsonDraftKind) => void;
}) {
  return (
    <div className="grid gap-3">
      <div className="text-sm text-fg-muted">No value set. Start with a structured value.</div>
      {!readOnly ? (
        <div className="flex flex-wrap gap-2">
          {rootKinds.map((kind) => (
            <Button
              key={kind}
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                onAdd(kind);
              }}
            >
              {`Add ${KIND_LABELS[kind].toLowerCase()}`}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function JsonDraftEditor({
  allowedKinds,
  depth,
  draft,
  pathLabel,
  readOnly,
  onChange,
}: JsonDraftEditorProps): React.ReactElement {
  if (draft.kind === "object") {
    return (
      <JsonNodeFrame
        allowedKinds={allowedKinds}
        depth={depth}
        kind={draft.kind}
        pathLabel={pathLabel}
        readOnly={readOnly}
        onKindChange={(kind) => {
          onChange(createStructuredJsonDraft(kind));
        }}
        actions={
          !readOnly ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                onChange({
                  kind: "object",
                  entries: [
                    ...draft.entries,
                    createStructuredJsonObjectEntry(nextObjectFieldKey(draft.entries)),
                  ],
                });
              }}
            >
              Add field
            </Button>
          ) : undefined
        }
      >
        {draft.entries.length === 0 ? (
          <div className="text-sm text-fg-muted">No fields yet.</div>
        ) : (
          <div className="grid gap-3">
            {draft.entries.map((entry, index) => (
              <ObjectEntryEditor
                key={entry.id}
                depth={depth + 1}
                entry={entry}
                index={index}
                readOnly={readOnly}
                onChange={(nextEntry) => {
                  onChange({
                    kind: "object",
                    entries: replaceObjectEntry(draft.entries, entry.id, nextEntry),
                  });
                }}
                onRemove={() => {
                  onChange({
                    kind: "object",
                    entries: draft.entries.filter((candidate) => candidate.id !== entry.id),
                  });
                }}
              />
            ))}
          </div>
        )}
      </JsonNodeFrame>
    );
  }

  if (draft.kind === "array") {
    return (
      <JsonNodeFrame
        allowedKinds={allowedKinds}
        depth={depth}
        kind={draft.kind}
        pathLabel={pathLabel}
        readOnly={readOnly}
        onKindChange={(kind) => {
          onChange(createStructuredJsonDraft(kind));
        }}
        actions={
          !readOnly ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                onChange({
                  kind: "array",
                  items: [...draft.items, createStructuredJsonArrayItem()],
                });
              }}
            >
              Add item
            </Button>
          ) : undefined
        }
      >
        {draft.items.length === 0 ? (
          <div className="text-sm text-fg-muted">No items yet.</div>
        ) : (
          <div className="grid gap-3">
            {draft.items.map((item, index) => (
              <ArrayItemEditor
                key={item.id}
                depth={depth + 1}
                index={index}
                item={item}
                readOnly={readOnly}
                onChange={(nextItem) => {
                  onChange({
                    kind: "array",
                    items: replaceArrayItem(draft.items, item.id, nextItem),
                  });
                }}
                onRemove={() => {
                  onChange({
                    kind: "array",
                    items: draft.items.filter((candidate) => candidate.id !== item.id),
                  });
                }}
              />
            ))}
          </div>
        )}
      </JsonNodeFrame>
    );
  }

  return (
    <JsonNodeFrame
      allowedKinds={allowedKinds}
      depth={depth}
      kind={draft.kind}
      pathLabel={pathLabel}
      readOnly={readOnly}
      onKindChange={(kind) => {
        onChange(createStructuredJsonDraft(kind));
      }}
    >
      <ScalarDraftEditor
        draft={draft}
        pathLabel={pathLabel}
        readOnly={readOnly}
        onChange={onChange}
      />
    </JsonNodeFrame>
  );
}

function JsonNodeFrame({
  allowedKinds,
  depth,
  kind,
  pathLabel,
  readOnly,
  actions,
  children,
  onKindChange,
}: {
  allowedKinds: readonly StructuredJsonDraftKind[];
  depth: number;
  kind: StructuredJsonDraftKind;
  pathLabel: string;
  readOnly: boolean;
  actions?: React.ReactNode;
  children: React.ReactNode;
  onKindChange: (kind: StructuredJsonDraftKind) => void;
}) {
  return (
    <div
      className={cn(
        "grid gap-3 rounded-lg border border-border/70 bg-bg px-3 py-3",
        depth > 0 ? "ml-4" : null,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">{pathLabel}</div>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          <Select
            bare
            aria-label={`${pathLabel} type`}
            className="w-auto min-w-[9rem]"
            disabled={readOnly}
            value={kind}
            onChange={(event) => {
              onKindChange(event.currentTarget.value as StructuredJsonDraftKind);
            }}
          >
            {allowedKinds.map((allowedKind) => (
              <option key={allowedKind} value={allowedKind}>
                {KIND_LABELS[allowedKind]}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {children}
    </div>
  );
}

function ObjectEntryEditor({
  depth,
  entry,
  index,
  readOnly,
  onChange,
  onRemove,
}: {
  depth: number;
  entry: StructuredJsonDraftObjectEntry;
  index: number;
  readOnly: boolean;
  onChange: (entry: StructuredJsonDraftObjectEntry) => void;
  onRemove: () => void;
}) {
  const pathLabel = entry.key.trim() || `Field ${String(index + 1)}`;

  return (
    <div className="grid gap-2 rounded-md border border-border/70 bg-bg-subtle/50 px-3 py-3">
      <div className="flex flex-wrap items-start gap-2">
        <Input
          aria-label={`${pathLabel} key`}
          className="min-w-[14rem] flex-1"
          placeholder="field_name"
          readOnly={readOnly}
          value={entry.key}
          onChange={(event) => {
            onChange({
              ...entry,
              key: event.currentTarget.value,
            });
          }}
        />
        {!readOnly ? (
          <Button type="button" size="sm" variant="outline" onClick={onRemove}>
            Remove
          </Button>
        ) : null}
      </div>
      <JsonDraftEditor
        allowedKinds={ALL_STRUCTURED_JSON_DRAFT_KINDS}
        depth={depth}
        draft={entry.value}
        pathLabel={pathLabel}
        readOnly={readOnly}
        onChange={(value) => {
          onChange({
            ...entry,
            value,
          });
        }}
      />
    </div>
  );
}

function ArrayItemEditor({
  depth,
  index,
  item,
  readOnly,
  onChange,
  onRemove,
}: {
  depth: number;
  index: number;
  item: StructuredJsonDraftArrayItem;
  readOnly: boolean;
  onChange: (item: StructuredJsonDraftArrayItem) => void;
  onRemove: () => void;
}) {
  const pathLabel = `Item ${String(index + 1)}`;

  return (
    <div className="grid gap-2 rounded-md border border-border/70 bg-bg-subtle/50 px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium text-fg">{pathLabel}</div>
        {!readOnly ? (
          <Button type="button" size="sm" variant="outline" onClick={onRemove}>
            Remove
          </Button>
        ) : null}
      </div>
      <JsonDraftEditor
        allowedKinds={ALL_STRUCTURED_JSON_DRAFT_KINDS}
        depth={depth}
        draft={item.value}
        pathLabel={pathLabel}
        readOnly={readOnly}
        onChange={(value) => {
          onChange({
            ...item,
            value,
          });
        }}
      />
    </div>
  );
}

function ScalarDraftEditor({
  draft,
  pathLabel,
  readOnly,
  onChange,
}: {
  draft: Extract<StructuredJsonDraft, { kind: "boolean" | "null" | "number" | "string" }>;
  pathLabel: string;
  readOnly: boolean;
  onChange: (draft: StructuredJsonDraft) => void;
}) {
  if (draft.kind === "string") {
    return (
      <Textarea
        aria-label={`${pathLabel} value`}
        readOnly={readOnly}
        rows={3}
        value={draft.value}
        onChange={(event) => {
          onChange({
            kind: "string",
            value: event.currentTarget.value,
          });
        }}
      />
    );
  }

  if (draft.kind === "number") {
    return (
      <Input
        aria-label={`${pathLabel} value`}
        readOnly={readOnly}
        type="number"
        step="any"
        value={draft.value}
        onChange={(event) => {
          onChange({
            kind: "number",
            value: event.currentTarget.value,
          });
        }}
      />
    );
  }

  if (draft.kind === "boolean") {
    return (
      <Select
        bare
        aria-label={`${pathLabel} value`}
        className="w-full sm:w-auto"
        disabled={readOnly}
        value={draft.value ? "true" : "false"}
        onChange={(event) => {
          onChange({
            kind: "boolean",
            value: event.currentTarget.value === "true",
          });
        }}
      >
        <option value="true">True</option>
        <option value="false">False</option>
      </Select>
    );
  }

  return <div className="text-sm text-fg-muted">This value will be saved as null.</div>;
}

function nextObjectFieldKey(entries: readonly StructuredJsonDraftObjectEntry[]): string {
  const existing = new Set(entries.map((entry) => entry.key.trim()).filter(Boolean));
  let index = entries.length + 1;
  while (existing.has(`field_${String(index)}`)) {
    index += 1;
  }
  return `field_${String(index)}`;
}

function replaceObjectEntry(
  entries: readonly StructuredJsonDraftObjectEntry[],
  entryId: string,
  nextEntry: StructuredJsonDraftObjectEntry,
): StructuredJsonDraftObjectEntry[] {
  return entries.map((entry) => (entry.id === entryId ? nextEntry : entry));
}

function replaceArrayItem(
  items: readonly StructuredJsonDraftArrayItem[],
  itemId: string,
  nextItem: StructuredJsonDraftArrayItem,
): StructuredJsonDraftArrayItem[] {
  return items.map((item) => (item.id === itemId ? nextItem : item));
}
