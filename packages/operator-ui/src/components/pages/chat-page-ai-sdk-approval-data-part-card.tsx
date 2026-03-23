import type { Approval, ResolveApprovalInput } from "@tyrum/operator-app";
import { ShieldCheck } from "lucide-react";
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
}) {
  const pending = part.state === "pending";
  return (
    <div className="rounded-lg border border-warning-300/70 bg-warning-50/70 px-2 py-1.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-medium text-warning-950">
            <ShieldCheck className="h-4 w-4 shrink-0" />
            <span className="truncate">Approval request</span>
          </div>
          <div className="mt-1 text-xs text-warning-900/80">{part.tool_name}</div>
        </div>
        <Badge variant={approvalStateVariant(part.state)}>{part.state}</Badge>
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
          />
        </div>
      ) : null}
    </div>
  );
}
