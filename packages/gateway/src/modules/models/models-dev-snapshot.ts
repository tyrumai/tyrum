import type { ModelsDevCatalog } from "@tyrum/contracts";

/**
 * Bundled Models.dev snapshot (minimal).
 *
 * Used only when remote fetch fails and no cached catalog exists.
 * Keep this small; treat it as a bootstrap set, not a full mirror.
 */
export const snapshot: ModelsDevCatalog = {
  openai: {
    id: "openai",
    name: "OpenAI",
    env: ["OPENAI_API_KEY"],
    api: "https://api.openai.com/v1",
    npm: "@ai-sdk/openai",
    models: {
      "gpt-5.4": {
        id: "gpt-5.4",
        name: "GPT-5.4",
        release_date: "2026-01-01",
        attachment: true,
        reasoning: true,
        temperature: true,
        tool_call: true,
        limit: { context: 128000, output: 8192 },
        options: {},
      },
      "gpt-4.1": {
        id: "gpt-4.1",
        name: "GPT-4.1",
        release_date: "2025-01-01",
        attachment: true,
        reasoning: true,
        temperature: true,
        tool_call: true,
        limit: { context: 128000, output: 8192 },
        options: {},
      },
    },
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    env: ["ANTHROPIC_API_KEY"],
    api: "https://api.anthropic.com",
    npm: "@ai-sdk/anthropic",
    models: {
      "claude-3-5-sonnet-20241022": {
        id: "claude-3-5-sonnet-20241022",
        name: "Claude 3.5 Sonnet",
        release_date: "2024-10-22",
        attachment: true,
        reasoning: true,
        temperature: true,
        tool_call: true,
        limit: { context: 200000, output: 8192 },
        options: {},
      },
    },
  },
};
