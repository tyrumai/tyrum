import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wireContainer, type GatewayContainer } from "../../src/container.js";
import { LocationService } from "../../src/modules/location/service.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import type { LocationDal } from "../../src/modules/location/dal.js";
import * as poiProviderModule from "../../src/modules/location/poi-provider.js";

describe("LocationService duplicate replay handling", () => {
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

  it("does not overwrite saved-place state when an older duplicate sample is replayed", async () => {
    const tenantId = "00000000-0000-4000-8000-000000000001";
    const nodeId = "node-mobile-1";
    const place = await service.createPlace({
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

    await service.ingestBeacon({
      tenantId,
      nodeId,
      payload: {
        sample_id: "99999999-1111-4111-8111-111111111111",
        recorded_at: "2026-03-11T13:00:00.000Z",
        coords: {
          latitude: 52.3702,
          longitude: 4.8952,
          accuracy_m: 10,
        },
        source: "gps",
        is_background: false,
      },
    });
    await service.ingestBeacon({
      tenantId,
      nodeId,
      payload: {
        sample_id: "99999999-2222-4222-8222-222222222222",
        recorded_at: "2026-03-11T13:20:00.000Z",
        coords: {
          latitude: 52.3802,
          longitude: 4.9052,
          accuracy_m: 10,
        },
        source: "gps",
        is_background: false,
      },
    });

    const replay = await service.ingestBeacon({
      tenantId,
      nodeId,
      payload: {
        sample_id: "99999999-1111-4111-8111-111111111111",
        recorded_at: "2026-03-11T13:00:00.000Z",
        coords: {
          latitude: 52.3702,
          longitude: 4.8952,
          accuracy_m: 10,
        },
        source: "gps",
        is_background: false,
      },
    });

    expect(replay.events).toEqual([]);
    const savedPlaceEvents = await service.listEvents({ tenantId, agentKey: "default", limit: 10 });
    expect(savedPlaceEvents).toHaveLength(2);
    expect(savedPlaceEvents.map((event) => event.type).toSorted()).toEqual([
      "saved_place.enter",
      "saved_place.exit",
    ]);

    const dal = (service as unknown as { dal: LocationDal }).dal;
    const agentId = await container.identityScopeDal.ensureAgentId(tenantId, "default");
    await expect(dal.listStates({ tenantId, agentId, nodeId })).resolves.toContainEqual({
      subject_kind: "saved_place",
      subject_ref: place.place_id,
      status: "outside",
      entered_at: null,
      dwell_emitted_at: null,
    });
  });

  it("does not overwrite POI-category state when an older duplicate sample is replayed", async () => {
    const tenantId = "00000000-0000-4000-8000-000000000001";
    const nodeId = "node-mobile-1";
    const provider = {
      findNearestCategoryMatch: vi
        .fn()
        .mockResolvedValueOnce({
          providerPlaceId: "osm:cafe-1",
          name: "Canal Cafe",
          distanceM: 20,
        })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          providerPlaceId: "osm:cafe-1",
          name: "Canal Cafe",
          distanceM: 20,
        }),
    };
    vi.spyOn(poiProviderModule, "createPoiProvider").mockReturnValue(provider);

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
      nodeId,
      payload: {
        sample_id: "99999999-3333-4333-8333-333333333333",
        recorded_at: "2026-03-11T14:00:00.000Z",
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
      nodeId,
      payload: {
        sample_id: "99999999-4444-4444-8444-444444444444",
        recorded_at: "2026-03-11T14:20:00.000Z",
        coords: {
          latitude: 52.3802,
          longitude: 4.9052,
          accuracy_m: 8,
        },
        source: "gps",
        is_background: false,
      },
    });

    const replay = await service.ingestBeacon({
      tenantId,
      nodeId,
      payload: {
        sample_id: "99999999-3333-4333-8333-333333333333",
        recorded_at: "2026-03-11T14:00:00.000Z",
        coords: {
          latitude: 52.3702,
          longitude: 4.8952,
          accuracy_m: 8,
        },
        source: "gps",
        is_background: false,
      },
    });

    expect(replay.events).toEqual([]);
    const poiCategoryEvents = await service.listEvents({
      tenantId,
      agentKey: "default",
      limit: 10,
    });
    expect(poiCategoryEvents).toHaveLength(2);
    expect(poiCategoryEvents.map((event) => event.type).toSorted()).toEqual([
      "poi_category.enter",
      "poi_category.exit",
    ]);
    expect(provider.findNearestCategoryMatch).toHaveBeenCalledTimes(3);

    const dal = (service as unknown as { dal: LocationDal }).dal;
    const agentId = await container.identityScopeDal.ensureAgentId(tenantId, "default");
    await expect(dal.listStates({ tenantId, agentId, nodeId })).resolves.toContainEqual({
      subject_kind: "poi_category",
      subject_ref: "cafe",
      status: "outside",
      entered_at: null,
      dwell_emitted_at: null,
    });
  });
});
