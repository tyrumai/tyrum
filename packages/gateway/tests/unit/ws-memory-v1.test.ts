import { describe, expect, it, vi } from "vitest";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { DEFAULT_TENANT_ID, IdentityScopeDal } from "../../src/modules/identity/scope.js";
import {
  createMemoryProtocolDeps,
  createOperatorAudience,
  expectAudienceEvent,
  expectErrorCode,
  expectOk,
  makeClient,
  registerWsMemoryV1Lifecycle,
  requireClient,
  requireWsMemoryV1Context,
  sendProtocolMessage,
} from "./ws-memory-v1.test-support.js";

describe("WS memory v1 handlers", () => {
  const state = registerWsMemoryV1Lifecycle();

  it("handles memory.create/update/get/list/search/delete and broadcasts events to operator clients", async () => {
    const ctx = requireWsMemoryV1Context(state);
    const cm = new ConnectionManager();
    const audience = createOperatorAudience(cm);
    const deps = createMemoryProtocolDeps(cm, ctx);
    const requester = requireClient(cm, audience.requesterId);

    const createdItem = expectOk<{ item: { memory_item_id: string } }>(
      await sendProtocolMessage(requester, deps, "r-create-1", "memory.create", {
        v: 1,
        item: {
          kind: "note",
          body_md: "Remember to check dashboards.",
          tags: ["project"],
          sensitivity: "private",
          provenance: { source_kind: "operator" },
        },
      }),
    ).item;
    expect(createdItem.memory_item_id).toMatch(/^[0-9a-f-]{36}$/i);

    const [createdEvent] = expectAudienceEvent(audience, "memory.item.created") as Array<{
      type: string;
      payload: { item: { memory_item_id: string } };
    }>;
    expect(createdEvent.payload.item.memory_item_id).toBe(createdItem.memory_item_id);

    vi.setSystemTime(new Date("2026-02-19T12:00:01.000Z"));
    expectOk(
      await sendProtocolMessage(requester, deps, "r-update-1", "memory.update", {
        v: 1,
        memory_item_id: createdItem.memory_item_id,
        patch: { body_md: "Updated." },
      }),
    );
    expectAudienceEvent(audience, "memory.item.updated");

    expectOk(
      await sendProtocolMessage(requester, deps, "r-get-1", "memory.get", {
        v: 1,
        memory_item_id: createdItem.memory_item_id,
      }),
    );
    expectOk(
      await sendProtocolMessage(requester, deps, "r-list-1", "memory.list", {
        v: 1,
        filter: { kinds: ["note"] },
        limit: 50,
      }),
    );
    expectOk(
      await sendProtocolMessage(requester, deps, "r-search-1", "memory.search", {
        v: 1,
        query: "updated",
        limit: 20,
      }),
    );
    expectOk(
      await sendProtocolMessage(requester, deps, "r-delete-1", "memory.delete", {
        v: 1,
        memory_item_id: createdItem.memory_item_id,
        reason: "cleanup",
      }),
    );
    expectAudienceEvent(audience, "memory.item.deleted");
  });

  it("forbids write memory operations for scoped tokens without operator.write", async () => {
    const ctx = requireWsMemoryV1Context(state);
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, {
      authClaims: {
        token_kind: "device",
        token_id: "token-scoped-1",
        tenant_id: DEFAULT_TENANT_ID,
        role: "client",
        device_id: "dev_client_1",
        scopes: ["operator.read"],
      },
    });
    const deps = createMemoryProtocolDeps(cm, ctx);

    expectErrorCode(
      await sendProtocolMessage(requireClient(cm, id), deps, "r-create-1", "memory.create", {
        v: 1,
        item: {
          kind: "note",
          body_md: "nope",
          provenance: { source_kind: "operator" },
        },
      }),
      "forbidden",
    );
  });

  it("uses payload.agent_id to access non-default agent memory", async () => {
    const ctx = requireWsMemoryV1Context(state);
    const cm = new ConnectionManager();
    const { id: requesterId } = makeClient(cm);
    const deps = createMemoryProtocolDeps(cm, ctx, { includeArtifactStore: true });
    const requester = requireClient(cm, requesterId);
    const identityScopeDal = new IdentityScopeDal(ctx.db);
    const agentId = await identityScopeDal.ensureAgentId(DEFAULT_TENANT_ID, "agent-2");
    const defaultAgentId = await identityScopeDal.ensureAgentId(DEFAULT_TENANT_ID, "default");

    const created = await ctx.memoryV1Dal.create(
      {
        kind: "note",
        body_md: "Scoped memory",
        tags: ["project"],
        sensitivity: "private",
        provenance: { source_kind: "operator" },
      },
      { tenantId: DEFAULT_TENANT_ID, agentId },
    );
    const defaultCreated = await ctx.memoryV1Dal.create(
      {
        kind: "note",
        body_md: "Default memory",
        tags: ["default-only"],
        sensitivity: "private",
        provenance: { source_kind: "operator" },
      },
      { tenantId: DEFAULT_TENANT_ID, agentId: defaultAgentId },
    );

    const listRes = expectOk<{ items: Array<{ memory_item_id: string }> }>(
      await sendProtocolMessage(requester, deps, "r-list-agent-2", "memory.list", {
        v: 1,
        agent_id: "agent-2",
        limit: 50,
      }),
    );
    expect(listRes.items).toEqual([
      expect.objectContaining({ memory_item_id: created.memory_item_id }),
    ]);

    const defaultListRes = expectOk<{ items: Array<{ memory_item_id: string }> }>(
      await sendProtocolMessage(requester, deps, "r-list-default", "memory.list", {
        v: 1,
        limit: 50,
      }),
    );
    expect(defaultListRes.items).toEqual([
      expect.objectContaining({ memory_item_id: defaultCreated.memory_item_id }),
    ]);

    const searchRes = expectOk<{ hits: Array<{ memory_item_id: string }> }>(
      await sendProtocolMessage(requester, deps, "r-search-agent-2", "memory.search", {
        v: 1,
        agent_id: "agent-2",
        query: "Scoped",
        limit: 50,
      }),
    );
    expect(searchRes.hits).toEqual([
      expect.objectContaining({ memory_item_id: created.memory_item_id }),
    ]);

    expectOk(
      await sendProtocolMessage(requester, deps, "r-get-agent-2", "memory.get", {
        v: 1,
        agent_id: "agent-2",
        memory_item_id: created.memory_item_id,
      }),
    );

    const updated = expectOk<{ item: { body_md: string } }>(
      await sendProtocolMessage(requester, deps, "r-update-agent-2", "memory.update", {
        v: 1,
        agent_id: "agent-2",
        memory_item_id: created.memory_item_id,
        patch: { body_md: "Scoped memory updated" },
      }),
    );
    expect(updated.item.body_md).toBe("Scoped memory updated");

    const { artifact_id: artifactId } = expectOk<{ artifact_id: string }>(
      await sendProtocolMessage(requester, deps, "r-export-agent-2", "memory.export", {
        v: 1,
        agent_id: "agent-2",
        include_tombstones: false,
      }),
    );
    const artifact = await ctx.artifactStore.get(artifactId);
    expect(artifact).not.toBeNull();
    const body = artifact!.body.toString("utf8");
    expect(body).toContain("Scoped memory updated");
    expect(body).not.toContain("Default memory");

    expectOk(
      await sendProtocolMessage(requester, deps, "r-forget-agent-2", "memory.forget", {
        v: 1,
        agent_id: "agent-2",
        confirm: "FORGET",
        selectors: [{ kind: "tag", tag: "project" }],
      }),
    );

    const afterForgetListRes = expectOk<{ items: Array<{ memory_item_id: string }> }>(
      await sendProtocolMessage(requester, deps, "r-list-agent-2-after-forget", "memory.list", {
        v: 1,
        agent_id: "agent-2",
        limit: 50,
      }),
    );
    expect(afterForgetListRes.items).toEqual([]);

    const afterForgetDefaultListRes = expectOk<{ items: Array<{ memory_item_id: string }> }>(
      await sendProtocolMessage(requester, deps, "r-list-default-after-forget", "memory.list", {
        v: 1,
        limit: 50,
      }),
    );
    expect(afterForgetDefaultListRes.items).toEqual([
      expect.objectContaining({ memory_item_id: defaultCreated.memory_item_id }),
    ]);
  });

  it("passes only resolved scope and DAL search fields into memoryV1Dal.search", async () => {
    const ctx = requireWsMemoryV1Context(state);
    const cm = new ConnectionManager();
    const { id: requesterId } = makeClient(cm);
    const deps = createMemoryProtocolDeps(cm, ctx);

    const requester = requireClient(cm, requesterId);
    const identityScopeDal = new IdentityScopeDal(ctx.db);
    const agentId = await identityScopeDal.ensureAgentId(DEFAULT_TENANT_ID, "agent-2");

    const searchSpy = vi.spyOn(ctx.memoryV1Dal, "search");

    expectOk(
      await sendProtocolMessage(requester, deps, "r-search-agent-2-spy", "memory.search", {
        v: 1,
        agent_id: "agent-2",
        query: "Scoped",
        limit: 50,
      }),
    );
    expect(searchSpy).toHaveBeenCalledTimes(1);

    const [input, scope] = searchSpy.mock.calls[0]!;
    expect(input).toEqual({
      query: "Scoped",
      filter: undefined,
      limit: 50,
      cursor: undefined,
    });
    expect(scope).toEqual({ tenantId: DEFAULT_TENANT_ID, agentId });
  });

  it("handles memory.forget and emits memory.item.forgotten", async () => {
    const ctx = requireWsMemoryV1Context(state);
    const cm = new ConnectionManager();
    const audience = createOperatorAudience(cm);
    const deps = createMemoryProtocolDeps(cm, ctx);
    const requester = requireClient(cm, audience.requesterId);

    expectOk(
      await sendProtocolMessage(requester, deps, "r-create-1", "memory.create", {
        v: 1,
        item: {
          kind: "note",
          body_md: "Forget me.",
          tags: ["project"],
          provenance: { source_kind: "operator" },
        },
      }),
    );
    expectOk(
      await sendProtocolMessage(requester, deps, "r-forget-1", "memory.forget", {
        v: 1,
        confirm: "FORGET",
        selectors: [{ kind: "tag", tag: "project" }],
      }),
    );
    expectAudienceEvent(audience, "memory.item.forgotten");
  });

  it("stores a memory export artifact and emits memory.export.completed", async () => {
    const ctx = requireWsMemoryV1Context(state);
    const cm = new ConnectionManager();
    const audience = createOperatorAudience(cm);
    const deps = createMemoryProtocolDeps(cm, ctx, { includeArtifactStore: true });
    const requester = requireClient(cm, audience.requesterId);

    await sendProtocolMessage(requester, deps, "r-create-1", "memory.create", {
      v: 1,
      item: {
        kind: "note",
        body_md: "Export me.",
        provenance: { source_kind: "operator" },
      },
    });

    const { artifact_id: artifactId } = expectOk<{ artifact_id: string }>(
      await sendProtocolMessage(requester, deps, "r-export-1", "memory.export", {
        v: 1,
        include_tombstones: false,
      }),
    );
    expect(artifactId).toMatch(/^[0-9a-f-]{36}$/i);

    const got = await ctx.artifactStore.get(artifactId);
    expect(got).not.toBeNull();
    expect(got!.body.toString("utf8")).toContain("Export me.");
    expectAudienceEvent(audience, "memory.export.completed");
  });

  it("returns not_found when memory.get refers to a missing item", async () => {
    const ctx = requireWsMemoryV1Context(state);
    const cm = new ConnectionManager();
    const { id } = makeClient(cm);
    const deps = createMemoryProtocolDeps(cm, ctx);

    expectErrorCode(
      await sendProtocolMessage(requireClient(cm, id), deps, "r-get-1", "memory.get", {
        v: 1,
        memory_item_id: "00000000-0000-0000-0000-000000000000",
      }),
      "not_found",
    );
  });

  it("returns invalid_request when cursors are malformed", async () => {
    const ctx = requireWsMemoryV1Context(state);
    const cm = new ConnectionManager();
    const { id } = makeClient(cm);
    const deps = createMemoryProtocolDeps(cm, ctx);

    expectErrorCode(
      await sendProtocolMessage(requireClient(cm, id), deps, "r-list-1", "memory.list", {
        v: 1,
        cursor: "not-a-cursor",
      }),
      "invalid_request",
    );
  });

  it("returns unsupported_request when memory.export is called without an ArtifactStore", async () => {
    const ctx = requireWsMemoryV1Context(state);
    const cm = new ConnectionManager();
    const { id } = makeClient(cm);
    const deps = createMemoryProtocolDeps(cm, ctx);

    expectErrorCode(
      await sendProtocolMessage(requireClient(cm, id), deps, "r-export-1", "memory.export", {
        v: 1,
      }),
      "unsupported_request",
    );
  });

  it("rejects memory APIs from node-role WS clients", async () => {
    const ctx = requireWsMemoryV1Context(state);
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, { role: "node" });
    const deps = createMemoryProtocolDeps(cm, ctx);

    expectErrorCode(
      await sendProtocolMessage(requireClient(cm, id), deps, "r-list-1", "memory.list", {
        v: 1,
        limit: 10,
      }),
      "unauthorized",
    );
  });

  it("returns unsupported_request when memory v1 DAL is not configured", async () => {
    const ctx = requireWsMemoryV1Context(state);
    const cm = new ConnectionManager();
    const { id } = makeClient(cm);
    const deps = { connectionManager: cm, db: ctx.db };

    expectErrorCode(
      await sendProtocolMessage(requireClient(cm, id), deps, "r-list-1", "memory.list", {
        v: 1,
        limit: 10,
      }),
      "unsupported_request",
    );
  });

  it("returns invalid_request for kind-incompatible memory.update patches", async () => {
    const ctx = requireWsMemoryV1Context(state);
    const cm = new ConnectionManager();
    const { id: requesterId } = makeClient(cm);
    const deps = createMemoryProtocolDeps(cm, ctx);
    const requester = requireClient(cm, requesterId);

    const createdItem = expectOk<{ item: { memory_item_id: string } }>(
      await sendProtocolMessage(requester, deps, "r-create-1", "memory.create", {
        v: 1,
        item: {
          kind: "note",
          body_md: "Remember to check dashboards.",
          tags: ["project"],
          sensitivity: "private",
          provenance: { source_kind: "operator" },
        },
      }),
    ).item;

    const error = expectErrorCode(
      await sendProtocolMessage(requester, deps, "r-update-1", "memory.update", {
        v: 1,
        memory_item_id: createdItem.memory_item_id,
        patch: { occurred_at: "2026-02-19T12:00:01.000Z" },
      }),
      "invalid_request",
    );
    expect(error.message).toContain("incompatible patch fields");
  });

  it("classifies memory.search guardrail failures as invalid_request", async () => {
    const ctx = requireWsMemoryV1Context(state);
    const cm = new ConnectionManager();
    const { id: requesterId } = makeClient(cm, { role: "client" });
    const deps = createMemoryProtocolDeps(cm, ctx);
    const tooLongQuery = "x".repeat(1025);

    const error = expectErrorCode(
      await sendProtocolMessage(
        requireClient(cm, requesterId),
        deps,
        "r-search-guardrail-1",
        "memory.search",
        { v: 1, query: tooLongQuery, limit: 20 },
      ),
      "invalid_request",
    );
    expect(error.message).toContain("query too long");
  });

  it("does not fail memory.create when budgets provider/consolidation throws", async () => {
    const ctx = requireWsMemoryV1Context(state);
    const cm = new ConnectionManager();
    const { id: requesterId } = makeClient(cm);
    const requester = requireClient(cm, requesterId);
    const requesterWs = requester.ws as unknown as { send: ReturnType<typeof vi.fn> };
    const logger = { warn: vi.fn(), error: vi.fn() };
    const deps = createMemoryProtocolDeps(cm, ctx, {
      logger,
      memoryV1BudgetsProvider: async () => {
        throw new Error("boom");
      },
    });

    expectOk(
      await sendProtocolMessage(requester, deps, "r-create-err-1", "memory.create", {
        v: 1,
        item: {
          kind: "note",
          body_md: "Remember to check dashboards.",
          tags: [],
          sensitivity: "private",
          provenance: { source_kind: "operator" },
        },
      }),
    );

    expect(
      requesterWs.send.mock.calls.some((call) => {
        const [message] = call;
        return typeof message === "string" && message.includes('"memory.item.created"');
      }),
    ).toBe(true);
    expect(
      logger.error.mock.calls.some((call) => call[0] === "memory.v1.consolidation_failed"),
    ).toBe(true);
  });
});
