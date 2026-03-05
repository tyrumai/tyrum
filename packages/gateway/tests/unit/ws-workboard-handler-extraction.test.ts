import { afterEach, describe, expect, it, vi } from "vitest";
import { createAdminWsClient, serializeWsRequest } from "../helpers/ws-protocol-test-helpers.js";

const { handleWorkboardMessageMock } = vi.hoisted(() => ({
  handleWorkboardMessageMock: vi.fn(async (_client: unknown, msg: unknown) => {
    const type = (msg as { type?: string }).type;
    const requestId = (msg as { request_id?: string }).request_id;
    if (!type?.startsWith("work.")) return undefined;
    return {
      request_id: requestId ?? "missing",
      type,
      ok: true as const,
      result: { mocked: true },
    };
  }),
}));

vi.mock("../../src/ws/protocol/workboard-handlers.js", () => {
  return { handleWorkboardMessage: handleWorkboardMessageMock };
});

describe("workboard WS handler extraction", () => {
  afterEach(() => {
    handleWorkboardMessageMock.mockClear();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("routes work.* requests through workboard-handlers", async () => {
    const client = createAdminWsClient();
    const deps = {};
    const raw = serializeWsRequest({ type: "work.create" });

    const { handleClientMessage } = await import("../../src/ws/protocol/handler.js");
    const res = await handleClientMessage(client, raw, deps);

    expect(handleWorkboardMessageMock).toHaveBeenCalledTimes(1);
    expect(handleWorkboardMessageMock).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ request_id: "req-1", type: "work.create" }),
      deps,
    );
    expect(res).toEqual({
      request_id: "req-1",
      type: "work.create",
      ok: true,
      result: { mocked: true },
    });
  });
});
