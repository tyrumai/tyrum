import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wireContainer, type GatewayContainer } from "../../src/container.js";
import { LocationService } from "../../src/modules/location/service.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import type { LocationDal } from "../../src/modules/location/dal.js";

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
      memoryV1Dal: container.memoryV1Dal,
    });
  });

  afterEach(async () => {
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
});
