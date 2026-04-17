import * as React from "react";
import { useTranslateNode } from "../../i18n-helpers.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { Select } from "../ui/select.js";
import type { ToolRegistryEntry } from "./admin-http-policy-config-types.js";
import type { PolicyStringRow } from "./admin-http-policy-shared.js";
import { lifecycleBadgeVariant, visibilityBadgeVariant } from "./admin-http-tools.metadata.js";

type ToolRegistryAlias = ToolRegistryEntry["aliases"][number];

type ToolRuleResolution =
  | {
      kind: "matched";
      entry: ToolRegistryEntry;
      matchedAlias?: ToolRegistryAlias;
    }
  | {
      kind: "raw";
      isPattern: boolean;
    };

const CUSTOM_TOOL_RULE = "__custom__";

function toolRegistryAliases(entry: ToolRegistryEntry): readonly ToolRegistryAlias[] {
  return Array.isArray(entry.aliases) ? entry.aliases : [];
}

function toolRegistryLifecycle(entry: ToolRegistryEntry): ToolRegistryEntry["lifecycle"] | null {
  return entry.lifecycle === "canonical" ||
    entry.lifecycle === "alias" ||
    entry.lifecycle === "deprecated"
    ? entry.lifecycle
    : null;
}

function toolRegistryVisibility(entry: ToolRegistryEntry): ToolRegistryEntry["visibility"] | null {
  return entry.visibility === "public" ||
    entry.visibility === "internal" ||
    entry.visibility === "runtime_only"
    ? entry.visibility
    : null;
}

function buildToolRegistryLookup(
  toolRegistry: readonly ToolRegistryEntry[],
): Map<string, { entry: ToolRegistryEntry; matchedAlias?: ToolRegistryAlias }> {
  const lookup = new Map<string, { entry: ToolRegistryEntry; matchedAlias?: ToolRegistryAlias }>();

  for (const entry of toolRegistry) {
    const canonicalId = entry.canonical_id.trim();
    if (!canonicalId || lookup.has(canonicalId)) continue;
    lookup.set(canonicalId, { entry });
  }

  for (const entry of toolRegistry) {
    for (const alias of toolRegistryAliases(entry)) {
      const aliasId = alias.id.trim();
      if (!aliasId || lookup.has(aliasId)) continue;
      lookup.set(aliasId, { entry, matchedAlias: alias });
    }
  }

  return lookup;
}

function resolveToolRule(
  rawValue: string,
  lookup: Map<string, { entry: ToolRegistryEntry; matchedAlias?: ToolRegistryAlias }>,
): ToolRuleResolution | null {
  const normalized = rawValue.trim();
  if (!normalized) return null;

  const match = lookup.get(normalized);
  if (match) {
    return {
      kind: "matched",
      entry: match.entry,
      matchedAlias: match.matchedAlias,
    };
  }

  return {
    kind: "raw",
    isPattern: /[?*]/.test(normalized),
  };
}

function canonicalToolOptions(toolRegistry: readonly ToolRegistryEntry[]): ToolRegistryEntry[] {
  const seen = new Set<string>();
  const options: ToolRegistryEntry[] = [];

  for (const entry of toolRegistry) {
    const canonicalId = entry.canonical_id.trim();
    if (!canonicalId || seen.has(canonicalId)) continue;
    seen.add(canonicalId);
    options.push(entry);
  }

  return options.toSorted((left, right) => left.canonical_id.localeCompare(right.canonical_id));
}

function toolRuleSelectionValue(
  row: PolicyStringRow,
  lookup: Map<string, { entry: ToolRegistryEntry; matchedAlias?: ToolRegistryAlias }>,
): string {
  if (row.mode === "custom") {
    return CUSTOM_TOOL_RULE;
  }

  const normalized = row.value.trim();
  if (!normalized) return "";

  const match = lookup.get(normalized);
  if (match && !match.matchedAlias && match.entry.canonical_id === normalized) {
    return normalized;
  }

  return CUSTOM_TOOL_RULE;
}

function formatAliasLabel(alias: ToolRegistryAlias): string {
  return `${alias.id} (${alias.lifecycle})`;
}

function customRuleHelperText(value: string): string {
  return /[?*]/.test(value.trim())
    ? "Use this raw path only when you need a legacy wildcard or pattern rule."
    : "Use this raw path only for legacy aliases, wildcard families, or unmatched stored values.";
}

function customRuleError(selectionValue: string, value: string): string | undefined {
  return selectionValue === CUSTOM_TOOL_RULE && !value.trim() ? "Value is required." : undefined;
}

