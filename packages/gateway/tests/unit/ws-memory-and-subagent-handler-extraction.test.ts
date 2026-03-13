import { afterEach, describe, expect, it, vi } from "vitest";
import { createAdminWsClient, serializeWsRequest } from "../helpers/ws-protocol-test-helpers.js";

describe("subagent WS handler extraction", () => {
  const { handleSubagentMessageMock } = vi.hoisted(() => ({
    handleSubagentMessageMock: vi.fn(async (_client: unknown, msg: unknown) => {
      const type = (msg as { type?: string }).type;
      const requestId = (msg as { request_id?: string }).request_id;
      if (!type?.startsWith("subagent.")) return undefined;
      return {
        request_id: requestId ?? "missing",
        type,
        ok: true as const,
        result: { mocked: true },
      };
    }),
  }));

  vi.mock("../../src/ws/protocol/subagent-handlers.js", () => {
    return { handleSubagentMessage: handleSubagentMessageMock };
  });

  afterEach(() => {
    handleSubagentMessageMock.mockClear();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("routes subagent.* requests through subagent-handlers", async () => {
    const client = createAdminWsClient();
    const deps = {};
    const raw = serializeWsRequest({ type: "subagent.spawn" });

    const { handleClientMessage } = await import("../../src/ws/protocol/handler.js");
    const res = await handleClientMessage(client, raw, deps);

    expect(handleSubagentMessageMock).toHaveBeenCalledTimes(1);
    expect(handleSubagentMessageMock).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ request_id: "req-1", type: "subagent.spawn" }),
      deps,
    );
    expect(res).toEqual({
      request_id: "req-1",
      type: "subagent.spawn",
      ok: true,
      result: { mocked: true },
    });
  });
});
