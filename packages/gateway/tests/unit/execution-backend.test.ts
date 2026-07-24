import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { ConversationDal } from "../../src/modules/agent/conversation-dal.js";
import { ConversationExecutionBackendOverrideDal } from "../../src/modules/agent/execution-backend-override-dal.js";
import {
  createExecutionBackendResolver,
  ExecutionBackendUnavailableError,
  NativeExecutionBackend,
  UnavailableExecutionBackend,
} from "../../src/modules/agent/execution-backend.js";
import { ChannelThreadDal } from "../../src/modules/channels/thread-dal.js";
import { DEFAULT_TENANT_ID, IdentityScopeDal } from "../../src/modules/identity/scope.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

describe("execution backend resolution", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  async function createFixture() {
    db = openTestSqliteDb();
    const conversation = await new ConversationDal(
      db,
      new IdentityScopeDal(db),
      new ChannelThreadDal(db),
    ).getOrCreate({
      scopeKeys: { agentKey: "default", workspaceKey: "default" },
      connectorKey: "test",
      providerThreadId: randomUUID(),
      containerKind: "channel",
    });
    const overrideDal = new ConversationExecutionBackendOverrideDal(db);
    const executeTurn = vi.fn(async () => ({
      reply: "native",
      conversation_id: conversation.conversation_id,
      conversation_key: conversation.conversation_key,
      attachments: [],
      used_tools: [],
      memory_written: false,
    }));
    const nativeBackend = new NativeExecutionBackend({ executeTurn });
    const resolver = createExecutionBackendResolver({ overrideDal, nativeBackend });
    return { conversation, executeTurn, nativeBackend, overrideDal, resolver };
  }

  it("resolves native when no conversation override exists", async () => {
    const fixture = await createFixture();

    const backend = await fixture.resolver.resolve(
      fixture.conversation.tenant_id,
      fixture.conversation.conversation_id,
    );

    expect(backend).toBe(fixture.nativeBackend);
    await expect(
      backend.executeTurn({
        channel: "test",
        thread_id: "thread-1",
        parts: [{ type: "text", text: "hello" }],
      }),
    ).resolves.toMatchObject({ reply: "native" });
    expect(fixture.executeTurn).toHaveBeenCalledOnce();
  });

  it("round-trips conversation overrides and resolves unavailable backends", async () => {
    const fixture = await createFixture();
    const set = await fixture.overrideDal.set({
      tenantId: fixture.conversation.tenant_id,
      conversationId: fixture.conversation.conversation_id,
      backendId: "codex",
    });

    expect(
      await fixture.overrideDal.get({
        tenantId: fixture.conversation.tenant_id,
        conversationId: fixture.conversation.conversation_id,
      }),
    ).toEqual(set);

    const backend = await fixture.resolver.resolve(
      fixture.conversation.tenant_id,
      fixture.conversation.conversation_id,
    );
    expect(backend).toBeInstanceOf(UnavailableExecutionBackend);
    expect(backend.id).toBe("codex");

    const request = {
      channel: "test",
      thread_id: "thread-1",
      parts: [{ type: "text" as const, text: "hello" }],
    };
    await expect(backend.executeTurn(request)).rejects.toEqual(
      expect.objectContaining<Partial<ExecutionBackendUnavailableError>>({
        name: "ExecutionBackendUnavailableError",
        backendId: "codex",
        message: "execution backend 'codex' is not available yet (ARCH-22 Phase 0)",
      }),
    );

    await expect(
      fixture.overrideDal.clear({
        tenantId: fixture.conversation.tenant_id,
        conversationId: fixture.conversation.conversation_id,
      }),
    ).resolves.toBe(true);
    await expect(
      fixture.overrideDal.get({
        tenantId: fixture.conversation.tenant_id,
        conversationId: fixture.conversation.conversation_id,
      }),
    ).resolves.toBeUndefined();
  });

  it("deletes overrides when their conversation is deleted", async () => {
    const fixture = await createFixture();
    await fixture.overrideDal.set({
      tenantId: DEFAULT_TENANT_ID,
      conversationId: fixture.conversation.conversation_id,
      backendId: "opencode",
    });

    await db!.run(
      `DELETE FROM conversations
       WHERE tenant_id = ? AND conversation_id = ?`,
      [DEFAULT_TENANT_ID, fixture.conversation.conversation_id],
    );

    await expect(
      fixture.overrideDal.get({
        tenantId: DEFAULT_TENANT_ID,
        conversationId: fixture.conversation.conversation_id,
      }),
    ).resolves.toBeUndefined();
  });
});
