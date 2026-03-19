import type { AuditExportResult, AuditForgetResult } from "@tyrum/operator-core/browser";
import type { OperatorCore } from "@tyrum/operator-core";
import { FileSearch } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import { useApiAction } from "../../hooks/use-api-action.js";
import { ElevatedModeTooltip } from "../elevated-mode/elevated-mode-tooltip.js";
import { useAdminHttpClient, useAdminMutationAccess } from "../pages/admin-http-shared.js";
import { Alert } from "../ui/alert.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { ConfirmDangerDialog } from "../ui/confirm-danger-dialog.js";
import { EmptyState } from "../ui/empty-state.js";
import {
  AuditExportResultCard,
  AuditForgetResultCard,
  AuditPlansBrowser,
  AuditSelectionSummary,
  downloadReceiptBundle,
  type AuditPlanSummary,
} from "./audit-panel.parts.js";

function resolveSelectedPlanKey(
  plans: AuditPlanSummary[],
  currentPlanKey: string | null,
): string | null {
  if (currentPlanKey && plans.some((plan) => plan.plan_key === currentPlanKey)) {
    return currentPlanKey;
  }
  return plans[0]?.plan_key ?? null;
}

function filterPlans(plans: AuditPlanSummary[], rawFilter: string): AuditPlanSummary[] {
  const needle = rawFilter.trim().toLowerCase();
  if (!needle) return plans;

  return plans.filter((plan) =>
    [plan.plan_key, plan.plan_id, plan.kind, plan.status].some((value) =>
      value.toLowerCase().includes(needle),
    ),
  );
}

