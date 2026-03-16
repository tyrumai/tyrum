import type { StatusResponse } from "@tyrum/client";

const STORAGE_KEY_PREFIX = "tyrum.first-run-onboarding";

const RELEVANT_CODES = new Set<StatusResponse["config_health"]["issues"][number]["code"]>([
  "no_provider_accounts",
  "no_model_presets",
  "execution_profile_unassigned",
  "execution_profile_provider_unconfigured",
  "execution_profile_model_unavailable",
  "agent_model_unconfigured",
  "agent_provider_unconfigured",
  "agent_model_unavailable",
]);

const EXECUTION_CODES = new Set<StatusResponse["config_health"]["issues"][number]["code"]>([
  "execution_profile_unassigned",
  "execution_profile_provider_unconfigured",
  "execution_profile_model_unavailable",
]);

const AGENT_CODES = new Set<StatusResponse["config_health"]["issues"][number]["code"]>([
  "agent_model_unconfigured",
  "agent_provider_unconfigured",
  "agent_model_unavailable",
]);

export type FirstRunOnboardingIssue = StatusResponse["config_health"]["issues"][number];
export type FirstRunOnboardingIssueBadge = {
  key: string;
  label: string;
  variant: "danger" | "warning";
};
export type FirstRunOnboardingStepId =
  | "admin"
  | "provider"
  | "preset"
  | "assignments"
  | "agent"
  | "done";
export type FirstRunOnboardingRenderableStepId = Exclude<FirstRunOnboardingStepId, "done">;
export type FirstRunOnboardingStoredState = {
  issueSignature?: string;
  status: "skipped" | "completed";
};
export type FirstRunOnboardingProgressStatus = "done" | "current" | "upcoming";
export type FirstRunOnboardingProgressItem = {
  id: FirstRunOnboardingRenderableStepId;
  title: string;
  detail: string;
  status: FirstRunOnboardingProgressStatus;
};

export const FIRST_RUN_ONBOARDING_STEPS: ReadonlyArray<{
  id: FirstRunOnboardingRenderableStepId;
  title: string;
  detail: string;
}> = [
  {
    id: "admin",
    title: "Authorize admin access",
    detail: "Unlock temporary admin access once so Tyrum can save the initial configuration.",
  },
  {
    id: "provider",
    title: "Add a provider account",
    detail: "Connect at least one model provider so Tyrum can discover available models.",
  },
  {
    id: "preset",
    title: "Create a model preset",
    detail: "Save one reusable preset to use as the default setup target.",
  },
  {
    id: "assignments",
    title: "Assign execution profiles",
    detail: "Apply a preset across the built-in execution profiles so runtime selection works.",
  },
  {
    id: "agent",
    title: "Set the default agent model",
    detail: "Finish by giving the default agent a primary model so new sessions can run.",
  },
] as const;
const ISSUE_BADGE_COPY: Partial<
  Record<FirstRunOnboardingIssue["code"], { key: string; label: string }>
> = {
  no_provider_accounts: { key: "providers", label: "Provider account" },
  no_model_presets: { key: "presets", label: "Model preset" },
  execution_profile_unassigned: { key: "execution-profiles", label: "Execution profiles" },
  execution_profile_provider_unconfigured: {
    key: "execution-profiles",
    label: "Execution profiles",
  },
  execution_profile_model_unavailable: {
    key: "execution-profiles",
    label: "Execution profiles",
  },
  agent_model_unconfigured: { key: "default-agent", label: "Default agent" },
  agent_provider_unconfigured: { key: "default-agent", label: "Default agent" },
  agent_model_unavailable: { key: "default-agent", label: "Default agent" },
};

const ONBOARDING_STEP_INDEX = new Map(
  FIRST_RUN_ONBOARDING_STEPS.map((step, index) => [step.id, index] as const),
);

export function supportsFirstRunOnboarding(hostKind: "desktop" | "mobile" | "web"): boolean {
  return hostKind === "desktop" || hostKind === "web";
}

