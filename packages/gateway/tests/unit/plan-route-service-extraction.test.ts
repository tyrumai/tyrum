import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

const { createGatewayPlanServiceMock, createPlanMock } = vi.hoisted(() => {
  const createPlanSpy = vi.fn();
  return {
    createGatewayPlanServiceMock: vi.fn(() => ({ createPlan: createPlanSpy })),
    createPlanMock: createPlanSpy,
  };
});

vi.mock("../../src/app/modules/planner/service.js", () => ({
  createGatewayPlanService: createGatewayPlanServiceMock,
}));

function buildPlanRequest(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    request_id: "test-req-1",
    trigger: {
      thread: {
        id: "thread-1",
        kind: "private",
        pii_fields: [],
      },
      message: {
        id: "msg-1",
        thread_id: "thread-1",
        source: "telegram",
        content: { text: "help me", attachments: [] },
        timestamp: "2026-01-01T00:00:00.000Z",
        pii_fields: [],
      },
    },
    tags: [],
    ...overrides,
  };
}

function createAuthedApp() {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("authClaims", {
      token_kind: "admin",
      token_id: "token-1",
      tenant_id: DEFAULT_TENANT_ID,
      role: "admin",
      scopes: ["*"],
    });
    return await next();
  });
  return app;
}

describe("plan route service extraction", () => {
  afterEach(() => {
    createGatewayPlanServiceMock.mockClear();
    createPlanMock.mockReset();
    vi.resetModules();
  });

  it("delegates plan execution to the extracted planner service", async () => {
    const { createPlanRoutes } = await import("../../src/routes/plan.js");
    const container = { marker: "container" } as never;
    createPlanMock.mockResolvedValueOnce({
      planId: "plan-service-1",
      requestId: "test-req-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      traceId: "trace-1",
      outcome: {
        status: "success",
        steps: [],
        summary: { synopsis: "mocked" },
      },
    });

    const app = createAuthedApp();
    app.route("/", createPlanRoutes(container));

    const response = await app.request("/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildPlanRequest({ tags: ["spend:0:USD"] })),
    });

    expect(response.status).toBe(200);
    expect(createGatewayPlanServiceMock).toHaveBeenCalledWith(container);
    expect(createPlanMock).toHaveBeenCalledWith({
      tenantId: DEFAULT_TENANT_ID,
      request: expect.objectContaining({
        request_id: "test-req-1",
        tags: ["spend:0:USD"],
      }),
    });
    expect(await response.json()).toEqual({
      plan_id: "plan-service-1",
      request_id: "test-req-1",
      created_at: "2026-01-01T00:00:00.000Z",
      trace_id: "trace-1",
      status: "success",
      steps: [],
      summary: { synopsis: "mocked" },
    });
  });

  it("rejects invalid requests before invoking the planner service", async () => {
    const { createPlanRoutes } = await import("../../src/routes/plan.js");
    const app = createAuthedApp();
    app.route("/", createPlanRoutes({} as never));

    const response = await app.request("/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildPlanRequest({ request_id: "" })),
    });

    expect(response.status).toBe(400);
    expect(createPlanMock).not.toHaveBeenCalled();
  });
});
