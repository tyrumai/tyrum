import { AgentConfig } from "@tyrum/schemas";
import type { AgentConfig as AgentConfigT } from "@tyrum/schemas";
import type { GatewayStateMode } from "../runtime-state/mode.js";
import type { SqlDb } from "../../statestore/types.js";
import { AgentConfigDal, type AgentConfigRevision } from "../config/agent-config-dal.js";
import { buildSeededAgentPersona } from "./persona.js";

export function buildDefaultAgentConfig(
  _stateMode: GatewayStateMode,
  persona?: AgentConfigT["persona"],
): AgentConfigT {
  return AgentConfig.parse({
    model: { model: null },
    ...(persona ? { persona } : {}),
    skills: { default_mode: "allow", workspace_trusted: true },
    mcp: { default_mode: "allow", pre_turn_tools: ["mcp.memory.seed"] },
    tools: { default_mode: "allow" },
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
