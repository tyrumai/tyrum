import { afterEach, describe, expect, it, vi } from "vitest";
import { createAdminWsClient, serializeWsRequest } from "../helpers/ws-protocol-test-helpers.js";

const {
  handleApprovalMessageMock,
  handleControlPlaneMessageMock,
  handleNodeMessageMock,
  handleResponseMessageMock,
  handleSessionMessageMock,
  handleTranscriptMessageMock,
} = vi.hoisted(() => ({
  handleApprovalMessageMock: vi.fn(async (_client: unknown, msg: unknown) => {
    const type = (msg as { type?: string }).type;
    const requestId = (msg as { request_id?: string }).request_id;
    if (type !== "approval.list") return undefined;
    return {
      request_id: requestId ?? "missing",
      type,
      ok: true as const,
      result: { mocked: "approval" },
    };
  }),
  handleControlPlaneMessageMock: vi.fn(async (_client: unknown, msg: unknown) => {
    const type = (msg as { type?: string }).type;
    const requestId = (msg as { request_id?: string }).request_id;
    if (type !== "command.execute") return undefined;
    return {
      request_id: requestId ?? "missing",
      type,
      ok: true as const,
      result: { mocked: "control-plane" },
    };
  }),
  handleNodeMessageMock: vi.fn(async (_client: unknown, msg: unknown) => {
    const type = (msg as { type?: string }).type;
    const requestId = (msg as { request_id?: string }).request_id;
    if (type !== "capability.ready") return undefined;
    return {
      request_id: requestId ?? "missing",
      type,
      ok: true as const,
      result: { mocked: "node" },
    };
  }),
  handleResponseMessageMock: vi.fn(async (_client: unknown, msg: unknown) => {
    const type = (msg as { type?: string }).type;
    const requestId = (msg as { request_id?: string }).request_id;
    if (type !== "task.execute") return undefined;
    return {
      request_id: requestId ?? "missing",
      type,
      ok: true as const,
      result: { mocked: "response" },
    };
  }),
  handleSessionMessageMock: vi.fn(async (_client: unknown, msg: unknown) => {
    const type = (msg as { type?: string }).type;
    const requestId = (msg as { request_id?: string }).request_id;
    if (type !== "conversation.list") return undefined;
    return {
      request_id: requestId ?? "missing",
      type,
      ok: true as const,
      result: { mocked: "session" },
    };
  }),
  handleTranscriptMessageMock: vi.fn(async (_client: unknown, msg: unknown) => {
    const type = (msg as { type?: string }).type;
    const requestId = (msg as { request_id?: string }).request_id;
    if (type !== "transcript.list") return undefined;
    return {
      request_id: requestId ?? "missing",
      type,
      ok: true as const,
      result: { mocked: "transcript" },
    };
  }),
}));

vi.mock("../../src/ws/protocol/approval-handlers.js", () => {
  return { handleApprovalMessage: handleApprovalMessageMock };
});

vi.mock("../../src/ws/protocol/control-plane-handlers.js", () => {
  return { handleControlPlaneMessage: handleControlPlaneMessageMock };
});

vi.mock("../../src/ws/protocol/node-handlers.js", () => {
  return { handleNodeMessage: handleNodeMessageMock };
});

vi.mock("../../src/ws/protocol/response-handlers.js", () => {
  return { handleResponseMessage: handleResponseMessageMock };
});

vi.mock("../../src/ws/protocol/session-handlers.js", () => {
  return { handleSessionMessage: handleSessionMessageMock };
});

vi.mock("../../src/ws/protocol/transcript-handlers.js", () => {
  return { handleTranscriptMessage: handleTranscriptMessageMock };
});

