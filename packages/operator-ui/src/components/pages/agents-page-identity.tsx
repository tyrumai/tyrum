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
    <div className="grid gap-1">
      <div className="text-sm font-medium text-fg-muted">{label}</div>
      <div className={cn("break-words text-sm text-fg [overflow-wrap:anywhere]", valueClassName)}>
        {value}
      </div>
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
      <div className="text-sm font-medium text-fg-muted">{label}</div>
      <div
        className={cn(
          "break-words text-base font-medium text-fg [overflow-wrap:anywhere]",
          valueClassName,
        )}
      >
        {value}
      </div>
    </div>
  );
}

function OutlineBadgeList({ emptyText, items }: { emptyText: string; items: string[] }) {
  return items.length === 0 ? (
    <div className="text-fg-muted">{emptyText}</div>
  ) : (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <Badge
          key={item}
          variant="outline"
          className="max-w-full break-words [overflow-wrap:anywhere]"
        >
          {item}
        </Badge>
      ))}
    </div>
  );
}

function SkillsCard({ status }: { status: AgentStatusResponse }) {
  const detailedSkills = status.skills_detailed ?? [];
  return (
    <Card className="min-w-0" data-testid="agents-identity-skills">
      <CardHeader className="pb-2.5">
        <div className="text-sm font-medium text-fg">Skills</div>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <OutlineBadgeList emptyText="No skills configured." items={status.skills} />
        {detailedSkills.length > 0 ? (
          <div className="grid gap-2">
            {detailedSkills.map((skill) => (
              <div
                key={skill.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-border/70 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="break-words font-medium text-fg [overflow-wrap:anywhere]">
                    {skill.name} <span className="text-fg-muted">({skill.id})</span>
                  </div>
                  <div className="break-words text-xs text-fg-muted [overflow-wrap:anywhere]">
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
  );
}

function McpCard({ status }: { status: AgentStatusResponse }) {
  return (
    <Card className="min-w-0" data-testid="agents-identity-mcp">
      <CardHeader className="pb-2.5">
        <div className="text-sm font-medium text-fg">MCP</div>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        {status.mcp.length === 0 ? (
          <div className="text-fg-muted">No MCP servers configured.</div>
        ) : (
          status.mcp.map((server) => (
            <div
              key={server.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-border/70 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="break-words font-medium text-fg [overflow-wrap:anywhere]">
                  {server.name}
                </div>
                <div className="break-words text-xs text-fg-muted [overflow-wrap:anywhere]">
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
  );
}

function SessionsCard({ status }: { status: AgentStatusResponse }) {
  const formatSessionLimit = (value: number, suffix: string): string =>
    value <= 0 ? "Unlimited" : `${value} ${suffix}`;
  const sessionStats = [
    { label: "TTL", value: `${status.sessions.ttl_days} days` },
    { label: "Max turns", value: formatSessionLimit(status.sessions.max_turns, "turns") },
    {
      label: "Context window",
      value: formatSessionLimit(status.sessions.context_pruning.max_messages, "messages"),
    },
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
    <Card className="min-w-0" data-testid="agents-identity-sessions">
      <CardHeader className="pb-2.5">
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

  return (
    <div className="grid min-w-0 gap-4" data-testid="agents-identity-panel">
      <div
        className="flex min-w-0 flex-wrap items-center justify-between gap-3"
        data-testid="agents-identity-header"
      >
        <div className="min-w-0 flex-1 text-sm text-fg-muted [overflow-wrap:anywhere]">
          Identity, runtime model, tool access, memory support, and session policy for the selected
          agent.
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="shrink-0"
          data-testid="agents-status-refresh"
          disabled={loading}
          isLoading={loading}
          onClick={onRefresh}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-2" data-testid="agents-identity-sections">
        <Card className="min-w-0" data-testid="agents-identity-overview">
          <CardHeader className="pb-2.5">
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

        <Card className="min-w-0" data-testid="agents-identity-model">
          <CardHeader className="pb-2.5">
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
                <div className="text-sm font-medium text-fg-muted">Fallbacks</div>
                <div className="flex flex-wrap gap-2">
                  {status.model.fallback.map((model) => (
                    <Badge
                      key={model}
                      variant="outline"
                      className="max-w-full break-words [overflow-wrap:anywhere]"
                    >
                      {model}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <SkillsCard status={status} />

        <Card className="min-w-0" data-testid="agents-identity-tools">
          <CardHeader className="pb-2.5">
            <div className="text-sm font-medium text-fg">Tools</div>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <OutlineBadgeList emptyText="No tools configured." items={status.tools} />
          </CardContent>
        </Card>

        <McpCard status={status} />
        <SessionsCard status={status} />
      </div>
    </div>
  );
}
