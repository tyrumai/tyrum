import type { McpServerSpec } from "@tyrum/schemas";
import type { SecretProvider } from "../secret/provider.js";

export const BUILTIN_EXA_SERVER_ID = "exa";
const BUILTIN_EXA_URL = "https://mcp.exa.ai/mcp";
const BUILTIN_EXA_TOOL_NAMES = ["web_search_exa", "get_code_context_exa", "crawling_exa"];
const EXA_API_KEY_SECRET_ID = "exa_api_key";

async function resolveExaApiKey(secretProvider?: SecretProvider): Promise<string | undefined> {
  if (!secretProvider) return undefined;
  try {
    const value = await secretProvider.resolve({
      handle_id: EXA_API_KEY_SECRET_ID,
      provider: "db",
      scope: EXA_API_KEY_SECRET_ID,
      created_at: new Date(0).toISOString(),
    });
    return value?.trim() ? value : undefined;
  } catch {
    return undefined;
  }
}

export async function buildBuiltinExaServerSpec(
  secretProvider?: SecretProvider,
): Promise<McpServerSpec> {
  const url = new URL(BUILTIN_EXA_URL);
  url.searchParams.set("tools", BUILTIN_EXA_TOOL_NAMES.join(","));

  const apiKey = await resolveExaApiKey(secretProvider);
  if (apiKey) {
    url.searchParams.set("exaApiKey", apiKey);
  }

  return {
    id: BUILTIN_EXA_SERVER_ID,
    name: "Exa",
    enabled: true,
    transport: "remote",
    url: url.toString(),
  };
}
