import type { ToolDescriptor } from "../tools.js";

export function resolvePolicyGatedPluginToolExposure(input: {
  allowlist: readonly string[];
  pluginTools: readonly ToolDescriptor[];
}): { allowlist: string[]; pluginTools: ToolDescriptor[] } {
  return {
    allowlist: [...input.allowlist],
    pluginTools: [...input.pluginTools],
  };
}
