import type { ConnectedClient } from "../../src/ws/connection-manager.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

export function createAdminWsClient(
  overrides?: Partial<Omit<ConnectedClient, "readyCapabilities">> & {
    readyCapabilities?: Set<ConnectedClient["capabilities"][number]>;
  },
): ConnectedClient {
  return {
    id: "test-client",
    ws: {} as unknown as ConnectedClient["ws"],
    role: "client",
    auth_claims: {
      token_kind: "admin",
      role: "admin",
      scopes: ["*"],
      tenant_id: DEFAULT_TENANT_ID,
    },
    protocol_rev: 1,
    capabilities: [],
    readyCapabilities: overrides?.readyCapabilities ?? new Set(),
    lastPong: Date.now(),
    ...overrides,
  };
}

export function serializeWsRequest(params: {
  requestId?: string;
  type: string;
  payload?: unknown;
}): string {
  return JSON.stringify({
    request_id: params.requestId ?? "req-1",
    type: params.type,
    payload: params.payload ?? {},
  });
}
