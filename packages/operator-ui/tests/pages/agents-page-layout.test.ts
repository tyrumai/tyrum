// @vitest-environment jsdom

import React, { act } from "react";
import { AgentConfig, IdentityPack } from "@tyrum/contracts";
import { describe, expect, it, vi } from "vitest";
import type { OperatorCore } from "../../../operator-app/src/index.js";
import { createStore } from "../../../operator-app/src/store.js";
import { AgentsPage } from "../../src/components/pages/agents-page.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

function sampleAgentStatus() {
  return {
    enabled: true,
    home: "/tmp/agents/default",
    identity: {
      name: "Default Agent",
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

function sampleManagedAgentDetail() {
  return {
    agent_id: "11111111-1111-4111-8111-111111111111",
    agent_key: "default",
    created_at: "2026-03-08T00:00:00.000Z",
    updated_at: "2026-03-08T00:00:00.000Z",
    has_config: true,
    has_identity: true,
    can_delete: false,
    persona: {
      name: "Default Agent",
      tone: "direct",
      palette: "graphite",
      character: "architect",
    },
    config: AgentConfig.parse({
      model: { model: "openai/gpt-5.4" },
      persona: {
        name: "Default Agent",
        tone: "direct",
        palette: "graphite",
        character: "architect",
      },
    }),
    identity: IdentityPack.parse({
      meta: {
        name: "Default Agent",
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

function createCore(): OperatorCore {
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
    agentKey: "default",
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

  const core = {
    connectionStore,
    statusStore,
    agentStatusStore: {
      ...agentStatusStore,
      setAgentKey: vi.fn((agentKey: string) => {
        setAgentStatusState((previous) => ({ ...previous, agentKey }));
      }),
      refresh: vi.fn().mockResolvedValue(undefined),
    },
    runsStore,
    http: {
      agents: {
        list: vi.fn(async () => ({
          agents: [
            {
              agent_key: "default",
              agent_id: "11111111-1111-4111-8111-111111111111",
              can_delete: false,
              persona: { name: "Default Agent" },
            },
          ],
        })),
        get: vi.fn().mockResolvedValue(sampleManagedAgentDetail()),
        capabilities: vi.fn(async () => ({
          skills: {
            default_mode: "allow",
            allow: [],
            deny: [],
            workspace_trusted: true,
            items: [],
          },
          mcp: { default_mode: "allow", allow: [], deny: [], items: [] },
          tools: { default_mode: "allow", allow: [], deny: [], items: [] },
        })),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      modelConfig: {
        listPresets: vi.fn().mockResolvedValue(samplePresets()),
      },
    },
  } as unknown as OperatorCore & {
    http: OperatorCore["admin"];
  };
  core.admin = core.http;
  return core;
}

describe("AgentsPage layout", () => {
  it("stretches the detail pane to the available page width", async () => {
    const core = createCore();
    const testRoot = renderIntoDocument(React.createElement(AgentsPage, { core }));
    await flush();

    const mobileToolbar = testRoot.container.querySelector<HTMLElement>(
      '[data-testid="agents-mobile-toolbar"]',
    );
    expect(mobileToolbar?.className).toContain("lg:hidden");

    const detailPane = testRoot.container.querySelector<HTMLDivElement>(
      '[data-testid="agents-detail-pane"]',
    );
    expect(detailPane?.className).toContain("min-w-0");

    const contentLayout = testRoot.container.querySelector<HTMLDivElement>(
      '[data-testid="agents-content-layout"]',
    );
    expect(contentLayout?.className).toContain("min-w-0");
    expect(contentLayout?.className).toContain("w-full");
    expect(contentLayout?.className).toContain("box-border");
    expect(contentLayout?.className).not.toContain("mx-auto");
    expect(contentLayout?.className).not.toContain("max-w-5xl");

    const activeTabPanel = testRoot.container.querySelector<HTMLElement>(
      "[data-state='active'][role='tabpanel']",
    );
    expect(activeTabPanel?.className).toContain("min-w-0");

    const identityHeader = testRoot.container.querySelector<HTMLDivElement>(
      '[data-testid="agents-identity-header"]',
    );
    expect(identityHeader?.className).toContain("min-w-0");
    expect(identityHeader?.className).toContain("justify-end");

    const identitySections = testRoot.container.querySelector<HTMLDivElement>(
      '[data-testid="agents-identity-sections"]',
    );
    expect(identitySections?.className).toContain("min-w-0");

    cleanupTestRoot(testRoot);
  });
});
