import type { Approval } from "@tyrum/client";
import type { ResolveApprovalInput } from "@tyrum/operator-app";
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js";
import { Label } from "../ui/label.js";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group.js";
import { isRecord } from "../../utils/is-record.js";

type SuggestedOverride = {
  tool_id: string;
  pattern: string;
  workspace_id?: string;
};

type SuggestedOverrideOption = SuggestedOverride & {
  key: string;
  title: string;
  description: string;
};

function extractSuggestedOverrides(approval: Approval | null | undefined): SuggestedOverride[] {
  const context = isRecord(approval?.context) ? approval.context : null;
  const policy = context && isRecord(context["policy"]) ? context["policy"] : null;
  const suggested = policy?.["suggested_overrides"];
  if (!Array.isArray(suggested)) return [];

  const overrides: SuggestedOverride[] = [];
  for (const entry of suggested) {
    if (!isRecord(entry)) continue;
    const toolId = typeof entry["tool_id"] === "string" ? entry["tool_id"].trim() : "";
    const pattern = typeof entry["pattern"] === "string" ? entry["pattern"].trim() : "";
    const workspaceId =
      typeof entry["workspace_id"] === "string" ? entry["workspace_id"].trim() : undefined;
    if (!toolId || !pattern) continue;
    overrides.push({ tool_id: toolId, pattern, workspace_id: workspaceId || undefined });
  }
  return overrides;
}

function describeSuggestedOverride(input: SuggestedOverride): {
  title: string;
  description: string;
} {
  if (input.tool_id === "tool.node.dispatch") {
    if (input.pattern.includes(";op:act*")) {
      return {
        title: "Desktop act actions in this scope",
        description: "Covers future Desktop act operations for this agent/workspace.",
      };
    }
    if (input.pattern.includes(";op:query")) {
      return {
        title: "Desktop query actions in this scope",
        description: "Covers read-only Desktop queries for this agent/workspace.",
      };
    }
    if (input.pattern.includes(";op:snapshot")) {
      return {
        title: "Desktop snapshots in this scope",
        description: "Covers Desktop screenshot or snapshot operations for this agent/workspace.",
      };
    }
  }

  if (input.tool_id === "connector.send") {
    return {
      title: "Sends to this destination",
      description: "Covers future sends to the same connector/account destination.",
    };
  }

  if (input.tool_id === "tool.automation.schedule.create") {
    if (input.pattern.includes("kind:heartbeat")) {
      return {
        title: "Heartbeat schedule creation in this scope",
        description: "Covers future heartbeat schedule creation with the same normalized scope.",
      };
    }
    if (input.pattern.includes("kind:cron")) {
      return {
        title: "Cron schedule creation in this scope",
        description: "Covers future cron schedule creation with the same normalized scope.",
      };
    }
    return {
      title: "Schedule creation in this scope",
      description: "Covers future automation schedule creation matching this normalized target.",
    };
  }

  if (
    input.tool_id === "tool.automation.schedule.update" ||
    input.tool_id === "tool.automation.schedule.pause" ||
    input.tool_id === "tool.automation.schedule.resume" ||
    input.tool_id === "tool.automation.schedule.delete" ||
    input.tool_id === "tool.automation.schedule.get"
  ) {
    return {
      title: "This exact schedule target",
      description: "Covers future actions against the same normalized schedule target.",
    };
  }

  return {
    title: "This exact tool target",
    description: "Covers future approvals matching the same normalized tool target.",
  };
}

function listApprovalSuggestedOverrideOptions(
  approval: Approval | null | undefined,
): SuggestedOverrideOption[] {
  return extractSuggestedOverrides(approval).map((override) => {
    const described = describeSuggestedOverride(override);
    return {
      tool_id: override.tool_id,
      pattern: override.pattern,
      workspace_id: override.workspace_id,
      key: `${override.tool_id}::${override.pattern}::${override.workspace_id ?? ""}`,
      title: described.title,
      description: described.description,
    };
  });
}

