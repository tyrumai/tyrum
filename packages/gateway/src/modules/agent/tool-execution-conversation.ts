import type { SqlDb } from "../../statestore/types.js";

type ExecutionConversationAudit = {
  work_conversation_key?: string;
  execution_turn_id?: string;
};

function trimOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export function readWorkConversationKey(
  audit?: Pick<ExecutionConversationAudit, "work_conversation_key">,
): string | undefined {
  return trimOptionalString(audit?.work_conversation_key);
}

export async function resolveExecutionConversationKind(input: {
  db?: SqlDb;
  tenantId?: string;
  audit?: ExecutionConversationAudit;
}): Promise<{ conversationKey?: string }> {
  const conversationKey = readWorkConversationKey(input.audit);
  const executionTurnId = trimOptionalString(input.audit?.execution_turn_id);
  if (input.db && input.tenantId && executionTurnId) {
    const turnRow = await input.db.get<{ conversation_key: string }>(
      `SELECT conversation_key
       FROM turns
       WHERE tenant_id = ? AND turn_id = ?
       LIMIT 1`,
      [input.tenantId, executionTurnId],
    );
    if (turnRow?.conversation_key) {
      return {
        conversationKey: turnRow.conversation_key,
      };
    }
  }

  return { conversationKey };
}
