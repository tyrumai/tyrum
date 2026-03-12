import { randomUUID } from "node:crypto";
import type { LocationBeacon, LocationEvent, LocationPlace } from "@tyrum/schemas";
import { LOCATION_DWELL_MS, LOCATION_EXIT_HYSTERESIS_M } from "./geo.js";

export const DEFAULT_CATEGORY_ENTER_M = 100;
export const DEFAULT_CATEGORY_EXIT_M = 150;

export type LocationSubjectState = {
  status: "inside" | "outside";
  entered_at: string | null;
  dwell_emitted_at: string | null;
};

export type EvaluatedLocationEvent = {
  event: LocationEvent;
  state: {
    status: "inside" | "outside";
    enteredAt: string | null;
    dwellEmittedAt: string | null;
  };
};

function shouldEmitDwell(
  occurredAt: string,
  enteredAt: string | null,
  dwellEmittedAt: string | null,
): boolean {
  const enteredAtMs = enteredAt ? Date.parse(enteredAt) : Number.NaN;
  const dwellEmittedAtMs = dwellEmittedAt ? Date.parse(dwellEmittedAt) : Number.NaN;
  return (
    Number.isFinite(enteredAtMs) &&
    Date.parse(occurredAt) - enteredAtMs >= LOCATION_DWELL_MS &&
    !Number.isFinite(dwellEmittedAtMs)
  );
}

export function evaluateSavedPlaceEvent(input: {
  agentKey: string;
  nodeId: string;
  payload: LocationBeacon;
  place: LocationPlace;
  distanceM: number;
  currentState: LocationSubjectState | undefined;
}): EvaluatedLocationEvent | null {
  const inside = input.distanceM <= input.place.radius_m;
  const outside = input.distanceM > input.place.radius_m + LOCATION_EXIT_HYSTERESIS_M;
  const occurredAt = input.payload.recorded_at;
  const coords = input.payload.coords;

  if (!input.currentState || input.currentState.status === "outside") {
    if (!inside) return null;
    return {
      event: {
        event_id: randomUUID(),
        agent_key: input.agentKey,
        node_id: input.nodeId,
        sample_id: input.payload.sample_id,
        type: "saved_place.enter",
        transition: "enter",
        occurred_at: occurredAt,
        place_id: input.place.place_id,
        place_name: input.place.name,
        provider_place_id: input.place.provider_place_id,
        distance_m: input.distanceM,
        coords,
        metadata: { tags: input.place.tags },
      },
      state: { status: "inside", enteredAt: occurredAt, dwellEmittedAt: null },
    };
  }

  if (outside) {
    return {
      event: {
        event_id: randomUUID(),
        agent_key: input.agentKey,
        node_id: input.nodeId,
        sample_id: input.payload.sample_id,
        type: "saved_place.exit",
        transition: "exit",
        occurred_at: occurredAt,
        place_id: input.place.place_id,
        place_name: input.place.name,
        provider_place_id: input.place.provider_place_id,
        distance_m: input.distanceM,
        coords,
        metadata: { tags: input.place.tags },
      },
      state: {
        status: "outside",
        enteredAt: null,
        dwellEmittedAt: null,
      },
    };
  }

  if (
    !shouldEmitDwell(occurredAt, input.currentState.entered_at, input.currentState.dwell_emitted_at)
  ) {
    return null;
  }

  return {
    event: {
      event_id: randomUUID(),
      agent_key: input.agentKey,
      node_id: input.nodeId,
      sample_id: input.payload.sample_id,
      type: "saved_place.dwell",
      transition: "dwell",
      occurred_at: occurredAt,
      place_id: input.place.place_id,
      place_name: input.place.name,
      provider_place_id: input.place.provider_place_id,
      distance_m: input.distanceM,
      coords,
      metadata: { tags: input.place.tags },
    },
    state: {
      status: "inside",
      enteredAt: input.currentState.entered_at,
      dwellEmittedAt: occurredAt,
    },
  };
}

export function evaluateCategoryEvent(input: {
  agentKey: string;
  nodeId: string;
  payload: LocationBeacon;
  categoryKey: string;
  currentState: LocationSubjectState | undefined;
  match: { providerPlaceId: string; name: string; distanceM: number } | null;
}): EvaluatedLocationEvent | null {
  const inside = input.match !== null && input.match.distanceM <= DEFAULT_CATEGORY_ENTER_M;
  const retainedPresence = input.match !== null && input.match.distanceM <= DEFAULT_CATEGORY_EXIT_M;
  const outside = !retainedPresence;
  const occurredAt = input.payload.recorded_at;
  const coords = input.payload.coords;

  if (!input.currentState || input.currentState.status === "outside") {
    if (!inside) return null;
    return {
      event: {
        event_id: randomUUID(),
        agent_key: input.agentKey,
        node_id: input.nodeId,
        sample_id: input.payload.sample_id,
        type: "poi_category.enter",
        transition: "enter",
        occurred_at: occurredAt,
        provider_place_id: input.match?.providerPlaceId,
        category_key: input.categoryKey,
        place_name: input.match?.name,
        distance_m: input.match?.distanceM,
        coords,
        metadata: {},
      },
      state: { status: "inside", enteredAt: occurredAt, dwellEmittedAt: null },
    };
  }

  if (outside) {
    return {
      event: {
        event_id: randomUUID(),
        agent_key: input.agentKey,
        node_id: input.nodeId,
        sample_id: input.payload.sample_id,
        type: "poi_category.exit",
        transition: "exit",
        occurred_at: occurredAt,
        provider_place_id: input.match?.providerPlaceId,
        category_key: input.categoryKey,
        place_name: input.match?.name,
        distance_m: input.match?.distanceM,
        coords,
        metadata: {},
      },
      state: {
        status: "outside",
        enteredAt: null,
        dwellEmittedAt: null,
      },
    };
  }

  if (
    !shouldEmitDwell(occurredAt, input.currentState.entered_at, input.currentState.dwell_emitted_at)
  ) {
    return null;
  }

  return {
    event: {
      event_id: randomUUID(),
      agent_key: input.agentKey,
      node_id: input.nodeId,
      sample_id: input.payload.sample_id,
      type: "poi_category.dwell",
      transition: "dwell",
      occurred_at: occurredAt,
      provider_place_id: input.match?.providerPlaceId,
      category_key: input.categoryKey,
      place_name: input.match?.name,
      distance_m: input.match?.distanceM,
      coords,
      metadata: {},
    },
    state: {
      status: "inside",
      enteredAt: input.currentState.entered_at,
      dwellEmittedAt: occurredAt,
    },
  };
}
