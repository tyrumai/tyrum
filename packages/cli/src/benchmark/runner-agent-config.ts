import { AgentConfig, type AgentSecretReference } from "@tyrum/contracts";

function uniqueSecretRefs(secretRefs: readonly AgentSecretReference[]): AgentSecretReference[] {
  const byId = new Map<string, AgentSecretReference>();
  for (const secretRef of secretRefs) {
    byId.set(secretRef.secret_ref_id, secretRef);
  }
  return [...byId.values()];
}

function uniqueTrimmedStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const rawValue of values) {
    const value = rawValue.trim();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

export function mergeAgentConfig(
  config: AgentConfig,
  secretRefs: readonly AgentSecretReference[],
  mcpServerAllowlist: readonly string[],
  modelOverride?: string,
): AgentConfig {
  return AgentConfig.parse({
    ...config,
    model: modelOverride ? { ...config.model, model: modelOverride } : config.model,
    secret_refs: uniqueSecretRefs([...config.secret_refs, ...secretRefs]),
    mcp: {
      ...config.mcp,
      allow: uniqueTrimmedStrings([...config.mcp.allow, ...mcpServerAllowlist]),
    },
  });
}
