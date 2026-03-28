import { randomUUID } from "node:crypto";
import type { SqlDb } from "../../statestore/types.js";

export class PlanDal {
  constructor(private readonly db: SqlDb) {}

  async getByKey(input: {
    tenantId: string;
    planKey: string;
  }): Promise<{ plan_id: string } | null> {
    const planKey = input.planKey.trim();
    if (!planKey) return null;

    const row = await this.db.get<{ plan_id: string }>(
      "SELECT plan_id FROM plans WHERE tenant_id = ? AND plan_key = ? LIMIT 1",
      [input.tenantId, planKey],
    );
    return row?.plan_id ? row : null;
  }

  async ensurePlanId(input: {
    tenantId: string;
    planKey: string;
    agentId: string;
    workspaceId: string;
    conversationId?: string | null;
    kind: string;
    status: string;
  }): Promise<string> {
    const planKey = input.planKey.trim();
    if (!planKey) {
      throw new Error("planKey is required");
    }

    const found = await this.db.get<{ plan_id: string }>(
      "SELECT plan_id FROM plans WHERE tenant_id = ? AND plan_key = ? LIMIT 1",
      [input.tenantId, planKey],
    );
    if (found?.plan_id) return found.plan_id;

    const planId = randomUUID();
    const inserted = await this.db.get<{ plan_id: string }>(
      `INSERT INTO plans (tenant_id, plan_id, plan_key, agent_id, workspace_id, conversation_id, kind, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, plan_key) DO NOTHING
       RETURNING plan_id`,
      [
        input.tenantId,
        planId,
        planKey,
        input.agentId,
        input.workspaceId,
        input.conversationId ?? null,
        input.kind,
        input.status,
      ],
    );
    if (inserted?.plan_id) return inserted.plan_id;

    const resolved = await this.db.get<{ plan_id: string }>(
      "SELECT plan_id FROM plans WHERE tenant_id = ? AND plan_key = ? LIMIT 1",
      [input.tenantId, planKey],
    );
    if (!resolved?.plan_id) {
      throw new Error("failed to ensure plan");
    }
    return resolved.plan_id;
  }
}
