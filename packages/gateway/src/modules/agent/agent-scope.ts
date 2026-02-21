/**
 * Agent scope helper -- provides agent_id-aware query utilities.
 * When TYRUM_MULTI_AGENT is off, always returns 'default'.
 */

import type { EventPublisher } from "../backplane/event-publisher.js";

const DEFAULT_AGENT_ID = "default";

export function isMultiAgentEnabled(): boolean {
  const raw = process.env["TYRUM_MULTI_AGENT"]?.trim().toLowerCase();
  if (!raw) return false;
  return ["1", "true", "on", "yes"].includes(raw);
}

export function resolveAgentId(agentId?: string): string {
  if (!isMultiAgentEnabled()) return DEFAULT_AGENT_ID;
  return agentId?.trim() || DEFAULT_AGENT_ID;
}

export function agentScopeClause(_paramIndex: number): string {
  return `agent_id = ?`;
}

/**
 * Append agent_id filter to a WHERE clause.
 * If multi-agent is disabled, this is a no-op (filter is always 'default').
 */
export function withAgentScope(
  query: string,
  agentId: string,
  params: unknown[],
): { query: string; params: unknown[] } {
  const resolved = resolveAgentId(agentId);
  // If the query already has WHERE, append with AND
  if (/\bWHERE\b/i.test(query)) {
    return {
      query: `${query} AND agent_id = ?`,
      params: [...params, resolved],
    };
  }
  return {
    query: `${query} WHERE agent_id = ?`,
    params: [...params, resolved],
  };
}

/**
 * Emit an agent.routed audit event when multi-agent routing occurs.
 * No-op when TYRUM_MULTI_AGENT is disabled.
 */
export function emitRoutingEvent(
  eventPublisher: EventPublisher | undefined,
  opts: { from_agent_id: string; to_agent_id: string; reason?: string },
): void {
  if (!isMultiAgentEnabled()) return;
  if (!eventPublisher) return;
  void eventPublisher.publish("agent.routed", opts).catch(() => {});
}
