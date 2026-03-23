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
} from "./agents-page.test-support.tsx";

describe("AgentsPage management", () => {
  it("creates a managed agent from the popup wizard and refreshes the list", async () => {
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
        ],
      })
      .mockResolvedValue({
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
    const { core } = createCore({ list, create });

    const testRoot = renderIntoDocument(React.createElement(AgentsPage, { core }));
    await flush();

    await act(async () => {
      click(testRoot.container.querySelector<HTMLElement>('[data-testid="agents-new"]')!);
      await Promise.resolve();
    });

    const dialog = await waitForSelector(document.body, '[data-testid="agents-editor-dialog"]');
    expect(dialog).not.toBeNull();

    const nameInput = document.querySelector<HTMLInputElement>(
      '[data-testid="agents-create-name"]',
    );
    const randomizeButton = document.querySelector<HTMLButtonElement>(
      '[data-testid="agents-create-randomize-name"]',
    );
    const saveButton = document.querySelector<HTMLButtonElement>(
      '[data-testid="agents-create-save"]',
    );
    expect(nameInput).not.toBeNull();
    expect(randomizeButton).not.toBeNull();
    expect(saveButton).not.toBeNull();

    act(() => {
      randomizeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      setNativeValue(nameInput as HTMLInputElement, "Agent 2");
    });

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ agent_key: "agent-2-2" }));
    expect(list.mock.calls.length).toBeGreaterThanOrEqual(3);

    cleanupTestRoot(testRoot);
  });

  it("shows the provider setup step in the popup when no provider is configured", async () => {
    const { core } = createCore({
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
      await waitForSelector(document.body, '[data-testid="agents-create-step-provider"]'),
    ).not.toBeNull();

    cleanupTestRoot(testRoot);
  });

  it("creates a preset from the popup wizard when a provider is already configured", async () => {
    let presets = [] as Awaited<ReturnType<typeof samplePresets>>["presets"];
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
      listProviders: vi.fn().mockResolvedValue(sampleConfiguredProviders()),
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
      await waitForSelector(document.body, '[data-testid="agents-create-step-preset"]'),
    ).not.toBeNull();

    act(() => {
      setNativeValue(
        Array.from(document.querySelectorAll<HTMLInputElement>("input")).find((input) =>
          input.labels?.[0]?.textContent?.includes("Display name"),
        )!,
        "GPT-5.4",
      );
    });

    await act(async () => {
      click(
        Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
          button.textContent?.includes("Save model preset"),
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

  it("deletes a managed agent from the editor popup after confirmation", async () => {
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
          {
            agent_key: "agent-1",
            agent_id: "22222222-2222-4222-8222-222222222222",
            can_delete: true,
            is_primary: false,
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
            is_primary: true,
            persona: { name: "Feynman" },
          },
        ],
      });
    const remove = vi.fn().mockResolvedValue({ deleted: true });
    const { core } = createCore({ list, remove });

    const testRoot = renderIntoDocument(React.createElement(AgentsPage, { core }));
    await flush();

    await act(async () => {
      click(testRoot.container.querySelector<HTMLElement>('[data-testid="agents-edit-agent-1"]')!);
      await Promise.resolve();
    });

    await waitForSelector(document.body, '[data-testid="agents-editor-dialog"]');

    await act(async () => {
      click(document.querySelector<HTMLElement>('[data-testid="agents-delete"]')!);
      await Promise.resolve();
    });

    await waitForSelector(document.body, '[data-testid="confirm-danger-dialog"]');

    await act(async () => {
      click(document.querySelector<HTMLElement>('[data-testid="confirm-danger-checkbox"]')!);
      await Promise.resolve();
    });

    await act(async () => {
      click(document.querySelector<HTMLElement>('[data-testid="confirm-danger-confirm"]')!);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(remove).toHaveBeenCalledWith("agent-1");

    cleanupTestRoot(testRoot);
  });
});
