// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { AgentsPage } from "../../src/components/pages/agents-page.js";
import { waitForSelector } from "../operator-ui.test-support.js";
import { cleanupTestRoot, click, renderIntoDocument, setNativeValue } from "../test-utils.js";
import {
  createCore,
  flush,
  sampleAvailableModels,
  sampleConfiguredProviders,
  sampleManagedAgentDetail,
  samplePresets,
} from "./agents-page.test-support.js";

describe("AgentsPage management", () => {
  it("creates a managed agent from the wizard and refreshes the list", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({
        agents: [
          {
            agent_key: "default",
            agent_id: "11111111-1111-4111-8111-111111111111",
            can_delete: false,
            is_primary: true,
            persona: { name: "Feynman" },
          },
        ],
      })
      .mockResolvedValueOnce({
        agents: [
          {
            agent_key: "default",
            agent_id: "11111111-1111-4111-8111-111111111111",
            can_delete: false,
            is_primary: true,
            persona: { name: "Feynman" },
          },
          {
            agent_key: "agent-2",
            agent_id: "33333333-3333-4333-8333-333333333333",
            can_delete: true,
            is_primary: false,
            persona: { name: "Agent Two" },
          },
        ],
      })
      .mockResolvedValueOnce({
        agents: [
          {
            agent_key: "default",
            agent_id: "11111111-1111-4111-8111-111111111111",
            can_delete: false,
            is_primary: true,
            persona: { name: "Feynman" },
          },
          {
            agent_key: "agent-2-2",
            agent_id: "44444444-4444-4444-8444-444444444444",
            can_delete: true,
            is_primary: false,
            persona: { name: "Agent 2" },
          },
        ],
      });
    const create = vi.fn().mockResolvedValue(sampleManagedAgentDetail("agent-2-2"));
    const { core, setAgentKey } = createCore({ list, create });

    const testRoot = renderIntoDocument(React.createElement(AgentsPage, { core }));
    await flush();

    const newButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="agents-new"]',
    );
    expect(newButton).not.toBeNull();

    await act(async () => {
      newButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const nameInput = testRoot.container.querySelector<HTMLInputElement>(
      '[data-testid="agents-create-name"]',
    );
    expect(nameInput).not.toBeNull();
    const randomizeButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="agents-create-randomize-name"]',
    );
    expect(randomizeButton).not.toBeNull();

    act(() => {
      randomizeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      setNativeValue(nameInput as HTMLInputElement, "Agent 2");
    });

    const saveButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="agents-create-save"]',
    );
    expect(saveButton).not.toBeNull();

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ agent_key: "agent-2-2" }));
    expect(list).toHaveBeenCalledTimes(3);
    expect(setAgentKey).toHaveBeenLastCalledWith("agent-2-2");

    cleanupTestRoot(testRoot);
  });

  it("shows the provider setup step when no provider is configured", async () => {
    const { core } = createCore({
      list: vi.fn().mockResolvedValue({
        agents: [
          {
            agent_key: "default",
            agent_id: "11111111-1111-4111-8111-111111111111",
            can_delete: false,
            is_primary: true,
            persona: { name: "Feynman" },
          },
        ],
      }),
      listProviders: vi.fn().mockResolvedValue({ status: "ok", providers: [] }),
      listPresets: vi.fn().mockResolvedValue({ status: "ok", presets: [] }),
      listAvailableModels: vi.fn().mockResolvedValue({ status: "ok", models: [] }),
    });

    const testRoot = renderIntoDocument(React.createElement(AgentsPage, { core }));
    await flush();

    await act(async () => {
      click(testRoot.container.querySelector<HTMLElement>('[data-testid="agents-new"]')!);
      await Promise.resolve();
    });

    expect(
      await waitForSelector(testRoot.container, '[data-testid="agents-create-step-provider"]'),
    ).not.toBeNull();

    cleanupTestRoot(testRoot);
  });

  it("creates a preset in the wizard when a provider is already configured", async () => {
    let presets = [] as Awaited<ReturnType<typeof samplePresets>>["presets"];
    const list = vi.fn().mockResolvedValue({
      agents: [
        {
          agent_key: "default",
          agent_id: "11111111-1111-4111-8111-111111111111",
          can_delete: false,
          is_primary: true,
          persona: { name: "Feynman" },
        },
      ],
    });
    const listProviders = vi.fn().mockResolvedValue(sampleConfiguredProviders());
    const listPresets = vi.fn(async () => ({ status: "ok" as const, presets }));
    const createPreset = vi.fn(async (input: { display_name: string }) => {
      const preset = {
        preset_id: "33333333-3333-4333-8333-333333333333",
        preset_key: "gpt-5-4",
        display_name: input.display_name,
        provider_key: "openrouter",
        model_id: "openai/gpt-5.4",
        options: {},
        created_at: "2026-03-08T00:00:00.000Z",
        updated_at: "2026-03-08T00:00:00.000Z",
      };
      presets = [preset];
      return { preset };
    });
    const { core } = createCore({
      list,
      listProviders,
      listPresets,
      listAvailableModels: vi.fn().mockResolvedValue(sampleAvailableModels()),
      createPreset,
    });

    const testRoot = renderIntoDocument(React.createElement(AgentsPage, { core }));
    await flush();

    await act(async () => {
      click(testRoot.container.querySelector<HTMLElement>('[data-testid="agents-new"]')!);
      await Promise.resolve();
    });

    expect(
      await waitForSelector(testRoot.container, '[data-testid="agents-create-step-preset"]'),
    ).not.toBeNull();

    act(() => {
      setNativeValue(
        Array.from(testRoot.container.querySelectorAll<HTMLInputElement>("input")).find((input) =>
          input.labels?.[0]?.textContent?.includes("Display name"),
        )!,
        "GPT-5.4",
      );
    });

    await act(async () => {
      click(
        Array.from(testRoot.container.querySelectorAll<HTMLButtonElement>("button")).find(
          (button) => button.textContent?.includes("Save model preset"),
        )!,
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(createPreset).toHaveBeenCalledTimes(1);
    expect(createPreset).toHaveBeenCalledWith({
      display_name: "GPT-5.4",
      model_id: "openai/gpt-5.4",
      options: {},
      provider_key: "openrouter",
    });
    expect(listPresets.mock.calls.length).toBeGreaterThanOrEqual(2);

    cleanupTestRoot(testRoot);
  });

  it("deletes the selected managed agent after confirmation", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({
        agents: [
          {
            agent_key: "default",
            agent_id: "11111111-1111-4111-8111-111111111111",
            can_delete: false,
            persona: { name: "Feynman" },
          },
          {
            agent_key: "agent-1",
            agent_id: "22222222-2222-4222-8222-222222222222",
            can_delete: true,
            persona: { name: "Ada" },
          },
        ],
      })
      .mockResolvedValueOnce({
        agents: [
          {
            agent_key: "default",
            agent_id: "11111111-1111-4111-8111-111111111111",
            can_delete: false,
            persona: { name: "Feynman" },
          },
        ],
      });
    const remove = vi.fn().mockResolvedValue({
      agent_id: "22222222-2222-4222-8222-222222222222",
      agent_key: "agent-1",
      deleted: true,
    });
    const { core, setAgentKey } = createCore({ list, remove });

    const testRoot = renderIntoDocument(React.createElement(AgentsPage, { core }));
    await flush();

    const agentButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="agents-select-agent-1"]',
    );
    expect(agentButton).not.toBeNull();

    await act(async () => {
      agentButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const deleteButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="agents-delete"]',
    );
    expect(deleteButton).not.toBeNull();

    await act(async () => {
      deleteButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const confirmDialog = document.querySelector<HTMLElement>(
      '[data-testid="confirm-danger-dialog"]',
    );
    expect(confirmDialog?.textContent).toContain("Delete Ada");
    expect(confirmDialog?.textContent).not.toContain("agent-1");

    const confirmCheckbox = document.querySelector<HTMLElement>(
      '[data-testid="confirm-danger-checkbox"]',
    );
    expect(confirmCheckbox).not.toBeNull();

    await act(async () => {
      if (confirmCheckbox) click(confirmCheckbox);
      await Promise.resolve();
    });

    const confirmButton = document.querySelector<HTMLButtonElement>(
      '[data-testid="confirm-danger-confirm"]',
    );
    expect(confirmButton).not.toBeNull();

    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(remove).toHaveBeenCalledWith("agent-1");
    expect(list).toHaveBeenCalledTimes(2);
    expect(setAgentKey).toHaveBeenLastCalledWith("default");

    cleanupTestRoot(testRoot);
  });
});
