import { expect, it, vi } from "vitest";
import type { RequestInit } from "undici";
import { createTestClient, jsonResponse, makeFetchMock } from "./http-client.test-support.js";

export function registerHttpClientLocationTests(): void {
  it("lists saved places from the location API", async () => {
    const fetch = makeFetchMock(async () =>
      jsonResponse({
        status: "ok",
        places: [
          {
            place_id: "place-home",
            name: "Home",
            latitude: 52.3676,
            longitude: 4.9041,
            radius_m: 80,
            tags: ["personal", "favorite"],
            source: "manual",
            created_at: "2026-03-01T00:00:00.000Z",
            updated_at: "2026-03-01T00:00:00.000Z",
          },
        ],
      }),
    );
    const client = createTestClient({ fetch });

    const result = await client.location?.listPlaces();

    expect(result?.places).toHaveLength(1);
    expect(result?.places[0]?.name).toBe("Home");

    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://gateway.example/location/places");
    expect(init.method).toBe("GET");
  });

  it("creates a saved place and validates the request body", async () => {
    const fetch = makeFetchMock(async () =>
      jsonResponse(
        {
          status: "ok",
          place: {
            place_id: "place-work",
            name: "Work",
            latitude: 52.08,
            longitude: 4.31,
            radius_m: 120,
            tags: ["office"],
            source: "manual",
            created_at: "2026-03-01T00:00:00.000Z",
            updated_at: "2026-03-01T00:00:00.000Z",
          },
        },
        201,
      ),
    );
    const client = createTestClient({ fetch });

    const result = await client.location?.createPlace({
      name: "Work",
      latitude: 52.08,
      longitude: 4.31,
      radius_m: 120,
      tags: ["office"],
    });

    expect(result?.place.place_id).toBe("place-work");

    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://gateway.example/location/places");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      name: "Work",
      latitude: 52.08,
      longitude: 4.31,
      radius_m: 120,
      tags: ["office"],
    });
  });

  it("updates the location profile with the primary node and provider key", async () => {
    const fetch = makeFetchMock(async () =>
      jsonResponse({
        status: "ok",
        profile: {
          primary_node_id: "mobile-node-1",
          poi_provider_key: "geoapify",
          updated_at: "2026-03-01T00:00:00.000Z",
        },
      }),
    );
    const client = createTestClient({ fetch });

    const result = await client.location?.updateProfile({
      primary_node_id: "mobile-node-1",
      poi_provider_key: "geoapify",
    });

    expect(result?.profile.primary_node_id).toBe("mobile-node-1");
    expect(result?.profile.poi_provider_key).toBe("geoapify");

    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://gateway.example/location/profile");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({
      primary_node_id: "mobile-node-1",
      poi_provider_key: "geoapify",
    });
  });
}
