import { vi } from "vitest";

export function createLocationFixture(testTimestamp: string): {
  locationUpdateProfile: ReturnType<typeof vi.fn>;
  locationCreatePlace: ReturnType<typeof vi.fn>;
  locationUpdatePlace: ReturnType<typeof vi.fn>;
  locationDeletePlace: ReturnType<typeof vi.fn>;
  locationApi: {
    listPlaces: ReturnType<typeof vi.fn>;
    createPlace: ReturnType<typeof vi.fn>;
    updatePlace: ReturnType<typeof vi.fn>;
    deletePlace: ReturnType<typeof vi.fn>;
    getProfile: ReturnType<typeof vi.fn>;
    updateProfile: ReturnType<typeof vi.fn>;
  };
} {
  const locationUpdateProfile = vi.fn(
    async () =>
      ({
        status: "ok",
        profile: {
          primary_node_id: "mobile-node-1",
          poi_provider_key: "geoapify",
          updated_at: testTimestamp,
        },
      }) as unknown,
  );
  const locationCreatePlace = vi.fn(
    async () =>
      ({
        status: "ok",
        place: {
          place_id: "place-created",
          name: "Home",
          latitude: 52.3676,
          longitude: 4.9041,
          radius_m: 100,
          tags: ["home"],
          source: "manual",
          created_at: testTimestamp,
          updated_at: testTimestamp,
        },
      }) as unknown,
  );
  const locationUpdatePlace = vi.fn(
    async () =>
      ({
        status: "ok",
        place: {
          place_id: "place-home",
          name: "Home",
          latitude: 52.3676,
          longitude: 4.9041,
          radius_m: 100,
          tags: ["home"],
          source: "manual",
          created_at: testTimestamp,
          updated_at: testTimestamp,
        },
      }) as unknown,
  );
  const locationDeletePlace = vi.fn(
    async () =>
      ({
        status: "ok",
        place_id: "place-home",
        deleted: true,
      }) as unknown,
  );

  return {
    locationUpdateProfile,
    locationCreatePlace,
    locationUpdatePlace,
    locationDeletePlace,
    locationApi: {
      listPlaces: vi.fn(
        async () =>
          ({
            status: "ok",
            places: [
              {
                place_id: "place-home",
                name: "Home",
                latitude: 52.3676,
                longitude: 4.9041,
                radius_m: 100,
                tags: ["home"],
                source: "manual",
                created_at: testTimestamp,
                updated_at: testTimestamp,
              },
            ],
          }) as unknown,
      ),
      createPlace: locationCreatePlace,
      updatePlace: locationUpdatePlace,
      deletePlace: locationDeletePlace,
      getProfile: vi.fn(
        async () =>
          ({
            status: "ok",
            profile: {
              primary_node_id: "mobile-node-1",
              poi_provider_key: "geoapify",
              updated_at: testTimestamp,
            },
          }) as unknown,
      ),
      updateProfile: locationUpdateProfile,
    },
  };
}
