import { expect, it } from "vitest";
import { wireContainer } from "../../src/container.js";
import { DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID } from "../../src/modules/identity/scope.js";
import { LocationService } from "../../src/modules/location/service.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import {
  createToolExecutor,
  requireHomeDir,
  type HomeDirState,
} from "./tool-executor.shared-test-support.js";

async function createLocationToolHarness(home: HomeDirState, currentAgentKey = "default") {
  const db = openTestSqliteDb();
  const container = wireContainer(db, {
    dbPath: ":memory:",
    migrationsDir: ".",
    tyrumHome: requireHomeDir(home),
  });
  const agentId = await container.identityScopeDal.ensureAgentId(
    DEFAULT_TENANT_ID,
    currentAgentKey,
  );
  const locationService = new LocationService(db, {
    identityScopeDal: container.identityScopeDal,
    memoryDal: container.memoryDal,
  });

  return {
    db,
    executor: createToolExecutor({
      homeDir: requireHomeDir(home),
      workspaceLease: {
        db,
        tenantId: DEFAULT_TENANT_ID,
        agentId,
        workspaceId: DEFAULT_WORKSPACE_ID,
      },
      identityScopeDal: container.identityScopeDal,
      locationService,
    }),
    identityScopeDal: container.identityScopeDal,
    locationService,
  };
}

