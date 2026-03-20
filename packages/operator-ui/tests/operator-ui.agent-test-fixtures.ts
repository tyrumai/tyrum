import { AgentConfig, IdentityPack } from "@tyrum/contracts";

export function sampleManagedAgentDetail(agentKey: string) {
  return {
    agent_id:
      agentKey === "default"
        ? "11111111-1111-4111-8111-111111111111"
        : "22222222-2222-4222-8222-222222222222",
    agent_key: agentKey,
    created_at: "2026-03-08T00:00:00.000Z",
    updated_at: "2026-03-08T00:00:00.000Z",
    has_config: true,
    has_identity: true,
    is_primary: agentKey === "default",
    can_delete: agentKey !== "default",
    persona: {
      name: agentKey === "default" ? "Default Agent" : "Agent One",
      tone: "direct",
      palette: "graphite",
      character: "architect",
    },
    config: AgentConfig.parse({
      model: { model: "openai/gpt-5.4" },
      persona: {
        name: agentKey === "default" ? "Default Agent" : "Agent One",
        tone: "direct",
        palette: "graphite",
        character: "architect",
      },
    }),
    identity: IdentityPack.parse({
      meta: {
        name: agentKey === "default" ? "Default Agent" : "Agent One",
        style: {
          tone: "direct",
        },
      },
    }),
    config_revision: 1,
    identity_revision: 1,
    config_sha256: "a".repeat(64),
    identity_sha256: "b".repeat(64),
  };
}
