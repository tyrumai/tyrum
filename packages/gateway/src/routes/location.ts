import {
  LocationPlaceCreateRequest,
  LocationPlacePatchRequest,
  LocationProfileUpdateRequest,
} from "@tyrum/contracts";
import { Hono } from "hono";
import { requireTenantId } from "../modules/auth/claims.js";
import { ScopeNotFoundError } from "../modules/identity/scope.js";
import { LocationService } from "../modules/location/service.js";

function toHttpPlace(place: Awaited<ReturnType<LocationService["listPlaces"]>>[number]) {
  return {
    place_id: place.place_id,
    name: place.name,
    latitude: place.point.latitude,
    longitude: place.point.longitude,
    radius_m: place.radius_m,
    tags: place.tags,
    source: place.source === "poi_provider" ? "provider" : place.source,
    created_at: place.created_at,
    updated_at: place.updated_at,
  };
}

function toHttpProfile(profile: Awaited<ReturnType<LocationService["getProfile"]>>) {
  return {
    primary_node_id: profile.primary_node_id,
    poi_provider_key: profile.poi_provider_kind === "none" ? null : profile.poi_provider_kind,
    updated_at: profile.updated_at,
  };
}

function toLocationRouteError(error: unknown): {
  status: 400 | 404;
  body: { error: string; message: string };
} {
  if (error instanceof ScopeNotFoundError) {
    return {
      status: 404,
      body: { error: error.code, message: error.message },
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  const status = message.includes("not found") ? 404 : 400;
  return {
    status,
    body: { error: status === 404 ? "not_found" : "invalid_request", message },
  };
}

export function createLocationRoutes(service: LocationService): Hono {
  const app = new Hono();

  const resolveAgentKey = async (
    tenantId: string,
    rawAgentKey: string | undefined,
  ): Promise<string> => {
    if (rawAgentKey !== undefined && rawAgentKey.trim().length === 0) {
      throw new Error("agent_key must be a non-empty string");
    }
    return await service.resolveAgentKey({ tenantId, agentKey: rawAgentKey });
  };

  app.get("/location/profile", async (c) => {
    const tenantId = requireTenantId(c);
    try {
      const agentKey = await resolveAgentKey(tenantId, c.req.query("agent_key"));
      const profile = await service.getProfile({ tenantId, agentKey });
      return c.json({ status: "ok", profile: toHttpProfile(profile) });
    } catch (error) {
      const response = toLocationRouteError(error);
      return c.json(response.body, response.status);
    }
  });

  app.patch("/location/profile", async (c) => {
    const tenantId = requireTenantId(c);
    const rawBody = (await c.req.json()) as Record<string, unknown>;
    const { poi_provider_key: _poiProviderKey, ...bodyWithoutAlias } = rawBody;
    const parsed = LocationProfileUpdateRequest.safeParse({
      ...bodyWithoutAlias,
      ...(typeof rawBody["poi_provider_key"] === "string" || rawBody["poi_provider_key"] === null
        ? {
            poi_provider_kind:
              rawBody["poi_provider_key"] === null ? "none" : rawBody["poi_provider_key"],
          }
        : {}),
    });
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }
    try {
      const agentKey = await resolveAgentKey(tenantId, c.req.query("agent_key"));
      const profile = await service.updateProfile({ tenantId, agentKey, patch: parsed.data });
      return c.json({ status: "ok", profile: toHttpProfile(profile) });
    } catch (error) {
      const response = toLocationRouteError(error);
      return c.json(response.body, response.status);
    }
  });

  app.get("/location/places", async (c) => {
    const tenantId = requireTenantId(c);
    try {
      const agentKey = await resolveAgentKey(tenantId, c.req.query("agent_key"));
      const places = await service.listPlaces({ tenantId, agentKey });
      return c.json({ status: "ok", places: places.map(toHttpPlace) });
    } catch (error) {
      const response = toLocationRouteError(error);
      return c.json(response.body, response.status);
    }
  });

  app.post("/location/places", async (c) => {
    const tenantId = requireTenantId(c);
    const rawBody = (await c.req.json()) as Record<string, unknown>;
    const parsed = LocationPlaceCreateRequest.safeParse({
      ...rawBody,
      ...(rawBody["source"] === "provider"
        ? { source: "poi_provider" }
        : rawBody["source"] === "memory" || rawBody["source"] === "import"
          ? { source: "manual" }
          : {}),
    });
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }
    try {
      const agentKey = await resolveAgentKey(tenantId, c.req.query("agent_key"));
      const place = await service.createPlace({ tenantId, agentKey, body: parsed.data });
      return c.json({ status: "ok", place: toHttpPlace(place) }, 201);
    } catch (error) {
      const response = toLocationRouteError(error);
      return c.json(response.body, response.status);
    }
  });

  app.patch("/location/places/:id", async (c) => {
    const tenantId = requireTenantId(c);
    const rawBody = (await c.req.json()) as Record<string, unknown>;
    const parsed = LocationPlacePatchRequest.safeParse({
      ...rawBody,
      ...(rawBody["source"] === "provider"
        ? { source: "poi_provider" }
        : rawBody["source"] === "memory" || rawBody["source"] === "import"
          ? { source: "manual" }
          : {}),
    });
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }
    try {
      const agentKey = await resolveAgentKey(tenantId, c.req.query("agent_key"));
      const place = await service.updatePlace({
        tenantId,
        agentKey,
        placeId: c.req.param("id"),
        patch: parsed.data,
      });
      return c.json({ status: "ok", place: toHttpPlace(place) });
    } catch (error) {
      const response = toLocationRouteError(error);
      return c.json(response.body, response.status);
    }
  });

  app.delete("/location/places/:id", async (c) => {
    const tenantId = requireTenantId(c);
    try {
      const agentKey = await resolveAgentKey(tenantId, c.req.query("agent_key"));
      const deleted = await service.deletePlace({ tenantId, agentKey, placeId: c.req.param("id") });
      if (!deleted) {
        return c.json({ error: "not_found", message: "place not found" }, 404);
      }
      return c.json({ status: "ok", place_id: c.req.param("id"), deleted: true });
    } catch (error) {
      const response = toLocationRouteError(error);
      return c.json(response.body, response.status);
    }
  });

  app.get("/location/events", async (c) => {
    const tenantId = requireTenantId(c);
    const limitRaw = c.req.query("limit");
    const parsedLimit =
      typeof limitRaw === "string" && /^[0-9]+$/.test(limitRaw.trim()) ? Number(limitRaw) : null;
    const limit =
      parsedLimit !== null && Number.isInteger(parsedLimit) && parsedLimit > 0
        ? parsedLimit
        : limitRaw === undefined
          ? 50
          : null;
    if (limit === null) {
      return c.json({ error: "invalid_request", message: "limit must be a positive integer" }, 400);
    }
    try {
      const agentKey = await resolveAgentKey(tenantId, c.req.query("agent_key"));
      return c.json({
        status: "ok",
        events: await service.listEvents({ tenantId, agentKey, limit }),
      });
    } catch (error) {
      const response = toLocationRouteError(error);
      return c.json(response.body, response.status);
    }
  });

  return app;
}
