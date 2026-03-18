import type { ToolRegistryListResult } from "@tyrum/client";
import { ChevronDown, ChevronRight } from "lucide-react";
import * as React from "react";
import { cn } from "../../lib/cn.js";
import {
  buildStructuredToolSchema,
  type StructuredToolSchema,
  type StructuredToolSchemaRow,
} from "./admin-http-tools.schema.js";
import { Badge, type BadgeVariant } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { DataTable, type DataTableColumn } from "../ui/data-table.js";

export type ToolRegistryEntry = ToolRegistryListResult["tools"][number];
export type ToolGroupId = "built_in" | "extensions";

export const GROUP_LABELS: Record<ToolGroupId, string> = {
  built_in: "Built-in",
  extensions: "Extensions",
};

export const SOURCE_LABELS: Record<ToolRegistryEntry["source"], string> = {
  builtin: "Built-in",
  builtin_mcp: "Built-in MCP",
  mcp: "MCP",
  plugin: "Plugin",
};

export function effectBadgeVariant(effect: ToolRegistryEntry["effect"]): BadgeVariant {
  return effect === "state_changing" ? "warning" : "success";
}

export function exposureBadge(tool: ToolRegistryEntry): {
  label: string;
  variant: BadgeVariant;
} {
  if (!tool.effective_exposure.enabled) {
    if (tool.effective_exposure.reason === "disabled_by_state_mode") {
      return { label: "Blocked by state mode", variant: "warning" };
    }
    return { label: "Blocked by agent allowlist", variant: "warning" };
  }
  return { label: "Exposed", variant: "success" };
}

export function groupForTool(tool: ToolRegistryEntry): ToolGroupId {
  return tool.source === "mcp" || tool.source === "plugin" ? "extensions" : "built_in";
}

function DetailSection({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}): React.ReactElement | null {
  if (!value) return null;
  return (
    <div className="grid gap-1">
      <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">{label}</div>
      <div className="text-sm text-fg">{value}</div>
    </div>
  );
}

const SCHEMA_FIELD_COLUMNS: DataTableColumn<StructuredToolSchemaRow>[] = [
  {
    id: "field",
    header: "Field",
    cell: (row) => <span className="font-mono text-xs text-fg">{row.field}</span>,
    cellClassName: "py-2",
  },
  {
    id: "type",
    header: "Type",
    cell: (row) => <span className="text-fg">{row.type}</span>,
    cellClassName: "py-2",
  },
  {
    id: "required",
    header: "Required",
    cell: (row) => <span className="text-fg">{row.required ? "Yes" : "No"}</span>,
    cellClassName: "py-2",
  },
  {
    id: "description",
    header: "Description",
    cell: (row) => <span className="text-fg-muted">{row.description ?? "—"}</span>,
    cellClassName: "py-2",
  },
];

