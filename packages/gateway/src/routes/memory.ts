import { Hono } from "hono";
import type { MemoryItemKind, MemorySensitivity } from "@tyrum/contracts";
import { requireTenantId } from "../modules/auth/claims.js";
import type { MemoryDal } from "../modules/memory/memory-dal.js";
import type { MemoryItemFilter } from "../modules/memory/types.js";

export interface MemoryRouteDeps {
  memoryDal: MemoryDal;
}

function parseOptionalInt(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function parseRepeatedQuery(values: string[] | undefined): string[] | undefined {
  return values && values.length > 0 ? values : undefined;
}

export function createMemoryRoutes(deps: MemoryRouteDeps): Hono {
  const app = new Hono();
  const { memoryDal } = deps;

  app.get("/memory/items", async (c) => {
    const tenantId = requireTenantId(c);
    const agentId = c.req.query("agent_id")?.trim() || undefined;
    const kinds = parseRepeatedQuery(c.req.queries("kinds")) as MemoryItemKind[] | undefined;
    const tags = parseRepeatedQuery(c.req.queries("tags"));
    const sensitivities = parseRepeatedQuery(c.req.queries("sensitivities")) as
      | MemorySensitivity[]
      | undefined;
    const limit = parseOptionalInt(c.req.query("limit"));
    const cursor = c.req.query("cursor")?.trim() || undefined;

    const filter: MemoryItemFilter = { kinds, tags, sensitivities };

    const result = await memoryDal.list({ tenantId, agentId, filter, limit, cursor });
    return c.json(result, 200);
  });

  app.get("/memory/items/:id", async (c) => {
    const tenantId = requireTenantId(c);
    const memoryItemId = c.req.param("id");
    const agentId = c.req.query("agent_id")?.trim() || undefined;

    const item = await memoryDal.getById(memoryItemId, { tenantId, agentId });
    if (!item) {
      return c.json({ error: "not_found", message: "memory item not found" }, 404);
    }

    return c.json({ item }, 200);
  });

  app.get("/memory/search", async (c) => {
    const tenantId = requireTenantId(c);
    const agentId = c.req.query("agent_id")?.trim() || undefined;
    const query = c.req.query("query")?.trim();
    if (!query) {
      return c.json({ error: "invalid_request", message: "query parameter is required" }, 400);
    }

    const kinds = parseRepeatedQuery(c.req.queries("kinds")) as MemoryItemKind[] | undefined;
    const tags = parseRepeatedQuery(c.req.queries("tags"));
    const sensitivities = parseRepeatedQuery(c.req.queries("sensitivities")) as
      | MemorySensitivity[]
      | undefined;
    const limit = parseOptionalInt(c.req.query("limit"));
    const filter: MemoryItemFilter = { kinds, tags, sensitivities };

    const result = await memoryDal.search({ query, filter, limit }, { tenantId, agentId });
    return c.json(result, 200);
  });

  app.delete("/memory/items/:id", async (c) => {
    const tenantId = requireTenantId(c);
    const memoryItemId = c.req.param("id");
    const agentId = c.req.query("agent_id")?.trim() || undefined;

    let reason: string | undefined;
    try {
      const body = (await c.req.json()) as Record<string, unknown>;
      reason = typeof body.reason === "string" ? body.reason.trim() || undefined : undefined;
    } catch (error) {
      void error;
      // No body is fine — reason is optional
    }

    try {
      const tombstone = await memoryDal.delete(
        memoryItemId,
        { deleted_by: "operator", reason },
        { tenantId, agentId },
      );
      return c.json({ tombstone }, 200);
    } catch (err) {
      if (err instanceof Error && err.message === "memory item not found") {
        return c.json({ error: "not_found", message: "memory item not found" }, 404);
      }
      throw err;
    }
  });

  app.get("/memory/tombstones", async (c) => {
    const tenantId = requireTenantId(c);
    const agentId = c.req.query("agent_id")?.trim() || undefined;
    const limit = parseOptionalInt(c.req.query("limit"));
    const cursor = c.req.query("cursor")?.trim() || undefined;

    const result = await memoryDal.listTombstones({ tenantId, agentId, limit, cursor });
    return c.json(result, 200);
  });

  return app;
}
