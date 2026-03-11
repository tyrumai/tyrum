import { vi } from "vitest";
import {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  capabilityDescriptorsForClientCapability,
  type CapabilityDescriptor,
  type CapabilityKind,
} from "@tyrum/schemas";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import type { ProtocolDeps } from "../../src/ws/protocol.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

export type SpyLogger = NonNullable<ProtocolDeps["logger"]> & {
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
};

export interface MockWebSocket {
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  readyState: number;
}

export function createMockWs(): MockWebSocket {
  return {
    send: vi.fn(),
    close: vi.fn(),
    on: vi.fn(() => undefined as never),
    readyState: 1,
  };
}

export function createSpyLogger(): SpyLogger {
  const logger = {
    child: vi.fn((_fields: Record<string, unknown>) => logger),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return logger as unknown as SpyLogger;
}

export function makeDeps(cm: ConnectionManager, overrides?: Partial<ProtocolDeps>): ProtocolDeps {
  return { connectionManager: cm, ...overrides };
}

export function makeClient(
  cm: ConnectionManager,
  capabilities: Array<CapabilityDescriptor | CapabilityKind | string>,
  opts?: {
    id?: string;
    role?: "client" | "node";
    deviceId?: string;
    authClaims?: unknown;
    protocolRev?: number;
  },
): { id: string; ws: MockWebSocket } {
  const ws = createMockWs();
  const authClaims =
    opts?.authClaims ??
    ({
      token_kind: "admin",
      token_id: "token-1",
      tenant_id: DEFAULT_TENANT_ID,
      role: "admin",
      scopes: ["*"],
    } as const);
  const normalizedCapabilities = capabilities.flatMap((capability) => {
    if (typeof capability !== "string") {
      return [capability];
    }
    if (capability.includes(".")) {
      return [{ id: capability, version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION }];
    }
    return capabilityDescriptorsForClientCapability(capability as CapabilityKind);
  });
  const id = cm.addClient(
    ws as never,
    normalizedCapabilities as never,
    {
      ...opts,
      authClaims,
    } as never,
  );
  return { id, ws };
}
