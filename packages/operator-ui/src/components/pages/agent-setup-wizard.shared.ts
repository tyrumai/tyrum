import { AgentConfig, CODEX_AGENT_NAMES } from "@tyrum/contracts";
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

const ONBOARDING_STEP_COPY = new Map(
  FIRST_RUN_ONBOARDING_STEPS.map((step) => [step.id, step] as const),
);

export const HIDDEN_AGENT_PERSONA_DEFAULTS = {
  palette: "graphite",
  character: "architect",
} as const;

export function buildAgentConfigFromPreset(input: {
  baseConfig?: AgentConfigT | null;
  preset: ModelPreset;
  name: string;
  tone: string;
}): AgentConfigT {
  const baseConfig = input.baseConfig ?? AgentConfig.parse({ model: { model: null } });
  const memoryServerSettings = baseConfig.mcp.server_settings["memory"];

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
    skills: {
      default_mode: "allow",
      allow: [],
      deny: [],
      workspace_trusted: false,
    },
    mcp: {
      default_mode: "deny",
      allow: ["memory"],
      deny: [],
      pre_turn_tools: ["mcp.memory.seed"],
      server_settings: memoryServerSettings === undefined ? {} : { memory: memoryServerSettings },
    },
    tools: {
      default_mode: "allow",
      allow: [],
      deny: [],
    },
  });
}

export function buildAgentSetupStepMeta(input: {
  hasPresetStep: boolean;
  hasProviderStep: boolean;
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
  const totalSteps = Number(input.hasProviderStep) + Number(input.hasPresetStep) + 1;
  if (input.step === "provider") {
    return {
      title: "Add a provider account",
      description: "Connect a model provider so the wizard can discover available models.",
      stepIndex: 1,
      totalSteps,
    };
  }
  if (input.step === "preset") {
    return {
      title: "Choose or create a model preset",
      description: "Pick an existing preset or create a new one for this agent.",
      stepIndex: input.hasProviderStep ? 2 : 1,
      totalSteps,
    };
  }
  return {
    title: "Configure the agent",
    description: "Name the agent and choose its tone.",
    stepIndex: totalSteps,
    totalSteps,
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

export function pickRandomAgentName(input: {
  currentName: string;
  existingAgentNames: readonly string[];
  random?: () => number;
}): string {
  const random = input.random ?? Math.random;
  const normalizedCurrent = input.currentName.trim().toLowerCase();
  const usedNames = new Set(
    input.existingAgentNames
      .map((name) => name.trim().toLowerCase())
      .filter((name) => name.length > 0 && name !== normalizedCurrent),
  );
  const selectableNames = CODEX_AGENT_NAMES.filter((name) => {
    const normalizedName = name.toLowerCase();
    return normalizedName !== normalizedCurrent && !usedNames.has(normalizedName);
  });
  const fallbackNames = CODEX_AGENT_NAMES.filter((name) => !usedNames.has(name.toLowerCase()));
  const pool =
    selectableNames.length > 0
      ? selectableNames
      : fallbackNames.length > 0
        ? fallbackNames
        : CODEX_AGENT_NAMES;
  const index = Math.min(pool.length - 1, Math.floor(random() * pool.length));
  return pool[index] ?? CODEX_AGENT_NAMES[0];
}
