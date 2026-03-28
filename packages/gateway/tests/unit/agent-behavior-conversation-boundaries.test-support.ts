export type RuntimeTurnRequest = {
  parts?: Array<{ type?: string; text?: string }>;
  envelope?: { content?: { text?: string } };
};

export function textParts(text: string): Array<{ type: "text"; text: string }> {
  return [{ type: "text", text }];
}

export function textFromTurnRequest(req: RuntimeTurnRequest): string | undefined {
  const partsText = req.parts
    ?.filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
  return partsText && partsText.length > 0 ? partsText : req.envelope?.content?.text;
}

export function makeRuntimeConfig(input?: { memoryEnabled?: boolean }): Record<string, unknown> {
  return {
    model: { model: "openai/gpt-4.1" },
    skills: { default_mode: "deny", workspace_trusted: false },
    mcp: {
      default_mode: "allow",
      pre_turn_tools: ["mcp.memory.seed"],
      server_settings: {
        memory: input?.memoryEnabled
          ? {
              enabled: true,
              keyword: { enabled: true, limit: 20 },
              semantic: { enabled: false, limit: 1 },
              structured: { fact_keys: [], tags: [] },
              budgets: {
                max_total_items: 10,
                max_total_chars: 4000,
                per_kind: {
                  fact: { max_items: 4, max_chars: 1200 },
                  note: { max_items: 6, max_chars: 2400 },
                  procedure: { max_items: 2, max_chars: 1200 },
                  episode: { max_items: 4, max_chars: 1600 },
                },
              },
            }
          : { enabled: false },
      },
    },
    tools: { default_mode: "allow" },
    conversations: { ttl_days: 30, max_turns: 20 },
  };
}

export function noteDecision(body_md: string) {
  return {
    should_store: true as const,
    reason: "Durable user-provided information.",
    memory: {
      kind: "note" as const,
      body_md,
    },
  };
}
