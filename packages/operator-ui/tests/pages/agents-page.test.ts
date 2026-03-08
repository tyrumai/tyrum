// @vitest-environment jsdom

import { AgentConfig, IdentityPack } from "@tyrum/schemas";
import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import type { OperatorCore } from "../../../operator-core/src/index.js";
import { createStore } from "../../../operator-core/src/store.js";
import { AgentsPage } from "../../src/components/pages/agents-page.js";
import { cleanupTestRoot, click, renderIntoDocument, setNativeValue } from "../test-utils.js";

function sampleAgentStatus() {
  return {
    enabled: true,
    home: "/tmp/agents/default",
    identity: {
      name: "Default Agent",
      description: "Primary operator agent",
    },
    model: {
      model: "openai/gpt-5.4",
      variant: "balanced",
      fallback: ["openai/gpt-5.4"],
    },
    skills: ["review"],
    skills_detailed: [
      {
        id: "review",
        name: "Review",
        version: "1.0.0",
        source: "bundled",
      },
    ],
    workspace_skills_trusted: true,
    mcp: [],
    tools: ["shell"],
    sessions: {
      ttl_days: 365,
      max_turns: 0,
      loop_detection: {
        within_turn: {
          enabled: true,
          consecutive_repeat_limit: 3,
          cycle_repeat_limit: 3,
        },
        cross_turn: {
          enabled: true,
          window_assistant_messages: 3,
          similarity_threshold: 0.97,
          min_chars: 120,
          cooldown_assistant_messages: 6,
        },
      },
      context_pruning: {
        max_messages: 0,
        tool_prune_keep_last_messages: 4,
      },
    },
  } as const;
}

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
        style: {
          tone: "direct",
        },
      },
      body: "",
    }),
    config_revision: 1,
    identity_revision: 1,
    config_sha256: "a".repeat(64),
    identity_sha256: "b".repeat(64),
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function createCore(options?: {
  list?: ReturnType<typeof vi.fn>;
  get?: ReturnType<typeof vi.fn>;
  create?: ReturnType<typeof vi.fn>;
  update?: ReturnType<typeof vi.fn>;
  remove?: ReturnType<typeof vi.fn>;
}): {
  core: OperatorCore;
  setAgentKey: ReturnType<typeof vi.fn>;
  refresh: ReturnType<typeof vi.fn>;
  memoryList: ReturnType<typeof vi.fn>;
} {
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
  const { store: agentStatusStore, setState: setAgentStatusState } = createStore({
    agentKey: "missing-agent",
    status: sampleAgentStatus(),
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

  const setAgentKey = vi.fn((agentKey: string) => {
    setAgentStatusState((prev) => ({ ...prev, agentKey }));
  });
  const refresh = vi.fn().mockResolvedValue(undefined);
  const memoryList = vi.fn().mockResolvedValue(undefined);

  const core = {
    connectionStore,
    statusStore,
    agentStatusStore: {
      ...agentStatusStore,
      setAgentKey,
      refresh,
    },
    http: {
      agents: {
        list: options?.list ?? vi.fn().mockResolvedValue({ agents: [] }),
        get: options?.get ?? vi.fn().mockResolvedValue(sampleManagedAgentDetail("default")),
        create: options?.create ?? vi.fn().mockResolvedValue(sampleManagedAgentDetail("default")),
        update: options?.update ?? vi.fn().mockResolvedValue(sampleManagedAgentDetail("default")),
        delete: options?.remove ?? vi.fn().mockResolvedValue({ deleted: true }),
      },
    },
    memoryStore: {
      ...memoryStore,
      list: memoryList,
      search: vi.fn().mockResolvedValue(undefined),
      refreshBrowse: vi.fn().mockResolvedValue(undefined),
      loadMore: vi.fn().mockResolvedValue(undefined),
      inspect: vi.fn().mockResolvedValue(undefined),
      update: vi.fn(),
      forget: vi.fn().mockResolvedValue(undefined),
      export: vi.fn().mockResolvedValue(undefined),
    },
    runsStore,
  } as unknown as OperatorCore;

  return { core, setAgentKey, refresh, memoryList };
}

describe("AgentsPage", () => {
  it("loads managed agents, auto-selects a valid agent, and refreshes on selection changes", async () => {
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
    const { core, setAgentKey, refresh } = createCore({ list });

    const testRoot = renderIntoDocument(React.createElement(AgentsPage, { core }));
    await flush();

    expect(list).toHaveBeenCalledTimes(1);
    expect(setAgentKey).toHaveBeenCalledWith("default");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(testRoot.container.querySelector('[data-testid="agents-tab-editor"]')).not.toBeNull();

    const agentButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="agents-select-agent-1"]',
    );
    expect(agentButton).not.toBeNull();
    expect(agentButton?.textContent).toContain("Ada");
    expect(agentButton?.textContent).toContain("agent-1");

    await act(async () => {
      agentButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(setAgentKey).toHaveBeenLastCalledWith("agent-1");
    expect(refresh).toHaveBeenCalledTimes(2);

    cleanupTestRoot(testRoot);
  });

  it("waits for a managed agent scope before loading memory", async () => {
    let resolveAgentList:
      | ((value: {
          agents: Array<{
            agent_key: string;
            agent_id: string;
            can_delete: boolean;
            persona?: { name?: string };
          }>;
        }) => void)
      | null = null;
    const list = vi.fn(
      () =>
        new Promise<{
          agents: Array<{
            agent_key: string;
            agent_id: string;
            can_delete: boolean;
            persona?: { name?: string };
          }>;
        }>((resolve) => {
          resolveAgentList = resolve;
        }),
    );
    const { core, memoryList } = createCore({ list });

    const testRoot = renderIntoDocument(React.createElement(AgentsPage, { core }));

    const memoryTab = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="agents-tab-memory"]',
    );
    expect(memoryTab).not.toBeNull();

    await act(async () => {
      if (memoryTab) click(memoryTab);
      await Promise.resolve();
    });

    expect(memoryList).not.toHaveBeenCalled();

    await act(async () => {
      resolveAgentList?.({
        agents: [
          {
            agent_key: "default",
            agent_id: "11111111-1111-4111-8111-111111111111",
            can_delete: false,
            persona: { name: "Feynman" },
          },
        ],
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(memoryList).toHaveBeenCalledTimes(1);
    expect(memoryList).toHaveBeenCalledWith({
      agentId: "11111111-1111-4111-8111-111111111111",
      limit: 50,
    });

    cleanupTestRoot(testRoot);
  });

  it("creates a managed agent from the editor", async () => {
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
          {
            agent_key: "agent-2",
            agent_id: "33333333-3333-4333-8333-333333333333",
            can_delete: true,
            persona: { name: "Agent Two" },
          },
        ],
      });
    const create = vi.fn().mockResolvedValue(sampleManagedAgentDetail("agent-2"));
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

    const keyInput = testRoot.container.querySelector<HTMLInputElement>(
      '[data-testid="agents-editor-agent-key"]',
    );
    expect(keyInput).not.toBeNull();

    act(() => {
      setNativeValue(keyInput as HTMLInputElement, "agent-2");
    });

    const saveButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="agents-editor-save"]',
    );
    expect(saveButton).not.toBeNull();

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ agent_key: "agent-2" }));
    expect(list).toHaveBeenCalledTimes(2);
    expect(setAgentKey).toHaveBeenLastCalledWith("agent-2");

    cleanupTestRoot(testRoot);
  });

  it("loads the selected agent into the editor and saves through update", async () => {
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
    const { core } = createCore({ list, get, update });

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

    const editButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="agents-edit"]',
    );
    expect(editButton).not.toBeNull();

    await act(async () => {
      editButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(get).toHaveBeenCalledWith("agent-1");

    const saveButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="agents-editor-save"]',
    );
    expect(saveButton).not.toBeNull();

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(
      "agent-1",
      expect.objectContaining({
        config: expect.any(Object),
        identity: expect.any(Object),
      }),
    );

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