export function getRelevantOnboardingIssues(
  issues: readonly FirstRunOnboardingIssue[],
): FirstRunOnboardingIssue[] {
  return issues.filter((issue) => RELEVANT_CODES.has(issue.code));
}

export function summarizeOnboardingIssues(
  issues: readonly FirstRunOnboardingIssue[],
): FirstRunOnboardingIssueBadge[] {
  const summarized = new Map<string, FirstRunOnboardingIssueBadge>();
  for (const issue of getRelevantOnboardingIssues(issues)) {
    const copy = ISSUE_BADGE_COPY[issue.code];
    if (!copy) continue;
    const nextVariant = issue.severity === "error" ? "danger" : "warning";
    const current = summarized.get(copy.key);
    if (!current) {
      summarized.set(copy.key, {
        key: copy.key,
        label: copy.label,
        variant: nextVariant,
      });
      continue;
    }
    if (current.variant !== "danger" && nextVariant === "danger") {
      summarized.set(copy.key, { ...current, variant: "danger" });
    }
  }
  return Array.from(summarized.values());
}

export function buildOnboardingProgressItems(
  currentStep: FirstRunOnboardingStepId,
): FirstRunOnboardingProgressItem[] {
  const activeIndex =
    currentStep === "done"
      ? FIRST_RUN_ONBOARDING_STEPS.length
      : (ONBOARDING_STEP_INDEX.get(currentStep) ?? 0);

  return FIRST_RUN_ONBOARDING_STEPS.map((step, index) => {
    const status =
      currentStep === "done" || index < activeIndex
        ? "done"
        : index === activeIndex
          ? "current"
          : "upcoming";

    return {
      id: step.id,
      title: step.title,
      detail: step.detail,
      status,
    };
  });
}

export function buildOnboardingIssueSignature(issues: readonly FirstRunOnboardingIssue[]): string {
  return getRelevantOnboardingIssues(issues)
    .map((issue) => `${issue.code}:${issue.target.kind}:${issue.target.id ?? ""}`)
    .toSorted((left, right) => left.localeCompare(right))
    .join("|");
}

export function readOnboardingStoredState(scopeKey: string): FirstRunOnboardingStoredState | null {
  try {
    const raw = globalThis.localStorage?.getItem(`${STORAGE_KEY_PREFIX}:${scopeKey}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const issueSignature = (parsed as { issueSignature?: unknown }).issueSignature;
    const status = (parsed as { status?: unknown }).status;
    if (status === "dismissed") {
      return typeof issueSignature === "string"
        ? { issueSignature, status: "skipped" }
        : { status: "skipped" };
    }
    if (status !== "skipped" && status !== "completed") return null;
    if (typeof issueSignature === "string") {
      return { issueSignature, status };
    }
    return { status };
  } catch {
    return null;
  }
}

export function writeOnboardingStoredState(
  scopeKey: string,
  value: FirstRunOnboardingStoredState,
): void {
  try {
    globalThis.localStorage?.setItem(`${STORAGE_KEY_PREFIX}:${scopeKey}`, JSON.stringify(value));
  } catch {
    // localStorage unavailable
  }
}

export function clearOnboardingStoredState(scopeKey: string): void {
  try {
    globalThis.localStorage?.removeItem(`${STORAGE_KEY_PREFIX}:${scopeKey}`);
  } catch {
    // localStorage unavailable
  }
}

export function resolveFirstRunOnboardingStep(input: {
  issues: readonly FirstRunOnboardingIssue[];
  activeProviderCount: number;
  availableModelCount: number;
  presetCount: number;
}): FirstRunOnboardingStepId {
  if (input.issues.length === 0) return "done";
  if (
    input.activeProviderCount === 0 ||
    (input.availableModelCount === 0 && input.presetCount === 0)
  ) {
    return "provider";
  }
  if (input.presetCount === 0) {
    return "preset";
  }
  if (input.issues.some((issue) => EXECUTION_CODES.has(issue.code))) {
    return "assignments";
  }
  if (input.issues.some((issue) => AGENT_CODES.has(issue.code))) {
    return "agent";
  }
  return "done";
}
