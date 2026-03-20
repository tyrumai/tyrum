import type { AgentSecretReference, McpServerSpec, SecretHandle } from "@tyrum/contracts";
import { vi } from "vitest";
import type { McpManager } from "../../src/modules/agent/mcp-manager.js";
import type { SecretProvider } from "../../src/modules/secret/provider.js";

export function stubMcpManager(overrides?: Partial<McpManager>): McpManager {
  return {
    listToolDescriptors: vi.fn(async () => []),
    shutdown: vi.fn(async () => {}),
    callTool: vi.fn(async () => ({ content: [{ type: "text", text: "mcp-result" }] })),
    ...overrides,
  } as unknown as McpManager;
}

export function createMcpSpec(id: string): McpServerSpec {
  return {
    id,
    name: `Server ${id}`,
    enabled: true,
    transport: "stdio",
    command: "node",
  };
}

export function stubSecretProvider(secrets: Map<string, string>): SecretProvider {
  const handles: SecretHandle[] = [...secrets.keys()].map((id) => ({
    handle_id: id,
    provider: "db" as const,
    scope: id,
    created_at: "",
  }));
  return {
    resolve: vi.fn(async (handle: SecretHandle) => secrets.get(handle.handle_id) ?? null),
    store: vi.fn(async () => ({
      handle_id: "h1",
      provider: "db" as const,
      scope: "test",
      created_at: "",
    })),
    revoke: vi.fn(async () => true),
    list: vi.fn(async () => handles),
  };
}

export async function allowPublicDnsLookup() {
  return [{ address: "93.184.216.34", family: 4 }] as const;
}

export function createClipboardAgentSecretRef(overrides?: Partial<AgentSecretReference>) {
  return {
    secret_ref_id: "sec-ref-db",
    secret_alias: "prod-db-password",
    allowed_tool_ids: ["tool.secret.copy-to-node-clipboard"],
    ...overrides,
  } satisfies AgentSecretReference;
}
