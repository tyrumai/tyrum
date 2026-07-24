import { expect, it } from "vitest";
import { executeCommand } from "../../src/modules/commands/dispatcher.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import type { SlashCommandFixture } from "./command-slash-commands-missing.test-support.js";

export function registerBackendTests(fixture: SlashCommandFixture): void {
  it("accepts every supported /backend value", async () => {
    const db = fixture.openDb();

    for (const backendId of ["native", "claude_agent_sdk", "codex", "opencode"]) {
      const result = await executeCommand(`/backend ${backendId}`, {
        db,
        commandContext: {
          agentId: "default",
          channel: "ui",
          threadId: `backend-${backendId}`,
        },
      });
      expect(result.data).toMatchObject({ backend_id: backendId });
    }
  });

  it("sets, shows, and clears /backend for a conversation", async () => {
    const db = fixture.openDb();
    const commandContext = {
      agentId: "default",
      channel: "ui",
      threadId: "backend-thread",
    };

    const set = await executeCommand("/backend codex", { db, commandContext });
    const setPayload = set.data as { conversation_id: string; backend_id: string };
    expect(setPayload.backend_id).toBe("codex");

    const stored = await db.get<{ backend_id: string }>(
      `SELECT backend_id
       FROM conversation_execution_backend_overrides
       WHERE tenant_id = ? AND conversation_id = ?`,
      [DEFAULT_TENANT_ID, setPayload.conversation_id],
    );
    expect(stored?.backend_id).toBe("codex");

    await expect(executeCommand("/backend", { db, commandContext })).resolves.toMatchObject({
      data: {
        conversation_id: setPayload.conversation_id,
        backend_id: "codex",
      },
    });

    await expect(executeCommand("/backend clear", { db, commandContext })).resolves.toMatchObject({
      data: {
        conversation_id: setPayload.conversation_id,
        backend_id: "native",
      },
    });
    expect(
      await db.get(
        `SELECT backend_id
         FROM conversation_execution_backend_overrides
         WHERE tenant_id = ? AND conversation_id = ?`,
        [DEFAULT_TENANT_ID, setPayload.conversation_id],
      ),
    ).toBeUndefined();
  });

  it("rejects invalid /backend values", async () => {
    const db = fixture.openDb();
    const result = await executeCommand("/backend unsupported", {
      db,
      commandContext: {
        agentId: "default",
        channel: "ui",
        threadId: "backend-invalid",
      },
    });

    expect(result).toEqual({
      output: "Usage: /backend <native|claude_agent_sdk|codex|opencode|clear>",
      data: null,
    });
  });
}