describe("remaining WS handler extraction", () => {
  afterEach(() => {
    handleApprovalMessageMock.mockClear();
    handleControlPlaneMessageMock.mockClear();
    handleNodeMessageMock.mockClear();
    handleResponseMessageMock.mockClear();
    handleSessionMessageMock.mockClear();
    handleTranscriptMessageMock.mockClear();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("routes response envelopes through response-handlers", { timeout: 10_000 }, async () => {
    const client = createAdminWsClient({ role: "node" });
    const deps = {};
    const raw = JSON.stringify({
      request_id: "task-1",
      type: "task.execute",
      ok: true,
      result: {},
    });

    const { handleClientMessage } = await import("../../src/ws/protocol/handler.js");
    const res = await handleClientMessage(client, raw, deps);

    expect(handleResponseMessageMock).toHaveBeenCalledTimes(1);
    expect(handleResponseMessageMock).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ request_id: "task-1", type: "task.execute", ok: true }),
      deps,
    );
    expect(res).toEqual({
      request_id: "task-1",
      type: "task.execute",
      ok: true,
      result: { mocked: "response" },
    });
  });

  it("routes approval requests through approval-handlers", async () => {
    const client = createAdminWsClient();
    const deps = {};
    const raw = serializeWsRequest({ type: "approval.list" });

    const { handleClientMessage } = await import("../../src/ws/protocol/handler.js");
    const res = await handleClientMessage(client, raw, deps);

    expect(handleApprovalMessageMock).toHaveBeenCalledTimes(1);
    expect(handleApprovalMessageMock).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ request_id: "req-1", type: "approval.list" }),
      deps,
    );
    expect(res).toEqual({
      request_id: "req-1",
      type: "approval.list",
      ok: true,
      result: { mocked: "approval" },
    });
  });

  it("routes AI SDK conversation requests through session-handlers", async () => {
    const client = createAdminWsClient();
    const deps = {};
    const raw = serializeWsRequest({ type: "conversation.list" });

    const { handleClientMessage } = await import("../../src/ws/protocol/handler.js");
    const res = await handleClientMessage(client, raw, deps);

    expect(handleSessionMessageMock).toHaveBeenCalledTimes(1);
    expect(handleSessionMessageMock).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ request_id: "req-1", type: "conversation.list" }),
      deps,
    );
    expect(res).toEqual({
      request_id: "req-1",
      type: "conversation.list",
      ok: true,
      result: { mocked: "session" },
    });
  });

  it("routes transcript requests through transcript-handlers", async () => {
    const client = createAdminWsClient();
    const deps = {};
    const raw = serializeWsRequest({ type: "transcript.list" });

    const { handleClientMessage } = await import("../../src/ws/protocol/handler.js");
    const res = await handleClientMessage(client, raw, deps);

    expect(handleTranscriptMessageMock).toHaveBeenCalledTimes(1);
    expect(handleTranscriptMessageMock).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ request_id: "req-1", type: "transcript.list" }),
      deps,
    );
    expect(res).toEqual({
      request_id: "req-1",
      type: "transcript.list",
      ok: true,
      result: { mocked: "transcript" },
    });
  });

  it("routes command/workflow control-plane requests through control-plane-handlers", async () => {
    const client = createAdminWsClient();
    const deps = {};
    const raw = serializeWsRequest({ type: "command.execute", payload: { command: "/help" } });

    const { handleClientMessage } = await import("../../src/ws/protocol/handler.js");
    const res = await handleClientMessage(client, raw, deps);

    expect(handleControlPlaneMessageMock).toHaveBeenCalledTimes(1);
    expect(handleControlPlaneMessageMock).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ request_id: "req-1", type: "command.execute" }),
      deps,
    );
    expect(res).toEqual({
      request_id: "req-1",
      type: "command.execute",
      ok: true,
      result: { mocked: "control-plane" },
    });
  });

  it("rejects requests without a tenant token before routing request handlers", async () => {
    const client = createAdminWsClient({
      auth_claims: {
        token_kind: "admin",
        role: "admin",
        scopes: ["*"],
        tenant_id: undefined,
      },
    });
    const deps = {};
    const raw = serializeWsRequest({ type: "command.execute", payload: { command: "/help" } });

    const { handleClientMessage } = await import("../../src/ws/protocol/handler.js");
    const res = await handleClientMessage(client, raw, deps);

    expect(handleControlPlaneMessageMock).not.toHaveBeenCalled();
    expect(handleApprovalMessageMock).not.toHaveBeenCalled();
    expect(handleNodeMessageMock).not.toHaveBeenCalled();
    expect(handleSessionMessageMock).not.toHaveBeenCalled();
    expect(handleTranscriptMessageMock).not.toHaveBeenCalled();
    expect(res).toMatchObject({
      request_id: "req-1",
      type: "command.execute",
      ok: false,
      error: {
        code: "unauthorized",
        message: "tenant token required",
      },
    });
  });

  it("rejects requests with a blank tenant token before routing request handlers", async () => {
    const client = createAdminWsClient({
      auth_claims: {
        token_kind: "admin",
        role: "admin",
        scopes: ["*"],
        tenant_id: "   ",
      },
    });
    const deps = {};
    const raw = serializeWsRequest({ type: "command.execute", payload: { command: "/help" } });

    const { handleClientMessage } = await import("../../src/ws/protocol/handler.js");
    const res = await handleClientMessage(client, raw, deps);

    expect(handleControlPlaneMessageMock).not.toHaveBeenCalled();
    expect(res).toMatchObject({
      request_id: "req-1",
      type: "command.execute",
      ok: false,
      error: {
        code: "unauthorized",
        message: "tenant token required",
      },
    });
  });

  it("routes node-facing requests through node-handlers", async () => {
    const client = createAdminWsClient({ role: "node" });
    const deps = {};
    const raw = serializeWsRequest({ type: "capability.ready", payload: { capabilities: [] } });

    const { handleClientMessage } = await import("../../src/ws/protocol/handler.js");
    const res = await handleClientMessage(client, raw, deps);

    expect(handleNodeMessageMock).toHaveBeenCalledTimes(1);
    expect(handleNodeMessageMock).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ request_id: "req-1", type: "capability.ready" }),
      raw,
      deps,
    );
    expect(res).toEqual({
      request_id: "req-1",
      type: "capability.ready",
      ok: true,
      result: { mocked: "node" },
    });
  });
});
