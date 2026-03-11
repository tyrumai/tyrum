import type { ToolRegistryListResult } from "@tyrum/client";
import { ChevronDown, ChevronRight } from "lucide-react";
import * as React from "react";
import { cn } from "../../lib/cn.js";
import { buildStructuredToolSchema, type StructuredToolSchema } from "./admin-http-tools.schema.js";
import { Badge, type BadgeVariant } from "../ui/badge.js";
import { Button } from "../ui/button.js";

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

export function riskBadgeVariant(risk: ToolRegistryEntry["risk"]): BadgeVariant {
  if (risk === "high") return "danger";
  if (risk === "medium") return "warning";
  return "success";
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
        <div key={section.label} className="grid gap-2">
          <div className="flex items-center gap-2">
            <Badge variant="outline">{section.label}</Badge>
            {section.summary ? (
              <span className="text-xs text-fg-muted">{section.summary}</span>
            ) : null}
          </div>
          {section.rows.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-border/80">
              <table className="min-w-full text-sm">
                <thead className="bg-bg-subtle/60 text-left text-xs uppercase tracking-wide text-fg-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">Field</th>
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium">Required</th>
                    <th className="px-3 py-2 font-medium">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {section.rows.map((row) => (
                    <tr key={`${section.label}:${row.field}`} className="border-t border-border/70">
                      <td className="px-3 py-2 font-mono text-xs text-fg">{row.field}</td>
                      <td className="px-3 py-2 text-fg">{row.type}</td>
                      <td className="px-3 py-2 text-fg">{row.required ? "Yes" : "No"}</td>
                      <td className="px-3 py-2 text-fg-muted">{row.description ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
  return (
    <section className="grid gap-3" data-testid={`admin-http-tools-group-${groupId}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-fg">{GROUP_LABELS[groupId]}</div>
        <Badge variant="outline">{tools.length}</Badge>
      </div>

      <div className="hidden overflow-x-auto rounded-lg border border-border/80 md:block">
        <table className="min-w-full text-sm">
          <thead className="bg-bg-subtle/60 text-left text-xs uppercase tracking-wide text-fg-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Tool</th>
              <th className="px-3 py-2 font-medium">Source</th>
              <th className="px-3 py-2 font-medium">Risk</th>
              <th className="px-3 py-2 font-medium">Confirm</th>
              <th className="px-3 py-2 font-medium">Exposure</th>
              <th className="px-3 py-2 font-medium text-right">Details</th>
            </tr>
          </thead>
          <tbody>
            {tools.map((tool) => {
              const expanded = expandedIds.has(tool.canonical_id);
              const exposure = exposureBadge(tool);
              return (
                <React.Fragment key={`${groupId}:${tool.canonical_id}`}>
                  <tr className="border-t border-border/70 align-top">
                    <td className="px-3 py-3">
                      <div className="grid gap-1">
                        <div className="font-mono text-sm text-fg">{tool.canonical_id}</div>
                        <div className="max-w-3xl text-xs text-fg-muted">{tool.description}</div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <Badge variant="outline">{SOURCE_LABELS[tool.source]}</Badge>
                    </td>
                    <td className="px-3 py-3">
                      <Badge variant={riskBadgeVariant(tool.risk)}>{tool.risk}</Badge>
                    </td>
                    <td className="px-3 py-3">
                      <Badge variant={tool.requires_confirmation ? "warning" : "default"}>
                        {tool.requires_confirmation ? "Required" : "No"}
                      </Badge>
                    </td>
                    <td className="px-3 py-3">
                      <Badge variant={exposure.variant}>{exposure.label}</Badge>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <DetailsToggle
                        expanded={expanded}
                        toolId={tool.canonical_id}
                        onToggle={() => {
                          onToggleExpanded(tool.canonical_id);
                        }}
                      />
                    </td>
                  </tr>
                  {expanded ? (
                    <tr
                      className="border-t border-border/70"
                      data-testid={`admin-http-tools-details-${tool.canonical_id}`}
                    >
                      <td className="px-3 py-3" colSpan={6}>
                        <ToolDetailPanel tool={tool} />
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

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
                  <Badge variant={riskBadgeVariant(tool.risk)}>{tool.risk}</Badge>
                  <Badge variant={tool.requires_confirmation ? "warning" : "default"}>
                    {tool.requires_confirmation ? "Confirm required" : "No confirm"}
                  </Badge>
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
