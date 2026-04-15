import {
  AgentToolExposureReadModel,
  type AgentConfig,
  type AgentToolExposureReadModel as AgentToolExposureReadModelT,
  type AgentToolExposureSelection as AgentToolExposureSelectionT,
} from "@tyrum/contracts";
import { resolveRuntimeExposureBundle } from "./runtime/effective-exposure-resolver.js";

function resolveSelection(
  surface: "mcp" | "tools",
  config:
    | Pick<AgentConfig["mcp"], "bundle" | "tier">
    | Pick<AgentConfig["tools"], "bundle" | "tier">,
): AgentToolExposureSelectionT {
  const bundle = resolveRuntimeExposureBundle(surface, config);
  return {
    ...(bundle ? { bundle } : {}),
    ...(config.tier ? { tier: config.tier } : {}),
  };
}

export function resolveAgentToolExposureReadModel(
  config: Pick<AgentConfig, "mcp" | "tools">,
): AgentToolExposureReadModelT {
  return AgentToolExposureReadModel.parse({
    mcp: resolveSelection("mcp", config.mcp),
    tools: resolveSelection("tools", config.tools),
  });
}
