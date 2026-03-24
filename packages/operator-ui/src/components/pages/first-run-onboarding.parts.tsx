import { CheckCircle2, ChevronLeft } from "lucide-react";
import type * as React from "react";
import { cn } from "../../lib/cn.js";
import { Button } from "../ui/button.js";
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
  activeStepId,
  className,
  items,
  onStepSelect,
}: {
  activeStepId: FirstRunOnboardingRenderableStepId;
  className?: string;
  items: readonly FirstRunOnboardingProgressItem[];
  onStepSelect: (stepId: FirstRunOnboardingRenderableStepId) => void;
}): React.ReactElement {
  const completedCount = items.filter((item) => item.status === "done").length;

  return (
    <Card
      className={cn("max-h-full overflow-hidden", className)}
      data-testid="first-run-onboarding-progress"
    >
      <CardHeader className="pb-3">
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-semibold text-fg">Setup steps</div>
            <div className="text-xs text-fg-muted">
              {completedCount} of {items.length} done
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex max-h-full gap-2 overflow-x-auto pb-4 xl:grid xl:gap-3 xl:overflow-auto xl:pb-4">
        {items.map((item, index) => {
          const selected = item.id === activeStepId;

          return (
            <button
              key={item.id}
              type="button"
              aria-current={selected ? "step" : undefined}
              data-testid={`first-run-onboarding-progress-${item.id}`}
              data-selected={selected ? "true" : "false"}
              data-status={item.status}
              onClick={() => onStepSelect(item.id)}
              className={cn(
                "min-w-[11rem] shrink-0 rounded-lg border px-3 py-3 text-left transition-colors xl:min-w-0",
                item.status === "done"
                  ? "border-success/30 bg-success/10"
                  : item.status === "current"
                    ? "border-primary/40 bg-primary-dim/20"
                    : "border-border/70 bg-bg",
                selected ? "ring-1 ring-primary/50 ring-inset" : null,
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="grid gap-1.5">
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
                    <div className="text-xs font-medium text-fg-muted">Step {index + 1}</div>
                  </div>
                  <div className="text-sm font-medium leading-5 text-fg">{item.title}</div>
                </div>
              </div>
            </button>
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
    <div className="grid gap-4">
      <div className="grid gap-2">
        <div className="text-sm font-medium text-fg-muted">
          Step {stepIndex} of {FIRST_RUN_ONBOARDING_STEPS.length}
        </div>
        <div className="grid gap-1">
          <h3 className="text-lg font-semibold text-fg">{step.title}</h3>
          <div className="text-sm text-fg-muted">{step.detail}</div>
        </div>
      </div>
      {children}
    </div>
  );
}

export function OnboardingBackButton({ onClick }: { onClick: () => void }): React.ReactElement {
  return (
    <div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="gap-1 px-1 text-fg-muted hover:text-fg"
        data-testid="first-run-onboarding-back"
        onClick={onClick}
      >
        <ChevronLeft className="h-4 w-4" aria-hidden={true} />
        Back
      </Button>
    </div>
  );
}
