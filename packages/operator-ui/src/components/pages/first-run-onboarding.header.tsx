import type * as React from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "../ui/button.js";
import type { FirstRunOnboardingStepId } from "./first-run-onboarding.shared.js";

export function FirstRunOnboardingHeader({
  onClose,
  onMarkCompleted,
  onRefresh,
  onSkip,
  step,
}: {
  onClose: () => void;
  onMarkCompleted: () => void;
  onRefresh: () => void;
  onSkip: () => void;
  step: FirstRunOnboardingStepId;
}): React.ReactElement {
  return (
    <section
      className="shrink-0 grid gap-4 rounded-2xl border border-border bg-bg-card px-5 py-5 shadow-sm md:grid-cols-[minmax(0,1fr)_auto] md:items-start"
      data-testid="first-run-onboarding-header"
    >
      <div className="grid gap-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold text-fg">Initial Setup</h2>
            </div>
            <div className="text-sm text-fg-muted">
              Finish the required setup before using the main operator workspace. You can skip now
              and resume later from the dashboard if needed.
            </div>
          </div>
        </div>
        <div className="text-xs text-fg-muted">
          Status is refreshed against the live gateway after each step.
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 md:justify-end">
        <Button type="button" variant="secondary" onClick={onRefresh}>
          Refresh
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            if (step === "done") {
              onMarkCompleted();
              onClose();
              return;
            }
            onSkip();
          }}
        >
          {step === "done" ? "Close" : "Skip setup"}
        </Button>
      </div>
    </section>
  );
}
