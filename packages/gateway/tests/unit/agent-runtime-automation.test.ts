import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import type { GatewayContainer } from "../../src/container.js";
import { createContainer } from "../../src/container.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import { ChannelInboxDal } from "../../src/modules/channels/inbox-dal.js";
import { ScheduleService } from "../../src/modules/automation/schedule-service.js";
import { WsEventDal } from "../../src/modules/ws-event/dal.js";
import { WorkboardDal } from "../../src/modules/workboard/dal.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { createStubLanguageModel } from "./stub-language-model.js";
import { makeClient } from "./ws-protocol.test-support.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");
const DEFAULT_SCOPE = {
  tenant_id: DEFAULT_TENANT_ID,
  agent_id: DEFAULT_AGENT_ID,
  workspace_id: DEFAULT_WORKSPACE_ID,
} as const;

function makeAutomationRequest() {
  return {
    channel: "automation:default",
    thread_id: "schedule-schedule-1",
    message: "Run the heartbeat.",
    metadata: {
      automation: {
        schedule_id: "schedule-1",
        schedule_kind: "heartbeat",
        fired_at: "2026-03-06T10:00:00.000Z",
        previous_fired_at: "2026-03-06T09:30:00.000Z",
        delivery_mode: "notify",
        instruction: "Check whether the operator should be notified.",
      },
    },
  } as const;
}

async function seedNotificationRoute(
  container: GatewayContainer,
  conversationKey = "agent:default:telegram:default:dm:chat-1",
): Promise<void> {
  const inbox = new ChannelInboxDal(container.db);
  await inbox.enqueue({
    source: "telegram:default",
    thread_id: "chat-1",
    message_id: "msg-1",
    key: conversationKey,
    received_at_ms: 1_000,
    payload: { kind: "test" },
  });

  const workboard = new WorkboardDal(container.db);
  await workboard.upsertScopeActivity({
    scope: DEFAULT_SCOPE,
    last_active_conversation_key: conversationKey,
    updated_at_ms: 1_000,
  });
}

describe("AgentRuntime automation replies", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;

  const fetch404 = (async () => new Response("not found", { status: 404 })) as typeof fetch;

  afterEach(async () => {
    vi.restoreAllMocks();
    await container?.db.close();
    container = undefined;

    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
  });

  it("does not seed default heartbeat schedules when automation is disabled", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer(
      { dbPath: ":memory:", migrationsDir, tyrumHome: homeDir },
      { deploymentConfig: { automation: { enabled: false } } },
    );

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createStubLanguageModel("ok"),
      fetchImpl: fetch404,
    });

    await runtime.turn({
      channel: "test",
      thread_id: "thread-1",
      message: "hello",
    });

    const schedules = await new ScheduleService(
      container.db,
      container.identityScopeDal,
    ).listSchedules({
      tenantId: DEFAULT_TENANT_ID,
      includeDeleted: true,
    });

    expect(schedules).toHaveLength(0);
  });

  it("skips automation replies when send_policy override is off", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });
    await seedNotificationRoute(container);
    await container.db.run(
      `INSERT INTO conversation_send_policy_overrides (tenant_id, conversation_key, send_policy, updated_at_ms)
       VALUES (?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, "agent:default:telegram:default:dm:chat-1", "off", 1_000],
    );

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createStubLanguageModel("notify operator"),
      fetchImpl: fetch404,
    });

    const response = await runtime.executeDecideAction(makeAutomationRequest());
    expect(response.reply).toBe("notify operator");

    const outboxCount = await container.db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM channel_outbox",
    );
    expect(outboxCount?.count).toBe(0);
  });

  it("delivers and dedupes automation replies through runtime.turn()", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });
    await seedNotificationRoute(container);

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createStubLanguageModel("notify operator"),
      fetchImpl: fetch404,
    });

    const first = await runtime.turn(makeAutomationRequest());
    const second = await runtime.turn(makeAutomationRequest());

    expect(first.reply).toBe("notify operator");
    expect(second.reply).toBe("notify operator");

    const outbox = await container.db.get<{ count: number; source: string | null }>(
      `SELECT COUNT(*) AS count, MAX(source) AS source
       FROM channel_outbox`,
    );
    expect(outbox?.count).toBe(1);
    expect(outbox?.source).toBe("telegram:default");
  });

  it("approval-gates automation replies when connector policy requires approval", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });
    await seedNotificationRoute(container);

    const connectionManager = new ConnectionManager();
    const { ws } = makeClient(connectionManager, ["playwright"]);
    vi.spyOn(container.policyService, "evaluateConnectorAction").mockResolvedValue({
      decision: "require_approval",
      policy_snapshot: { policy_snapshot_id: "snapshot-1" },
      applied_override_ids: [],
    } as never);

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createStubLanguageModel("notify operator"),
      fetchImpl: fetch404,
      protocolDeps: {
        connectionManager,
        wsEventDal: new WsEventDal(container.db),
        logger: container.logger,
        maxBufferedBytes: 64 * 1024,
      },
    });

    await runtime.executeDecideAction(makeAutomationRequest());

    const pending = await container.approvalDal.listBlocked({ tenantId: DEFAULT_TENANT_ID });
    expect(pending).toHaveLength(1);
    expect(pending[0]!.status).toBe("queued");
    expect(ws.send).toHaveBeenCalledOnce();
    const event = JSON.parse(ws.send.mock.calls[0]![0] as string) as Record<string, unknown>;
    expect(event["type"]).toBe("approval.updated");
    expect((event["payload"] as { approval: { status: string } }).approval.status).toBe("queued");

    const outbox = await container.db.get<{ count: number; approval_id: string | null }>(
      `SELECT COUNT(*) AS count, MAX(approval_id) AS approval_id
       FROM channel_outbox`,
    );
    expect(outbox?.count).toBe(1);
    expect(outbox?.approval_id).toBeTruthy();
  });

  it("approval-gates automation replies when turnStream().finalize() completes", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });
    await seedNotificationRoute(container);

    vi.spyOn(container.policyService, "evaluateConnectorAction").mockResolvedValue({
      decision: "require_approval",
      policy_snapshot: { policy_snapshot_id: "snapshot-1" },
      applied_override_ids: [],
    } as never);

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createStubLanguageModel("notify operator"),
      fetchImpl: fetch404,
    });

    const handle = await runtime.turnStream(makeAutomationRequest());
    const response = await handle.finalize();
    expect(response.reply).toBe("notify operator");

    const pending = await container.approvalDal.listBlocked({ tenantId: DEFAULT_TENANT_ID });
    expect(pending).toHaveLength(1);

    const outbox = await container.db.get<{ count: number; approval_id: string | null }>(
      `SELECT COUNT(*) AS count, MAX(approval_id) AS approval_id
       FROM channel_outbox`,
    );
    expect(outbox?.count).toBe(1);
    expect(outbox?.approval_id).toBeTruthy();
  });
});
