import type { AgentSkillConfig } from "@tyrum/contracts";
import { wildcardMatch } from "../policy/wildcard.js";

type AgentAccessConfig = Pick<AgentSkillConfig, "default_mode" | "allow" | "deny">;

function normalizeId(id: string): string {
  return id.trim();
}

function matchesAccessEntry(entry: string, id: string): boolean {
  const normalizedEntry = normalizeId(entry);
  return normalizedEntry.length > 0 && wildcardMatch(normalizedEntry, id);
}

export function isAgentAccessAllowed(config: AgentAccessConfig, id: string): boolean {
  const normalizedId = normalizeId(id);
  if (!normalizedId) return false;
  const deny = config.deny ?? [];
  const allow = config.allow ?? [];
  const defaultMode = config.default_mode ?? "deny";

  if (deny.some((entry) => matchesAccessEntry(entry, normalizedId))) return false;

  if (allow.some((entry) => matchesAccessEntry(entry, normalizedId))) return true;

  return defaultMode === "allow";
}

export function materializeAllowedAgentIds<T extends { id: string }>(
  config: AgentAccessConfig,
  items: readonly T[],
): T[] {
  const seen = new Set<string>();
  const allowed: T[] = [];

  for (const item of items) {
    const id = normalizeId(item.id);
    if (!id || seen.has(id) || !isAgentAccessAllowed(config, id)) continue;
    seen.add(id);
    allowed.push(item);
  }

  return allowed;
}
