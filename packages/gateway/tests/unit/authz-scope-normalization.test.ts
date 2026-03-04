import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { createHttpScopeAuthorizationMiddleware } from "../../src/modules/authz/http-scope-middleware.js";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { handleClientMessage, type ProtocolDeps } from "../../src/ws/protocol.js";
import type { ConnectedClient } from "../../src/ws/connection-manager.js";

describe("scope normalization", () => {
  it("HTTP scope middleware trims token scopes before comparison", async () => {
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("authClaims", {
        token_kind: "device",
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
    const onApprovalDecision = vi.fn();
    const deps: ProtocolDeps = {
      connectionManager: new ConnectionManager(),
      onApprovalDecision,
    };

    const client = {
      id: "client_123",
      ws: {} as never,
      role: "client",
      auth_claims: {
        token_kind: "device",
        role: "client",
        scopes: [" operator.approvals "],
      },
      protocol_rev: 1,
      capabilities: [],
      readyCapabilities: new Set(),
      lastPong: 0,
    } satisfies ConnectedClient;

    const approvalId = randomUUID();
    const response = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: `approval-${approvalId}`,
        type: "approval.request",
        ok: true,
        result: { approved: true },
      }),
      deps,
    );

    expect(response).toBeUndefined();
    expect(onApprovalDecision).toHaveBeenCalledWith(approvalId, true, undefined);
  });
});
