import * as React from "react";
import type { IntlShape } from "react-intl";
import { formatDateTimeString, translateString, useTranslateNode } from "../../i18n-helpers.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { Input } from "../ui/input.js";
import { Select } from "../ui/select.js";
import {
  createBlankStringRow,
  normalizeToolRows,
  type PolicyDecisionValue,
  type PolicyDomainFormState,
  type PolicyStringRow,
} from "./admin-http-policy-shared.js";
import type { ToolRegistryEntry } from "./admin-http-policy-config-types.js";

export function formatTimestamp(
  intl: IntlShape,
  value: string | null | undefined,
  fallback = "Not saved yet",
): string {
  return formatDateTimeString(intl, value, fallback);
}

export function sourceLabel(intl: IntlShape, source: string): string {
  if (source === "default") return translateString(intl, "Built-in default");
  if (source === "shared") return translateString(intl, "Saved deployment config");
  return source;
}

export function emptyStringMessage(value: string): string | undefined {
  return value.trim() ? undefined : "Value is required.";
}

export function SectionHeading(props: {
  title: string;
  description: string;
  testId?: string;
}): React.ReactElement {
  const translateNode = useTranslateNode();
  return (
    <div className="grid gap-0.5" data-testid={props.testId}>
      <div className="text-sm font-medium text-fg">{translateNode(props.title)}</div>
      <div className="text-sm text-fg-muted">{translateNode(props.description)}</div>
    </div>
  );
}

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

