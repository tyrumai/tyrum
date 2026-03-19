import type { OperatorCore } from "@tyrum/operator-app";
import * as React from "react";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import {
  FacetFilterGroup,
  SOURCE_LABELS,
  ToolTableSection,
  groupForTool,
  type ToolGroupId,
  type ToolRegistryEntry,
} from "./admin-http-tools.shared.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { Input } from "../ui/input.js";
import { LoadingState } from "../ui/loading-state.js";

type SourceFilter = ToolRegistryEntry["source"] | "all";
type EffectFilter = ToolRegistryEntry["effect"] | "all";
type ExposureFilter = ToolRegistryEntry["effective_exposure"]["reason"] | "all";

const GROUP_ORDER: ToolGroupId[] = ["built_in", "extensions"];

const SOURCE_OPTIONS: Array<{ value: SourceFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "builtin", label: "Built-in" },
  { value: "builtin_mcp", label: "Built-in MCP" },
  { value: "mcp", label: "MCP" },
  { value: "plugin", label: "Plugin" },
];

const EFFECT_OPTIONS: Array<{ value: EffectFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "read_only", label: "Read-only" },
  { value: "state_changing", label: "State-changing" },
];

const EXPOSURE_OPTIONS: Array<{ value: ExposureFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "enabled", label: "Exposed" },
  { value: "disabled_by_agent_allowlist", label: "Allowlist blocked" },
  { value: "disabled_by_state_mode", label: "State-mode blocked" },
];

function matchesTextFilter(tool: ToolRegistryEntry, query: string): boolean {
  if (!query) return true;
  const normalized = query.toLowerCase();
  const haystacks = [
    tool.canonical_id,
    tool.description,
    tool.source,
    SOURCE_LABELS[tool.source],
    tool.family,
    tool.backing_server?.id,
    tool.backing_server?.name,
    tool.backing_server?.transport,
    tool.backing_server?.url,
    tool.plugin?.id,
    tool.plugin?.name,
    tool.plugin?.version,
    tool.effective_exposure.reason,
    tool.effective_exposure.agent_key,
    ...(tool.keywords ?? []),
  ];
  return haystacks.some((value) => value?.toLowerCase().includes(normalized));
}

function matchesFacetFilters(
  tool: ToolRegistryEntry,
  filters: {
    source: SourceFilter;
    effect: EffectFilter;
    exposure: ExposureFilter;
  },
): boolean {
  if (filters.source !== "all" && tool.source !== filters.source) {
    return false;
  }

  if (filters.effect !== "all" && tool.effect !== filters.effect) {
    return false;
  }

  if (filters.exposure !== "all" && tool.effective_exposure.reason !== filters.exposure) {
    return false;
  }

  return true;
}

function buildGroups(tools: readonly ToolRegistryEntry[]): Array<{
  id: ToolGroupId;
  items: ToolRegistryEntry[];
}> {
  return GROUP_ORDER.map((groupId) => ({
    id: groupId,
    items: tools.filter((tool) => groupForTool(tool) === groupId),
  })).filter((group) => group.items.length > 0);
}

export function ToolRegistryCard({ core }: { core: OperatorCore }): React.ReactElement {
  const toolRegistryApi = core.admin.toolRegistry;
  const [tools, setTools] = React.useState<ToolRegistryEntry[]>([]);
  const [expandedIds, setExpandedIds] = React.useState<Set<string>>(() => new Set());
  const [filter, setFilter] = React.useState("");
  const [sourceFilter, setSourceFilter] = React.useState<SourceFilter>("all");
  const [effectFilter, setEffectFilter] = React.useState<EffectFilter>("all");
  const [exposureFilter, setExposureFilter] = React.useState<ExposureFilter>("all");
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
    () =>
      tools.filter(
        (tool) =>
          matchesTextFilter(tool, filter.trim()) &&
          matchesFacetFilters(tool, {
            source: sourceFilter,
            effect: effectFilter,
            exposure: exposureFilter,
          }),
      ),
    [effectFilter, exposureFilter, filter, sourceFilter, tools],
  );
  const groupedTools = React.useMemo(() => buildGroups(filteredTools), [filteredTools]);

  function toggleExpanded(toolId: string): void {
    setExpandedIds((previous) => {
      const next = new Set(previous);
      if (next.has(toolId)) {
        next.delete(toolId);
      } else {
        next.add(toolId);
      }
      return next;
    });
  }

  return (
    <Card data-testid="admin-http-tools">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="text-sm font-medium text-fg">Tools</div>
            <p className="text-sm text-fg-muted">
              Compact registry of built-in and extension-backed tool descriptors with exposure and
              structured input fields.
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

        <Alert
          variant="info"
          data-testid="admin-http-tools-skills-note"
          title="Skills are managed separately"
          description="Skills guide behavior but do not register tool rows directly on this page."
        />

        <div className="grid gap-4 rounded-lg border border-border/80 bg-bg-subtle/20 p-4">
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

          <div className="grid gap-4">
            <FacetFilterGroup
              label="Source"
              value={sourceFilter}
              options={SOURCE_OPTIONS}
              onChange={setSourceFilter}
              testIdPrefix="admin-http-tools-filter-source"
            />
            <FacetFilterGroup
              label="Effect"
              value={effectFilter}
              options={EFFECT_OPTIONS}
              onChange={setEffectFilter}
              testIdPrefix="admin-http-tools-filter-effect"
            />
            <FacetFilterGroup
              label="Exposure"
              value={exposureFilter}
              options={EXPOSURE_OPTIONS}
              onChange={setExposureFilter}
              testIdPrefix="admin-http-tools-filter-exposure"
            />
          </div>
        </div>

        {errorMessage ? (
          <Alert
            variant="error"
            title="Failed to load tools"
            description={errorMessage}
            onDismiss={() => setErrorMessage(null)}
          />
        ) : null}

        {loading ? <LoadingState label="Loading tool registry..." /> : null}

        {!loading && !errorMessage && groupedTools.length === 0 ? (
          <Alert
            variant="info"
            title={tools.length === 0 ? "No tools registered" : "No tools match the current filter"}
            description={
              tools.length === 0
                ? "No tool descriptors were returned by the gateway."
                : "Adjust the search or filters to see more registry entries."
            }
          />
        ) : null}

        {!loading && !errorMessage ? (
          <div className="grid gap-5">
            {groupedTools.map((group) => (
              <ToolTableSection
                key={group.id}
                groupId={group.id}
                tools={group.items}
                expandedIds={expandedIds}
                onToggleExpanded={toggleExpanded}
              />
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
