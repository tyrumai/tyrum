import { afterEach, describe, expect, it, vi } from "vitest";
import { createAdminWsClient } from "../helpers/ws-protocol-test-helpers.js";

const { createGatewayWorkboardServiceMock } = vi.hoisted(() => ({
  createGatewayWorkboardServiceMock: vi.fn(() => ({ mocked: true })),
}));

vi.mock("../../src/modules/workboard/service.js", () => {
  return { createGatewayWorkboardService: createGatewayWorkboardServiceMock };
});

describe("workboard WS service extraction", () => {
  afterEach(() => {
    createGatewayWorkboardServiceMock.mockClear();
    vi.resetModules();
  });

  it("builds workboard access from the extracted gateway service adapter", async () => {
    const { requireClientWorkboardAccess } =
      await import("../../src/ws/protocol/workboard-handlers-shared.js");

    const db = { kind: "sqlite" } as never;
    const access = requireClientWorkboardAccess(
      {
        client: createAdminWsClient({ role: "client" }),
        msg: { request_id: "req-1", type: "work.list", payload: {} } as never,
        deps: { db, redactionEngine: { redactText: vi.fn() } as never },
        tenantId: "default",
      },
      "list work items",
    );

    expect(createGatewayWorkboardServiceMock).toHaveBeenCalledWith({
      db,
      redactionEngine: expect.anything(),
    });
    expect(access).toMatchObject({ workboardService: { mocked: true }, db });
  });
});
