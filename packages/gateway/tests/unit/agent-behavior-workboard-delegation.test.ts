import { afterEach, describe, expect, it, vi } from "vitest";
import type { GatewayContainer } from "../../src/container.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import { WorkboardDal } from "../../src/modules/workboard/dal.js";
import { WorkSignalScheduler } from "../../src/modules/workboard/signal-scheduler.js";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import {
  createPromptAwareLanguageModel,
  extractPromptSection,
  promptIncludes,
} from "./agent-behavior.test-support.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
  fetch404,
  seedAgentConfig,
  setupTestEnv,
  teardownTestEnv,
} from "./agent-runtime.test-helpers.js";

function makeMemoryEnabledConfig(): Record<string, unknown> {
  return {
    model: { model: "openai/gpt-4.1" },
    skills: { default_mode: "deny", workspace_trusted: false },
    mcp: {
      default_mode: "allow",
      pre_turn_tools: ["mcp.memory.seed"],
      server_settings: {
        memory: {
          enabled: true,
          keyword: { enabled: true, limit: 20 },
          semantic: { enabled: false, limit: 1 },
          structured: { fact_keys: [], tags: [] },
          budgets: {
            max_total_items: 10,
            max_total_chars: 4000,
            per_kind: {
              fact: { max_items: 4, max_chars: 1200 },
              note: { max_items: 6, max_chars: 2400 },
              procedure: { max_items: 2, max_chars: 1200 },
              episode: { max_items: 4, max_chars: 1600 },
            },
          },
        },
      },
    },
    tools: { default_mode: "allow" },
    sessions: { ttl_days: 30, max_turns: 20 },
  };
}

function noteDecision(body_md: string) {
  return {
    should_store: true as const,
    reason: "Durable operational note.",
    memory: {
      kind: "note" as const,
      body_md,
    },
  };
}

interface MockWebSocket {
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  readyState: number;
}

function createMockWs(): MockWebSocket {
  return {
    send: vi.fn(),
    close: vi.fn(),
    on: vi.fn(() => undefined as never),
    readyState: 1,
  };
}

