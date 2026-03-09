import { Hono } from "hono";
import { NodeInventoryResponse } from "@tyrum/schemas";
import { requireTenantId } from "../modules/auth/claims.js";
import { NodeInventoryService } from "../modules/node/inventory-service.js";

export function createNodesRoute(service: NodeInventoryService): Hono {
  const app = new Hono();

  app.get("/nodes", async (c) => {
    const tenantId = requireTenantId(c);
    const capability = c.req.query("capability")?.trim() || undefined;
    const dispatchableOnlyRaw = c.req.query("dispatchable_only")?.trim().toLowerCase();
    const dispatchableOnly =
      dispatchableOnlyRaw === undefined
        ? false
        : !["0", "false", "no"].includes(dispatchableOnlyRaw);
    const key = c.req.query("key")?.trim() || undefined;
    const lane = c.req.query("lane")?.trim() || undefined;

    const result = await service.list({
      tenantId,
      capability,
      dispatchableOnly,
      key,
      lane,
    });

    return c.json(
      NodeInventoryResponse.parse({
        status: "ok",
        generated_at: new Date().toISOString(),
        ...result,
      }),
    );
  });

  return app;
}
