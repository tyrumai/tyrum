import { AgentConfig } from "@tyrum/schemas";
import type { AgentConfig as AgentConfigT } from "@tyrum/schemas";
import type { GatewayStateMode } from "../runtime-state/mode.js";

export function buildDefaultAgentConfig(stateMode: GatewayStateMode): AgentConfigT {
  return AgentConfig.parse({
    model: { model: "openai/gpt-4.1" },
    tools: { allow: stateMode === "local" ? ["tool.fs.read"] : [] },
  });
}
