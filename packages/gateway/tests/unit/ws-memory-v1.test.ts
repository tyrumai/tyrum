import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { handleClientMessage } from "../../src/ws/protocol.js";
import type { ProtocolDeps } from "../../src/ws/protocol.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { MemoryV1Dal } from "../../src/modules/memory/v1-dal.js";
import { FsArtifactStore } from "../../src/modules/artifact/store.js";

interface MockWebSocket {
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  readyState: number;
}

function createMockWs(): MockWebSocket {
  return {
    send: vi.fn(),
    close: vi.fn(),
    on: vi.fn(() => undefined as never),
    readyState: 1,
  };
}

function makeClient(
  cm: ConnectionManager,
  opts?: { role?: "client" | "node"; authClaims?: unknown },
): { id: string; ws: MockWebSocket } {
  const ws = createMockWs();
  const authClaims =
    opts?.authClaims ??
    ({
      token_kind: "admin",
      role: "admin",
      scopes: ["*"],
    } as const);
  const id = cm.addClient(ws as never, [] as never, { role: opts?.role, authClaims } as never);
  return { id, ws };
}

function makeDeps(cm: ConnectionManager, overrides?: Partial<ProtocolDeps>): ProtocolDeps {
  return { connectionManager: cm, ...overrides };
}

function parseSentJson(ws: MockWebSocket): unknown[] {
  return ws.send.mock.calls
    .map((c) => c[0])
    .map((raw) =>
      typeof raw === "string" ? raw : raw instanceof Buffer ? raw.toString("utf8") : "",
    )
    .filter((raw) => raw.length > 0)
    .map((raw) => JSON.parse(raw) as unknown);
}

