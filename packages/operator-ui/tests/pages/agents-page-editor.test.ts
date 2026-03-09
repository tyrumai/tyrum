// @vitest-environment jsdom

import { AgentConfig, IdentityPack } from "@tyrum/schemas";
import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import type { OperatorCore } from "../../../operator-core/src/index.js";
import { createStore } from "../../../operator-core/src/store.js";
import { AgentsPage } from "../../src/components/pages/agents-page.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

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
      description: "Managed agent",
      tone: "direct",
      palette: "graphite",
      character: "architect",
    },
    config: AgentConfig.parse({
      model: { model: "openai/gpt-5.4" },
      persona: {
        name: agentKey === "default" ? "Default Agent" : "Agent One",
        description: "Managed agent",
        tone: "direct",
        palette: "graphite",
        character: "architect",
      },
    }),
    identity: IdentityPack.parse({
      meta: {
        name: agentKey === "default" ? "Default Agent" : "Agent One",
        description: "Managed agent",
        style: { tone: "direct" },
      },
      body: "",
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

function createCore(
  list: ReturnType<typeof vi.fn>,
  get: ReturnType<typeof vi.fn>,
  update: ReturnType<typeof vi.fn>,
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
    http: { agents: { list, get, create: vi.fn(), update, delete: vi.fn() } },
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
    const update = vi.fn().mockResolvedValue(sampleManagedAgentDetail("agent-1"));
    const core = createCore(list, get, update);

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
      expect.objectContaining({ config: expect.any(Object), identity: expect.any(Object) }),
    );
    cleanupTestRoot(testRoot);
  });
});
