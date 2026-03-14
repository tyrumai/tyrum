import { describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";

describe("location routes", () => {
  it("creates places and updates the location profile", async () => {
    const { request } = await createTestApp();

    const placeRes = await request("/location/places", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Office",
        latitude: 52.3676,
        longitude: 4.9041,
        radius_m: 150,
        tags: ["work"],
        source: "provider",
      }),
    });
    expect(placeRes.status).toBe(201);
    const created = (await placeRes.json()) as {
      status: string;
      place: { name: string; latitude: number; longitude: number; source: string };
    };
    expect(created).toMatchObject({
      status: "ok",
      place: {
        name: "Office",
        latitude: 52.3676,
        longitude: 4.9041,
        source: "provider",
      },
    });

    const profileRes = await request("/location/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        primary_node_id: "node-mobile-1",
        poi_provider_key: "osm_overpass",
      }),
    });
    expect(profileRes.status).toBe(200);
    const profileBody = (await profileRes.json()) as {
      status: string;
      profile: { primary_node_id: string | null; poi_provider_key: string | null };
    };
    expect(profileBody).toMatchObject({
      status: "ok",
      profile: {
        primary_node_id: "node-mobile-1",
        poi_provider_key: "osm_overpass",
      },
    });

    const listRes = await request("/location/places");
    const listed = (await listRes.json()) as {
      status: string;
      places: Array<{ name: string; source: string }>;
    };
    expect(listed.status).toBe("ok");
    expect(
      listed.places.some((place) => place.name === "Office" && place.source === "provider"),
    ).toBe(true);
  });

  it("rejects invalid event limits before querying the database", async () => {
    const { request } = await createTestApp();

    const response = await request("/location/events?limit=abc");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_request",
      message: "limit must be a positive integer",
    });
  });

  it("rejects zero event limits", async () => {
    const { request } = await createTestApp();

    const response = await request("/location/events?limit=0");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_request",
      message: "limit must be a positive integer",
    });
  });

  it("returns 404 for missing explicit location scopes without creating agents", async () => {
    const { request, container, agents } = await createTestApp();
    const tenantId = "00000000-0000-4000-8000-000000000001";
    const before = await container.db.get<{ count: number }>(
      "SELECT COUNT(1) AS count FROM agents WHERE tenant_id = ?",
      [tenantId],
    );

    const profileRes = await request("/location/profile?agent_key=missing-agent");
    expect(profileRes.status).toBe(404);
    await expect(profileRes.json()).resolves.toMatchObject({
      error: "not_found",
      message: "agent 'missing-agent' not found",
    });

    const triggerRes = await request("/automation/triggers?agent_key=missing-agent");
    expect(triggerRes.status).toBe(404);
    await expect(triggerRes.json()).resolves.toMatchObject({
      error: "not_found",
      message: "agent 'missing-agent' not found",
    });

    const after = await container.db.get<{ count: number }>(
      "SELECT COUNT(1) AS count FROM agents WHERE tenant_id = ?",
      [tenantId],
    );
    expect(after?.count ?? 0).toBe(before?.count ?? 0);

    await agents?.shutdown();
    await container.db.close();
  });
});
