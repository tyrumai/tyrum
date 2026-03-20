// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { AgentConfig, CODEX_AGENT_NAMES } from "@tyrum/contracts";
import {
  buildAgentConfigFromPreset,
  buildAgentPolicyBundle,
  buildAgentSetupStepMeta,
  pickRandomAgentName,
} from "../../src/components/pages/agent-setup-wizard.shared.js";

const SAMPLE_PRESET = {
  preset_id: "33333333-3333-4333-8333-333333333333",
  preset_key: "gpt-5-4",
  display_name: "GPT-5.4",
  provider_key: "openrouter",
  model_id: "openai/gpt-5.4",
  options: {},
  created_at: "2026-03-08T00:00:00.000Z",
  updated_at: "2026-03-08T00:00:00.000Z",
} as const;

function buildConfig(policyPreset: "safest" | "moderate" | "power_user") {
  return buildAgentConfigFromPreset({
    baseConfig: AgentConfig.parse({ model: { model: null } }),
    preset: SAMPLE_PRESET,
    name: "Research Agent",
    tone: "direct",
    policyPreset,
  });
}

describe("agent-setup-wizard.shared", () => {
  it("builds the safest agent config and policy bundle", () => {
    const config = buildConfig("safest");
    const bundle = buildAgentPolicyBundle("safest");

    expect(config.persona).toEqual({
      name: "Research Agent",
      tone: "direct",
      palette: "graphite",
      character: "architect",
    });
    expect(config.skills).toMatchObject({
      default_mode: "deny",
      workspace_trusted: false,
      allow: [],
      deny: [],
    });
    expect(config.mcp).toMatchObject({
      default_mode: "deny",
      allow: [],
      deny: [],
      pre_turn_tools: [],
    });
    expect(config.tools).toEqual({ default_mode: "deny", allow: [], deny: [] });
    expect(bundle).toEqual({
      v: 1,
      tools: { allow: [], require_approval: [], deny: ["*"] },
      network_egress: { default: "deny", allow: [], require_approval: [], deny: [] },
      secrets: { default: "deny", allow: [], require_approval: [], deny: [] },
      connectors: { default: "deny", allow: [], require_approval: [], deny: [] },
      provenance: { untrusted_shell_requires_approval: true },
    });
  });

  it("builds the moderate agent config and policy bundle", () => {
    const config = buildConfig("moderate");
    const bundle = buildAgentPolicyBundle("moderate");

    expect(config.skills).toMatchObject({
      default_mode: "allow",
      workspace_trusted: false,
      allow: [],
      deny: [],
    });
    expect(config.mcp).toMatchObject({
      default_mode: "deny",
      allow: ["memory"],
      deny: [],
      pre_turn_tools: ["mcp.memory.seed"],
    });
    expect(config.tools).toEqual({ default_mode: "allow", allow: [], deny: [] });
    expect(bundle).toEqual({
      v: 1,
      tools: { allow: [], require_approval: [], deny: [] },
    });
  });

  it("builds the power user agent config and policy bundle", () => {
    const config = buildConfig("power_user");
    const bundle = buildAgentPolicyBundle("power_user");

    expect(config.skills).toMatchObject({
      default_mode: "allow",
      workspace_trusted: true,
      allow: [],
      deny: [],
    });
    expect(config.mcp).toMatchObject({
      default_mode: "allow",
      allow: [],
      deny: [],
      pre_turn_tools: ["mcp.memory.seed"],
    });
    expect(config.tools).toEqual({ default_mode: "allow", allow: [], deny: [] });
    expect(bundle).toEqual({
      v: 1,
      tools: { allow: ["*"], require_approval: [], deny: [] },
      network_egress: { default: "deny", allow: ["*"], require_approval: [], deny: [] },
      secrets: { default: "deny", allow: ["*"], require_approval: [], deny: [] },
      connectors: { default: "deny", allow: ["*"], require_approval: [], deny: [] },
      provenance: { untrusted_shell_requires_approval: false },
    });
  });

  it("counts the create-agent steps correctly when the preset step is skipped", () => {
    expect(
      buildAgentSetupStepMeta({
        mode: "create_agent",
        step: "agent",
        hasProviderStep: true,
        hasPresetStep: false,
      }),
    ).toMatchObject({
      stepIndex: 2,
      totalSteps: 2,
    });
  });

  it("picks a random canonical agent name while preferring unused names", () => {
    expect(
      pickRandomAgentName({
        currentName: "Hypatia",
        existingAgentNames: ["Euclid", "Archimedes"],
        random: () => 0,
      }),
    ).toBe("Ptolemy");

    expect(
      pickRandomAgentName({
        currentName: "Custom Agent",
        existingAgentNames: ["Euclid", "Archimedes", "Ptolemy"],
        random: () => 0.5,
      }),
    ).not.toBe("Euclid");
  });

  it("does not return the current canonical name when another unused name is available", () => {
    expect(
      pickRandomAgentName({
        currentName: "Hypatia",
        existingAgentNames: CODEX_AGENT_NAMES.filter(
          (name) => name !== "Hypatia" && name !== "Avicenna",
        ),
        random: () => 0,
      }),
    ).toBe("Avicenna");
  });
});
