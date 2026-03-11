import { describe, expect, it } from "vitest";
import type { LocationEvent } from "@tyrum/schemas";
import type { LocationAutomationTriggerRecord } from "../../src/modules/location/types.js";
import { matchesTrigger } from "../../src/modules/location/trigger-execution.js";

function buildEvent(overrides: Partial<LocationEvent>, type: LocationEvent["type"]): LocationEvent {
  return {
    event_id: "11111111-1111-4111-8111-111111111111",
    agent_key: "default",
    node_id: "node-mobile-1",
    sample_id: "22222222-2222-4222-8222-222222222222",
    type,
    transition: "enter",
    occurred_at: "2026-03-11T10:00:00.000Z",
    place_id: "33333333-3333-4333-8333-333333333333",
    place_name: "Home",
    provider_place_id: "osm:123",
    category_key: "grocery",
    distance_m: 42,
    coords: {
      latitude: 52.3676,
      longitude: 4.9041,
      accuracy_m: 10,
    },
    metadata: {},
    ...overrides,
  };
}

describe("matchesTrigger", () => {
  it("matches a saved-place trigger only for saved-place events", () => {
    const trigger: LocationAutomationTriggerRecord = {
      trigger_id: "44444444-4444-4444-8444-444444444444",
      agent_key: "default",
      workspace_key: "default",
      enabled: true,
      delivery_mode: "notify",
      trigger_type: "location",
      condition: {
        type: "saved_place",
        place_id: "33333333-3333-4333-8333-333333333333",
        transition: "enter",
      },
      execution: { kind: "agent_turn", instruction: "Do the thing" },
      created_at: "2026-03-11T10:00:00.000Z",
      updated_at: "2026-03-11T10:00:00.000Z",
    };

    expect(matchesTrigger(trigger, buildEvent({}, "saved_place.enter"))).toBe(true);
    expect(matchesTrigger(trigger, buildEvent({}, "poi_category.enter"))).toBe(false);
  });

  it("matches a poi-category trigger only for poi-category events", () => {
    const trigger: LocationAutomationTriggerRecord = {
      trigger_id: "55555555-5555-4555-8555-555555555555",
      agent_key: "default",
      workspace_key: "default",
      enabled: true,
      delivery_mode: "notify",
      trigger_type: "location",
      condition: {
        type: "poi_category",
        category_key: "grocery",
        transition: "enter",
      },
      execution: { kind: "agent_turn", instruction: "Buy milk" },
      created_at: "2026-03-11T10:00:00.000Z",
      updated_at: "2026-03-11T10:00:00.000Z",
    };

    expect(matchesTrigger(trigger, buildEvent({}, "poi_category.enter"))).toBe(true);
    expect(matchesTrigger(trigger, buildEvent({}, "saved_place.enter"))).toBe(false);
  });
});
