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
});