function buildToolRegistryLookup(
  toolRegistry: ToolRegistryEntry[],
): Map<string, { entry: ToolRegistryEntry; matchedAlias?: ToolRegistryAlias }> {
  const lookup = new Map<string, { entry: ToolRegistryEntry; matchedAlias?: ToolRegistryAlias }>();

  for (const entry of toolRegistry) {
    const canonicalId = entry.canonical_id.trim();
    if (!canonicalId || lookup.has(canonicalId)) continue;
    lookup.set(canonicalId, { entry });
  }

  for (const entry of toolRegistry) {
    for (const alias of entry.aliases) {
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

function visibilityBadgeVariant(
  visibility: ToolRegistryEntry["visibility"],
): "success" | "warning" | "danger" | "outline" {
  if (visibility === "public") return "success";
  if (visibility === "internal") return "warning";
  return "danger";
}

function lifecycleBadgeVariant(
  lifecycle: ToolRegistryEntry["lifecycle"],
): "success" | "warning" | "danger" | "outline" {
  if (lifecycle === "canonical") return "success";
  if (lifecycle === "alias") return "warning";
  return "danger";
}

function formatAliasLabel(alias: ToolRegistryAlias): string {
  return `${alias.id} (${alias.lifecycle})`;
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
            {resolution.isPattern ? "Pattern rule" : "Stored rule"}
          </Badge>
          <span className="text-sm text-fg-muted">{translateNode("Raw rule preserved.")}</span>
        </div>
        <div className="font-mono text-sm text-fg">{rowValue}</div>
        <div className="text-sm text-fg-muted">
          {resolution.isPattern
            ? "This wildcard or pattern row stays readable as stored and is not forced into a canonical match."
            : "This stored value does not have a canonical registry match."}
        </div>
      </div>
    );
  }

  const aliasLabel = resolution.matchedAlias ? formatAliasLabel(resolution.matchedAlias) : null;
  const aliasList =
    resolution.entry.aliases.length > 0
      ? resolution.entry.aliases.map(formatAliasLabel).join(", ")
      : null;

  return (
    <div className="grid gap-2" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{translateNode("Canonical ID")}</Badge>
        <span className="font-mono text-sm text-fg">{resolution.entry.canonical_id}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge variant={lifecycleBadgeVariant(resolution.entry.lifecycle)}>
          {resolution.entry.lifecycle}
        </Badge>
        <Badge variant={visibilityBadgeVariant(resolution.entry.visibility)}>
          {resolution.entry.visibility}
        </Badge>
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

function DecisionSelect(props: {
  label: string;
  value: PolicyDecisionValue;
  helperText: string;
  onChange: (next: PolicyDecisionValue) => void;
  testId?: string;
}): React.ReactElement {
  return (
    <Select
      label={props.label}
      helperText={props.helperText}
      value={props.value}
      data-testid={props.testId}
      onChange={(event) => {
        const next = event.currentTarget.value;
        if (next === "allow" || next === "require_approval" || next === "deny") {
          props.onChange(next);
        }
      }}
    >
      <option value="allow">Allow</option>
      <option value="require_approval">Require approval</option>
      <option value="deny">Deny</option>
    </Select>
  );
}

function StringListEditor(props: {
  title: string;
  description: string;
  rows: PolicyStringRow[];
  addLabel: string;
  testIdPrefix: string;
  helperText: string;
  onAdd: () => void;
  onChange: (id: string, value: string) => void;
  onRemove: (id: string) => void;
  renderMetadata?: (row: PolicyStringRow, index: number) => React.ReactElement | null;
}): React.ReactElement {
  return (
    <div className="grid gap-3 rounded-lg border border-border p-4">
      <SectionHeading title={props.title} description={props.description} />
      {props.rows.length === 0 ? (
        <Alert
          variant="info"
          title="No entries yet"
          description="Add a narrow match target or tool ID."
        />
      ) : null}
      {props.rows.map((row, index) => (
        <div key={row.id} className="grid gap-3 rounded-lg border border-border/60 p-3">
          <div className="grid gap-2 md:grid-cols-[1fr_auto]">
            <Input
              label={`${props.title} entry ${index + 1}`}
              helperText={props.helperText}
              error={emptyStringMessage(row.value)}
              data-testid={`${props.testIdPrefix}-row-${index}`}
              value={row.value}
              onChange={(event) => props.onChange(row.id, event.currentTarget.value)}
            />
            <div className="flex items-end">
              <Button
                variant="ghost"
                data-testid={`${props.testIdPrefix}-remove-${index}`}
                onClick={() => props.onRemove(row.id)}
              >
                Remove
              </Button>
            </div>
          </div>
          {props.renderMetadata ? props.renderMetadata(row, index) : null}
        </div>
      ))}
      <div>
        <Button variant="secondary" data-testid={`${props.testIdPrefix}-add`} onClick={props.onAdd}>
          {props.addLabel}
        </Button>
      </div>
    </div>
  );
}

export function DomainEditor(props: {
  title: string;
  description: string;
  state: PolicyDomainFormState;
  onChange: (next: PolicyDomainFormState) => void;
  toolMode?: boolean;
  showDefaultDecision?: boolean;
  testIdPrefix: string;
  toolRegistry?: ToolRegistryEntry[];
}): React.ReactElement {
  const toolRegistryLookup = React.useMemo(
    () => buildToolRegistryLookup(props.toolRegistry ?? []),
    [props.toolRegistry],
  );

  const updateRows = (
    key: "allow" | "requireApproval" | "deny",
    transform: (rows: PolicyStringRow[]) => PolicyStringRow[],
  ) => {
    const nextRows = transform(props.state[key]);
    props.onChange({
      ...props.state,
      [key]: props.toolMode ? normalizeToolRows(nextRows) : nextRows,
    });
  };

  const helperText = props.toolMode
    ? "Use a canonical tool ID. Legacy aliases and tool groups expand to their saved IDs."
    : "Use a narrow wildcard pattern. `*` matches many characters, `?` matches one.";

  const renderToolMetadata = props.toolMode
    ? (row: PolicyStringRow, index: number) => (
        <ToolRuleMetadataPreview
          key={row.id}
          rowValue={row.value}
          resolution={resolveToolRule(row.value, toolRegistryLookup)}
          testId={`${props.testIdPrefix}-metadata-${index}`}
        />
      )
    : undefined;

  return (
    <Card data-testid={props.testIdPrefix}>
      <CardHeader>
        <SectionHeading title={props.title} description={props.description} />
      </CardHeader>
      <CardContent className="grid gap-4">
        {props.showDefaultDecision !== false ? (
          <DecisionSelect
            label="Default decision"
            value={props.state.defaultDecision ?? "deny"}
            helperText="Applied when no more specific rule matches."
            testId={`${props.testIdPrefix}-default`}
            onChange={(next) => props.onChange({ ...props.state, defaultDecision: next })}
          />
        ) : null}
        <div className="grid gap-4 xl:grid-cols-3">
          <StringListEditor
            title="Allow"
            description="Always allow exact or narrow matches."
            rows={props.state.allow}
            addLabel="Add allow rule"
            helperText={helperText}
            testIdPrefix={`${props.testIdPrefix}-allow`}
            renderMetadata={renderToolMetadata}
            onAdd={() =>
              updateRows("allow", (rows) => [
                ...rows,
                createBlankStringRow(`${props.testIdPrefix}-allow`),
              ])
            }
            onChange={(id, value) =>
              updateRows("allow", (rows) =>
                rows.map((row) => (row.id === id ? { ...row, value } : row)),
              )
            }
            onRemove={(id) => updateRows("allow", (rows) => rows.filter((row) => row.id !== id))}
          />
          <StringListEditor
            title="Require approval"
            description="Pause and request operator approval for matching actions."
            rows={props.state.requireApproval}
            addLabel="Add approval rule"
            helperText={helperText}
            testIdPrefix={`${props.testIdPrefix}-approval`}
            renderMetadata={renderToolMetadata}
            onAdd={() =>
              updateRows("requireApproval", (rows) => [
                ...rows,
                createBlankStringRow(`${props.testIdPrefix}-approval`),
              ])
            }
            onChange={(id, value) =>
              updateRows("requireApproval", (rows) =>
                rows.map((row) => (row.id === id ? { ...row, value } : row)),
              )
            }
            onRemove={(id) =>
              updateRows("requireApproval", (rows) => rows.filter((row) => row.id !== id))
            }
          />
          <StringListEditor
            title="Deny"
            description="Block matching actions outright."
            rows={props.state.deny}
            addLabel="Add deny rule"
            helperText={helperText}
            testIdPrefix={`${props.testIdPrefix}-deny`}
            renderMetadata={renderToolMetadata}
            onAdd={() =>
              updateRows("deny", (rows) => [
                ...rows,
                createBlankStringRow(`${props.testIdPrefix}-deny`),
              ])
            }
            onChange={(id, value) =>
              updateRows("deny", (rows) =>
                rows.map((row) => (row.id === id ? { ...row, value } : row)),
              )
            }
            onRemove={(id) => updateRows("deny", (rows) => rows.filter((row) => row.id !== id))}
          />
        </div>
      </CardContent>
    </Card>
  );
}
