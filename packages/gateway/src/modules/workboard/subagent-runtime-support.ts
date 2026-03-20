import type { WorkScope } from "@tyrum/contracts";
import type { AgentRegistry } from "../agent/registry.js";
import type { IdentityScopeDal } from "../identity/scope.js";

type SubagentTurnTarget = {
  subagent_id: string;
  session_key: string;
  lane: string;
  agent_id: string;
  work_item_id?: string;
  work_item_task_id?: string;
  attached_node_id?: string;
};

export async function resolveAgentKeyById(params: {
  identityScopeDal: IdentityScopeDal;
  tenantId: string;
  agentId: string;
}): Promise<string> {
  const agentKey = (
    await params.identityScopeDal.resolveAgentKey(params.tenantId, params.agentId)
  )?.trim();
  if (!agentKey) {
    throw new Error("agent_key not found for work scope");
  }
  return agentKey;
}

export async function runSubagentTurn(params: {
  agents: AgentRegistry;
  identityScopeDal: IdentityScopeDal;
  scope: WorkScope;
  subagent: SubagentTurnTarget;
  message: string;
}): Promise<string> {
  const agentKey = await resolveAgentKeyById({
    identityScopeDal: params.identityScopeDal,
    tenantId: params.scope.tenant_id,
    agentId: params.subagent.agent_id,
  });
  const runtime = await params.agents.getRuntime({
    tenantId: params.scope.tenant_id,
    agentKey,
  });
  const response = await runtime.turn({
    channel: "subagent",
    thread_id: params.subagent.subagent_id,
    parts: [{ type: "text", text: params.message }],
    metadata: {
      tyrum_key: params.subagent.session_key,
      lane: params.subagent.lane,
      subagent_id: params.subagent.subagent_id,
      ...(params.subagent.work_item_id ? { work_item_id: params.subagent.work_item_id } : {}),
      ...(params.subagent.work_item_task_id
        ? { work_item_task_id: params.subagent.work_item_task_id }
        : {}),
      ...(params.subagent.attached_node_id
        ? { attached_node_id: params.subagent.attached_node_id }
        : {}),
    },
  });
  return response.reply ?? "";
}