export function AuditPanel({ core }: { core: OperatorCore }) {
  const { canMutate, requestEnter } = useAdminMutationAccess(core);
  const adminHttp = useAdminHttpClient({ access: "strict" });
  const auditApi = adminHttp?.audit ?? null;
  const exportAction = useApiAction<AuditExportResult>();
  const forgetAction = useApiAction<AuditForgetResult>();

  const [plans, setPlans] = React.useState<AuditPlanSummary[]>([]);
  const [plansLoading, setPlansLoading] = React.useState(false);
  const [plansError, setPlansError] = React.useState<unknown>(null);
  const [filterValue, setFilterValue] = React.useState("");
  const [selectedPlanKey, setSelectedPlanKey] = React.useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [unavailableDismissed, setUnavailableDismissed] = React.useState(false);

  React.useEffect(() => {
    setUnavailableDismissed(false);
  }, [auditApi]);

  const visiblePlans = React.useMemo(() => filterPlans(plans, filterValue), [plans, filterValue]);
  const selectedPlan =
    visiblePlans.find((plan) => plan.plan_key === selectedPlanKey) ??
    (selectedPlanKey ? (plans.find((plan) => plan.plan_key === selectedPlanKey) ?? null) : null);

  React.useEffect(() => {
    if (visiblePlans.some((plan) => plan.plan_key === selectedPlanKey)) return;
    setSelectedPlanKey(visiblePlans[0]?.plan_key ?? null);
  }, [selectedPlanKey, visiblePlans]);

  React.useEffect(() => {
    exportAction.reset();
    forgetAction.reset();
  }, [selectedPlanKey]);

  React.useEffect(() => {
    const api = auditApi;
    if (!api) {
      setPlans([]);
      setSelectedPlanKey(null);
      setPlansError(new Error("Audit API is unavailable."));
      return;
    }

    let cancelled = false;

    async function loadPlans(apiClient: NonNullable<typeof api>): Promise<void> {
      setPlansLoading(true);
      setPlansError(null);
      try {
        const result = await apiClient.listPlans({ limit: 100 });
        if (cancelled) return;
        setPlans(result.plans);
        setSelectedPlanKey((current) => resolveSelectedPlanKey(result.plans, current));
      } catch (error) {
        if (cancelled) return;
        setPlans([]);
        setSelectedPlanKey(null);
        setPlansError(error);
      } finally {
        if (!cancelled) setPlansLoading(false);
      }
    }

    void loadPlans(api);

    return () => {
      cancelled = true;
    };
  }, [auditApi]);

  async function refreshPlans(): Promise<void> {
    const api = auditApi;
    if (!api) return;
    setPlansLoading(true);
    setPlansError(null);
    try {
      const result = await api.listPlans({ limit: 100 });
      setPlans(result.plans);
      setSelectedPlanKey((current) => resolveSelectedPlanKey(result.plans, current));
    } catch (error) {
      setPlansError(error);
    } finally {
      setPlansLoading(false);
    }
  }

  if (!auditApi) {
    return (
      <Card data-testid="admin-http-audit-panel">
        <CardHeader>
          <div className="text-sm font-medium text-fg">Audit</div>
        </CardHeader>
        {!unavailableDismissed ? (
          <CardContent>
            <Alert
              variant="error"
              title="Audit API unavailable"
              onDismiss={() => setUnavailableDismissed(true)}
            />
          </CardContent>
        ) : null}
      </Card>
    );
  }

  return (
    <Card data-testid="admin-http-audit-panel">
      <CardHeader className="gap-2">
        <div className="text-sm font-medium text-fg">Audit receipts</div>
        <div className="max-w-3xl text-sm text-fg-muted">
          Browse recent audited plans, inspect their receipt metadata, export a receipt bundle, or
          forget the selected plan&apos;s stored receipts. This page uses only structured fields and
          never requires JSON input.
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <AuditPlansBrowser
          plans={visiblePlans}
          selectedPlanKey={selectedPlanKey}
          filterValue={filterValue}
          isLoading={plansLoading}
          error={plansError}
          onFilterChange={setFilterValue}
          onRefresh={refreshPlans}
          onSelectPlan={setSelectedPlanKey}
        />

        <div className="grid gap-4">
          {selectedPlan ? (
            <Card data-testid="audit-plan-detail">
              <CardHeader className="gap-2">
                <div className="text-sm font-medium text-fg">Selected plan</div>
                <div className="text-sm text-fg-muted">
                  Export the selected plan&apos;s receipt bundle or delete its stored receipts.
                </div>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1 rounded-lg border border-border bg-bg-subtle p-3">
                    <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">
                      Plan
                    </div>
                    <div className="font-mono text-sm text-fg break-words">
                      {selectedPlan.plan_key}
                    </div>
                  </div>
                  <div className="grid gap-1 rounded-lg border border-border bg-bg-subtle p-3">
                    <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">
                      Internal plan ID
                    </div>
                    <div className="font-mono text-sm text-fg break-words">
                      {selectedPlan.plan_id}
                    </div>
                  </div>
                  <div className="grid gap-1 rounded-lg border border-border bg-bg-subtle p-3">
                    <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">
                      Kind
                    </div>
                    <div className="text-sm text-fg">{selectedPlan.kind}</div>
                  </div>
                  <div className="grid gap-1 rounded-lg border border-border bg-bg-subtle p-3">
                    <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">
                      Status
                    </div>
                    <div className="text-sm text-fg">{selectedPlan.status}</div>
                  </div>
                  <div className="grid gap-1 rounded-lg border border-border bg-bg-subtle p-3">
                    <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">
                      Event count
                    </div>
                    <div className="text-sm text-fg">{String(selectedPlan.event_count)}</div>
                  </div>
                  <div className="grid gap-1 rounded-lg border border-border bg-bg-subtle p-3">
                    <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">
                      Last activity
                    </div>
                    <div className="text-sm text-fg">{selectedPlan.last_event_at}</div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    isLoading={exportAction.isLoading}
                    onClick={() => {
                      void exportAction
                        .run(() => auditApi.exportReceiptBundle(selectedPlan.plan_key), {
                          throwOnError: true,
                        })
                        .catch((error: unknown) => {
                          toast.error("Export failed", {
                            description: formatErrorMessage(error),
                          });
                        });
                    }}
                  >
                    Export receipt bundle
                  </Button>
                  <ElevatedModeTooltip canMutate={canMutate} requestEnter={requestEnter}>
                    <Button
                      variant="danger"
                      disabled={forgetAction.isLoading}
                      onClick={() => {
                        setDialogOpen(true);
                      }}
                    >
                      Forget audit receipts…
                    </Button>
                  </ElevatedModeTooltip>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent>
                <EmptyState
                  icon={FileSearch}
                  title="Select a plan"
                  description="Choose a recent audited plan from the list to inspect its receipt data."
                />
              </CardContent>
            </Card>
          )}

          <AuditExportResultCard
            plan={selectedPlan}
            result={exportAction.value}
            onDownload={() => {
              if (!selectedPlan || !exportAction.value) return;
              try {
                downloadReceiptBundle(exportAction.value, selectedPlan.plan_key);
              } catch (error) {
                toast.error("Download failed", { description: formatErrorMessage(error) });
              }
            }}
          />

          <AuditForgetResultCard
            planKey={selectedPlan?.plan_key ?? selectedPlanKey}
            result={forgetAction.value}
          />
        </div>
      </CardContent>

      <ConfirmDangerDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title="Forget audit receipts?"
        description="This deletes the selected plan's stored receipt events and appends a proof event. It cannot be undone from this UI."
        confirmLabel="Forget receipts"
        confirmationLabel="I understand this will delete the stored audit receipts."
        isLoading={forgetAction.isLoading}
        onConfirm={async () => {
          if (!canMutate) {
            requestEnter();
            throw new Error("Authorize admin access to forget audit receipts.");
          }
          if (!selectedPlan) return;
          try {
            await forgetAction.run(
              async () => {
                const result = await auditApi.forget({
                  confirm: "FORGET",
                  entity_type: "plan",
                  entity_id: selectedPlan.plan_key,
                  decision: "delete",
                });
                await refreshPlans();
                return result;
              },
              { throwOnError: true },
            );
          } catch (error) {
            toast.error("Forget failed", { description: formatErrorMessage(error) });
            return false;
          }
        }}
      >
        {selectedPlan ? <AuditSelectionSummary plan={selectedPlan} /> : null}
      </ConfirmDangerDialog>
    </Card>
  );
}
