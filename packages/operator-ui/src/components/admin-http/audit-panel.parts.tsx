import type {
  AuditExportResult,
  AuditForgetResult,
  AuditPlansListResult,
} from "@tyrum/operator-core/browser";
import { FileSearch, RefreshCw } from "lucide-react";
import * as React from "react";
import { cn } from "../../lib/cn.js";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import { toSafeJsonDownloadFileName } from "../pages/admin-http-shared.js";
import { Alert } from "../ui/alert.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { EmptyState } from "../ui/empty-state.js";
import { Input } from "../ui/input.js";
import { ScrollArea } from "../ui/scroll-area.js";

export type AuditPlanSummary = AuditPlansListResult["plans"][number];

export function downloadReceiptBundle(bundle: AuditExportResult, planKey: string): void {
  if (typeof Blob !== "function" || typeof globalThis.URL?.createObjectURL !== "function") {
    throw new Error("Receipt bundle download is not supported in this environment.");
  }

  const serialized = JSON.stringify(bundle, null, 2);
  const blob = new Blob([serialized], { type: "application/json" });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = toSafeJsonDownloadFileName(`${planKey}-receipt-bundle`, "receipt-bundle.json");
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

function AuditSummaryField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="grid gap-1 rounded-lg border border-border bg-bg-subtle p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">{label}</div>
      <div className={cn("text-sm text-fg break-words", mono ? "font-mono" : null)}>{value}</div>
    </div>
  );
}

export function AuditSelectionSummary({ plan }: { plan: AuditPlanSummary }): React.ReactElement {
  return (
    <div className="grid gap-2 text-sm text-fg">
      <div>
        <span className="text-fg-muted">Plan:</span>{" "}
        <span className="font-mono">{plan.plan_key}</span>
      </div>
      <div>
        <span className="text-fg-muted">Events:</span> {String(plan.event_count)}
      </div>
      <div>
        <span className="text-fg-muted">Last activity:</span> {plan.last_event_at}
      </div>
    </div>
  );
}

export function AuditPlansBrowser({
  plans,
  selectedPlanKey,
  filterValue,
  isLoading,
  error,
  onFilterChange,
  onRefresh,
  onSelectPlan,
}: {
  plans: AuditPlanSummary[];
  selectedPlanKey: string | null;
  filterValue: string;
  isLoading: boolean;
  error: unknown;
  onFilterChange: (value: string) => void;
  onRefresh: () => Promise<void>;
  onSelectPlan: (planKey: string) => void;
}) {
  return (
    <Card>
      <CardHeader className="gap-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-fg">Recent audited plans</div>
            <div className="text-sm text-fg-muted">
              Browse recent receipt streams and pick the plan to inspect.
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            isLoading={isLoading}
            onClick={() => {
              void onRefresh();
            }}
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Refresh
          </Button>
        </div>
        <Input
          data-testid="audit-plan-filter"
          label="Find plan"
          placeholder="Filter by plan, kind, or status"
          value={filterValue}
          onChange={(event) => {
            onFilterChange(event.currentTarget.value);
          }}
        />
      </CardHeader>
      <CardContent className="grid gap-3">
        {error ? (
          <Alert
            variant="error"
            title="Could not load audited plans"
            description={formatErrorMessage(error)}
          />
        ) : null}

        <ScrollArea className="h-[360px] rounded-lg border border-border">
          <div className="grid gap-2 p-2">
            {plans.length === 0 ? (
              <EmptyState
                icon={FileSearch}
                title={filterValue.trim().length > 0 ? "No matching plans" : "No audited plans yet"}
                description={
                  filterValue.trim().length > 0
                    ? "Try a broader filter to find the plan you want."
                    : "Plans with audit receipts will appear here when execution events are available."
                }
              />
            ) : (
              plans.map((plan) => {
                const isSelected = plan.plan_key === selectedPlanKey;
                return (
                  <button
                    key={plan.plan_key}
                    type="button"
                    className={cn(
                      "grid gap-1 rounded-lg border px-3 py-3 text-left transition-colors",
                      isSelected
                        ? "border-primary bg-primary-dim/20"
                        : "border-border bg-bg-card hover:bg-bg-subtle",
                    )}
                    onClick={() => {
                      onSelectPlan(plan.plan_key);
                    }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-sm text-fg">{plan.plan_key}</span>
                      <span className="text-xs uppercase tracking-wide text-fg-muted">
                        {plan.status}
                      </span>
                    </div>
                    <div className="text-sm text-fg-muted">
                      {String(plan.event_count)} events · {plan.kind}
                    </div>
                    <div className="text-xs text-fg-muted">{plan.last_event_at}</div>
                  </button>
                );
              })
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

export function AuditExportResultCard({
  plan,
  result,
  onDownload,
}: {
  plan: AuditPlanSummary | null;
  result: AuditExportResult | undefined;
  onDownload: () => void;
}) {
  if (!result) return null;

  const verification = result?.chain_verification;

  return (
    <Card>
      <CardHeader>
        <div className="text-sm font-medium text-fg">Export result</div>
      </CardHeader>
      <CardContent className="grid gap-3">
        {result ? (
          <Alert
            variant={verification?.valid ? "success" : "warning"}
            title={
              verification?.valid
                ? "Receipt bundle exported"
                : "Receipt bundle exported with warnings"
            }
            description={
              verification?.valid
                ? "The exported receipt chain verified successfully."
                : "The export completed, but the chain verification reported a broken point."
            }
          />
        ) : null}
        {result ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <AuditSummaryField label="Plan" value={plan?.plan_key ?? "Unknown"} mono />
              <AuditSummaryField label="Internal plan ID" value={result.plan_id} mono />
              <AuditSummaryField
                label="Chain status"
                value={result.chain_verification.valid ? "Valid" : "Broken"}
              />
              <AuditSummaryField
                label="Checked events"
                value={String(result.chain_verification.checked_count)}
              />
              <AuditSummaryField label="Exported at" value={result.exported_at} />
              <AuditSummaryField label="Bundle events" value={String(result.events.length)} />
              <AuditSummaryField
                label="Broken at index"
                value={
                  result.chain_verification.broken_at_index === null
                    ? "None"
                    : String(result.chain_verification.broken_at_index)
                }
              />
              <AuditSummaryField
                label="Broken at event"
                value={
                  result.chain_verification.broken_at_id === null
                    ? "None"
                    : String(result.chain_verification.broken_at_id)
                }
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={onDownload}>
                Download receipt bundle
              </Button>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function AuditForgetResultCard({
  planKey,
  result,
}: {
  planKey: string | null;
  result: AuditForgetResult | undefined;
}) {
  if (!result) return null;

  return (
    <Card>
      <CardHeader>
        <div className="text-sm font-medium text-fg">Forget result</div>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Alert
          variant="success"
          title="Audit receipts forgotten"
          description="The selected plan now keeps only the new proof event."
        />
        {result ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <AuditSummaryField label="Plan" value={planKey ?? "Unknown"} mono />
            <AuditSummaryField label="Deleted receipts" value={String(result.deleted_count)} />
            <AuditSummaryField label="Proof event ID" value={String(result.proof_event_id)} />
            <AuditSummaryField label="Decision" value={result.decision} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
