import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wireContainer, type GatewayContainer } from "../../src/container.js";
import { LocationService } from "../../src/modules/location/service.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import type { LocationDal } from "../../src/modules/location/dal.js";
import * as poiProviderModule from "../../src/modules/location/poi-provider.js";

describe("LocationService", () => {
  let db: SqliteDb;
  let container: GatewayContainer;
  let service: LocationService;

  beforeEach(() => {
    db = openTestSqliteDb();
    container = wireContainer(db, {
      dbPath: ":memory:",
      migrationsDir: ".",
      tyrumHome: "/tmp/tyrum-test",
    });
    service = new LocationService(db, {
      identityScopeDal: container.identityScopeDal,
      memoryDal: container.memoryDal,
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.close();
  });

  it("derives enter, dwell, and exit events for a saved place", async () => {
    await service.createPlace({
      tenantId: "00000000-0000-4000-8000-000000000001",
      agentKey: "default",
      body: {
        name: "Home",
        latitude: 52.3702,
        longitude: 4.8952,
        radius_m: 120,
        tags: ["home"],
        source: "manual",
        metadata: {},
      },
    });

    const enter = await service.ingestBeacon({
      tenantId: "00000000-0000-4000-8000-000000000001",
      nodeId: "node-mobile-1",
      payload: {
        sample_id: "11111111-1111-4111-8111-111111111111",
        recorded_at: "2026-03-11T10:00:00.000Z",
        coords: {
          latitude: 52.3702,
          longitude: 4.8952,
          accuracy_m: 15,
        },
        source: "gps",
        is_background: false,
      },
    });
    expect(enter.events.map((event) => event.type)).toEqual(["saved_place.enter"]);

    const dwell = await service.ingestBeacon({
      tenantId: "00000000-0000-4000-8000-000000000001",
      nodeId: "node-mobile-1",
      payload: {
        sample_id: "22222222-2222-4222-8222-222222222222",
        recorded_at: "2026-03-11T10:11:00.000Z",
        coords: {
          latitude: 52.3702,
          longitude: 4.8952,
          accuracy_m: 12,
        },
        source: "gps",
        is_background: false,
      },
    });
    expect(dwell.events.map((event) => event.type)).toEqual(["saved_place.dwell"]);

    const exit = await service.ingestBeacon({
      tenantId: "00000000-0000-4000-8000-000000000001",
      nodeId: "node-mobile-1",
      payload: {
        sample_id: "33333333-3333-4333-8333-333333333333",
        recorded_at: "2026-03-11T10:20:00.000Z",
        coords: {
          latitude: 52.3802,
          longitude: 4.9052,
          accuracy_m: 10,
        },
        source: "gps",
        is_background: false,
      },
    });
    expect(exit.events.map((event) => event.type)).toEqual(["saved_place.exit"]);
  });

  it("loads automation triggers once per beacon even when multiple place events fire", async () => {
    await service.createPlace({
      tenantId: "00000000-0000-4000-8000-000000000001",
      agentKey: "default",
      body: {
        name: "Home",
        latitude: 52.3702,
        longitude: 4.8952,
        radius_m: 120,
        tags: ["home"],
        source: "manual",
        metadata: {},
      },
    });
    await service.createPlace({
      tenantId: "00000000-0000-4000-8000-000000000001",
      agentKey: "default",
      body: {
        name: "Office",
        latitude: 52.3702,
        longitude: 4.8952,
        radius_m: 200,
        tags: ["work"],
        source: "manual",
        metadata: {},
      },
    });

    const dal = (service as unknown as { dal: LocationDal }).dal;
    const listAutomationTriggersSpy = vi.spyOn(dal, "listAutomationTriggers");

    const result = await service.ingestBeacon({
      tenantId: "00000000-0000-4000-8000-000000000001",
      nodeId: "node-mobile-1",
      payload: {
        sample_id: "44444444-4444-4444-8444-444444444444",
        recorded_at: "2026-03-11T11:00:00.000Z",
        coords: {
          latitude: 52.3702,
          longitude: 4.8952,
          accuracy_m: 8,
        },
        source: "gps",
        is_background: false,
      },
    });

    expect(result.events.map((event) => event.type)).toEqual([
      "saved_place.enter",
      "saved_place.enter",
    ]);
    expect(listAutomationTriggersSpy).toHaveBeenCalledTimes(1);
  });

  it("continues evaluating later saved places when one trigger dispatch fails", async () => {
    const tenantId = "00000000-0000-4000-8000-000000000001";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    service = new LocationService(db, {
      identityScopeDal: container.identityScopeDal,
      memoryDal: container.memoryDal,
      policyService: container.policyService,
    });

    const home = await service.createPlace({
      tenantId,
      agentKey: "default",
      body: {
        name: "Home",
        latitude: 52.3702,
        longitude: 4.8952,
        radius_m: 120,
        tags: ["home"],
        source: "manual",
        metadata: {},
      },
    });
    await service.createPlace({
      tenantId,
      agentKey: "default",
      body: {
        name: "Office",
        latitude: 52.3702,
        longitude: 4.8952,
        radius_m: 200,
        tags: ["work"],
        source: "manual",
        metadata: {},
      },
    });
    await service.createAutomationTrigger({
      tenantId,
      agentKey: "default",
      body: {
        workspace_key: "default",
        enabled: true,
        delivery_mode: "notify",
        condition: {
          type: "saved_place",
          place_id: home.place_id,
          transition: "enter",
        },
        execution: {
          kind: "playbook",
          playbook_id: "missing-playbook",
        },
      },
    });

    const result = await service.ingestBeacon({
      tenantId,
      nodeId: "node-mobile-1",
      payload: {
        sample_id: "88888888-8888-4888-8888-888888888888",
        recorded_at: "2026-03-11T11:05:00.000Z",
        coords: {
          latitude: 52.3702,
          longitude: 4.8952,
          accuracy_m: 8,
        },
        source: "gps",
        is_background: false,
      },
    });

    expect(result.events).toHaveLength(2);
    expect(result.events.map((event) => event.place_name).toSorted()).toEqual(["Home", "Office"]);
    const events = await service.listEvents({ tenantId, agentKey: "default", limit: 10 });
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.place_name).toSorted()).toEqual(["Home", "Office"]);
    expect(logSpy).toHaveBeenCalled();
  });

  it("updates a place without reloading the full place list and preserves explicit null clears", async () => {
    const tenantId = "00000000-0000-4000-8000-000000000001";
    const created = await service.createPlace({
      tenantId,
      agentKey: "default",
      body: {
        name: "Home",
        latitude: 52.3702,
        longitude: 4.8952,
        radius_m: 120,
        tags: ["home"],
        source: "poi_provider",
        provider_place_id: "osm:123",
        metadata: { floor: 3 },
      },
    });

    const dal = (service as unknown as { dal: LocationDal }).dal;
    const listPlacesSpy = vi.spyOn(dal, "listPlaces");

    const updated = await service.updatePlace({
      tenantId,
      agentKey: "default",
      placeId: created.place_id,
      patch: {
        name: "Home Base",
        provider_place_id: null,
      },
    });

    expect(updated.name).toBe("Home Base");
    expect(updated.provider_place_id).toBeNull();
    expect(updated.tags).toEqual(["home"]);
    expect(updated.metadata).toEqual({ floor: 3 });
    expect(listPlacesSpy).not.toHaveBeenCalled();
  });

  it("reuses the same POI provider across beacon ingestions for the same provider kind", async () => {
    const tenantId = "00000000-0000-4000-8000-000000000001";
    const provider = {
      findNearestCategoryMatch: vi.fn().mockResolvedValue(null),
    };
    const createPoiProviderSpy = vi
      .spyOn(poiProviderModule, "createPoiProvider")
      .mockReturnValue(provider);

    await service.updateProfile({
      tenantId,
      agentKey: "default",
      patch: { poi_provider_kind: "osm_overpass" },
    });
    await service.createAutomationTrigger({
      tenantId,
      agentKey: "default",
      body: {
        workspace_key: "default",
        enabled: true,
        delivery_mode: "notify",
        condition: {
          type: "poi_category",
          category_key: "cafe",
          transition: "enter",
        },
        execution: {
          kind: "agent_turn",
          instruction: "Check in",
        },
      },
    });

    await service.ingestBeacon({
      tenantId,
      nodeId: "node-mobile-1",
      payload: {
        sample_id: "55555555-5555-4555-8555-555555555555",
        recorded_at: "2026-03-11T12:00:00.000Z",
        coords: {
          latitude: 52.3702,
          longitude: 4.8952,
          accuracy_m: 8,
        },
        source: "gps",
        is_background: false,
      },
    });
    await service.ingestBeacon({
      tenantId,
      nodeId: "node-mobile-1",
      payload: {
        sample_id: "66666666-6666-4666-8666-666666666666",
        recorded_at: "2026-03-11T12:05:00.000Z",
        coords: {
          latitude: 52.3704,
          longitude: 4.8954,
          accuracy_m: 8,
        },
        source: "gps",
        is_background: false,
      },
    });

    expect(createPoiProviderSpy).toHaveBeenCalledTimes(1);
    expect(provider.findNearestCategoryMatch).toHaveBeenCalledTimes(2);
  });
});
