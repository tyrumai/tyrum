import type { OperatorCore } from "@tyrum/operator-core";
import { CircleCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "../components/layout/page-header.js";
import { Alert } from "../components/ui/alert.js";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Card, CardContent, CardFooter, CardHeader } from "../components/ui/card.js";
import { EmptyState } from "../components/ui/empty-state.js";
import { Spinner } from "../components/ui/spinner.js";
import { useOperatorStore } from "../use-operator-store.js";

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function ApprovalsPage({ core }: { core: OperatorCore }) {
  const approvals = useOperatorStore(core.approvalsStore);
  const [resolvingById, setResolvingById] = useState<
    Record<number, "approved" | "denied" | undefined>
  >({});

  const resolveApproval = async (
    approvalId: number,
    decision: "approved" | "denied",
  ): Promise<void> => {
    if (resolvingById[approvalId]) return;

    setResolvingById((prev) => ({ ...prev, [approvalId]: decision }));
    try {
      await core.approvalsStore.resolve(approvalId, decision);
      toast.success(decision === "approved" ? "Approval resolved" : "Approval denied");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setResolvingById((prev) => {
        const next = { ...prev };
        delete next[approvalId];
        return next;
      });
    }
  };

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Approvals"
        actions={
          <Button
            data-testid="approvals-refresh"
            variant="secondary"
            isLoading={approvals.loading}
            onClick={() => {
              void core.approvalsStore.refreshPending();
            }}
          >
            {approvals.loading ? "Refreshing..." : "Refresh"}
          </Button>
        }
      />

      {approvals.error ? (
        <Alert variant="error" title="Approvals failed to load" description={approvals.error} />
      ) : null}

      {approvals.pendingIds.length === 0 ? (
        approvals.loading ? (
          <div
            className="flex items-center justify-center gap-2 px-6 py-12 text-sm text-fg-muted"
            aria-busy={true}
          >
            <Spinner aria-hidden={true} />
            Loading approvals...
          </div>
        ) : (
          <EmptyState
            icon={CircleCheck}
            title="No pending approvals"
            description="Approvals appear here when agents request permission to perform actions."
          />
        )
      ) : (
        <div className="grid gap-4">
          {approvals.pendingIds.map((approvalId) => {
            const approval = approvals.byId[approvalId];
            if (!approval) return null;

            const resolvingDecision = resolvingById[approvalId];
            const isResolving = resolvingDecision !== undefined;

            return (
              <Card key={approvalId}>
                <CardHeader className="pb-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <Badge variant="outline">{approval.kind}</Badge>
                    <time
                      dateTime={approval.created_at}
                      className="text-xs text-fg-muted"
                      title={approval.created_at}
                    >
                      {formatTimestamp(approval.created_at)}
                    </time>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <blockquote className="rounded-md border-l-4 border-primary/30 bg-primary-dim/20 px-4 py-3 text-sm text-fg">
                    {approval.prompt}
                  </blockquote>
                </CardContent>
                <CardFooter className="gap-2">
                  <Button
                    data-testid={`approval-approve-${approvalId}`}
                    variant="success"
                    disabled={isResolving}
                    isLoading={resolvingDecision === "approved"}
                    onClick={() => {
                      void resolveApproval(approvalId, "approved");
                    }}
                  >
                    Approve
                  </Button>
                  <Button
                    data-testid={`approval-deny-${approvalId}`}
                    variant="danger"
                    disabled={isResolving}
                    isLoading={resolvingDecision === "denied"}
                    onClick={() => {
                      void resolveApproval(approvalId, "denied");
                    }}
                  >
                    Deny
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
