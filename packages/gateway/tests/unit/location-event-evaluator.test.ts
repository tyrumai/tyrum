import { describe, expect, it } from "vitest";
import {
  evaluateCategoryEvent,
  evaluateSavedPlaceEvent,
} from "../../src/modules/location/event-evaluator.js";

describe("evaluateCategoryEvent", () => {
  it("emits dwell while retained inside the category exit radius", () => {
    const result = evaluateCategoryEvent({
      agentKey: "default",
      nodeId: "node-mobile-1",
      payload: {
        sample_id: "11111111-1111-4111-8111-111111111111",
        recorded_at: "2026-03-11T10:11:00.000Z",
        coords: {
          latitude: 52.3676,
          longitude: 4.9041,
          accuracy_m: 12,
        },
        source: "gps",
        is_background: false,
      },
      categoryKey: "grocery",
      currentState: {
        status: "inside",
        entered_at: "2026-03-11T10:00:00.000Z",
        dwell_emitted_at: null,
      },
      match: {
        providerPlaceId: "osm:123",
        name: "Corner Market",
        distanceM: 120,
      },
    });

    expect(result?.event.type).toBe("poi_category.dwell");
    expect(result?.event.transition).toBe("dwell");
    expect(result?.state.status).toBe("inside");
    expect(result?.state.dwellEmittedAt).toBe("2026-03-11T10:11:00.000Z");
  });

  it("includes retained match metadata on category exit", () => {
    const result = evaluateCategoryEvent({
      agentKey: "default",
      nodeId: "node-mobile-1",
      payload: {
        sample_id: "22222222-2222-4222-8222-222222222222",
        recorded_at: "2026-03-11T10:12:00.000Z",
        coords: {
          latitude: 52.3676,
          longitude: 4.9041,
          accuracy_m: 12,
        },
        source: "gps",
        is_background: false,
      },
      categoryKey: "grocery",
      currentState: {
        status: "inside",
        entered_at: "2026-03-11T10:00:00.000Z",
        dwell_emitted_at: "2026-03-11T10:11:00.000Z",
      },
      match: {
        providerPlaceId: "osm:123",
        name: "Corner Market",
        distanceM: 180,
      },
    });

    expect(result?.event.type).toBe("poi_category.exit");
    expect(result?.event.transition).toBe("exit");
    expect(result?.event.provider_place_id).toBe("osm:123");
    expect(result?.event.place_name).toBe("Corner Market");
    expect(result?.event.distance_m).toBe(180);
    expect(result?.state.status).toBe("outside");
  });
});

describe("evaluateSavedPlaceEvent", () => {
  it("emits dwell while retained inside the saved place hysteresis zone", () => {
    const result = evaluateSavedPlaceEvent({
      agentKey: "default",
      nodeId: "node-mobile-1",
      payload: {
        sample_id: "11111111-1111-4111-8111-111111111111",
        recorded_at: "2026-03-11T10:11:00.000Z",
        coords: {
          latitude: 52.3676,
          longitude: 4.9041,
          accuracy_m: 12,
        },
        source: "gps",
        is_background: false,
      },
      place: {
        place_id: "place-home",
        agent_key: "default",
        name: "Home",
        latitude: 52.3676,
        longitude: 4.9041,
        radius_m: 100,
        tags: ["home"],
        source: "manual",
        provider_place_id: null,
        metadata: {},
        created_at: "2026-03-11T09:00:00.000Z",
        updated_at: "2026-03-11T09:00:00.000Z",
      },
      distanceM: 120,
      currentState: {
        status: "inside",
        entered_at: "2026-03-11T10:00:00.000Z",
        dwell_emitted_at: null,
      },
    });

    expect(result?.event.type).toBe("saved_place.dwell");
    expect(result?.event.transition).toBe("dwell");
    expect(result?.state.status).toBe("inside");
    expect(result?.state.dwellEmittedAt).toBe("2026-03-11T10:11:00.000Z");
  });
});