describe("WS memory v1 handlers", () => {
  let baseDir: string;
  let db: ReturnType<typeof openTestSqliteDb>;
  let memoryV1Dal: MemoryV1Dal;
  let artifactStore: FsArtifactStore;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-19T12:00:00.000Z"));

    baseDir = mkdtempSync(join(tmpdir(), "tyrum-ws-memory-v1-test-"));
    db = openTestSqliteDb();
    memoryV1Dal = new MemoryV1Dal(db);
    artifactStore = new FsArtifactStore(baseDir);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await db.close();
    rmSync(baseDir, { recursive: true, force: true });
  });

  it("handles memory.create/update/get/list/search/delete and broadcasts events to operator clients", async () => {
    const cm = new ConnectionManager();
    const { id: requesterId, ws: requesterWs } = makeClient(cm);
    const { ws: otherOperatorWs } = makeClient(cm, {
      authClaims: {
        token_kind: "device",
        role: "client",
        device_id: "dev_client_1",
        scopes: ["operator.read"],
      },
    });
    const { ws: pairingOnlyWs } = makeClient(cm, {
      authClaims: {
        token_kind: "device",
        role: "client",
        device_id: "dev_client_2",
        scopes: ["operator.pairing"],
      },
    });
    const { ws: nodeWs } = makeClient(cm, { role: "node" });

    const deps = makeDeps(cm, { db } as unknown as Partial<ProtocolDeps>);
    (deps as unknown as { memoryV1Dal: MemoryV1Dal }).memoryV1Dal = memoryV1Dal;
    (deps as unknown as { artifactStore: FsArtifactStore }).artifactStore = artifactStore;

    const requester = cm.getClient(requesterId)!;

    const createRes = await handleClientMessage(
      requester,
      JSON.stringify({
        request_id: "r-create-1",
        type: "memory.create",
        payload: {
          v: 1,
          item: {
            kind: "note",
            body_md: "Remember to check dashboards.",
            tags: ["project"],
            sensitivity: "private",
            provenance: { source_kind: "operator" },
          },
        },
      }),
      deps,
    );

    expect(createRes).toBeDefined();
    expect((createRes as unknown as { ok: boolean }).ok).toBe(true);

    const createdItem = (createRes as unknown as { result: { item: { memory_item_id: string } } })
      .result.item;
    expect(createdItem.memory_item_id).toMatch(/^[0-9a-f-]{36}$/i);

    const createEvents = parseSentJson(requesterWs).filter(
      (m) => (m as { type?: unknown }).type === "memory.item.created",
    );
    expect(createEvents.length).toBe(1);

    const createdEvent = createEvents[0] as {
      type: string;
      payload: { item: { memory_item_id: string } };
    };
    expect(createdEvent.payload.item.memory_item_id).toBe(createdItem.memory_item_id);

    expect(
      parseSentJson(otherOperatorWs).some(
        (m) => (m as { type?: unknown }).type === "memory.item.created",
      ),
    ).toBe(true);
    expect(
      parseSentJson(pairingOnlyWs).some(
        (m) => (m as { type?: unknown }).type === "memory.item.created",
      ),
    ).toBe(false);
    expect(
      parseSentJson(nodeWs).some((m) => (m as { type?: unknown }).type === "memory.item.created"),
    ).toBe(false);

    vi.setSystemTime(new Date("2026-02-19T12:00:01.000Z"));
    const updateRes = await handleClientMessage(
      requester,
      JSON.stringify({
        request_id: "r-update-1",
        type: "memory.update",
        payload: {
          v: 1,
          memory_item_id: createdItem.memory_item_id,
          patch: { body_md: "Updated." },
        },
      }),
      deps,
    );
    expect((updateRes as unknown as { ok: boolean }).ok).toBe(true);

    const updateEvents = parseSentJson(requesterWs).filter(
      (m) => (m as { type?: unknown }).type === "memory.item.updated",
    );
    expect(updateEvents.length).toBe(1);
    expect(
      parseSentJson(otherOperatorWs).some(
        (m) => (m as { type?: unknown }).type === "memory.item.updated",
      ),
    ).toBe(true);
    expect(
      parseSentJson(pairingOnlyWs).some(
        (m) => (m as { type?: unknown }).type === "memory.item.updated",
      ),
    ).toBe(false);
    expect(
      parseSentJson(nodeWs).some((m) => (m as { type?: unknown }).type === "memory.item.updated"),
    ).toBe(false);

    const getRes = await handleClientMessage(
      requester,
      JSON.stringify({
        request_id: "r-get-1",
        type: "memory.get",
        payload: { v: 1, memory_item_id: createdItem.memory_item_id },
      }),
      deps,
    );
    expect((getRes as unknown as { ok: boolean }).ok).toBe(true);

    const listRes = await handleClientMessage(
      requester,
      JSON.stringify({
        request_id: "r-list-1",
        type: "memory.list",
        payload: { v: 1, filter: { kinds: ["note"] }, limit: 50 },
      }),
      deps,
    );
    expect((listRes as unknown as { ok: boolean }).ok).toBe(true);

    const searchRes = await handleClientMessage(
      requester,
      JSON.stringify({
        request_id: "r-search-1",
        type: "memory.search",
        payload: { v: 1, query: "updated", limit: 20 },
      }),
      deps,
    );
    expect((searchRes as unknown as { ok: boolean }).ok).toBe(true);

    const deleteRes = await handleClientMessage(
      requester,
      JSON.stringify({
        request_id: "r-delete-1",
        type: "memory.delete",
        payload: { v: 1, memory_item_id: createdItem.memory_item_id, reason: "cleanup" },
      }),
      deps,
    );
    expect((deleteRes as unknown as { ok: boolean }).ok).toBe(true);

    const deleteEvents = parseSentJson(requesterWs).filter(
      (m) => (m as { type?: unknown }).type === "memory.item.deleted",
    );
    expect(deleteEvents.length).toBe(1);
    expect(
      parseSentJson(otherOperatorWs).some(
        (m) => (m as { type?: unknown }).type === "memory.item.deleted",
      ),
    ).toBe(true);
    expect(
      parseSentJson(pairingOnlyWs).some(
        (m) => (m as { type?: unknown }).type === "memory.item.deleted",
      ),
    ).toBe(false);
    expect(
      parseSentJson(nodeWs).some((m) => (m as { type?: unknown }).type === "memory.item.deleted"),
    ).toBe(false);
  });

  it("forbids write memory operations for scoped tokens without operator.write", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, {
      authClaims: {
        token_kind: "device",
        role: "client",
        device_id: "dev_client_1",
        scopes: ["operator.read"],
      },
    });
    const client = cm.getClient(id)!;

    const deps = makeDeps(cm, { db } as unknown as Partial<ProtocolDeps>);
    (deps as unknown as { memoryV1Dal: MemoryV1Dal }).memoryV1Dal = memoryV1Dal;

    const res = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "r-create-1",
        type: "memory.create",
        payload: {
          v: 1,
          item: {
            kind: "note",
            body_md: "nope",
            provenance: { source_kind: "operator" },
          },
        },
      }),
      deps,
    );

    expect(res).toBeDefined();
    expect((res as unknown as { ok: boolean }).ok).toBe(false);
    expect((res as unknown as { error: { code: string } }).error.code).toBe("forbidden");
  });

  it("handles memory.forget and emits memory.item.forgotten", async () => {
    const cm = new ConnectionManager();
    const { id: requesterId, ws: requesterWs } = makeClient(cm);
    const { ws: otherOperatorWs } = makeClient(cm, {
      authClaims: {
        token_kind: "device",
        role: "client",
        device_id: "dev_client_1",
        scopes: ["operator.read"],
      },
    });
    const { ws: pairingOnlyWs } = makeClient(cm, {
      authClaims: {
        token_kind: "device",
        role: "client",
        device_id: "dev_client_2",
        scopes: ["operator.pairing"],
      },
    });
    const { ws: nodeWs } = makeClient(cm, { role: "node" });

    const deps = makeDeps(cm, { db } as unknown as Partial<ProtocolDeps>);
    (deps as unknown as { memoryV1Dal: MemoryV1Dal }).memoryV1Dal = memoryV1Dal;

    const requester = cm.getClient(requesterId)!;

    const createRes = await handleClientMessage(
      requester,
      JSON.stringify({
        request_id: "r-create-1",
        type: "memory.create",
        payload: {
          v: 1,
          item: {
            kind: "note",
            body_md: "Forget me.",
            tags: ["project"],
            provenance: { source_kind: "operator" },
          },
        },
      }),
      deps,
    );
    expect((createRes as unknown as { ok: boolean }).ok).toBe(true);

    const forgetRes = await handleClientMessage(
      requester,
      JSON.stringify({
        request_id: "r-forget-1",
        type: "memory.forget",
        payload: { v: 1, confirm: "FORGET", selectors: [{ kind: "tag", tag: "project" }] },
      }),
      deps,
    );

    expect((forgetRes as unknown as { ok: boolean }).ok).toBe(true);

    const forgotEvents = parseSentJson(requesterWs).filter(
      (m) => (m as { type?: unknown }).type === "memory.item.forgotten",
    );
    expect(forgotEvents.length).toBe(1);
    expect(
      parseSentJson(otherOperatorWs).some(
        (m) => (m as { type?: unknown }).type === "memory.item.forgotten",
      ),
    ).toBe(true);
    expect(
      parseSentJson(pairingOnlyWs).some(
        (m) => (m as { type?: unknown }).type === "memory.item.forgotten",
      ),
    ).toBe(false);
    expect(
      parseSentJson(nodeWs).some((m) => (m as { type?: unknown }).type === "memory.item.forgotten"),
    ).toBe(false);
  });

  it("stores a memory export artifact and emits memory.export.completed", async () => {
    const cm = new ConnectionManager();
    const { id: requesterId, ws: requesterWs } = makeClient(cm);
    const { ws: otherOperatorWs } = makeClient(cm, {
      authClaims: {
        token_kind: "device",
        role: "client",
        device_id: "dev_client_1",
        scopes: ["operator.read"],
      },
    });
    const { ws: pairingOnlyWs } = makeClient(cm, {
      authClaims: {
        token_kind: "device",
        role: "client",
        device_id: "dev_client_2",
        scopes: ["operator.pairing"],
      },
    });
    const { ws: nodeWs } = makeClient(cm, { role: "node" });
    const deps = makeDeps(cm, { db } as unknown as Partial<ProtocolDeps>);
    (deps as unknown as { memoryV1Dal: MemoryV1Dal }).memoryV1Dal = memoryV1Dal;
    (deps as unknown as { artifactStore: FsArtifactStore }).artifactStore = artifactStore;

    const requester = cm.getClient(requesterId)!;

    await handleClientMessage(
      requester,
      JSON.stringify({
        request_id: "r-create-1",
        type: "memory.create",
        payload: {
          v: 1,
          item: {
            kind: "note",
            body_md: "Export me.",
            provenance: { source_kind: "operator" },
          },
        },
      }),
      deps,
    );

    const exportRes = await handleClientMessage(
      requester,
      JSON.stringify({
        request_id: "r-export-1",
        type: "memory.export",
        payload: { v: 1, include_tombstones: false },
      }),
      deps,
    );

    expect(exportRes).toBeDefined();
    expect((exportRes as unknown as { ok: boolean }).ok).toBe(true);
    const artifactId = (exportRes as unknown as { result: { artifact_id: string } }).result
      .artifact_id;
    expect(artifactId).toMatch(/^[0-9a-f-]{36}$/i);

    const got = await artifactStore.get(artifactId);
    expect(got).not.toBeNull();
    expect(got!.body.toString("utf8")).toContain("Export me.");

    const exportEvents = parseSentJson(requesterWs).filter(
      (m) => (m as { type?: unknown }).type === "memory.export.completed",
    );
    expect(exportEvents.length).toBe(1);
    expect(
      parseSentJson(otherOperatorWs).some(
        (m) => (m as { type?: unknown }).type === "memory.export.completed",
      ),
    ).toBe(true);
    expect(
      parseSentJson(pairingOnlyWs).some(
        (m) => (m as { type?: unknown }).type === "memory.export.completed",
      ),
    ).toBe(false);
    expect(
      parseSentJson(nodeWs).some(
        (m) => (m as { type?: unknown }).type === "memory.export.completed",
      ),
    ).toBe(false);
  });
});