describe("Agent behavior - WorkBoard and delegation", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    await teardownTestEnv({ homeDir, container });
    container = undefined;
    homeDir = undefined;
  });

  it("answers status from WorkBoard state across channels", async () => {
    ({ homeDir, container } = await setupTestEnv());

    const scope = {
      tenant_id: DEFAULT_TENANT_ID,
      agent_id: DEFAULT_AGENT_ID,
      workspace_id: DEFAULT_WORKSPACE_ID,
    } as const;
    const workItemId = "123e4567-e89b-12d3-a456-426614174201";
    const taskId = "123e4567-e89b-12d3-a456-426614174202";

    const dal = new WorkboardDal(container.db);
    await dal.createItem({
      scope,
      workItemId,
      createdFromSessionKey: "agent:default:ui:default:channel:origin-thread",
      item: { kind: "action", title: "Cross-channel status item" },
    });
    await dal.transitionItem({ scope, work_item_id: workItemId, status: "ready" });
    await dal.transitionItem({ scope, work_item_id: workItemId, status: "doing" });
    await dal.createTask({
      scope,
      taskId,
      task: {
        work_item_id: workItemId,
        status: "running",
        execution_profile: "executor",
        side_effect_class: "workspace",
      },
    });

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createPromptAwareLanguageModel(() => "MODEL_SHOULD_NOT_BE_USED"),
      fetchImpl: fetch404,
    });

    const status = await runtime.turn({
      channel: "telegram",
      thread_id: "different-thread",
      message: "status?",
    });

    expect(status.reply).toContain(workItemId);
    expect(status.reply).toContain("Cross-channel status item");
    expect(status.reply).toContain(taskId);
    expect(status.reply).not.toBe("MODEL_SHOULD_NOT_BE_USED");
  });

  it("fires an event signal once and does not re-fire after scheduler restart", async () => {
    const cm = new ConnectionManager();
    const ws = createMockWs();
    cm.addClient(
      ws as never,
      [] as never,
      {
        role: "client",
        authClaims: {
          token_kind: "admin",
          token_id: "token-1",
          tenant_id: DEFAULT_TENANT_ID,
          role: "admin",
          scopes: ["*"],
        },
      } as never,
    );

    const db = openTestSqliteDb();
    try {
      const dal = new WorkboardDal(db);
      const scope = {
        tenant_id: DEFAULT_TENANT_ID,
        agent_id: DEFAULT_AGENT_ID,
        workspace_id: DEFAULT_WORKSPACE_ID,
      } as const;

      const item = await dal.createItem({
        scope,
        item: { kind: "action", title: "Signal once" },
        createdFromSessionKey: "agent:default:ui:default:channel:signal-thread",
      });
      const signal = await dal.createSignal({
        scope,
        signal: {
          work_item_id: item.work_item_id,
          trigger_kind: "event",
          trigger_spec_json: { kind: "work_item.status.transition", to: ["blocked"] },
          payload_json: { reason: "notify-once" },
        },
      });

      await dal.transitionItem({ scope, work_item_id: item.work_item_id, status: "ready" });
      await dal.transitionItem({ scope, work_item_id: item.work_item_id, status: "doing" });
      await dal.transitionItem({ scope, work_item_id: item.work_item_id, status: "blocked" });

      const scheduler = new WorkSignalScheduler({
        db,
        connectionManager: cm,
        owner: "scheduler-1",
      });
      await scheduler.tick();

      const firstFireCount = ws.send.mock.calls.filter(([payload]) =>
        String(payload).includes('"type":"work.signal.fired"'),
      ).length;
      const firedSignal = await dal.getSignal({ scope, signal_id: signal.signal_id });

      ws.send.mockClear();
      const restarted = new WorkSignalScheduler({
        db,
        connectionManager: cm,
        owner: "scheduler-2",
      });
      await restarted.tick();

      expect(firstFireCount).toBe(1);
      expect(firedSignal?.status).toBe("fired");
      expect(ws.send).not.toHaveBeenCalled();
    } finally {
      await db.close();
    }
  });

  it("shares durable memory with a subagent while keeping subagent execution separate", async () => {
    ({ homeDir, container } = await setupTestEnv());
    await seedAgentConfig(container, { config: makeMemoryEnabledConfig() });

    const scope = {
      tenant_id: DEFAULT_TENANT_ID,
      agent_id: DEFAULT_AGENT_ID,
      workspace_id: DEFAULT_WORKSPACE_ID,
    } as const;
    const workboard = new WorkboardDal(container.db);
    const subagentKey = "agent:default:subagent:subagent-1";
    await workboard.createSubagent({
      scope,
      subagentId: "subagent-1",
      subagent: {
        execution_profile: "executor",
        session_key: subagentKey,
      },
    });
    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createPromptAwareLanguageModel(
        ({ promptText }) => {
          if (promptIncludes(promptText, "what needs verification")) {
            return /deployment needs verification/iu.test(
              extractPromptSection(promptText, "Memory digest:"),
            )
              ? "deployment"
              : "UNKNOWN";
          }
          return "Stored.";
        },
        {
          memoryDecision: ({ latestUserText }) =>
            promptIncludes(latestUserText, "remember that deployment needs verification")
              ? noteDecision("remember that deployment needs verification")
              : undefined,
        },
      ),
      fetchImpl: fetch404,
    });

    const subagentTurn = await runtime.turn({
      channel: "subagent",
      thread_id: "subagent-1",
      message: "remember that deployment needs verification",
      metadata: {
        tyrum_key: subagentKey,
        lane: "subagent",
      },
    });
    const mainTurn = await runtime.turn({
      channel: "ui",
      thread_id: "main-thread",
      message: "what needs verification?",
    });

    const runRow = await container.db.get<{ key: string; lane: string }>(
      `SELECT key, lane
       FROM execution_runs
       WHERE key = ?
       ORDER BY rowid DESC
       LIMIT 1`,
      [subagentKey],
    );
    const subagentSessions = await container.sessionDal.list({
      connectorKey: "subagent",
      limit: 10,
    });
    const uiSessions = await container.sessionDal.list({ connectorKey: "ui", limit: 10 });

    expect(subagentTurn.memory_written).toBe(true);
    expect(mainTurn.reply).toBe("deployment");
    expect(runRow).toMatchObject({ key: subagentKey, lane: "subagent" });
    expect(subagentSessions.sessions).toHaveLength(1);
    expect(uiSessions.sessions).toHaveLength(1);
    expect(subagentTurn.session_key).not.toBe(mainTurn.session_key);
  });
});
