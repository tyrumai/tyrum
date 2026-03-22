import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { WsResponseEnvelope, WsResponseOkEnvelope } from "@tyrum/contracts";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { handleAiSdkChatMessage } from "../../src/ws/protocol/ai-sdk-chat-ops.js";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { createSpyLogger, makeClient, makeDeps } from "./ws-protocol.test-support.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

function readOkResult<T>(response: WsResponseEnvelope | undefined): T {
  expect(response).toBeTruthy();
  expect(response && "ok" in response ? response.ok : false).toBe(true);
  return (response as WsResponseOkEnvelope & { result: T }).result;
}

describe("ai-sdk chat queue mode ops", () => {
  let container: GatewayContainer | undefined;
  let homeDir: string | undefined;

  afterEach(async () => {
    await container?.db.close();
    container = undefined;
    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
  });

  it("defaults created chat sessions to steer and persists the override", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-ai-sdk-chat-ops-"));
    container = createContainer({
      dbPath: ":memory:",
      migrationsDir,
      tyrumHome: homeDir,
    });

    const connectionManager = new ConnectionManager();
    const { id } = makeClient(connectionManager, []);
    const client = connectionManager.getClient(id);
    expect(client).toBeTruthy();

    const deps = makeDeps(connectionManager, {
      db: container.db,
      logger: createSpyLogger(),
      redactionEngine: container.redactionEngine,
    });

    const response = await handleAiSdkChatMessage(
      client!,
      {
        request_id: "req-create-queue-default",
        type: "chat.session.create",
        payload: { agent_id: "default", channel: "ui" },
      } as never,
      deps,
    );

    const result = readOkResult<{ session: { queue_mode: string; session_id: string } }>(response);
    expect(result.session.queue_mode).toBe("steer");

    const row = await container.db.get<{ queue_mode: string }>(
      `SELECT queue_mode
       FROM lane_queue_mode_overrides
       WHERE tenant_id = ? AND key = ? AND lane = ?`,
      [DEFAULT_TENANT_ID, result.session.session_id, "main"],
    );
    expect(row?.queue_mode).toBe("steer");
  });

  it("defaults existing chat sessions to steer on get when unset", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-ai-sdk-chat-ops-"));
    container = createContainer({
      dbPath: ":memory:",
      migrationsDir,
      tyrumHome: homeDir,
    });

    const connectionManager = new ConnectionManager();
    const { id } = makeClient(connectionManager, []);
    const client = connectionManager.getClient(id);
    expect(client).toBeTruthy();

    const session = await container.sessionDal.getOrCreate({
      tenantId: DEFAULT_TENANT_ID,
      scopeKeys: { agentKey: "default", workspaceKey: "default" },
      connectorKey: "ui",
      providerThreadId: "ui-thread-queue-default",
      containerKind: "channel",
    });
    const deps = makeDeps(connectionManager, {
      db: container.db,
      logger: createSpyLogger(),
      redactionEngine: container.redactionEngine,
    });

    const response = await handleAiSdkChatMessage(
      client!,
      {
        request_id: "req-get-queue-default",
        type: "chat.session.get",
        payload: { session_id: session.session_key },
      } as never,
      deps,
    );

    const result = readOkResult<{ session: { queue_mode: string; session_id: string } }>(response);
    expect(result.session.queue_mode).toBe("steer");

    const row = await container.db.get<{ queue_mode: string }>(
      `SELECT queue_mode
       FROM lane_queue_mode_overrides
       WHERE tenant_id = ? AND key = ? AND lane = ?`,
      [DEFAULT_TENANT_ID, session.session_key, "main"],
    );
    expect(row?.queue_mode).toBe("steer");
  });

  it("updates chat session queue mode overrides", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-ai-sdk-chat-ops-"));
    container = createContainer({
      dbPath: ":memory:",
      migrationsDir,
      tyrumHome: homeDir,
    });

    const connectionManager = new ConnectionManager();
    const { id } = makeClient(connectionManager, []);
    const client = connectionManager.getClient(id);
    expect(client).toBeTruthy();

    const session = await container.sessionDal.getOrCreate({
      tenantId: DEFAULT_TENANT_ID,
      scopeKeys: { agentKey: "default", workspaceKey: "default" },
      connectorKey: "ui",
      providerThreadId: "ui-thread-queue-set",
      containerKind: "channel",
    });
    const deps = makeDeps(connectionManager, {
      db: container.db,
      logger: createSpyLogger(),
      redactionEngine: container.redactionEngine,
    });

    const response = await handleAiSdkChatMessage(
      client!,
      {
        request_id: "req-set-queue-mode",
        type: "chat.session.queue_mode.set",
        payload: { session_id: session.session_key, queue_mode: "interrupt" },
      } as never,
      deps,
    );

    expect(readOkResult<{ queue_mode: string; session_id: string }>(response)).toEqual({
      session_id: session.session_key,
      queue_mode: "interrupt",
    });

    const row = await container.db.get<{ queue_mode: string }>(
      `SELECT queue_mode
       FROM lane_queue_mode_overrides
       WHERE tenant_id = ? AND key = ? AND lane = ?`,
      [DEFAULT_TENANT_ID, session.session_key, "main"],
    );
    expect(row?.queue_mode).toBe("interrupt");
  });

  it("clears chat session queue mode overrides when a session is deleted", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-ai-sdk-chat-ops-"));
    container = createContainer({
      dbPath: ":memory:",
      migrationsDir,
      tyrumHome: homeDir,
    });

    const connectionManager = new ConnectionManager();
    const { id } = makeClient(connectionManager, []);
    const client = connectionManager.getClient(id);
    expect(client).toBeTruthy();

    const session = await container.sessionDal.getOrCreate({
      tenantId: DEFAULT_TENANT_ID,
      scopeKeys: { agentKey: "default", workspaceKey: "default" },
      connectorKey: "ui",
      providerThreadId: "ui-thread-delete-queue-mode",
      containerKind: "channel",
    });
    await container.db.run(
      `INSERT INTO lane_queue_mode_overrides (tenant_id, key, lane, queue_mode, updated_at_ms)
       VALUES (?, ?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, session.session_key, "main", "interrupt", Date.now()],
    );

    const deps = makeDeps(connectionManager, {
      db: container.db,
      logger: createSpyLogger(),
      redactionEngine: container.redactionEngine,
    });

    const response = await handleAiSdkChatMessage(
      client!,
      {
        request_id: "req-delete-queue-mode",
        type: "chat.session.delete",
        payload: { session_id: session.session_key },
      } as never,
      deps,
    );

    expect(readOkResult<{ session_id: string }>(response)).toEqual({
      session_id: session.session_key,
    });

    const row = await container.db.get<{ queue_mode: string }>(
      `SELECT queue_mode
       FROM lane_queue_mode_overrides
       WHERE tenant_id = ? AND key = ? AND lane = ?`,
      [DEFAULT_TENANT_ID, session.session_key, "main"],
    );
    expect(row).toBeUndefined();
  });
});
