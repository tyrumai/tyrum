import { parseTyrumKey, SubagentConversationKey } from "@tyrum/contracts";
import type { SqlDb } from "../../statestore/types.js";

export async function ensureManagedDesktopHandoffTarget(input: {
  db: SqlDb;
  tenantId: string;
  key: string;
}): Promise<void> {
  if (SubagentConversationKey.safeParse(input.key).success) {
    const parsed = SubagentConversationKey.safeParse(input.key);
    const exists = await input.db.get<{ conversation_key: string }>(
      `SELECT conversation_key
       FROM subagents
       WHERE tenant_id = ? AND conversation_key = ?
       LIMIT 1`,
      [input.tenantId, parsed.data],
    );
    if (!exists) {
      throw new Error("target subagent conversation was not found in the current tenant");
    }
    return;
  }

  const persistedConversation = await input.db.get<{ conversation_key: string }>(
    `SELECT conversation_key
     FROM conversations
     WHERE tenant_id = ? AND conversation_key = ?
     LIMIT 1`,
    [input.tenantId, input.key],
  );
  if (persistedConversation) {
    return;
  }

  const parsed = parseTyrumKey(input.key);
  if (parsed.kind === "agent") {
    return;
  }

  throw new Error("target_key must reference a valid conversation key");
}
