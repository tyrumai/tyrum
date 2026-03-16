import { CheckCircle2 } from "lucide-react";
import type * as React from "react";
import { cn } from "../../lib/cn.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { StatusDot } from "../ui/status-dot.js";
import {
  FIRST_RUN_ONBOARDING_STEPS,
  type FirstRunOnboardingProgressItem,
  type FirstRunOnboardingRenderableStepId,
} from "./first-run-onboarding.shared.js";

const STEP_COPY = new Map(FIRST_RUN_ONBOARDING_STEPS.map((step) => [step.id, step] as const));

function getStepIndex(stepId: FirstRunOnboardingRenderableStepId): number {
  return FIRST_RUN_ONBOARDING_STEPS.findIndex((step) => step.id === stepId) + 1;
}

export function OnboardingProgressCard({
  items,
}: {
  items: readonly FirstRunOnboardingProgressItem[];
}): React.ReactElement {
  const completedCount = items.filter((item) => item.status === "done").length;
  const remainingCount = items.length - completedCount;
  const currentItem = items.find((item) => item.status === "current") ?? null;

  return (
    <Card data-testid="first-run-onboarding-progress">
      <CardHeader className="pb-3">
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-semibold text-fg">Setup progress</div>
            <div className="text-xs text-fg-muted">
              {completedCount} of {items.length} complete
            </div>
          </div>
          <div className="text-sm text-fg-muted">
            {currentItem
              ? `${remainingCount} step${remainingCount === 1 ? "" : "s"} remaining. Current: ${currentItem.title}.`
              : "All setup stages are complete."}
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        {items.map((item, index) => {
          const statusCopy =
            item.status === "done"
              ? "Complete"
              : item.status === "current"
                ? "Current step"
                : "Upcoming";

          return (
            <div
              key={item.id}
              data-testid={`first-run-onboarding-progress-${item.id}`}
              data-status={item.status}
              className={cn(
                "grid gap-2 rounded-xl border px-3 py-3 transition-colors",
                item.status === "done"
                  ? "border-success/30 bg-success/10"
                  : item.status === "current"
                    ? "border-primary/40 bg-primary-dim/20"
                    : "border-border/70 bg-bg",
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  {item.status === "done" ? (
                    <CheckCircle2 aria-hidden={true} className="h-4 w-4 text-success" />
                  ) : (
                    <StatusDot
                      aria-hidden={true}
                      variant={item.status === "current" ? "primary" : "neutral"}
                      pulse={item.status === "current"}
                    />
                  )}
                  <div className="text-xs font-medium tracking-[0.18em] text-fg-muted uppercase">
                    Step {index + 1}
                  </div>
                </div>
                <div className="text-xs font-medium text-fg-muted">{statusCopy}</div>
              </div>
              <div className="text-sm font-medium text-fg">{item.title}</div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export function OnboardingStepFrame({
  children,
  stepId,
}: {
  children: React.ReactNode;
  stepId: FirstRunOnboardingRenderableStepId;
}): React.ReactElement {
  const step = STEP_COPY.get(stepId);
  const stepIndex = getStepIndex(stepId);

  if (!step || stepIndex === 0) {
    throw new Error(`Unknown onboarding step: ${stepId}`);
  }

  return (
    <div className="grid gap-5">
      <div className="grid gap-2">
        <div className="text-xs font-medium tracking-[0.18em] text-fg-muted uppercase">
          Step {stepIndex} of {FIRST_RUN_ONBOARDING_STEPS.length}
        </div>
        <div className="grid gap-1">
          <h3 className="text-xl font-semibold text-fg">{step.title}</h3>
          <div className="text-sm text-fg-muted">{step.detail}</div>
        </div>
      </div>
      {children}
    </div>
  );
}
