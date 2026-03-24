import { CheckCircle2, ChevronDown } from "lucide-react";
import * as React from "react";
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
  const activeItem = items.find((item) => item.id === activeStepId) ?? null;
  const activeIndex = activeItem ? items.findIndex((item) => item.id === activeItem.id) : -1;
  const [mobileExpanded, setMobileExpanded] = React.useState(false);
  const mobilePanelId = React.useId();

  React.useEffect(() => {
    setMobileExpanded(false);
  }, [activeStepId]);

  const renderProgressButton = (
    item: FirstRunOnboardingProgressItem,
    index: number,
    testId: string,
    collapseOnSelect = false,
  ): React.ReactElement => {
    const selected = item.id === activeStepId;

    return (
      <button
        key={testId}
        type="button"
        aria-current={selected ? "step" : undefined}
        data-testid={testId}
        data-selected={selected ? "true" : "false"}
        data-status={item.status}
        onClick={() => {
          onStepSelect(item.id);
          if (collapseOnSelect) {
            setMobileExpanded(false);
          }
        }}
        className={cn(
          "w-full rounded-lg border px-3 py-3 text-left transition-colors",
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
  };

  return (
    <Card
      className={cn("self-start overflow-hidden", className)}
      data-testid="first-run-onboarding-progress"
    >
      <CardHeader className="pb-3">
        <div className="hidden gap-2 xl:grid">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-semibold text-fg">Setup steps</div>
            <div className="text-xs text-fg-muted">
              {completedCount} of {items.length} done
            </div>
          </div>
        </div>
        <div className="grid gap-3 xl:hidden">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold text-fg">Setup steps</div>
            <div className="text-xs text-fg-muted">
              {completedCount} of {items.length} done
            </div>
          </div>
          {activeItem ? (
            <button
              type="button"
              aria-controls={mobilePanelId}
              aria-expanded={mobileExpanded}
              data-testid="first-run-onboarding-progress-mobile-toggle"
              onClick={() => {
                setMobileExpanded((current) => !current);
              }}
              className={cn(
                "flex w-full items-start justify-between gap-3 rounded-lg border border-border/70 bg-bg px-3 py-3 text-left transition-colors",
                "hover:bg-bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
              )}
            >
              <div className="grid gap-1.5">
                <div className="flex items-center gap-2">
                  {activeItem.status === "done" ? (
                    <CheckCircle2 aria-hidden={true} className="h-4 w-4 text-success" />
                  ) : (
                    <StatusDot
                      aria-hidden={true}
                      variant={activeItem.status === "current" ? "primary" : "neutral"}
                      pulse={activeItem.status === "current"}
                    />
                  )}
                  <div className="text-xs font-medium text-fg-muted">
                    Step {activeIndex + 1} of {items.length}
                  </div>
                </div>
                <div className="text-sm font-medium leading-5 text-fg">{activeItem.title}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2 pt-0.5">
                <span className="text-xs text-fg-muted">{mobileExpanded ? "Hide" : "Change"}</span>
                <ChevronDown
                  aria-hidden={true}
                  className={cn(
                    "h-4 w-4 text-fg-muted transition-transform",
                    mobileExpanded ? "rotate-180" : null,
                  )}
                />
              </div>
            </button>
          ) : null}
        </div>
      </CardHeader>
      {mobileExpanded ? (
        <CardContent
          id={mobilePanelId}
          className="grid gap-2 pb-4 xl:hidden"
          data-testid="first-run-onboarding-progress-mobile-panel"
        >
          {items.map((item, index) =>
            renderProgressButton(
              item,
              index,
              `first-run-onboarding-progress-mobile-${item.id}`,
              true,
            ),
          )}
        </CardContent>
      ) : null}
      <CardContent className="hidden max-h-full gap-3 overflow-auto pb-4 xl:grid">
        {items.map((item, index) =>
          renderProgressButton(item, index, `first-run-onboarding-progress-${item.id}`),
        )}
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
