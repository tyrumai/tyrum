import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wireContainer, type GatewayContainer } from "../../src/container.js";
import { ScopeNotFoundError } from "../../src/modules/identity/scope.js";
import { LocationService } from "../../src/modules/location/service.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import * as poiProviderModule from "../../src/modules/location/poi-provider.js";

describe("LocationService scope validation", () => {
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

  it("rejects location beacons for a missing explicit agent without creating it", async () => {
    const tenantId = "00000000-0000-4000-8000-000000000001";
    const before = await db.get<{ count: number }>(
      "SELECT COUNT(1) AS count FROM agents WHERE tenant_id = ?",
      [tenantId],
    );
    const beforeProfiles = await db.get<{ count: number }>(
      "SELECT COUNT(1) AS count FROM location_profiles WHERE tenant_id = ?",
      [tenantId],
    );

    await expect(
      service.ingestBeacon({
        tenantId,
        nodeId: "node-mobile-1",
        payload: {
          agent_key: "missing-agent",
          sample_id: "77777777-7777-4777-8777-777777777777",
          recorded_at: "2026-03-11T12:10:00.000Z",
          coords: {
            latitude: 52.3702,
            longitude: 4.8952,
            accuracy_m: 8,
          },
          source: "gps",
          is_background: false,
        },
      }),
    ).rejects.toBeInstanceOf(ScopeNotFoundError);

    const after = await db.get<{ count: number }>(
      "SELECT COUNT(1) AS count FROM agents WHERE tenant_id = ?",
      [tenantId],
    );
    const afterProfiles = await db.get<{ count: number }>(
      "SELECT COUNT(1) AS count FROM location_profiles WHERE tenant_id = ?",
      [tenantId],
    );
    expect(after?.count ?? 0).toBe(before?.count ?? 0);
    expect(afterProfiles?.count ?? 0).toBe(beforeProfiles?.count ?? 0);
  });

  it("rejects explicit missing automation-trigger scopes without creating them", async () => {
    const tenantId = "00000000-0000-4000-8000-000000000001";
    const beforeAgents = await db.get<{ count: number }>(
      "SELECT COUNT(1) AS count FROM agents WHERE tenant_id = ?",
      [tenantId],
    );
    const beforeWorkspaces = await db.get<{ count: number }>(
      "SELECT COUNT(1) AS count FROM workspaces WHERE tenant_id = ?",
      [tenantId],
    );

    await expect(
      service.createAutomationTrigger({
        tenantId,
        agentKey: "default",
        body: {
          agent_key: "missing-agent",
          workspace_key: "missing-workspace",
          enabled: true,
          delivery_mode: "notify",
          condition: {
            type: "poi_category",
            category_key: "coffee",
            transition: "enter",
          },
          execution: {
            kind: "agent_turn",
            instruction: "Check in",
          },
        },
      }),
    ).rejects.toBeInstanceOf(ScopeNotFoundError);

    const afterAgents = await db.get<{ count: number }>(
      "SELECT COUNT(1) AS count FROM agents WHERE tenant_id = ?",
      [tenantId],
    );
    const afterWorkspaces = await db.get<{ count: number }>(
      "SELECT COUNT(1) AS count FROM workspaces WHERE tenant_id = ?",
      [tenantId],
    );
    expect(afterAgents?.count ?? 0).toBe(beforeAgents?.count ?? 0);
    expect(afterWorkspaces?.count ?? 0).toBe(beforeWorkspaces?.count ?? 0);
  });

  it("applies a workspace filter even when no agent filter is provided", async () => {
    const tenantId = "00000000-0000-4000-8000-000000000001";

    await service.createAutomationTrigger({
      tenantId,
      agentKey: "default",
      body: {
        workspace_key: "default",
        enabled: true,
        delivery_mode: "notify",
        condition: {
          type: "poi_category",
          category_key: "coffee",
          transition: "enter",
        },
        execution: {
          kind: "agent_turn",
          instruction: "Check in",
        },
      },
    });
    await container.identityScopeDal.ensureWorkspaceId(tenantId, "travel");
    await service.createAutomationTrigger({
      tenantId,
      agentKey: "default",
      body: {
        workspace_key: "travel",
        enabled: true,
        delivery_mode: "notify",
        condition: {
          type: "poi_category",
          category_key: "airport",
          transition: "enter",
        },
        execution: {
          kind: "agent_turn",
          instruction: "Boarding soon",
        },
      },
    });

    const triggers = await service.listAutomationTriggers({
      tenantId,
      workspaceKey: "travel",
    });

    expect(triggers).toHaveLength(1);
    expect(triggers[0]?.workspace_key).toBe("travel");
    expect(triggers[0]?.condition).toMatchObject({
      type: "poi_category",
      category_key: "airport",
    });
  });

  it("returns saved-place events when POI category evaluation fails", async () => {
    const tenantId = "00000000-0000-4000-8000-000000000001";
    const provider = {
      findNearestCategoryMatch: vi.fn().mockRejectedValue(new Error("provider unavailable")),
    };
    vi.spyOn(poiProviderModule, "createPoiProvider").mockReturnValue(provider);

    await service.createPlace({
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

    await expect(
      service.ingestBeacon({
        tenantId,
        nodeId: "node-mobile-1",
        payload: {
          sample_id: "77777777-7777-4777-8777-777777777777",
          recorded_at: "2026-03-11T12:10:00.000Z",
          coords: {
            latitude: 52.3702,
            longitude: 4.8952,
            accuracy_m: 8,
          },
          source: "gps",
          is_background: false,
        },
      }),
    ).resolves.toMatchObject({ events: [{ type: "saved_place.enter" }] });
  });
});
