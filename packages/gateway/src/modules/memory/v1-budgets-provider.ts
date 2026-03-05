import { AgentConfig } from "@tyrum/schemas";
import type { AgentConfig as AgentConfigT } from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";
import { AgentConfigDal } from "../config/agent-config-dal.js";

const DEFAULT_BUDGETS: AgentConfigT["memory"]["v1"]["budgets"] = AgentConfig.parse({
  model: { model: "openai/gpt-4.1" },
  tools: { allow: ["tool.fs.read"] },
}).memory.v1.budgets;

export function createMemoryV1BudgetsProvider(
  db: SqlDb,
): (tenantId: string, agentId?: string) => Promise<AgentConfigT["memory"]["v1"]["budgets"]> {
  const dal = new AgentConfigDal(db);

  return async (tenantId: string, agentId?: string) => {
    const resolvedTenantId = tenantId.trim();
    const resolvedAgentId = agentId?.trim();
    if (!resolvedTenantId || !resolvedAgentId) return DEFAULT_BUDGETS;

    const revision = await dal.getLatest({ tenantId: resolvedTenantId, agentId: resolvedAgentId });
    return revision?.config.memory.v1.budgets ?? DEFAULT_BUDGETS;
  };
}
