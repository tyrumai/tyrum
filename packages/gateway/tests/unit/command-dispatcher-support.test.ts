import { describe, expect, it } from "vitest";
import {
  CommandContextError,
  resolveAgentId,
} from "../../src/modules/commands/dispatcher-support.js";
import type { CommandDeps } from "../../src/modules/commands/dispatcher.js";
import { DEFAULT_TENANT_ID, IdentityScopeDal } from "../../src/modules/identity/scope.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

function commandContext(
  value: NonNullable<CommandDeps["commandContext"]>,
): CommandDeps["commandContext"] {
  return value;
}

async function promotePrimaryAgent(input: {
  db: SqliteDb;
  identityScopeDal: IdentityScopeDal;
  tenantId: string;
  agentKey: string;
}): Promise<void> {
  const agentId = await input.identityScopeDal.ensureAgentId(input.tenantId, input.agentKey);
  await input.identityScopeDal.ensureAgentId(input.tenantId, "default");
  await input.db.run(`UPDATE agents SET is_primary = 0 WHERE tenant_id = ?`, [input.tenantId]);
  await input.db.run(`UPDATE agents SET is_primary = 1 WHERE tenant_id = ? AND agent_id = ?`, [
    input.tenantId,
    agentId,
  ]);
  input.identityScopeDal.rememberPrimaryAgent(input.tenantId, input.agentKey, agentId);
}

describe("resolveAgentId", () => {
  it("prefers an explicit command-context agent id", async () => {
    await expect(
      resolveAgentId(
        commandContext({
          agentId: "ops-agent",
          key: "hook:550e8400-e29b-41d4-a716-446655440000",
        }),
      ),
    ).resolves.toBe("ops-agent");
  });

  it("extracts the agent key from agent conversation keys", async () => {
    await expect(
      resolveAgentId(
        commandContext({
          key: "agent:ops-agent:main",
        }),
      ),
    ).resolves.toBe("ops-agent");
  });

  it("resolves the primary agent for valid non-agent keys when scope data is available", async () => {
    const db = openTestSqliteDb();
    try {
      const identityScopeDal = new IdentityScopeDal(db);
      await promotePrimaryAgent({
        db,
        identityScopeDal,
        tenantId: DEFAULT_TENANT_ID,
        agentKey: "ops-agent",
      });

      await expect(
        resolveAgentId(
          commandContext({
            key: "hook:550e8400-e29b-41d4-a716-446655440000",
          }),
          {
            tenantId: DEFAULT_TENANT_ID,
            identityScopeDal,
          },
        ),
      ).resolves.toBe("ops-agent");
    } finally {
      await db.close();
    }
  });

  it("rejects invalid conversation keys instead of guessing an agent", async () => {
    await expect(
      resolveAgentId(
        commandContext({
          key: "legacy-conversation-key",
        }),
      ),
    ).rejects.toThrowError(new CommandContextError("Invalid conversation key in command context."));
  });

  it("rejects missing agent context when no scope fallback is available", async () => {
    await expect(resolveAgentId(undefined)).rejects.toThrowError(
      new CommandContextError("Agent context is required for this command."),
    );
  });
});
