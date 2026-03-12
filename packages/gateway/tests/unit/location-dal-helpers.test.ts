import { describe, expect, it } from "vitest";
import { toLocationEvent, type RawEventRow } from "../../src/modules/location/dal-helpers.js";

describe("toLocationEvent", () => {
  it("preserves null location fields when reading persisted events", () => {
    const event = toLocationEvent(
      {
        event_id: "11111111-1111-4111-8111-111111111111",
        sample_id: "22222222-2222-4222-8222-222222222222",
        node_id: "node-mobile-1",
        event_type: "poi_category.enter",
        transition: "enter",
        place_id: null,
        place_name: null,
        provider_place_id: null,
        category_key: "cafe",
        latitude: 52.3676,
        longitude: 4.9041,
        accuracy_m: 12,
        altitude_m: null,
        altitude_accuracy_m: null,
        heading_deg: null,
        speed_mps: null,
        distance_m: null,
        metadata_json: "{}",
        occurred_at: "2026-03-11T12:00:00.000Z",
      } satisfies RawEventRow,
      "default",
      {},
    );

    expect(event.distance_m).toBeNull();
    expect(event.coords).toMatchObject({
      altitude_m: null,
      altitude_accuracy_m: null,
      heading_deg: null,
      speed_mps: null,
    });
  });
});
