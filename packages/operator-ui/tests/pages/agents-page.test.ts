// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import type { OperatorCore } from "../../../operator-core/src/index.js";
import { createStore } from "../../../operator-core/src/store.js";
import { AgentsPage } from "../../src/components/pages/agents-page.js";
import { cleanupTestRoot, renderIntoDocument, setNativeValue } from "../test-utils.js";

function sampleAgentStatus() {
  return {
    enabled: true,
    home: "/tmp/agents/default",
    identity: {
      name: "Default Agent",
      description: "Primary operator agent",
    },
    model: {
      model: "openai/gpt-4.1",
      variant: "balanced",
      fallback: ["openai/gpt-4.1-mini"],
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
      ttl_days: 30,
      max_turns: 20,
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
        max_messages: 32,
        tool_prune_keep_last_messages: 4,
      },
    },
  } as const;
}

function createCore(agentListGet: ReturnType<typeof vi.fn>): {
  core: OperatorCore;
  setAgentKey: ReturnType<typeof vi.fn>;
  refresh: ReturnType<typeof vi.fn>;
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

  const core = {
    connectionStore,
    statusStore,
    agentStatusStore: {
      ...agentStatusStore,
      setAgentKey,
      refresh,
    },
    http: {
      agentList: { get: agentListGet },
    },
    memoryStore: {
      ...memoryStore,
      list: vi.fn().mockResolvedValue(undefined),
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

  return { core, setAgentKey, refresh };
}

describe("AgentsPage", () => {
  it("loads discovered agents, auto-selects a valid agent, and refreshes on selection changes", async () => {
    const agentListGet = vi.fn(async () => ({
      agents: [
        { agent_key: "default", agent_id: "11111111-1111-4111-8111-111111111111" },
        { agent_key: "agent-1", agent_id: "22222222-2222-4222-8222-222222222222" },
      ],
    }));
    const { core, setAgentKey, refresh } = createCore(agentListGet);

    const testRoot = renderIntoDocument(React.createElement(AgentsPage, { core }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(agentListGet).toHaveBeenCalledTimes(1);
    expect(setAgentKey).toHaveBeenCalledWith("default");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(testRoot.container.querySelector('[data-testid="agents-tab-identity"]')).not.toBeNull();
    expect(testRoot.container.querySelector('[data-testid="agents-tab-memory"]')).not.toBeNull();
    expect(testRoot.container.querySelector('[data-testid="agents-tab-runs"]')).not.toBeNull();

    const agentButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="agents-select-agent-1"]',
    );
    expect(agentButton).not.toBeNull();

    await act(async () => {
      agentButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(setAgentKey).toHaveBeenLastCalledWith("agent-1");
    expect(refresh).toHaveBeenCalledTimes(2);

    cleanupTestRoot(testRoot);
  });

  it("shows a manual agent-key fallback when discovery fails", async () => {
    const agentListGet = vi.fn(async () => {
      throw new Error("list failed");
    });
    const { core, setAgentKey, refresh } = createCore(agentListGet);

    const testRoot = renderIntoDocument(React.createElement(AgentsPage, { core }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(testRoot.container.textContent).toContain("Agent list unavailable");

    const input = testRoot.container.querySelector<HTMLInputElement>("input");
    expect(input).not.toBeNull();

    act(() => {
      setNativeValue(input as HTMLInputElement, "  agent-2  ");
    });

    const openButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="agents-select-apply"]',
    );
    expect(openButton).not.toBeNull();

    await act(async () => {
      openButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(setAgentKey).toHaveBeenLastCalledWith("agent-2");
    expect(refresh).toHaveBeenCalledTimes(1);

    cleanupTestRoot(testRoot);
  });
});
