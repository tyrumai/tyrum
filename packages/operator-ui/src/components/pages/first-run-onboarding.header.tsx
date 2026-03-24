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
      className="shrink-0 grid gap-4 rounded-lg border border-border bg-bg-card px-5 py-5 shadow-sm md:grid-cols-[minmax(0,1fr)_auto] md:items-start"
      data-testid="first-run-onboarding-header"
    >
      <div className="grid gap-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold text-fg">Set up Tyrum</h2>
            </div>
            <div className="text-sm text-fg-muted">
              Finish a few basics so Tyrum is ready to use. You can skip this for now and come back
              from the dashboard later.
            </div>
          </div>
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
          {step === "done" ? "Close" : "Skip for now"}
        </Button>
      </div>
    </section>
  );
}
