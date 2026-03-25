import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_DESKTOP_ENVIRONMENT_IMAGE_REF } from "@tyrum/contracts";
import {
  DesktopEnvironmentDal,
  DesktopEnvironmentHostDal,
} from "../../src/modules/desktop-environments/dal.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { createTestContainer } from "../integration/helpers.js";
import type { SqlDb } from "../../src/statestore/types.js";

describe("DesktopEnvironmentDal", () => {
  const containers: Array<Awaited<ReturnType<typeof createTestContainer>>> = [];

  afterEach(async () => {
    while (containers.length > 0) {
      await containers.pop()?.db.close();
    }
  });

  it("getByNodeId returns a running environment matching node_id and tenant_id", async () => {
    const container = await createTestContainer();
    containers.push(container);

    const hostDal = new DesktopEnvironmentHostDal(container.db);
    await hostDal.upsert({
      hostId: "host-1",
      label: "Primary runtime",
      version: "0.1.0",
      dockerAvailable: true,
      healthy: true,
    });

    const dal = new DesktopEnvironmentDal(container.db);
    const environment = await dal.create({
      tenantId: DEFAULT_TENANT_ID,
      hostId: "host-1",
      label: "Desktop env",
      imageRef: DEFAULT_DESKTOP_ENVIRONMENT_IMAGE_REF,
      desiredRunning: true,
    });

    await dal.updateRuntime({
      tenantId: DEFAULT_TENANT_ID,
      environmentId: environment.environment_id,
      status: "running",
      nodeId: "device-abc",
      takeoverUrl: null,
      lastError: null,
    });

    const found = await dal.getByNodeId("device-abc", DEFAULT_TENANT_ID);
    expect(found).toBeDefined();
    expect(found!.environment_id).toBe(environment.environment_id);
    expect(found!.tenant_id).toBe(DEFAULT_TENANT_ID);
    expect(found!.node_id).toBe("device-abc");
  });

  it("getByNodeId returns undefined when node_id does not match", async () => {
    const container = await createTestContainer();
    containers.push(container);

    const hostDal = new DesktopEnvironmentHostDal(container.db);
    await hostDal.upsert({
      hostId: "host-1",
      label: "Primary runtime",
      version: "0.1.0",
      dockerAvailable: true,
      healthy: true,
    });

    const dal = new DesktopEnvironmentDal(container.db);
    await dal.create({
      tenantId: DEFAULT_TENANT_ID,
      hostId: "host-1",
      label: "Desktop env",
      imageRef: DEFAULT_DESKTOP_ENVIRONMENT_IMAGE_REF,
      desiredRunning: true,
    });

    const found = await dal.getByNodeId("nonexistent-device", DEFAULT_TENANT_ID);
    expect(found).toBeUndefined();
  });

  it("getByNodeId returns undefined when environment is not desired_running", async () => {
    const container = await createTestContainer();
    containers.push(container);

    const hostDal = new DesktopEnvironmentHostDal(container.db);
    await hostDal.upsert({
      hostId: "host-1",
      label: "Primary runtime",
      version: "0.1.0",
      dockerAvailable: true,
      healthy: true,
    });

    const dal = new DesktopEnvironmentDal(container.db);
    const environment = await dal.create({
      tenantId: DEFAULT_TENANT_ID,
      hostId: "host-1",
      label: "Desktop env",
      imageRef: DEFAULT_DESKTOP_ENVIRONMENT_IMAGE_REF,
      desiredRunning: false,
    });

    await dal.updateRuntime({
      tenantId: DEFAULT_TENANT_ID,
      environmentId: environment.environment_id,
      status: "stopped",
      nodeId: "device-abc",
      takeoverUrl: null,
      lastError: null,
    });

    const found = await dal.getByNodeId("device-abc", DEFAULT_TENANT_ID);
    expect(found).toBeUndefined();
  });

  it("preserves runtime fields when a label update races with runtime reconciliation", async () => {
    const container = await createTestContainer();
    containers.push(container);

    const hostDal = new DesktopEnvironmentHostDal(container.db);
    await hostDal.upsert({
      hostId: "host-1",
      label: "Primary runtime",
      version: "0.1.0",
      dockerAvailable: true,
      healthy: true,
      lastSeenAt: "2026-03-15T00:00:00.000Z",
      lastError: null,
    });

    const directDal = new DesktopEnvironmentDal(container.db);
    const environment = await directDal.create({
      tenantId: DEFAULT_TENANT_ID,
      hostId: "host-1",
      label: "Research desktop",
      imageRef: DEFAULT_DESKTOP_ENVIRONMENT_IMAGE_REF,
      desiredRunning: true,
    });

    let injectedRuntimeUpdate = false;
    const racingDb: SqlDb = {
      kind: container.db.kind,
      async get<T>(sql: string, params?: readonly unknown[]): Promise<T | undefined> {
        if (!injectedRuntimeUpdate && sql.startsWith("UPDATE desktop_environments")) {
          injectedRuntimeUpdate = true;
          await directDal.updateRuntime({
            tenantId: DEFAULT_TENANT_ID,
            environmentId: environment.environment_id,
            status: "running",
            nodeId: "node-desktop-1",
            takeoverUrl: "http://127.0.0.1:6080/vnc.html?autoconnect=true",
            lastSeenAt: "2026-03-15T00:01:00.000Z",
            lastError: null,
            logs: ["desktop runtime ready"],
          });
        }
        return await container.db.get<T>(sql, params);
      },
      async all<T>(sql: string, params?: readonly unknown[]): Promise<T[]> {
        return await container.db.all<T>(sql, params);
      },
      async run(sql: string, params?: readonly unknown[]) {
        return await container.db.run(sql, params);
      },
      async exec(sql: string): Promise<void> {
        await container.db.exec(sql);
      },
      async transaction<T>(fn: (tx: SqlDb) => Promise<T>): Promise<T> {
        return await container.db.transaction(fn);
      },
      async close(): Promise<void> {
        await container.db.close();
      },
    };

    const dal = new DesktopEnvironmentDal(racingDb);
    const updated = await dal.update({
      tenantId: DEFAULT_TENANT_ID,
      environmentId: environment.environment_id,
      label: "Renamed desktop",
    });
    const storedUpdated = await directDal.getStored({
      tenantId: DEFAULT_TENANT_ID,
      environmentId: environment.environment_id,
    });

    expect(updated).toMatchObject({
      label: "Renamed desktop",
      status: "running",
      node_id: "node-desktop-1",
      last_seen_at: "2026-03-15T00:01:00.000Z",
      last_error: null,
    });
    expect(storedUpdated).toMatchObject({
      label: "Renamed desktop",
      status: "running",
      node_id: "node-desktop-1",
      takeover_url: "http://127.0.0.1:6080/vnc.html?autoconnect=true",
      last_seen_at: "2026-03-15T00:01:00.000Z",
      last_error: null,
    });
    await expect(
      directDal.getLogs({
        tenantId: DEFAULT_TENANT_ID,
        environmentId: environment.environment_id,
      }),
    ).resolves.toEqual(["desktop runtime ready"]);
  });
});
