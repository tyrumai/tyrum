import type { AgentStatusResponse } from "@tyrum/schemas";
import { RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { Alert } from "../ui/alert.js";
import { cn } from "../../lib/cn.js";

function IdentityField({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: ReactNode;
  valueClassName?: string;
}) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">{label}</div>
      <div className={cn("text-sm text-fg", valueClassName)}>{value}</div>
    </div>
  );
}

function SessionStat({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-lg border border-border/70 px-3 py-2">
      <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">{label}</div>
      <div className={cn("text-base font-medium text-fg", valueClassName)}>{value}</div>
    </div>
  );
}

function OutlineBadgeList({ emptyText, items }: { emptyText: string; items: string[] }) {
  return items.length === 0 ? (
    <div className="text-fg-muted">{emptyText}</div>
  ) : (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <Badge key={item} variant="outline">
          {item}
        </Badge>
      ))}
    </div>
  );
}

export function AgentIdentityPanel({
  loading,
  error,
  status,
  onRefresh,
}: {
  loading: boolean;
  error: string | null;
  status: AgentStatusResponse | null;
  onRefresh: () => void;
}) {
  if (error) {
    return <Alert variant="error" title="Failed to load agent" description={error} />;
  }

  if (loading && !status) {
    return (
      <Card>
        <CardContent className="py-10 text-sm text-fg-muted">Loading agent identity…</CardContent>
      </Card>
    );
  }

  if (!status) {
    return (
      <Card>
        <CardContent className="py-10 text-sm text-fg-muted">
          Select an agent to load its identity.
        </CardContent>
      </Card>
    );
  }

  const detailedSkills = status.skills_detailed ?? [];
  const overviewFields: Array<{ label: string; value: ReactNode; valueClassName?: string }> = [
    { label: "Name", value: status.identity.name, valueClassName: "text-base font-medium" },
    ...(status.identity.description
      ? [{ label: "Description", value: status.identity.description }]
      : []),
    {
      label: "Home",
      value: (
        <code className="break-all rounded bg-bg-subtle px-2 py-1 text-xs text-fg">
          {status.home}
        </code>
      ),
    },
  ];
  const modelFields: Array<{ label: string; value: ReactNode; valueClassName?: string }> = [
    { label: "Primary", value: status.model.model, valueClassName: "text-base font-medium" },
    ...(status.model.variant ? [{ label: "Variant", value: status.model.variant }] : []),
  ];
  const sessionStats = [
    { label: "TTL", value: `${status.sessions.ttl_days} days` },
    { label: "Max turns", value: status.sessions.max_turns },
    { label: "Context window", value: `${status.sessions.context_pruning.max_messages} messages` },
    {
      label: "Tool prune keep",
      value: `${status.sessions.context_pruning.tool_prune_keep_last_messages} messages`,
    },
  ];
  const sessionPolicies = [
    {
      label: "Within-turn limits",
      value: `${status.sessions.loop_detection.within_turn.consecutive_repeat_limit} consecutive • ${status.sessions.loop_detection.within_turn.cycle_repeat_limit} cycle`,
      valueClassName: "text-sm font-normal",
    },
    {
      label: "Cross-turn detection",
      value: `${status.sessions.loop_detection.cross_turn.window_assistant_messages} msgs • ${status.sessions.loop_detection.cross_turn.similarity_threshold} similarity`,
      valueClassName: "text-sm font-normal",
    },
  ];

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-fg-muted">
          Identity, runtime model, tool access, memory support, and session policy for the selected
          agent.
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          data-testid="agents-status-refresh"
          disabled={loading}
          isLoading={loading}
          onClick={onRefresh}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card data-testid="agents-identity-overview">
          <CardHeader className="pb-4">
            <div className="text-sm font-medium text-fg">Overview</div>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={status.enabled ? "success" : "outline"}>
                {status.enabled ? "Enabled" : "Disabled"}
              </Badge>
              {status.workspace_skills_trusted ? (
                <Badge variant="outline">Workspace skills trusted</Badge>
              ) : null}
            </div>
            {overviewFields.map((field) => (
              <IdentityField
                key={field.label}
                label={field.label}
                value={field.value}
                valueClassName={field.valueClassName}
              />
            ))}
          </CardContent>
        </Card>

        <Card data-testid="agents-identity-model">
          <CardHeader className="pb-4">
            <div className="text-sm font-medium text-fg">Model</div>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {modelFields.map((field) => (
              <IdentityField
                key={field.label}
                label={field.label}
                value={field.value}
                valueClassName={field.valueClassName}
              />
            ))}
            {status.model.fallback && status.model.fallback.length > 0 ? (
              <div className="grid gap-2">
                <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">
                  Fallbacks
                </div>
                <div className="flex flex-wrap gap-2">
                  {status.model.fallback.map((model) => (
                    <Badge key={model} variant="outline">
                      {model}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card data-testid="agents-identity-skills">
          <CardHeader className="pb-4">
            <div className="text-sm font-medium text-fg">Skills</div>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <OutlineBadgeList emptyText="No skills configured." items={status.skills} />
            {detailedSkills.length > 0 ? (
              <div className="grid gap-2">
                {detailedSkills.map((skill) => (
                  <div
                    key={skill.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium text-fg">
                        {skill.name} <span className="text-fg-muted">({skill.id})</span>
                      </div>
                      <div className="text-xs text-fg-muted">
                        {skill.source} • v{skill.version}
                      </div>
                    </div>
                    <Badge variant="outline">Installed</Badge>
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card data-testid="agents-identity-tools">
          <CardHeader className="pb-4">
            <div className="text-sm font-medium text-fg">Tools</div>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <OutlineBadgeList emptyText="No tools configured." items={status.tools} />
          </CardContent>
        </Card>

        <Card data-testid="agents-identity-mcp">
          <CardHeader className="pb-4">
            <div className="text-sm font-medium text-fg">MCP</div>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {status.mcp.length === 0 ? (
              <div className="text-fg-muted">No MCP servers configured.</div>
            ) : (
              status.mcp.map((server) => (
                <div
                  key={server.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-fg">{server.name}</div>
                    <div className="text-xs text-fg-muted">
                      {server.id} • {server.transport}
                    </div>
                  </div>
                  <Badge variant={server.enabled ? "success" : "outline"}>
                    {server.enabled ? "On" : "Off"}
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card data-testid="agents-identity-sessions">
          <CardHeader className="pb-4">
            <div className="text-sm font-medium text-fg">Sessions</div>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <div className="grid gap-2 sm:grid-cols-2">
              {sessionStats.map((stat) => (
                <SessionStat key={stat.label} label={stat.label} value={stat.value} />
              ))}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {sessionPolicies.map((stat) => (
                <SessionStat
                  key={stat.label}
                  label={stat.label}
                  value={stat.value}
                  valueClassName={stat.valueClassName}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
