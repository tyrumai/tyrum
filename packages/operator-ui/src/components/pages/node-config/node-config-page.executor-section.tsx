import { useEffect, useState } from "react";
import { Alert } from "../../ui/alert.js";
import { Badge, type BadgeVariant } from "../../ui/badge.js";
import { Card, CardContent } from "../../ui/card.js";
import { Switch } from "../../ui/switch.js";
import type { NodeExecutorState } from "./node-config-page.types.js";

// ─── Status badge variant mapping ───────────────────────────────────────────

function statusBadgeVariant(status: NodeExecutorState["status"]): BadgeVariant {
  switch (status) {
    case "connected":
      return "success";
    case "connecting":
      return "warning";
    case "disconnected":
    case "disabled":
      return "default";
    case "error":
      return "danger";
  }
}

// ─── ExecutorSection ────────────────────────────────────────────────────────

export interface ExecutorSectionProps {
  executor: NodeExecutorState;
  /** Human-readable platform label, e.g. "Desktop", "Browser", "Mobile". */
  platformLabel: string;
}

export function ExecutorSection({ executor, platformLabel }: ExecutorSectionProps) {
  const [errorDismissed, setErrorDismissed] = useState(false);

  useEffect(() => {
    setErrorDismissed(false);
  }, [executor.error]);

  const title = `${platformLabel} node executor`;
  const description = `Manage the local ${platformLabel.toLowerCase()} node.`;

  return (
    <Card>
      <CardContent className="grid gap-4 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 grid gap-1">
            <div className="text-sm font-semibold text-fg">{title}</div>
            <div className="text-sm text-fg-muted">{description}</div>
          </div>
          <Switch
            className="shrink-0"
            aria-label={`Toggle ${title}`}
            checked={executor.enabled}
            disabled={executor.busy}
            onCheckedChange={executor.onToggle}
          />
        </div>

        {/* Status metadata */}
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={statusBadgeVariant(executor.status)}>{executor.status}</Badge>
          {executor.nodeId ? (
            <code className="break-all font-mono text-xs text-fg-muted">{executor.nodeId}</code>
          ) : null}
        </div>

        {/* Error alert */}
        {executor.error && !errorDismissed ? (
          <Alert
            variant="error"
            title="Executor error"
            description={executor.error}
            onDismiss={() => setErrorDismissed(true)}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}
