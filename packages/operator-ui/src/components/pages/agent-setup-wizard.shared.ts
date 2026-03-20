import { AgentConfig, PolicyBundle } from "@tyrum/contracts";
import type { AgentConfig as AgentConfigT } from "@tyrum/contracts";
import React from "react";
import { modelRefFor, type ModelPreset } from "./admin-http-models.shared.js";
import {
  FIRST_RUN_ONBOARDING_STEPS,
  type FirstRunOnboardingRenderableStepId,
} from "./first-run-onboarding.shared.js";

export type AgentSetupWizardMode = "first_run" | "create_agent";
export type AgentSetupWizardStep = "provider" | "preset" | "agent";
type StepMeta = {
  description: string;
  stepIndex: number;
  title: string;
  totalSteps: number;
};

export type AgentPolicyPresetKey = "safest" | "moderate" | "power_user";
const ONBOARDING_STEP_COPY = new Map(
  FIRST_RUN_ONBOARDING_STEPS.map((step) => [step.id, step] as const),
);

export const AGENT_POLICY_PRESET_OPTIONS: ReadonlyArray<{
  key: AgentPolicyPresetKey;
  label: string;
  description: string;
}> = [
  {
    key: "safest",
    label: "Safest",
    description: "Deny tools and external access by default.",
  },
  {
    key: "moderate",
    label: "Moderate",
    description: "Balanced defaults with memory enabled and standard approvals.",
  },
  {
    key: "power_user",
    label: "Power user",
    description: "Trust the workspace and allow broad access with fewer approvals.",
  },
] as const;

export const HIDDEN_AGENT_PERSONA_DEFAULTS = {
  palette: "graphite",
  character: "architect",
} as const;

export type AgentPolicyBundleInput = {
  v: 1;
  tools: {
    allow: string[];
    require_approval: string[];
    deny: string[];
  };
  network_egress?: {
    default: "allow" | "require_approval" | "deny";
    allow: string[];
    require_approval: string[];
    deny: string[];
  };
  secrets?: {
    default: "allow" | "require_approval" | "deny";
    allow: string[];
    require_approval: string[];
    deny: string[];
  };
  connectors?: {
    default: "allow" | "require_approval" | "deny";
    allow: string[];
    require_approval: string[];
    deny: string[];
  };
  provenance?: {
    untrusted_shell_requires_approval: boolean;
  };
};

export function buildAgentConfigFromPreset(input: {
  baseConfig?: AgentConfigT | null;
  preset: ModelPreset;
  name: string;
  tone: string;
  policyPreset: AgentPolicyPresetKey;
}): AgentConfigT {
  const baseConfig = input.baseConfig ?? AgentConfig.parse({ model: { model: null } });
  const memoryServerSettings = baseConfig.mcp.server_settings["memory"];

  const policyDefaults =
    input.policyPreset === "safest"
      ? {
          skills: {
            default_mode: "deny" as const,
            allow: [],
            deny: [],
            workspace_trusted: false,
          },
          mcp: {
            default_mode: "deny" as const,
            allow: [],
            deny: [],
            pre_turn_tools: [] as string[],
          },
          tools: {
            default_mode: "deny" as const,
            allow: [],
            deny: [],
          },
        }
      : input.policyPreset === "power_user"
        ? {
            skills: {
              default_mode: "allow" as const,
              allow: [],
              deny: [],
              workspace_trusted: true,
            },
            mcp: {
              default_mode: "allow" as const,
              allow: [],
              deny: [],
              pre_turn_tools: ["mcp.memory.seed"],
            },
            tools: {
              default_mode: "allow" as const,
              allow: [],
              deny: [],
            },
          }
        : {
            skills: {
              default_mode: "allow" as const,
              allow: [],
              deny: [],
              workspace_trusted: false,
            },
            mcp: {
              default_mode: "deny" as const,
              allow: ["memory"],
              deny: [],
              pre_turn_tools: ["mcp.memory.seed"],
            },
            tools: {
              default_mode: "allow" as const,
              allow: [],
              deny: [],
            },
          };

  return AgentConfig.parse({
    ...baseConfig,
    model: {
      model: modelRefFor(input.preset),
      ...(Object.keys(input.preset.options).length > 0 ? { options: input.preset.options } : {}),
    },
    persona: {
      name: input.name.trim(),
      tone: input.tone.trim(),
      palette: HIDDEN_AGENT_PERSONA_DEFAULTS.palette,
      character: HIDDEN_AGENT_PERSONA_DEFAULTS.character,
    },
    skills: policyDefaults.skills,
    mcp: {
      ...policyDefaults.mcp,
      server_settings: memoryServerSettings === undefined ? {} : { memory: memoryServerSettings },
    },
    tools: policyDefaults.tools,
  });
}

