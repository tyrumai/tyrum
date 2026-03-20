// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { AgentsPageCreateWizard } from "../../src/components/pages/agents-page-create-wizard.js";
import { buildAgentPolicyBundle } from "../../src/components/pages/agent-setup-wizard.shared.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";
import { waitForSelector } from "../operator-ui.test-support.js";
import {
  createActiveProviderGroup,
  findButtonByText,
  setInputByLabel,
} from "../operator-ui.first-run-onboarding.helpers.js";
import {
  createCore,
  flush,
  sampleAvailableModels,
  samplePresets,
  sampleRegistry,
} from "./agents-page.test-support.js";

describe("AgentsPageCreateWizard", () => {
  it("runs the full provider, preset, and agent flow when setup data is missing", async () => {
    let providerCreated = false;
    let presetCreated = false;

    const createProviderAccount = vi.fn(async () => {
      providerCreated = true;
      return { status: "ok" as const };
    });
    const createPreset = vi.fn(async () => {
      presetCreated = true;
      return { preset: samplePresets().presets[0] };
    });
    const createAgent = vi.fn(
      async ({ agent_key, config }: { agent_key: string; config: unknown }) => ({
        ...config,
        agent_key,
      }),
    );
    const updateAgentPolicy = vi.fn(async () => ({}));
    const onCancel = vi.fn();
    const onSaved = vi.fn();

    const { core } = createCore({
      listProviders: vi.fn(async () => ({
        status: "ok" as const,
        providers: providerCreated ? [createActiveProviderGroup()] : [],
      })),
      listPresets: vi.fn(async () => ({
        status: "ok" as const,
        presets: presetCreated ? samplePresets().presets : [],
      })),
      listAvailableModels: vi.fn(async () => sampleAvailableModels()),
      listRegistry: vi.fn(async () => sampleRegistry()),
      createProviderAccount,
      createPreset,
      create: createAgent,
      updateAgentPolicy,
      list: vi.fn(async () => ({ agents: [] })),
    });

    const testRoot = renderIntoDocument(
      <AgentsPageCreateWizard core={core} onCancel={onCancel} onSaved={onSaved} />,
    );

    await waitForSelector(testRoot.container, '[data-testid="agents-create-step-provider"]');
    await flush();

    setInputByLabel(testRoot.container, "API key", "secret-key");
    setInputByLabel(testRoot.container, "Display name", "OpenRouter");
    await act(async () => {
      findButtonByText(testRoot.container, "Save provider account")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    await waitForSelector(testRoot.container, '[data-testid="agents-create-step-preset"]');
    setInputByLabel(testRoot.container, "Display name", "Shared Preset");
    await act(async () => {
      findButtonByText(testRoot.container, "Save model preset")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    await waitForSelector(testRoot.container, '[data-testid="agents-create-step-agent"]');
    setInputByLabel(testRoot.container, "Agent name", "Operations Agent");
    await act(async () => {
      findButtonByText(testRoot.container, "Create agent")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(createProviderAccount).toHaveBeenCalledOnce();
    expect(createPreset).toHaveBeenCalledOnce();
    expect(createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agent_key: "operations-agent",
        reason: "agents: create via setup wizard",
      }),
    );
    expect(updateAgentPolicy).toHaveBeenCalledWith("operations-agent", {
      bundle: buildAgentPolicyBundle("moderate"),
      reason: "agents: apply setup wizard policy preset",
    });
    expect(onCancel).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledWith("operations-agent");

    cleanupTestRoot(testRoot);
  });

  it("starts on the preset step when providers and presets already exist", async () => {
    const createAgent = vi.fn(
      async ({ agent_key, config }: { agent_key: string; config: unknown }) => ({
        ...config,
        agent_key,
      }),
    );
    const updateAgentPolicy = vi.fn(async () => ({}));
    const onSaved = vi.fn();

    const { core } = createCore({
      listProviders: vi.fn(async () => ({
        status: "ok" as const,
        providers: [createActiveProviderGroup()],
      })),
      listPresets: vi.fn(async () => samplePresets()),
      listAvailableModels: vi.fn(async () => sampleAvailableModels()),
      listRegistry: vi.fn(async () => sampleRegistry()),
      create: createAgent,
      updateAgentPolicy,
      list: vi.fn(async () => ({
        agents: [{ agent_key: "operations-agent", agent_id: "agent-1", is_primary: false }],
      })),
    });

    const testRoot = renderIntoDocument(
      <AgentsPageCreateWizard core={core} onCancel={vi.fn()} onSaved={onSaved} />,
    );

    await waitForSelector(testRoot.container, '[data-testid="agents-create-step-preset"]');
    await act(async () => {
      findButtonByText(testRoot.container, "Use selected preset")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });
    await waitForSelector(testRoot.container, '[data-testid="agents-create-step-agent"]');

    setInputByLabel(testRoot.container, "Agent name", "Operations Agent");
    await act(async () => {
      findButtonByText(testRoot.container, "Create agent")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agent_key: "operations-agent-2",
      }),
    );
    expect(onSaved).toHaveBeenCalledWith("operations-agent-2");

    cleanupTestRoot(testRoot);
  });
});
