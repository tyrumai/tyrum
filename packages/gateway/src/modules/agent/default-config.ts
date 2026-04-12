import { AgentConfig } from "@tyrum/contracts";
import type { AgentConfig as AgentConfigT } from "@tyrum/contracts";
import type { GatewayStateMode } from "../runtime-state/mode.js";
import type { SqlDb } from "../../statestore/types.js";
import { AgentConfigDal, type AgentConfigRevision } from "../config/agent-config-dal.js";
import { buildSeededAgentPersona } from "./persona.js";

const DEFAULT_MCP_EXPOSURE = {
  bundle: "workspace-default",
  tier: "advanced",
} as const;

const DEFAULT_TOOL_EXPOSURE = {
  bundle: "authoring-core",
  tier: "default",
} as const;

export function buildDefaultAgentConfig(
  _stateMode: GatewayStateMode,
  persona?: AgentConfigT["persona"],
): AgentConfigT {
  return AgentConfig.parse({
    model: { model: null },
    ...(persona ? { persona } : {}),
    skills: { default_mode: "allow", workspace_trusted: true },
    mcp: {
      ...DEFAULT_MCP_EXPOSURE,
      default_mode: "allow",
      pre_turn_tools: ["memory.seed"],
    },
    tools: {
      ...DEFAULT_TOOL_EXPOSURE,
      default_mode: "allow",
    },
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

export async function loadAgentConfigOrDefault(params: {
  db: SqlDb;
  stateMode: GatewayStateMode;
  tenantId: string;
  agentId: string;
}): Promise<AgentConfigT> {
  const latest = await new AgentConfigDal(params.db).getLatest({
    tenantId: params.tenantId,
    agentId: params.agentId,
  });
  return latest?.config ?? buildDefaultAgentConfig(params.stateMode);
}