export function buildAgentPolicyBundle(policyPreset: AgentPolicyPresetKey): AgentPolicyBundleInput {
  const baseBundle = {
    v: 1 as const,
    tools: {
      allow: [] as string[],
      require_approval: [] as string[],
      deny: [] as string[],
    },
  };
  if (policyPreset === "safest") {
    const bundle = {
      ...baseBundle,
      tools: { allow: [], require_approval: [], deny: ["*"] },
      network_egress: { default: "deny" as const, allow: [], require_approval: [], deny: [] },
      secrets: { default: "deny" as const, allow: [], require_approval: [], deny: [] },
      connectors: { default: "deny" as const, allow: [], require_approval: [], deny: [] },
      provenance: { untrusted_shell_requires_approval: true },
    };
    PolicyBundle.parse(bundle);
    return bundle;
  }
  if (policyPreset === "power_user") {
    const bundle = {
      ...baseBundle,
      tools: { allow: ["*"], require_approval: [], deny: [] },
      network_egress: { default: "deny" as const, allow: ["*"], require_approval: [], deny: [] },
      secrets: { default: "deny" as const, allow: ["*"], require_approval: [], deny: [] },
      connectors: { default: "deny" as const, allow: ["*"], require_approval: [], deny: [] },
      provenance: { untrusted_shell_requires_approval: false },
    };
    PolicyBundle.parse(bundle);
    return bundle;
  }
  PolicyBundle.parse(baseBundle);
  return baseBundle;
}

export function buildAgentSetupStepMeta(input: {
  canReturnToProvider: boolean;
  mode: AgentSetupWizardMode;
  step: AgentSetupWizardStep;
}): StepMeta {
  if (input.mode === "first_run") {
    const copy = ONBOARDING_STEP_COPY.get(input.step as FirstRunOnboardingRenderableStepId);
    if (!copy) {
      throw new Error(`Unknown onboarding step '${input.step}'`);
    }
    return {
      title: copy.title,
      description: copy.detail,
      stepIndex: FIRST_RUN_ONBOARDING_STEPS.findIndex((step) => step.id === copy.id) + 1,
      totalSteps: FIRST_RUN_ONBOARDING_STEPS.length,
    };
  }
  if (input.step === "provider") {
    return {
      title: "Add a provider account",
      description: "Connect a model provider so the wizard can discover available models.",
      stepIndex: 1,
      totalSteps: 3,
    };
  }
  if (input.step === "preset") {
    return {
      title: "Choose or create a model preset",
      description: "Pick an existing preset or create a new one for this agent.",
      stepIndex: input.canReturnToProvider ? 2 : 1,
      totalSteps: input.canReturnToProvider ? 3 : 2,
    };
  }
  return {
    title: "Configure the agent",
    description: "Name the agent, choose its tone, and apply an agent policy preset.",
    stepIndex: input.canReturnToProvider ? 3 : 2,
    totalSteps: input.canReturnToProvider ? 3 : 2,
  };
}

export function agentSetupWizardTestId(
  mode: AgentSetupWizardMode,
  step: AgentSetupWizardStep,
): string {
  const prefix = mode === "first_run" ? "first-run-onboarding" : "agents-create";
  return `${prefix}-step-${step}`;
}

export function AgentSetupStepFrame({
  children,
  meta,
}: {
  children: React.ReactNode;
  meta: StepMeta;
}): React.ReactElement {
  return React.createElement(
    "div",
    { className: "grid gap-5" },
    React.createElement(
      "div",
      { className: "grid gap-2" },
      React.createElement(
        "div",
        { className: "text-xs font-medium tracking-[0.18em] text-fg-muted uppercase" },
        `Step ${meta.stepIndex} of ${meta.totalSteps}`,
      ),
      React.createElement(
        "div",
        { className: "grid gap-1" },
        React.createElement("h3", { className: "text-xl font-semibold text-fg" }, meta.title),
        React.createElement("div", { className: "text-sm text-fg-muted" }, meta.description),
      ),
    ),
    children,
  );
}

export function slugifyAgentKey(raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  if (!normalized || normalized === "default") {
    return "agent";
  }
  return normalized;
}

export function createUniqueAgentKey(input: {
  agentName: string;
  existingAgentKeys: readonly string[];
  currentAgentKey?: string | null;
}): string {
  const existing = new Set(
    input.existingAgentKeys.filter((key) => key !== input.currentAgentKey && key.trim().length > 0),
  );
  const base = slugifyAgentKey(input.agentName);
  if (!existing.has(base)) {
    return base;
  }
  for (let index = 2; index <= 999; index += 1) {
    const candidate = `${base}-${String(index)}`;
    if (!existing.has(candidate)) {
      return candidate;
    }
  }
  return `${base}-${String(Date.now()).slice(-6)}`;
}
