import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { createHttpScopeAuthorizationMiddleware } from "../../src/modules/authz/http-scope-middleware.js";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { handleClientMessage, type ProtocolDeps } from "../../src/ws/protocol.js";
import type { ConnectedClient } from "../../src/ws/connection-manager.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

describe("scope normalization", () => {
  it("HTTP scope middleware trims token scopes before comparison", async () => {
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("authClaims", {
        token_kind: "device",
        token_id: "test-token",
        tenant_id: DEFAULT_TENANT_ID,
        role: "client",
        scopes: [" operator.approvals "],
      });
      await next();
    });
    app.use(
      "*",
      createHttpScopeAuthorizationMiddleware({
        resolveScopes: () => ["operator.approvals"],
      }),
    );
    app.get("/scope-test", (c) => c.json({ ok: true }));

    const res = await app.request("/scope-test");
    expect(res.status).toBe(200);
  });

  it("WS protocol trims token scopes before comparison", async () => {
    const deps: ProtocolDeps = {
      connectionManager: new ConnectionManager(),
      approvalDal: {
        listBlocked: vi.fn(async () => []),
      } as ProtocolDeps["approvalDal"],
    };

    const client = {
      id: "client_123",
      ws: {} as never,
      role: "client",
      auth_claims: {
        token_kind: "device",
        token_id: "test-token",
        tenant_id: DEFAULT_TENANT_ID,
        role: "client",
        scopes: [" operator.approvals "],
      },
      protocol_rev: 1,
      capabilities: [],
      readyCapabilities: new Set(),
      lastWsPongAt: 0,
    } satisfies ConnectedClient;

    const response = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: `approval-${randomUUID()}`,
        type: "approval.list",
        payload: {},
      }),
      deps,
    );

    expect(response).toMatchObject({
      ok: true,
      type: "approval.list",
      result: { approvals: [], next_cursor: undefined },
    });
  });
});
