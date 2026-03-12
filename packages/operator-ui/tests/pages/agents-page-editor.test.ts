// @vitest-environment jsdom

import { AgentConfig, IdentityPack } from "@tyrum/schemas";
import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import type { OperatorCore } from "../../../operator-core/src/index.js";
import { createStore } from "../../../operator-core/src/store.js";
import { AgentsPageEditor } from "../../src/components/pages/agents-page-editor.js";
import { AgentsPage } from "../../src/components/pages/agents-page.js";
import { cleanupTestRoot, click, renderIntoDocument, setNativeValue } from "../test-utils.js";

function sampleManagedAgentDetail(agentKey: string) {
  return {
    agent_id:
      agentKey === "default"
        ? "11111111-1111-4111-8111-111111111111"
        : "22222222-2222-4222-8222-222222222222",
    agent_key: agentKey,
    created_at: "2026-03-08T00:00:00.000Z",
    updated_at: "2026-03-08T00:00:00.000Z",
    has_config: true,
    has_identity: true,
    can_delete: agentKey !== "default",
    persona: {
      name: agentKey === "default" ? "Default Agent" : "Agent One",
      tone: "direct",
      palette: "graphite",
      character: "architect",
    },
    config: AgentConfig.parse({
      model: { model: "openai/gpt-5.4" },
      persona: {
        name: agentKey === "default" ? "Default Agent" : "Agent One",
        tone: "direct",
        palette: "graphite",
        character: "architect",
      },
    }),
    identity: IdentityPack.parse({
      meta: {
        name: agentKey === "default" ? "Default Agent" : "Agent One",
        style: { tone: "direct" },
      },
    }),
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function samplePresets() {
  return {
    status: "ok" as const,
    presets: [
      {
        preset_id: "33333333-3333-4333-8333-333333333333",
        preset_key: "claude-opus-4-6-high",
        display_name: "Claude Opus 4.6 High",
        provider_key: "openrouter",
        model_id: "anthropic/claude-opus-4.6",
        options: { reasoning_effort: "high" as const },
        created_at: "2026-03-08T00:00:00.000Z",
        updated_at: "2026-03-08T00:00:00.000Z",
      },
      {
        preset_id: "44444444-4444-4444-8444-444444444444",
        preset_key: "gpt-5-4",
        display_name: "GPT-5.4",
        provider_key: "openrouter",
        model_id: "openai/gpt-5.4",
        options: {},
        created_at: "2026-03-08T00:00:00.000Z",
        updated_at: "2026-03-08T00:00:00.000Z",
      },
    ],
  };
}

function createCore(
  list: ReturnType<typeof vi.fn>,
  get: ReturnType<typeof vi.fn>,
  capabilities: ReturnType<typeof vi.fn>,
  update: ReturnType<typeof vi.fn>,
  listPresets = vi.fn().mockResolvedValue(samplePresets()),
) {
  const { store: connectionStore } = createStore({
    status: "connected",
    clientId: null,
    lastDisconnect: null,
    transportError: null,
    recovering: false,
  });
  const { store: statusStore } = createStore({
    status: { session_lanes: null },
    usage: null,
    presenceByInstanceId: {},
    loading: { status: false, usage: false, presence: false },
    error: { status: null, usage: null, presence: null },
    lastSyncedAt: null,
  });
  const { store: agentStatusStore } = createStore({
    agentKey: "missing-agent",
    status: null,
    loading: false,
    error: null,
    lastSyncedAt: null,
  });
  const { store: runsStore } = createStore({
    runsById: {},
    stepsById: {},
    attemptsById: {},
    stepIdsByRunId: {},
    attemptIdsByStepId: {},
  });
  const { store: memoryStore } = createStore({
    browse: { request: null, results: null, loading: false, error: null, lastSyncedAt: null },
    inspect: { agentId: null, memoryItemId: null, item: null, loading: false, error: null },
    tombstones: { tombstones: [], loading: false, error: null },
    export: { running: false, artifactId: null, error: null, lastExportedAt: null },
  });

  return {
    connectionStore,
    statusStore,
    agentStatusStore: {
      ...agentStatusStore,
      setAgentKey: vi.fn(),
      refresh: vi.fn().mockResolvedValue(undefined),
    },
    http: {
      agents: { list, get, capabilities, create: vi.fn(), update, delete: vi.fn() },
      modelConfig: {
        listPresets,
      },
    },
    memoryStore: {
      ...memoryStore,
      list: vi.fn(),
      search: vi.fn(),
      refreshBrowse: vi.fn(),
      loadMore: vi.fn(),
      inspect: vi.fn(),
      update: vi.fn(),
      forget: vi.fn(),
      export: vi.fn(),
    },
    runsStore,
  } as unknown as OperatorCore;
}

describe("AgentsPage editor", () => {
  it("preloads the selected agent into the editor and saves through update", async () => {
    const list = vi.fn(async () => ({
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
    }));
    const get = vi.fn().mockResolvedValue(sampleManagedAgentDetail("agent-1"));
    const capabilities = vi.fn(async () => ({
      skills: { default_mode: "allow", allow: [], deny: [], workspace_trusted: true, items: [] },
      mcp: { default_mode: "allow", allow: [], deny: [], items: [] },
      tools: { default_mode: "allow", allow: [], deny: [], items: [] },
    }));
    const update = vi.fn().mockResolvedValue(sampleManagedAgentDetail("agent-1"));
    const core = createCore(list, get, capabilities, update);

    const testRoot = renderIntoDocument(React.createElement(AgentsPage, { core }));
    await flush();
    expect(get).toHaveBeenCalledWith("default");

    const agentButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="agents-select-agent-1"]',
    );
    expect(agentButton).not.toBeNull();
    await act(async () => {
      agentButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(get).toHaveBeenLastCalledWith("agent-1");

    const editorTab = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="agents-tab-editor"]',
    );
    const saveButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="agents-editor-save"]',
    );
    expect(editorTab).not.toBeNull();
    expect(saveButton).not.toBeNull();

    await act(async () => {
      editorTab?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(update).toHaveBeenCalledWith(
      "agent-1",
      expect.objectContaining({ config: expect.any(Object) }),
    );
    cleanupTestRoot(testRoot);
  });

  it("replaces a legacy model with a configured preset and persists its options", async () => {
    const list = vi.fn(async () => ({
      agents: [
        {
          agent_key: "default",
          agent_id: "11111111-1111-4111-8111-111111111111",
          can_delete: false,
          persona: { name: "Feynman" },
        },
      ],
    }));
    const get = vi.fn().mockResolvedValue(sampleManagedAgentDetail("default"));
    const capabilities = vi.fn(async () => ({
      skills: { default_mode: "allow", allow: [], deny: [], workspace_trusted: true, items: [] },
      mcp: { default_mode: "allow", allow: [], deny: [], items: [] },
      tools: { default_mode: "allow", allow: [], deny: [], items: [] },
    }));
    const update = vi.fn().mockResolvedValue(sampleManagedAgentDetail("default"));
    const listPresets = vi.fn().mockResolvedValue(samplePresets());
    const core = createCore(list, get, capabilities, update, listPresets);

    const testRoot = renderIntoDocument(React.createElement(AgentsPage, { core }));
    await flush();

    const editorTab = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="agents-tab-editor"]',
    );
    const primaryToggle = testRoot.container.querySelector<HTMLElement>(
      '[data-testid="agents-editor-primary-model-toggle"]',
    );
    const saveButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="agents-editor-save"]',
    );

    expect(editorTab).not.toBeNull();
    expect(primaryToggle).not.toBeNull();
    expect(saveButton).not.toBeNull();

    await act(async () => {
      if (editorTab) click(editorTab);
      if (primaryToggle) click(primaryToggle);
      await Promise.resolve();
    });

    const primaryOption = testRoot.container.querySelector<HTMLElement>(
      '[data-testid="agents-editor-primary-model-option-claude-opus-4-6-high"]',
    );
    expect(primaryOption).not.toBeNull();

    await act(async () => {
      if (primaryOption) click(primaryOption);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      if (saveButton) click(saveButton);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(listPresets).toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      "default",
      expect.objectContaining({
        config: expect.objectContaining({
          model: expect.objectContaining({
            model: "openrouter/anthropic/claude-opus-4.6",
            options: { reasoning_effort: "high" },
          }),
        }),
      }),
    );

    cleanupTestRoot(testRoot);
  });

  it("debounces capability lookups while typing a new agent key", async () => {
    vi.useFakeTimers();
    try {
      const capabilities = vi.fn(async () => ({
        skills: { default_mode: "allow", allow: [], deny: [], workspace_trusted: true, items: [] },
        mcp: { default_mode: "allow", allow: [], deny: [], items: [] },
        tools: { default_mode: "allow", allow: [], deny: [], items: [] },
      }));
      const core = createCore(vi.fn(), vi.fn(), capabilities, vi.fn());

      const testRoot = renderIntoDocument(
        React.createElement(AgentsPageEditor, {
          core,
          mode: "create",
          createNonce: 1,
          onSaved: vi.fn(),
          onCancelCreate: vi.fn(),
        }),
      );
      await flush();

      expect(capabilities).toHaveBeenCalledTimes(1);
      expect(capabilities).toHaveBeenLastCalledWith("default");

      const agentKeyInput = testRoot.container.querySelector<HTMLInputElement>(
        '[data-testid="agents-editor-agent-key"]',
      );
      expect(agentKeyInput).not.toBeNull();

      act(() => {
        if (agentKeyInput) {
          setNativeValue(agentKeyInput, "agent-draft");
        }
      });
      await flush();

      expect(capabilities).toHaveBeenCalledTimes(1);

      await act(async () => {
        vi.advanceTimersByTime(249);
        await Promise.resolve();
      });
      expect(capabilities).toHaveBeenCalledTimes(1);

      await act(async () => {
        vi.advanceTimersByTime(1);
        await Promise.resolve();
      });
      await flush();

      expect(capabilities).toHaveBeenCalledTimes(2);
      expect(capabilities).toHaveBeenLastCalledWith("agent-draft");

      cleanupTestRoot(testRoot);
    } finally {
      vi.useRealTimers();
    }
  });
});
