import type { Approval, ResolveApprovalInput } from "@tyrum/operator-app";
import { ShieldCheck } from "lucide-react";
import type { PolicyToolOption } from "./admin-http-policy-overrides.shared.js";
import {
  PolicyToolMetadataPanel,
  buildPolicyToolLookup,
  resolvePolicyTool,
} from "./admin-http-policy-overrides.shared.js";
import { Badge } from "../ui/badge.js";
import { ApprovalActions } from "./approval-actions.js";

function approvalStateVariant(
  state: "approved" | "cancelled" | "denied" | "expired" | "pending",
): React.ComponentProps<typeof Badge>["variant"] {
  if (state === "approved") {
    return "success";
  }
  if (state === "denied" || state === "cancelled" || state === "expired") {
    return "danger";
  }
  return "warning";
}

export function ApprovalDataPartCard({
  approval,
  interactiveApprovals,
  onResolveApproval,
  part,
  resolvingApproval,
  tools = [],
}: {
  approval: Approval | null;
  interactiveApprovals: boolean;
  onResolveApproval: (input: ResolveApprovalInput) => void;
  part: {
    approval_id: string;
    state: "approved" | "cancelled" | "denied" | "expired" | "pending";
    tool_name: string;
  };
  resolvingApproval: { approvalId: string; state: "always" | "approved" | "denied" } | null;
  tools?: readonly PolicyToolOption[];
}) {
  const pending = part.state === "pending";
  const toolLookup = buildPolicyToolLookup(tools);
  const resolvedTool = resolvePolicyTool(toolLookup, part.tool_name);
  return (
    <div className="rounded-lg border border-warning-300/70 bg-warning-50/70 px-2 py-1.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-medium text-warning-950">
            <ShieldCheck className="h-4 w-4 shrink-0" />
            <span className="truncate">Approval request</span>
          </div>
        </div>
        <Badge variant={approvalStateVariant(part.state)}>{part.state}</Badge>
      </div>
      <div className="mt-2">
        <PolicyToolMetadataPanel
          title="Canonical tool"
          toolId={part.tool_name}
          resolved={resolvedTool}
          rawToolIdLabel="Requested tool ID"
          unavailableMessage="Shared tool metadata unavailable for this approval."
        />
      </div>

      {interactiveApprovals && pending ? (
        <div className="mt-2">
          <div className="text-xs text-warning-900">
            User approval is required before this tool can continue.
          </div>
          <ApprovalActions
            approvalId={part.approval_id}
            approval={approval}
            resolvingState={
              resolvingApproval?.approvalId === part.approval_id
                ? resolvingApproval.state
                : undefined
            }
            onResolve={onResolveApproval}
            className="mt-2"
            tools={tools}
          />
        </div>
      ) : null}
    </div>
  );
}