function StructuredSchemaDetails({
  schema,
}: {
  schema: StructuredToolSchema | null;
}): React.ReactElement | null {
  if (!schema) return null;

  return (
    <div className="grid gap-3">
      <div className="text-sm font-medium text-fg">Input fields</div>
      {schema.summary ? <div className="text-sm text-fg-muted">{schema.summary}</div> : null}
      {schema.sections.map((section) => (
        <div key={section.id} className="grid gap-2">
          <div className="flex items-center gap-2">
            <Badge variant="outline">{section.label}</Badge>
            {section.summary ? (
              <span className="text-xs text-fg-muted">{section.summary}</span>
            ) : null}
          </div>
          {section.rows.length > 0 ? (
            <DataTable<StructuredToolSchemaRow>
              columns={SCHEMA_FIELD_COLUMNS}
              data={section.rows}
              rowKey={(row) => `${section.id}:${row.field}`}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}

function ToolDetailPanel({ tool }: { tool: ToolRegistryEntry }): React.ReactElement {
  const schema = React.useMemo(
    () => buildStructuredToolSchema(tool.input_schema),
    [tool.input_schema],
  );

  return (
    <div className="grid gap-4 rounded-lg border border-border/80 bg-bg-subtle/40 p-4">
      <DetailSection label="Description" value={tool.description} />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <DetailSection label="Family" value={tool.family ?? "—"} />
        <DetailSection label="Source" value={SOURCE_LABELS[tool.source]} />
        <DetailSection
          label="Agent scope"
          value={tool.effective_exposure.agent_key ?? "Default agent scope"}
        />
        <DetailSection
          label="Keywords"
          value={
            tool.keywords && tool.keywords.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {tool.keywords.map((keyword) => (
                  <Badge key={keyword} variant="default">
                    {keyword}
                  </Badge>
                ))}
              </div>
            ) : (
              "—"
            )
          }
        />
      </div>

      {tool.backing_server ? (
        <DetailSection
          label="Backing server"
          value={`${tool.backing_server.name} (${tool.backing_server.id}) • ${tool.backing_server.transport}${
            tool.backing_server.url ? ` • ${tool.backing_server.url}` : ""
          }`}
        />
      ) : null}

      {tool.plugin ? (
        <DetailSection
          label="Plugin"
          value={`${tool.plugin.name} (${tool.plugin.id}@${tool.plugin.version})`}
        />
      ) : null}

      <StructuredSchemaDetails schema={schema} />
    </div>
  );
}

function DetailsToggle({
  expanded,
  toolId,
  onToggle,
}: {
  expanded: boolean;
  toolId: string;
  onToggle: () => void;
}): React.ReactElement {
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      aria-expanded={expanded}
      data-testid={`admin-http-tools-toggle-${toolId}`}
      onClick={onToggle}
    >
      {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      {expanded ? "Hide details" : "View details"}
    </Button>
  );
}

export function ToolTableSection({
  groupId,
  tools,
  expandedIds,
  onToggleExpanded,
}: {
  groupId: ToolGroupId;
  tools: ToolRegistryEntry[];
  expandedIds: ReadonlySet<string>;
  onToggleExpanded: (toolId: string) => void;
}): React.ReactElement {
  const toolGroupColumns: DataTableColumn<ToolRegistryEntry>[] = [
    {
      id: "tool",
      header: "Tool",
      cell: (tool) => (
        <div className="grid gap-1">
          <div className="font-mono text-sm text-fg">{tool.canonical_id}</div>
          <div className="max-w-3xl text-xs text-fg-muted">{tool.description}</div>
        </div>
      ),
    },
    {
      id: "source",
      header: "Source",
      cell: (tool) => <Badge variant="outline">{SOURCE_LABELS[tool.source]}</Badge>,
    },
    {
      id: "effect",
      header: "Effect",
      cell: (tool) => <Badge variant={effectBadgeVariant(tool.effect)}>{tool.effect}</Badge>,
    },
    {
      id: "exposure",
      header: "Exposure",
      cell: (tool) => {
        const exposure = exposureBadge(tool);
        return <Badge variant={exposure.variant}>{exposure.label}</Badge>;
      },
    },
    {
      id: "details",
      header: "Details",
      headerClassName: "text-right",
      cellClassName: "text-right",
      cell: (tool) => (
        <DetailsToggle
          expanded={expandedIds.has(tool.canonical_id)}
          toolId={tool.canonical_id}
          onToggle={() => {
            onToggleExpanded(tool.canonical_id);
          }}
        />
      ),
    },
  ];

  return (
    <section className="grid gap-3" data-testid={`admin-http-tools-group-${groupId}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-fg">{GROUP_LABELS[groupId]}</div>
        <Badge variant="outline">{tools.length}</Badge>
      </div>

      <DataTable<ToolRegistryEntry>
        className="hidden md:block"
        columns={toolGroupColumns}
        data={tools}
        rowKey={(tool) => `${groupId}:${tool.canonical_id}`}
        rowClassName="align-top"
        renderAfterRow={(tool) =>
          expandedIds.has(tool.canonical_id) ? (
            <tr
              className="border-t border-border"
              data-testid={`admin-http-tools-details-${tool.canonical_id}`}
            >
              <td className="px-3 py-3" colSpan={5}>
                <ToolDetailPanel tool={tool} />
              </td>
            </tr>
          ) : null
        }
      />

      <div className="grid gap-2 md:hidden">
        {tools.map((tool) => {
          const expanded = expandedIds.has(tool.canonical_id);
          const exposure = exposureBadge(tool);
          return (
            <article
              key={`${groupId}:mobile:${tool.canonical_id}`}
              className="grid gap-3 rounded-lg border border-border/80 bg-bg-subtle/30 p-3"
            >
              <div className="grid gap-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="grid gap-1">
                    <div className="font-mono text-sm text-fg">{tool.canonical_id}</div>
                    <div className="text-xs text-fg-muted">{tool.description}</div>
                  </div>
                  <Badge variant="outline">{SOURCE_LABELS[tool.source]}</Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant={effectBadgeVariant(tool.effect)}>{tool.effect}</Badge>
                  <Badge variant={exposure.variant}>{exposure.label}</Badge>
                </div>
              </div>

              <DetailsToggle
                expanded={expanded}
                toolId={tool.canonical_id}
                onToggle={() => {
                  onToggleExpanded(tool.canonical_id);
                }}
              />

              {expanded ? (
                <div data-testid={`admin-http-tools-details-${tool.canonical_id}`}>
                  <ToolDetailPanel tool={tool} />
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function FacetFilterGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  testIdPrefix,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (nextValue: T) => void;
  testIdPrefix: string;
}): React.ReactElement {
  return (
    <div className="grid gap-2">
      <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">{label}</div>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Button
              key={option.value}
              type="button"
              size="sm"
              variant={selected ? "secondary" : "outline"}
              aria-pressed={selected}
              data-testid={`${testIdPrefix}-${option.value}`}
              className={cn(selected ? "border-primary/30" : null)}
              onClick={() => {
                onChange(option.value);
              }}
            >
              {option.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
