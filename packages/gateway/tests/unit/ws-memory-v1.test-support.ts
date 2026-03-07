import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { ConnectionManager, type ConnectedClient } from "../../src/ws/connection-manager.js";
import { handleClientMessage } from "../../src/ws/protocol.js";
import type { ProtocolDeps } from "../../src/ws/protocol.js";
import { FsArtifactStore } from "../../src/modules/artifact/store.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { MemoryV1Dal } from "../../src/modules/memory/v1-dal.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

export interface MockWebSocket {
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  readyState: number;
}

type MakeClientOptions = {
  role?: "client" | "node";
  authClaims?: unknown;
};

export type WsMemoryV1Context = {
  artifactStore: FsArtifactStore;
  baseDir: string;
  db: ReturnType<typeof openTestSqliteDb>;
  memoryV1Dal: MemoryV1Dal;
};

export type WsMemoryV1State = {
  current: WsMemoryV1Context | undefined;
};

export type OperatorAudience = {
  nodeWs: MockWebSocket;
  otherOperatorWs: MockWebSocket;
  pairingOnlyWs: MockWebSocket;
  requesterId: string;
  requesterWs: MockWebSocket;
};

function createMockWs(): MockWebSocket {
  return {
    send: vi.fn(),
    close: vi.fn(),
    on: vi.fn(() => undefined as never),
    readyState: 1,
  };
}

export function registerWsMemoryV1Lifecycle(): WsMemoryV1State {
  const state: WsMemoryV1State = { current: undefined };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-19T12:00:00.000Z"));

    const baseDir = mkdtempSync(join(tmpdir(), "tyrum-ws-memory-v1-test-"));
    const db = openTestSqliteDb();
    state.current = {
      baseDir,
      db,
      memoryV1Dal: new MemoryV1Dal(db),
      artifactStore: new FsArtifactStore(baseDir),
    };
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (!state.current) return;

    await state.current.db.close();
    rmSync(state.current.baseDir, { recursive: true, force: true });
    state.current = undefined;
  });

  return state;
}

export function requireWsMemoryV1Context(state: WsMemoryV1State): WsMemoryV1Context {
  if (!state.current) {
    throw new Error("WS memory v1 test context not initialized");
  }

  return state.current;
}

export function makeClient(
  cm: ConnectionManager,
  opts?: MakeClientOptions,
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
  const id = cm.addClient(ws as never, [] as never, { role: opts?.role, authClaims } as never);
  return { id, ws };
}

export function requireClient(cm: ConnectionManager, id: string): ConnectedClient {
  const client = cm.getClient(id);
  if (!client) {
    throw new Error(`missing connected client: ${id}`);
  }
  return client;
}

export function createOperatorAudience(cm: ConnectionManager): OperatorAudience {
  const { id: requesterId, ws: requesterWs } = makeClient(cm);
  const { ws: otherOperatorWs } = makeClient(cm, {
    authClaims: {
      token_kind: "device",
      token_id: "token-op-1",
      tenant_id: DEFAULT_TENANT_ID,
      role: "client",
      device_id: "dev_client_1",
      scopes: ["operator.read"],
    },
  });
  const { ws: pairingOnlyWs } = makeClient(cm, {
    authClaims: {
      token_kind: "device",
      token_id: "token-pair-1",
      tenant_id: DEFAULT_TENANT_ID,
      role: "client",
      device_id: "dev_client_2",
      scopes: ["operator.pairing"],
    },
  });
  const { ws: nodeWs } = makeClient(cm, { role: "node" });

  return { requesterId, requesterWs, otherOperatorWs, pairingOnlyWs, nodeWs };
}

export function createMemoryProtocolDeps(
  cm: ConnectionManager,
  ctx: WsMemoryV1Context,
  options: Partial<ProtocolDeps> & { includeArtifactStore?: boolean } = {},
): ProtocolDeps {
  const { includeArtifactStore = false, ...overrides } = options;
  return {
    connectionManager: cm,
    db: ctx.db,
    memoryV1Dal: ctx.memoryV1Dal,
    ...(includeArtifactStore ? { artifactStore: ctx.artifactStore } : {}),
    ...overrides,
  };
}

export async function sendProtocolMessage(
  client: ConnectedClient,
  deps: ProtocolDeps,
  requestId: string,
  type: string,
  payload: unknown,
): Promise<unknown> {
  return await handleClientMessage(
    client,
    JSON.stringify({ request_id: requestId, type, payload }),
    deps,
  );
}

export function parseSentJson(ws: MockWebSocket): unknown[] {
  return ws.send.mock.calls
    .map((call) => call[0])
    .map((raw) =>
      typeof raw === "string" ? raw : raw instanceof Buffer ? raw.toString("utf8") : "",
    )
    .filter((raw) => raw.length > 0)
    .map((raw) => JSON.parse(raw) as unknown);
}

export function getSentEvents(ws: MockWebSocket, type: string): unknown[] {
  return parseSentJson(ws).filter((message) => (message as { type?: unknown }).type === type);
}

export function expectAudienceEvent(audience: OperatorAudience, type: string): unknown[] {
  const requesterEvents = getSentEvents(audience.requesterWs, type);
  expect(requesterEvents).toHaveLength(1);
  expect(getSentEvents(audience.otherOperatorWs, type)).toHaveLength(1);
  expect(getSentEvents(audience.pairingOnlyWs, type)).toHaveLength(0);
  expect(getSentEvents(audience.nodeWs, type)).toHaveLength(0);
  return requesterEvents;
}

export function expectOk<T = unknown>(response: unknown): T {
  expect(response).toBeDefined();
  expect((response as { ok: boolean }).ok).toBe(true);
  return (response as { result: T }).result;
}

export function expectErrorCode(
  response: unknown,
  code: string,
): { code: string; message?: string } {
  expect(response).toBeDefined();
  expect((response as { ok: boolean }).ok).toBe(false);
  const error = (response as { error: { code: string; message?: string } }).error;
  expect(error.code).toBe(code);
  return error;
}
