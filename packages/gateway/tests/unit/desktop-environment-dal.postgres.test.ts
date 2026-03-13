import { describe, expect, it } from "vitest";
import {
  DesktopEnvironmentDal,
  DesktopEnvironmentHostDal,
} from "../../src/modules/desktop-environments/dal.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { openTestPostgresDb } from "../helpers/postgres-db.js";

async function getColumnType(
  db: { get<T>(sql: string, params?: readonly unknown[]): Promise<T | undefined> },
  table: string,
  column: string,
): Promise<string | undefined> {
  const row = await db.get<{ udt_name: string }>(
    `SELECT udt_name
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ? AND column_name = ?`,
    [table, column],
  );
  return row?.udt_name;
}

describe("desktop environment DAL (postgres)", () => {
  it("uses native postgres booleans for desktop environment columns", async () => {
    const { db, close } = await openTestPostgresDb();
    try {
      const hostDal = new DesktopEnvironmentHostDal(db);
      const environmentDal = new DesktopEnvironmentDal(db);

      expect(await getColumnType(db, "desktop_environment_hosts", "docker_available")).toBe("bool");
      expect(await getColumnType(db, "desktop_environment_hosts", "healthy")).toBe("bool");
      expect(await getColumnType(db, "desktop_environments", "desired_running")).toBe("bool");

      await hostDal.upsert({
        hostId: "host-1",
        label: "Primary runtime",
        version: "0.1.0",
        dockerAvailable: true,
        healthy: false,
        lastSeenAt: "2026-03-12T00:00:00.000Z",
        lastError: null,
      });

      const hostRow = await db.get<{ docker_available: boolean; healthy: boolean }>(
        `SELECT docker_available, healthy
           FROM desktop_environment_hosts
          WHERE host_id = ?`,
        ["host-1"],
      );
      expect(hostRow).toEqual({
        docker_available: true,
        healthy: false,
      });

      const created = await environmentDal.create({
        tenantId: DEFAULT_TENANT_ID,
        hostId: "host-1",
        label: "Research desktop",
        imageRef: "tyrum-desktop-sandbox:latest",
        desiredRunning: false,
      });
      let environmentRow = await db.get<{ desired_running: boolean; status: string }>(
        `SELECT desired_running, status
           FROM desktop_environments
          WHERE tenant_id = ? AND environment_id = ?`,
        [DEFAULT_TENANT_ID, created.environment_id],
      );
      expect(environmentRow?.desired_running).toBe(false);
      expect(environmentRow?.status).toBe("stopped");

      await environmentDal.reset({
        tenantId: DEFAULT_TENANT_ID,
        environmentId: created.environment_id,
      });
      environmentRow = await db.get<{ desired_running: boolean; status: string }>(
        `SELECT desired_running, status
           FROM desktop_environments
          WHERE tenant_id = ? AND environment_id = ?`,
        [DEFAULT_TENANT_ID, created.environment_id],
      );
      expect(environmentRow?.desired_running).toBe(false);
      expect(environmentRow?.status).toBe("stopped");

      await environmentDal.start({
        tenantId: DEFAULT_TENANT_ID,
        environmentId: created.environment_id,
      });
      environmentRow = await db.get<{ desired_running: boolean; status: string }>(
        `SELECT desired_running, status
           FROM desktop_environments
          WHERE tenant_id = ? AND environment_id = ?`,
        [DEFAULT_TENANT_ID, created.environment_id],
      );
      expect(environmentRow?.desired_running).toBe(true);
      expect(environmentRow?.status).toBe("starting");

      await environmentDal.reset({
        tenantId: DEFAULT_TENANT_ID,
        environmentId: created.environment_id,
      });
      environmentRow = await db.get<{ desired_running: boolean; status: string }>(
        `SELECT desired_running, status
           FROM desktop_environments
          WHERE tenant_id = ? AND environment_id = ?`,
        [DEFAULT_TENANT_ID, created.environment_id],
      );
      expect(environmentRow?.desired_running).toBe(true);
      expect(environmentRow?.status).toBe("pending");
    } finally {
      await close();
    }
  });
});
