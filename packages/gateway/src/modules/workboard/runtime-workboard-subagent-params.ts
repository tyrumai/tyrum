import type { WorkboardRepository } from "@tyrum/runtime-workboard";
import type { WorkboardDal } from "./dal.js";

export function toGatewaySubagentCreateParams(
  params: Parameters<WorkboardRepository["createSubagent"]>[0],
): Parameters<WorkboardDal["createSubagent"]>[0] {
  return {
    scope: params.scope,
    subagentId: params.subagentId,
    subagent: {
      parent_conversation_key: params.subagent.parent_conversation_key,
      work_item_id: params.subagent.work_item_id,
      work_item_task_id: params.subagent.work_item_task_id,
      execution_profile: params.subagent.execution_profile,
      conversation_key: params.subagent.conversation_key ?? "",
      status: params.subagent.status,
      desktop_environment_id: params.subagent.desktop_environment_id,
      attached_node_id: params.subagent.attached_node_id,
    },
  };
}

export function toGatewaySubagentListParams(
  params: Parameters<WorkboardRepository["listSubagents"]>[0],
): Parameters<WorkboardDal["listSubagents"]>[0] {
  return {
    ...params,
    parent_conversation_key: params.parent_conversation_key,
  };
}

export function toGatewaySubagentGetParams(
  params: Parameters<WorkboardRepository["getSubagent"]>[0],
): Parameters<WorkboardDal["getSubagent"]>[0] {
  return {
    ...params,
    parent_conversation_key: params.parent_conversation_key,
  };
}
