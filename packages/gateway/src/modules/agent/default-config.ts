import { AgentConfig } from "@tyrum/schemas";
import type { AgentConfig as AgentConfigT } from "@tyrum/schemas";
import type { GatewayStateMode } from "../runtime-state/mode.js";
import type { SqlDb } from "../../statestore/types.js";
import { AgentConfigDal, type AgentConfigRevision } from "../config/agent-config-dal.js";
import { buildSeededAgentPersona } from "./persona.js";

export function buildDefaultAgentConfig(
  stateMode: GatewayStateMode,
  persona?: AgentConfigT["persona"],
): AgentConfigT {
  return AgentConfig.parse({
    model: { model: "openai/gpt-4.1" },
    ...(persona ? { persona } : {}),
    tools: { allow: stateMode === "local" ? ["tool.fs.read"] : [] },
  });
}

export async function ensureAgentConfigSeeded(params: {
  db: SqlDb;
  stateMode: GatewayStateMode;
  tenantId: string;
  agentId: string;
  agentKey: string;
  createdBy?: unknown;
  reason?: string;
}): Promise<AgentConfigRevision> {
  return await new AgentConfigDal(params.db).ensureSeeded({
    tenantId: params.tenantId,
    agentId: params.agentId,
    defaultConfig: async () =>
      buildDefaultAgentConfig(
        params.stateMode,
        await buildSeededAgentPersona({
          db: params.db,
          tenantId: params.tenantId,
          agentId: params.agentId,
          agentKey: params.agentKey,
        }),
      ),
    createdBy: params.createdBy,
    reason: params.reason,
  });
}
