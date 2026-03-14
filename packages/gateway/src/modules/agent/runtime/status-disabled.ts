import { AgentStatusResponse } from "@tyrum/schemas";
import { resolveAgentPersona } from "../persona.js";

export function createDisabledAgentStatus(input: { home: string; agentKey: string }) {
  const persona = resolveAgentPersona({ agentKey: input.agentKey });
  return AgentStatusResponse.parse({
    enabled: false,
    home: input.home,
    persona,
    identity: { name: persona.name },
    model: { model: "disabled/disabled" },
    skills: [],
    mcp: [],
    tools: [],
    tool_access: { default_mode: "allow", allow: [], deny: [] },
    sessions: { ttl_days: 365, max_turns: 0 },
  });
}
