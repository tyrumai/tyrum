import type { ToolDescriptor } from "../tools.js";
import type { PolicyService } from "../../policy/service.js";

export async function resolvePolicyGatedPluginToolExposure(input: {
  policyService: PolicyService;
  tenantId: string;
  agentId: string;
  allowlist: readonly string[];
  pluginTools: readonly ToolDescriptor[];
}): Promise<{ allowlist: string[]; pluginTools: ToolDescriptor[] }> {
  void input.policyService;
  void input.tenantId;
  void input.agentId;

  return {
    allowlist: [...input.allowlist],
    pluginTools: input.pluginTools
      .map((tool) => {
        const id = tool.id.trim();
        if (!id) return undefined;
        if (id === tool.id) return tool;
        return { ...tool, id };
      })
      .filter((tool): tool is ToolDescriptor => Boolean(tool)),
  };
}
