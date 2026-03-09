import type { ToolRegistryListResult } from "@tyrum/client";
import type { OperatorCore } from "@tyrum/operator-core";
import * as React from "react";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import { Alert } from "../ui/alert.js";
import { Badge, type BadgeVariant } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { Input } from "../ui/input.js";
import { JsonViewer } from "../ui/json-viewer.js";

type ToolRegistryEntry = ToolRegistryListResult["tools"][number];

const SOURCE_LABELS: Record<ToolRegistryEntry["source"], string> = {
  builtin: "Built-in",
  builtin_mcp: "Built-in MCP",
  mcp: "MCP",
  plugin: "Plugin",
};

const SOURCE_ORDER: ToolRegistryEntry["source"][] = ["builtin", "builtin_mcp", "mcp", "plugin"];

function riskBadgeVariant(risk: ToolRegistryEntry["risk"]): BadgeVariant {
  if (risk === "high") return "danger";
  if (risk === "medium") return "warning";
  return "success";
}

function matchesFilter(tool: ToolRegistryEntry, query: string): boolean {
  if (!query) return true;
  const normalized = query.toLowerCase();
  const haystacks = [
    tool.canonical_id,
    tool.description,
    tool.source,
    tool.backing_server?.id,
    tool.backing_server?.name,
    tool.plugin?.id,
    tool.plugin?.name,
    tool.effective_exposure.reason,
    tool.effective_exposure.agent_key,
    ...(tool.keywords ?? []),
  ];
  return haystacks.some((value) => value?.toLowerCase().includes(normalized));
}

function groupTools(tools: ToolRegistryEntry[]): Array<{
  source: ToolRegistryEntry["source"];
  items: ToolRegistryEntry[];
}> {
  return SOURCE_ORDER.map((source) => ({
    source,
    items: tools.filter((tool) => tool.source === source),
  })).filter((group) => group.items.length > 0);
}

function exposureBadge(tool: ToolRegistryEntry): {
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

function ToolRow({ tool }: { tool: ToolRegistryEntry }): React.ReactElement {
  const exposure = exposureBadge(tool);
  return (
    <article className="grid gap-3 rounded-lg border border-border bg-bg-subtle/40 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="font-mono text-sm text-fg">{tool.canonical_id}</div>
          <p className="text-sm text-fg-muted">{tool.description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{SOURCE_LABELS[tool.source]}</Badge>
          <Badge variant={riskBadgeVariant(tool.risk)}>{tool.risk} risk</Badge>
          <Badge variant={tool.requires_confirmation ? "warning" : "default"}>
            {tool.requires_confirmation ? "Confirm required" : "No confirm"}
          </Badge>
          <Badge variant={exposure.variant}>{exposure.label}</Badge>
        </div>
      </div>

      {tool.backing_server || tool.plugin || tool.effective_exposure.agent_key ? (
        <div className="flex flex-wrap gap-2 text-xs text-fg-muted">
          {tool.backing_server ? (
            <span>
              Server: {tool.backing_server.name} ({tool.backing_server.id},{" "}
              {tool.backing_server.transport}
              {tool.backing_server.url ? `, ${tool.backing_server.url}` : ""})
            </span>
          ) : null}
          {tool.plugin ? (
            <span>
              Plugin: {tool.plugin.name} ({tool.plugin.id}@{tool.plugin.version})
            </span>
          ) : null}
          {tool.effective_exposure.agent_key ? (
            <span>Agent scope: {tool.effective_exposure.agent_key}</span>
          ) : null}
        </div>
      ) : null}

      {tool.keywords && tool.keywords.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {tool.keywords.map((keyword) => (
            <Badge key={keyword} variant="default">
              {keyword}
            </Badge>
          ))}
        </div>
      ) : null}

      {tool.input_schema ? (
        <details className="rounded-md border border-border bg-bg p-2">
          <summary className="cursor-pointer text-sm font-medium text-fg">Input schema</summary>
          <div className="mt-2">
            <JsonViewer value={tool.input_schema} />
          </div>
        </details>
      ) : null}
    </article>
  );
}

function ToolSourceSection({
  source,
  tools,
}: {
  source: ToolRegistryEntry["source"];
  tools: ToolRegistryEntry[];
}): React.ReactElement {
  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-fg">{SOURCE_LABELS[source]}</div>
        <Badge variant="outline">{tools.length}</Badge>
      </div>
      <div className="grid gap-3">
        {tools.map((tool) => (
          <ToolRow key={`${tool.source}:${tool.canonical_id}`} tool={tool} />
        ))}
      </div>
    </section>
  );
}

export function ToolRegistryCard({ core }: { core: OperatorCore }): React.ReactElement {
  const toolRegistryApi = core.http.toolRegistry;
  const [tools, setTools] = React.useState<ToolRegistryEntry[]>([]);
  const [filter, setFilter] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    if (!toolRegistryApi) {
      setLoading(false);
      setRefreshing(false);
      return;
    }

    setRefreshing(true);
    setErrorMessage(null);
    try {
      const result = await toolRegistryApi.list();
      setTools(result.tools);
    } catch (error) {
      setErrorMessage(formatErrorMessage(error));
      setTools([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toolRegistryApi]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const filteredTools = React.useMemo(
    () => tools.filter((tool) => matchesFilter(tool, filter.trim())),
    [filter, tools],
  );
  const groupedTools = React.useMemo(() => groupTools(filteredTools), [filteredTools]);

  return (
    <Card data-testid="admin-http-tools">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="text-sm font-medium text-fg">Tools</div>
            <p className="text-sm text-fg-muted">
              Read-only registry of built-in, plugin, and MCP-backed tool descriptors with effective
              exposure.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{filteredTools.length} visible</Badge>
            <Badge variant="outline">{tools.length} total</Badge>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              data-testid="admin-http-tools-refresh"
              isLoading={refreshing}
              onClick={() => {
                void refresh();
              }}
            >
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {!toolRegistryApi ? (
          <Alert
            variant="warning"
            title="Tool registry unavailable"
            description="This client does not expose the tool registry API."
          />
        ) : null}

        <div className="max-w-xl">
          <Input
            label="Filter tools"
            value={filter}
            data-testid="admin-http-tools-filter"
            placeholder="Search by id, source, exposure, plugin, server, or keyword"
            onChange={(event) => {
              setFilter(event.currentTarget.value);
            }}
          />
        </div>

        {errorMessage ? (
          <Alert variant="error" title="Failed to load tools" description={errorMessage} />
        ) : null}

        {loading ? <div className="text-sm text-fg-muted">Loading tool registry...</div> : null}

        {!loading && !errorMessage && groupedTools.length === 0 ? (
          <Alert
            variant="info"
            title={tools.length === 0 ? "No tools registered" : "No tools match the current filter"}
            description={
              tools.length === 0
                ? "No tool descriptors were returned by the gateway."
                : "Adjust the filter to see more registry entries."
            }
          />
        ) : null}

        {!loading && !errorMessage ? (
          <div className="grid gap-5">
            {groupedTools.map((group) => (
              <ToolSourceSection key={group.source} source={group.source} tools={group.items} />
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
