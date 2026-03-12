import type { ToolDescriptor } from "../tools.js";
import type { PolicyService } from "../../policy/service.js";
import { loadScopedPolicyBundle } from "../../policy/scoped-bundle.js";
import { wildcardMatch } from "../../policy/wildcard.js";

function isSideEffectingPluginTool(tool: ToolDescriptor): boolean {
  const id = tool.id.trim();
  return id.startsWith("plugin.") && tool.requires_confirmation;
}

export async function resolvePolicyGatedPluginToolExposure(input: {
  policyService: PolicyService;
  tenantId: string;
  agentId: string;
  allowlist: readonly string[];
  pluginTools: readonly ToolDescriptor[];
}): Promise<{ allowlist: string[]; pluginTools: ToolDescriptor[] }> {
  const pluginTools = input.pluginTools
    .map((tool) => {
      const id = tool.id.trim();
      if (!id) return undefined;
      if (id === tool.id) return tool;
      return { ...tool, id };
    })
    .filter((tool): tool is ToolDescriptor => Boolean(tool));

  if (
    pluginTools.every((tool) => !isSideEffectingPluginTool(tool)) ||
    !input.policyService.isEnabled() ||
    input.policyService.isObserveOnly()
  ) {
    return { allowlist: [...input.allowlist], pluginTools };
  }

  try {
    const effective = await loadScopedPolicyBundle(input.policyService, {
      tenantId: input.tenantId,
      agentId: input.agentId,
    });
    const toolsDomain = effective.bundle.tools;
    const deny = toolsDomain?.deny ?? [];
    const allow = toolsDomain?.allow ?? [];
    const requireApproval = toolsDomain?.require_approval ?? [];
    const isOptedIn = (toolId: string): boolean => {
      for (const pat of deny) {
        if (wildcardMatch(pat, toolId)) return false;
      }
      for (const pat of requireApproval) {
        if (wildcardMatch(pat, toolId)) return true;
      }
      for (const pat of allow) {
        if (wildcardMatch(pat, toolId)) return true;
      }
      return false;
    };

    const gatedPluginTools = pluginTools.filter(
      (tool) => !isSideEffectingPluginTool(tool) || isOptedIn(tool.id),
    );
    const gatedAllowlist = new Set(input.allowlist);
    for (const tool of gatedPluginTools) {
      if (isSideEffectingPluginTool(tool) && isOptedIn(tool.id)) {
        gatedAllowlist.add(tool.id);
      }
    }

    return { allowlist: [...gatedAllowlist], pluginTools: gatedPluginTools };
  } catch {
    // Intentional: fail closed; side-effecting plugin tools are opt-in and require a readable policy bundle.
    return {
      allowlist: [...input.allowlist],
      pluginTools: pluginTools.filter((tool) => !isSideEffectingPluginTool(tool)),
    };
  }
}
