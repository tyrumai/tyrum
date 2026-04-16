import { AgentStatusResponse } from "@tyrum/contracts";
import { describe, expect, it, vi } from "vitest";
import { createAgentStatusStore } from "../src/stores/agent-status-store.js";
import { createDeferred } from "./transcript-store.test-support.js";

function createAgentStatus(agentKey: string, name: string, toolBundle?: string) {
  return AgentStatusResponse.parse({
    enabled: true,
    home: `/tmp/agents/${agentKey}`,
    persona: {
      name,
      tone: "direct",
      palette: "graphite",
      character: "architect",
    },
    identity: { name },
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
    tools: ["read"],
    tool_exposure: {
      mcp: { bundle: "workspace-default", tier: "advanced" },
      tools: toolBundle ? { bundle: toolBundle, tier: "default" } : {},
    },
    tool_access: {
      default_mode: "deny",
      allow: ["read"],
      deny: [],
    },
    conversations: {
      ttl_days: 365,
      max_turns: 0,
      loop_detection: {
        within_turn: {
          consecutive_repeat_limit: 2,
          cycle_repeat_limit: 3,
        },
        cross_turn: {
          window_assistant_messages: 8,
          similarity_threshold: 0.92,
        },
      },
      context_pruning: {
        max_messages: 0,
        tool_prune_keep_last_messages: 4,
      },
    },
  });
}

describe("createAgentStatusStore", () => {
  it("ignores stale refresh results when the selected agent changes", async () => {
    const defaultStatus = createAgentStatus("default", "Default Agent", "authoring-core");
    const otherStatus = createAgentStatus("agent-1", "Agent One", "workspace-ops");
    const defaultStatusDeferred = createDeferred<typeof defaultStatus>();
    const http = {
      agentStatus: {
        get: vi.fn(async (payload?: { agent_key?: string }) => {
          const agentKey = payload?.agent_key ?? "";
          if (agentKey === "default") {
            return await defaultStatusDeferred.promise;
          }
          if (agentKey === "agent-1") {
            return otherStatus;
          }
          throw new Error(`unexpected agent key: ${agentKey}`);
        }),
      },
    };

    const { store } = createAgentStatusStore(http as never);

    store.setAgentKey("default");
    const defaultRefresh = store.refresh();

    expect(store.getSnapshot()).toMatchObject({
      agentKey: "default",
      loading: true,
      status: null,
    });

    store.setAgentKey("agent-1");
    await store.refresh();

    expect(store.getSnapshot()).toMatchObject({
      agentKey: "agent-1",
      loading: false,
      status: otherStatus,
    });

    defaultStatusDeferred.resolve(defaultStatus);
    await defaultRefresh;

    expect(http.agentStatus.get).toHaveBeenNthCalledWith(1, { agent_key: "default" });
    expect(http.agentStatus.get).toHaveBeenNthCalledWith(2, { agent_key: "agent-1" });
    expect(store.getSnapshot()).toMatchObject({
      agentKey: "agent-1",
      loading: false,
      status: otherStatus,
      error: null,
    });
  });
});
