import {
  isApprovalHumanActionableStatus,
  type Approval,
  type OperatorCore,
  type ResolveApprovalInput,
  type TurnsState,
} from "@tyrum/operator-app";
import type { IntlShape } from "react-intl";
import { toast } from "sonner";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { ApprovalActions } from "./approval-actions.js";
import {
  describeApprovalOutcome,
  describeDesktopApprovalContext,
  formatReviewRisk,
} from "./approvals-page.helpers.js";
import { formatErrorMessage } from "../../utils/format-error-message.js";

export function ApprovalExpandedRow(props: {
  approvalId: string;
  approval: Approval;
  core: OperatorCore;
  intl: IntlShape;
  resolvingDecision?: "approved" | "denied" | "always";
  runsState: TurnsState;
  onResolve: (input: ResolveApprovalInput) => void;
  onOpenTakeover: (input: { environmentId: string; title: string }) => Promise<void>;
}) {
  const { approval, approvalId, intl, resolvingDecision } = props;
  const actionable = isApprovalHumanActionableStatus(approval.status);
  const reviewReason = approval.latest_review?.reason?.trim() ?? "";
  const reviewRisk = formatReviewRisk(intl, approval.latest_review);
  const scope = approval.scope;
  const detailEntries = [
    ["Approval key", approval.approval_key],
    ["Conversation", scope?.conversation_key],
    ["Turn", scope?.turn_id],
    ["Turn item", scope?.turn_item_id],
    ["Workflow step", scope?.workflow_run_step_id],
  ].filter((entry): entry is [string, string] => typeof entry[1] === "string");
  const desktop = describeDesktopApprovalContext(approval.context);
  const hasMotivation = Boolean(approval.motivation);
  const hasReview = Boolean(reviewReason || reviewRisk);
  const hasDesktop = desktop !== null;
  const hasDetails = detailEntries.length > 0;

  return (
    <div data-testid={`approval-expanded-${approvalId}`} className="grid gap-3">
      <blockquote className="rounded-md border border-border bg-bg-subtle px-3 py-2.5 text-sm text-fg break-words [overflow-wrap:anywhere]">
        {approval.prompt}
      </blockquote>

      <div className="flex flex-wrap items-center gap-3">
        {actionable ? (
          <ApprovalActions
            approvalId={approvalId}
            approval={approval}
            resolvingState={resolvingDecision}
            onResolve={props.onResolve}
          />
        ) : (
          <div className="text-sm text-fg-muted">
            {describeApprovalOutcome(intl, approval.status)}
          </div>
        )}
      </div>

      {hasMotivation ? (
        <div
          data-testid={`approval-motivation-${approvalId}`}
          className="grid gap-0.5 rounded-md border border-border bg-bg-subtle px-3 py-2.5"
        >
          <div className="text-xs font-medium text-fg-muted">Motivation</div>
          <div className="text-sm text-fg break-words [overflow-wrap:anywhere]">
            {approval.motivation}
          </div>
        </div>
      ) : null}

      {hasReview ? (
        <div
          data-testid={`approval-review-${approvalId}`}
          className="grid gap-1 rounded-md border border-border bg-bg-subtle px-3 py-2.5"
        >
          <div className="text-xs font-medium text-fg-muted">Latest review</div>
          {reviewReason ? (
            <div className="text-sm text-fg break-words [overflow-wrap:anywhere]">
              {reviewReason}
            </div>
          ) : null}
          {reviewRisk ? <div className="text-xs text-fg-muted">Risk {reviewRisk}</div> : null}
        </div>
      ) : null}

      {hasDetails ? (
        <div
          data-testid={`approval-details-${approvalId}`}
          className="grid gap-2 rounded-md border border-border bg-bg-subtle px-3 py-2.5 sm:grid-cols-2 xl:grid-cols-4"
        >
          {detailEntries.map(([label, value]) => (
            <div key={label} className="grid gap-0.5">
              <div className="text-xs font-medium text-fg-muted">{label}</div>
              <div className="font-mono text-xs text-fg break-all">{value}</div>
            </div>
          ))}
        </div>
      ) : null}

      {hasDesktop
        ? (() => {
            const managedDesktop = approval.managed_desktop;

            return (
              <div
                data-testid={`desktop-approval-summary-${approvalId}`}
                className="grid gap-1.5 rounded-md border border-border bg-bg-subtle px-3 py-2.5"
              >
                <div className="flex flex-wrap items-center gap-2 text-sm text-fg">
                  <Badge variant="outline">Desktop</Badge>
                  <span className="font-medium text-fg">{desktop.op}</span>
                  {desktop.actionKind ? (
                    <span className="text-fg-muted">&bull; {desktop.actionKind}</span>
                  ) : null}
                </div>
                {desktop.targetText ? (
                  <div className="text-xs text-fg-muted">{desktop.targetText}</div>
                ) : null}
                {managedDesktop ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-fit"
                    data-testid={`approval-takeover-${approvalId}`}
                    onClick={() => {
                      void props
                        .onOpenTakeover({
                          environmentId: managedDesktop.environment_id,
                          title: desktop.targetText ?? approval.prompt,
                        })
                        .catch((error) => toast.error(formatErrorMessage(error)));
                    }}
                  >
                    Open takeover
                  </Button>
                ) : null}
              </div>
            );
          })()
        : null}
    </div>
  );
}
