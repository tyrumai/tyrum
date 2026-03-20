import { vi } from "vitest";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import type { ProtocolDeps } from "../../src/ws/protocol.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import { WorkboardDal } from "../../src/modules/workboard/dal.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

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

export function makeDeps(cm: ConnectionManager, overrides?: Partial<ProtocolDeps>): ProtocolDeps {
  return { connectionManager: cm, ...overrides };
}

export async function markWorkItemDispatchReady(db: SqliteDb, workItemId: string): Promise<void> {
  const workboard = new WorkboardDal(db);
  const scope = {
    tenant_id: DEFAULT_TENANT_ID,
    agent_id: DEFAULT_AGENT_ID,
    workspace_id: DEFAULT_WORKSPACE_ID,
  } as const;
  await workboard.updateItem({
    scope,
    work_item_id: workItemId,
    patch: { acceptance: { done: true } },
  });
  await workboard.setStateKv({
    scope: { kind: "work_item", ...scope, work_item_id: workItemId },
    key: "work.refinement.phase",
    value_json: "done",
    provenance_json: { source: "test" },
  });
  await workboard.setStateKv({
    scope: { kind: "work_item", ...scope, work_item_id: workItemId },
    key: "work.size.class",
    value_json: "small",
    provenance_json: { source: "test" },
  });
}

export function makeClient(
  cm: ConnectionManager,
  opts?: { authClaims?: unknown; role?: "client" | "node" },
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
  const id = cm.addClient(
    ws as never,
    [] as never,
    {
      authClaims,
      role: opts?.role,
    } as never,
  );
  return { id, ws };
}