export function registerToolExecutorLocationToolTests(home: HomeDirState): void {
  it("location place tools use the current agent scope when agent_key is omitted", async () => {
    const harness = await createLocationToolHarness(home);

    try {
      const createdResult = await harness.executor.execute(
        "tool.location.place.create",
        "call-place-1",
        {
          name: "Home",
          latitude: 52.3676,
          longitude: 4.9041,
        },
      );
      expect(createdResult.error).toBeUndefined();
      const created = JSON.parse(createdResult.output) as {
        place: { place_id: string; agent_key: string; name: string };
      };
      expect(created.place.agent_key).toBe("default");
      expect(created.place.name).toBe("Home");

      const listResult = await harness.executor.execute(
        "tool.location.place.list",
        "call-place-2",
        {},
      );
      expect(listResult.error).toBeUndefined();
      const listed = JSON.parse(listResult.output) as {
        places: Array<{ place_id: string }>;
      };
      expect(listed.places.map((place) => place.place_id)).toEqual([created.place.place_id]);

      const updatedResult = await harness.executor.execute(
        "tool.location.place.update",
        "call-place-3",
        {
          place_id: created.place.place_id,
          name: "Home Base",
        },
      );
      expect(updatedResult.error).toBeUndefined();
      const updated = JSON.parse(updatedResult.output) as {
        place: { name: string };
      };
      expect(updated.place.name).toBe("Home Base");

      const deletedResult = await harness.executor.execute(
        "tool.location.place.delete",
        "call-place-4",
        {
          place_id: created.place.place_id,
        },
      );
      expect(deletedResult.error).toBeUndefined();
      expect(JSON.parse(deletedResult.output)).toEqual({
        place_id: created.place.place_id,
        deleted: true,
      });

      const emptyListResult = await harness.executor.execute(
        "tool.location.place.list",
        "call-place-5",
        {},
      );
      expect(emptyListResult.error).toBeUndefined();
      expect(JSON.parse(emptyListResult.output)).toEqual({ places: [] });
    } finally {
      await harness.db.close();
    }
  });

  it("location place tools honor explicit agent_key overrides", async () => {
    const harness = await createLocationToolHarness(home);

    try {
      const createdResult = await harness.executor.execute(
        "tool.location.place.create",
        "call-place-6",
        {
          agent_key: "travel",
          name: "Hotel",
          latitude: 48.8566,
          longitude: 2.3522,
        },
      );
      expect(createdResult.error).toBeUndefined();
      const created = JSON.parse(createdResult.output) as {
        place: { agent_key: string; place_id: string };
      };
      expect(created.place.agent_key).toBe("travel");

      const defaultListResult = await harness.executor.execute(
        "tool.location.place.list",
        "call-place-7",
        {},
      );
      expect(defaultListResult.error).toBeUndefined();
      expect(JSON.parse(defaultListResult.output)).toEqual({ places: [] });

      const travelListResult = await harness.executor.execute(
        "tool.location.place.list",
        "call-place-8",
        {
          agent_key: "travel",
        },
      );
      expect(travelListResult.error).toBeUndefined();
      const listed = JSON.parse(travelListResult.output) as {
        places: Array<{ place_id: string; agent_key: string }>;
      };
      expect(listed.places).toEqual([
        expect.objectContaining({
          place_id: created.place.place_id,
          agent_key: "travel",
        }),
      ]);
    } finally {
      await harness.db.close();
    }
  });

  it("location place tools require agent_key when current agent scope is unavailable", async () => {
    const db = openTestSqliteDb();

    try {
      const container = wireContainer(db, {
        dbPath: ":memory:",
        migrationsDir: ".",
        tyrumHome: requireHomeDir(home),
      });
      const locationService = new LocationService(db, {
        identityScopeDal: container.identityScopeDal,
        memoryDal: container.memoryDal,
      });

      const result = await createToolExecutor({
        homeDir: requireHomeDir(home),
        workspaceLease: {
          db,
          tenantId: DEFAULT_TENANT_ID,
          agentId: null,
          workspaceId: DEFAULT_WORKSPACE_ID,
        },
        identityScopeDal: container.identityScopeDal,
        locationService,
      }).execute("tool.location.place.list", "call-place-9", {});

      expect(result.output).toBe("");
      expect(result.error).toBe("agent_key is required when current agent scope is unavailable");
    } finally {
      await db.close();
    }
  });

  it("location place update rejects empty patch payloads", async () => {
    const harness = await createLocationToolHarness(home);

    try {
      const result = await harness.executor.execute("tool.location.place.update", "call-place-10", {
        place_id: "11111111-1111-1111-1111-111111111111",
      });

      expect(result.output).toBe("");
      expect(result.error).toBe("location place update request must include at least one field");
    } finally {
      await harness.db.close();
    }
  });

  it("location place update accepts null provider_place_id to clear the field", async () => {
    const harness = await createLocationToolHarness(home);

    try {
      const createdResult = await harness.executor.execute(
        "tool.location.place.create",
        "call-place-10a",
        {
          name: "Airport",
          latitude: 52.31,
          longitude: 4.76,
          provider_place_id: "poi-123",
          source: "poi_provider",
        },
      );
      expect(createdResult.error).toBeUndefined();
      const created = JSON.parse(createdResult.output) as {
        place: { place_id: string; provider_place_id: string | null };
      };
      expect(created.place.provider_place_id).toBe("poi-123");

      const updatedResult = await harness.executor.execute(
        "tool.location.place.update",
        "call-place-10b",
        {
          place_id: created.place.place_id,
          provider_place_id: null,
        },
      );

      expect(updatedResult.error).toBeUndefined();
      const updated = JSON.parse(updatedResult.output) as {
        place: { provider_place_id: string | null };
      };
      expect(updated.place.provider_place_id).toBeNull();
    } finally {
      await harness.db.close();
    }
  });

  it("location place tools fail closed when the service is not configured", async () => {
    const db = openTestSqliteDb();

    try {
      const identityScopeDal = wireContainer(db, {
        dbPath: ":memory:",
        migrationsDir: ".",
        tyrumHome: requireHomeDir(home),
      }).identityScopeDal;
      const agentId = await identityScopeDal.ensureAgentId(DEFAULT_TENANT_ID, "default");
      const result = await createToolExecutor({
        homeDir: requireHomeDir(home),
        workspaceLease: {
          db,
          tenantId: DEFAULT_TENANT_ID,
          agentId,
          workspaceId: DEFAULT_WORKSPACE_ID,
        },
        identityScopeDal,
      }).execute("tool.location.place.list", "call-place-11", {
        agent_key: "default",
      });

      expect(result.output).toBe("");
      expect(result.error).toBe("location tools are not configured");
    } finally {
      await db.close();
    }
  });
}
