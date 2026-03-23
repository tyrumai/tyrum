import { afterEach, describe, expect, it } from "vitest";
import { SessionLaneNodeAttachmentDal } from "../../src/modules/agent/session-lane-node-attachment-dal.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import type { SqlDb } from "../../src/statestore/types.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

const ATTACHMENT_SCOPE = {
  tenantId: "tenant-test",
  key: "agent:default:test:default:channel:thread-attachment",
  lane: "main",
} as const;

describe("SessionLaneNodeAttachmentDal", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("does not create an empty row when only a timestamp update is requested", async () => {
    db = openTestSqliteDb();
    const dal = new SessionLaneNodeAttachmentDal(db);

    await expect(dal.put({ ...ATTACHMENT_SCOPE, updatedAtMs: 5 })).resolves.toBeUndefined();
    await expect(dal.get(ATTACHMENT_SCOPE)).resolves.toBeUndefined();
  });

  it("does not create an empty row when only last activity is reported", async () => {
    db = openTestSqliteDb();
    const dal = new SessionLaneNodeAttachmentDal(db);

    await expect(
      dal.put({
        ...ATTACHMENT_SCOPE,
        lastActivityAtMs: 5,
        updatedAtMs: 5,
        createIfMissing: false,
      }),
    ).resolves.toBeUndefined();
    await expect(dal.get(ATTACHMENT_SCOPE)).resolves.toBeUndefined();
  });

  it("preserves unspecified fields across partial updates", async () => {
    db = openTestSqliteDb();
    const dal = new SessionLaneNodeAttachmentDal(db);

    await dal.upsert({
      ...ATTACHMENT_SCOPE,
      sourceClientDeviceId: "device-1",
      attachedNodeId: "node-1",
      updatedAtMs: 1,
    });
    await dal.put({
      ...ATTACHMENT_SCOPE,
      desktopEnvironmentId: "env-1",
      updatedAtMs: 2,
    });

    await expect(dal.get(ATTACHMENT_SCOPE)).resolves.toMatchObject({
      source_client_device_id: "device-1",
      attached_node_id: "node-1",
      desktop_environment_id: "env-1",
      last_activity_at_ms: 1,
      updated_at_ms: 2,
    });
  });

  it("keeps upsert atomic when another writer inserts the lane first", async () => {
    db = openTestSqliteDb();
    const sqliteDb = db;
    if (!sqliteDb) {
      throw new Error("test db was not initialized");
    }
    const directDal = new SessionLaneNodeAttachmentDal(sqliteDb);
    let interleaved = false;

    const interleavingDb: SqlDb = {
      kind: sqliteDb.kind,
      async get<T>(sql: string, params?: readonly unknown[]): Promise<T | undefined> {
        return await sqliteDb.get<T>(sql, params);
      },
      async all<T>(sql: string, params?: readonly unknown[]): Promise<T[]> {
        return await sqliteDb.all<T>(sql, params);
      },
      async run(sql: string, params?: readonly unknown[]) {
        if (!interleaved && sql.includes("INSERT INTO session_lane_node_attachments")) {
          interleaved = true;
          await directDal.upsert({
            ...ATTACHMENT_SCOPE,
            sourceClientDeviceId: "device-newer",
            updatedAtMs: 2,
          });
        }
        return await sqliteDb.run(sql, params);
      },
      async exec(sql: string): Promise<void> {
        await sqliteDb.exec(sql);
      },
      async transaction<T>(fn: (tx: SqlDb) => Promise<T>): Promise<T> {
        return await sqliteDb.transaction(fn);
      },
      async close(): Promise<void> {
        await sqliteDb.close();
      },
    };

    const dal = new SessionLaneNodeAttachmentDal(interleavingDb);
    await expect(
      dal.upsert({
        ...ATTACHMENT_SCOPE,
        sourceClientDeviceId: "device-older",
        updatedAtMs: 1,
      }),
    ).resolves.toBeUndefined();
    expect(interleaved).toBe(true);
    await expect(directDal.get(ATTACHMENT_SCOPE)).resolves.toMatchObject({
      source_client_device_id: "device-newer",
      updated_at_ms: 2,
    });
  });
});