function ToolRuleMetadataPreview({
  rowValue,
  resolution,
  testId,
}: {
  rowValue: string;
  resolution: ToolRuleResolution | null;
  testId: string;
}): React.ReactElement | null {
  const translateNode = useTranslateNode();

  if (!resolution) return null;

  if (resolution.kind === "raw") {
    return (
      <div className="grid gap-2" data-testid={testId}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={resolution.isPattern ? "warning" : "outline"}>
            {translateNode(resolution.isPattern ? "Pattern rule" : "Stored rule")}
          </Badge>
          <span className="text-sm text-fg-muted">{translateNode("Raw rule preserved.")}</span>
        </div>
        <div className="font-mono text-sm text-fg">{rowValue}</div>
        <div className="text-sm text-fg-muted">
          {translateNode(
            resolution.isPattern
              ? "This wildcard or pattern row stays readable as stored and is not forced into a canonical match."
              : "This stored value does not have a canonical registry match.",
          )}
        </div>
      </div>
    );
  }

  const aliasLabel = resolution.matchedAlias ? formatAliasLabel(resolution.matchedAlias) : null;
  const aliases = toolRegistryAliases(resolution.entry);
  const lifecycle = toolRegistryLifecycle(resolution.entry);
  const visibility = toolRegistryVisibility(resolution.entry);
  const aliasList = aliases.length > 0 ? aliases.map(formatAliasLabel).join(", ") : null;

  return (
    <div className="grid gap-2" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{translateNode("Canonical ID")}</Badge>
        <span className="font-mono text-sm text-fg">{resolution.entry.canonical_id}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {lifecycle ? <Badge variant={lifecycleBadgeVariant(lifecycle)}>{lifecycle}</Badge> : null}
        {visibility ? (
          <Badge variant={visibilityBadgeVariant(visibility)}>{visibility}</Badge>
        ) : null}
        <Badge variant="outline">{resolution.entry.group ?? "—"}</Badge>
        <Badge variant="outline">{resolution.entry.tier ?? "—"}</Badge>
      </div>
      {aliasLabel ? (
        <div className="text-sm text-fg-muted">
          <span className="font-medium text-fg">{translateNode("Matched via:")}</span> {aliasLabel}
        </div>
      ) : null}
      {aliasList ? (
        <div className="text-sm text-fg-muted">
          <span className="font-medium text-fg">{translateNode("Aliases:")}</span> {aliasList}
        </div>
      ) : null}
    </div>
  );
}

function ToolRuleRowEditor(props: {
  title: string;
  row: PolicyStringRow;
  index: number;
  testIdPrefix: string;
  toolRegistryLookup: Map<string, { entry: ToolRegistryEntry; matchedAlias?: ToolRegistryAlias }>;
  toolOptions: readonly ToolRegistryEntry[];
  onChange: (nextRow: PolicyStringRow) => void;
  onRemove: (id: string) => void;
}): React.ReactElement {
  const selectionValue = toolRuleSelectionValue(props.row, props.toolRegistryLookup);
  const resolution = resolveToolRule(props.row.value, props.toolRegistryLookup);
  const isCustomSelection = selectionValue === CUSTOM_TOOL_RULE;

  return (
    <div className="grid gap-3 rounded-lg border border-border/60 p-3">
      <div className="grid gap-2 md:grid-cols-[1fr_auto]">
        <div className="grid gap-2">
          <Select
            label={`${props.title} entry ${props.index + 1}`}
            helperText="Select a canonical tool. Use custom only for legacy aliases, wildcard families, or unmatched stored values."
            data-testid={`${props.testIdPrefix}-select-${props.index}`}
            value={selectionValue}
            onChange={(event) => {
              const nextValue = event.currentTarget.value;
              if (nextValue === CUSTOM_TOOL_RULE) {
                props.onChange({
                  ...props.row,
                  mode: "custom",
                });
                return;
              }
              props.onChange({
                ...props.row,
                value: nextValue,
                mode: undefined,
              });
            }}
          >
            <option value="">Select canonical tool</option>
            {props.toolOptions.map((tool) => (
              <option key={tool.canonical_id} value={tool.canonical_id}>
                {tool.canonical_id}
              </option>
            ))}
            <option value={CUSTOM_TOOL_RULE}>Custom or legacy rule</option>
          </Select>
          {isCustomSelection ? (
            <Input
              label="Custom rule"
              helperText={customRuleHelperText(props.row.value)}
              error={customRuleError(selectionValue, props.row.value)}
              data-testid={`${props.testIdPrefix}-row-${props.index}`}
              value={props.row.value}
              onChange={(event) =>
                props.onChange({
                  ...props.row,
                  value: event.currentTarget.value,
                  mode: "custom",
                })
              }
            />
          ) : null}
        </div>
        <div className="flex items-end">
          <Button
            variant="ghost"
            data-testid={`${props.testIdPrefix}-remove-${props.index}`}
            onClick={() => props.onRemove(props.row.id)}
          >
            Remove
          </Button>
        </div>
      </div>
      <ToolRuleMetadataPreview
        rowValue={props.row.value}
        resolution={resolution}
        testId={`${props.testIdPrefix}-metadata-${props.index}`}
      />
    </div>
  );
}

export function ToolRuleListEditor(props: {
  title: string;
  description: string;
  rows: PolicyStringRow[];
  addLabel: string;
  testIdPrefix: string;
  toolRegistry: readonly ToolRegistryEntry[];
  onAdd: () => void;
  onChange: (nextRow: PolicyStringRow) => void;
  onRemove: (id: string) => void;
}): React.ReactElement {
  const translateNode = useTranslateNode();
  const toolRegistryLookup = React.useMemo(
    () => buildToolRegistryLookup(props.toolRegistry),
    [props.toolRegistry],
  );
  const toolOptions = React.useMemo(
    () => canonicalToolOptions(props.toolRegistry),
    [props.toolRegistry],
  );

  return (
    <div className="grid gap-3 rounded-lg border border-border p-4">
      <div className="grid gap-0.5">
        <div className="text-sm font-medium text-fg">{translateNode(props.title)}</div>
        <div className="text-sm text-fg-muted">{translateNode(props.description)}</div>
      </div>
      {props.rows.length === 0 ? (
        <Alert
          variant="info"
          title="No entries yet"
          description="Select a canonical tool or add a custom legacy or wildcard rule."
        />
      ) : null}
      {props.rows.map((row, index) => (
        <ToolRuleRowEditor
          key={row.id}
          title={props.title}
          row={row}
          index={index}
          testIdPrefix={props.testIdPrefix}
          toolRegistryLookup={toolRegistryLookup}
          toolOptions={toolOptions}
          onChange={props.onChange}
          onRemove={props.onRemove}
        />
      ))}
      <div>
        <Button variant="secondary" data-testid={`${props.testIdPrefix}-add`} onClick={props.onAdd}>
          {props.addLabel}
        </Button>
      </div>
    </div>
  );
}