export function ApprovalActions(props: {
  approvalId: string;
  approval?: Approval | null;
  resolvingState?: "approved" | "denied" | "always";
  onResolve: (input: ResolveApprovalInput) => void;
  className?: string;
}): ReactElement {
  const options = useMemo(
    () => listApprovalSuggestedOverrideOptions(props.approval),
    [props.approval],
  );
  const hasAlwaysApprove = options.length > 0;
  const [alwaysOpen, setAlwaysOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string>(options[0]?.key ?? "");

  useEffect(() => {
    setSelectedKey(options[0]?.key ?? "");
  }, [options]);

  const selected = options.find((option) => option.key === selectedKey) ?? options[0] ?? null;
  const isResolving = props.resolvingState !== undefined;

  return (
    <>
      <div className={props.className ?? "flex gap-2"}>
        <Button
          data-testid={`approval-approve-${props.approvalId}`}
          variant="success"
          disabled={isResolving}
          isLoading={props.resolvingState === "approved"}
          onClick={() => {
            props.onResolve({
              approvalId: props.approvalId,
              decision: "approved",
              mode: "once",
            });
          }}
        >
          {hasAlwaysApprove ? "Approve once" : "Approve"}
        </Button>
        {hasAlwaysApprove ? (
          <Button
            data-testid={`approval-always-${props.approvalId}`}
            variant="secondary"
            disabled={isResolving}
            isLoading={props.resolvingState === "always"}
            onClick={() => {
              setAlwaysOpen(true);
            }}
          >
            Always approve
          </Button>
        ) : null}
        <Button
          data-testid={`approval-deny-${props.approvalId}`}
          variant="danger"
          disabled={isResolving}
          isLoading={props.resolvingState === "denied"}
          onClick={() => {
            props.onResolve({
              approvalId: props.approvalId,
              decision: "denied",
            });
          }}
        >
          Deny
        </Button>
      </div>

      <Dialog open={alwaysOpen} onOpenChange={setAlwaysOpen}>
        <DialogContent data-testid={`approval-always-dialog-${props.approvalId}`}>
          <DialogHeader>
            <DialogTitle>Always approve future matches</DialogTitle>
            <DialogDescription>
              Choose the standing rule to create. The first option is the recommended narrow
              default.
            </DialogDescription>
          </DialogHeader>

          <RadioGroup
            className="mt-4"
            value={selected?.key ?? ""}
            onValueChange={setSelectedKey}
            aria-label="Always approve options"
          >
            {options.map((option, index) => (
              <Label
                key={option.key}
                htmlFor={`approval-always-option-${props.approvalId}-${index}`}
                className="flex cursor-pointer items-start gap-3 rounded-md border border-border px-3 py-3"
              >
                <RadioGroupItem
                  id={`approval-always-option-${props.approvalId}-${index}`}
                  value={option.key}
                  data-testid={`approval-always-option-${props.approvalId}-${index}`}
                  className="mt-0.5"
                />
                <div className="grid gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-fg">{option.title}</span>
                    {index === 0 ? <Badge variant="success">Recommended</Badge> : null}
                    <Badge variant="outline">{option.tool_id}</Badge>
                  </div>
                  <div className="text-sm text-fg-muted">{option.description}</div>
                  <code className="rounded bg-bg-subtle px-2 py-1 font-mono text-xs text-fg">
                    {option.pattern}
                  </code>
                </div>
              </Label>
            ))}
          </RadioGroup>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setAlwaysOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              data-testid={`approval-always-confirm-${props.approvalId}`}
              variant="success"
              disabled={selected === null || isResolving}
              onClick={() => {
                if (!selected) return;
                props.onResolve({
                  approvalId: props.approvalId,
                  decision: "approved",
                  mode: "always",
                  overrides: [
                    {
                      tool_id: selected.tool_id,
                      pattern: selected.pattern,
                      workspace_id: selected.workspace_id,
                    },
                  ],
                });
                setAlwaysOpen(false);
              }}
            >
              Create always-approve rule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
