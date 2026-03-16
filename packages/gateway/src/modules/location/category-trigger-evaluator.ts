import type { LocationBeacon, LocationEvent, LocationProfile } from "@tyrum/schemas";
import { DEFAULT_CATEGORY_EXIT_M, evaluateCategoryEvent } from "./event-evaluator.js";
import { recordLocationEpisode } from "./trigger-execution.js";
import type { LocationAutomationTriggerRecord } from "./types.js";
import type { LocationDal } from "./dal.js";
import type { PoiProvider } from "./poi-provider.js";
import type { MemoryDal } from "../memory/memory-dal.js";
import type { LocationSubjectState } from "./event-evaluator.js";

export async function evaluateCategoryTriggerEvents(input: {
  dal: LocationDal;
  memoryDal: MemoryDal;
  tenantId: string;
  agentId: string;
  agentKey: string;
  nodeId: string;
  payload: LocationBeacon;
  profile: LocationProfile;
  stateMap: Map<string, LocationSubjectState>;
  automationTriggers: LocationAutomationTriggerRecord[];
  getPoiProvider: (kind: LocationProfile["poi_provider_kind"]) => PoiProvider;
  dispatchLocationTriggers: (input: {
    tenantId: string;
    agentId: string;
    event: LocationEvent;
    triggers: LocationAutomationTriggerRecord[];
  }) => Promise<void>;
}): Promise<LocationEvent[]> {
  const categoryKeys = [
    ...new Set(
      input.automationTriggers
        .filter((trigger) => trigger.enabled)
        .flatMap((trigger) =>
          trigger.condition.type === "poi_category" ? [trigger.condition.category_key] : [],
        ),
    ),
  ];
  if (categoryKeys.length === 0 || input.profile.poi_provider_kind === "none") return [];

  const provider = input.getPoiProvider(input.profile.poi_provider_kind);
  const events: LocationEvent[] = [];
  for (const categoryKey of categoryKeys) {
    const match = await provider.findNearestCategoryMatch({
      coords: input.payload.coords,
      categoryKey,
      radiusM: DEFAULT_CATEGORY_EXIT_M,
    });
    const event = evaluateCategoryEvent({
      agentKey: input.agentKey,
      nodeId: input.nodeId,
      payload: input.payload,
      categoryKey,
      currentState: input.stateMap.get(`poi_category:${categoryKey}`),
      match,
    });
    if (!event) continue;

    const inserted = await input.dal.insertEventIfAbsent({
      tenantId: input.tenantId,
      agentId: input.agentId,
      event: event.event,
      subjectKind: "poi_category",
      subjectRef: categoryKey,
    });
    if (!inserted) continue;

    await input.dal.upsertState({
      tenantId: input.tenantId,
      agentId: input.agentId,
      nodeId: input.nodeId,
      subjectKind: "poi_category",
      subjectRef: categoryKey,
      status: event.state.status,
      enteredAt: event.state.enteredAt,
      dwellEmittedAt: event.state.dwellEmittedAt,
    });
    events.push(event.event);
    await recordLocationEpisode(input.memoryDal, input.tenantId, input.agentId, event.event);
    await input.dispatchLocationTriggers({
      tenantId: input.tenantId,
      agentId: input.agentId,
      event: event.event,
      triggers: input.automationTriggers,
    });
  }

  return events;
}
