import { afterEach, describe, expect, it } from "vitest";
import { ConversationNodeAttachmentDal } from "../../src/modules/agent/conversation-node-attachment-dal.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import type { SqlDb } from "../../src/statestore/types.js";
import {
  DesktopEnvironmentDal,
  DesktopEnvironmentHostDal,
} from "../../src/modules/desktop-environments/dal.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

const ATTACHMENT_SCOPE = {
  tenantId: "tenant-test",
  key: "agent:default:test:default:channel:thread-attachment",
} as const;

describe("ConversationNodeAttachmentDal", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("does not create an empty row when only a timestamp update is requested", async () => {
    db = openTestSqliteDb();
    const dal = new ConversationNodeAttachmentDal(db);

    await expect(dal.put({ ...ATTACHMENT_SCOPE, updatedAtMs: 5 })).resolves.toBeUndefined();
    await expect(dal.get(ATTACHMENT_SCOPE)).resolves.toBeUndefined();
  });

  it("does not create an empty row when only last activity is reported", async () => {
    db = openTestSqliteDb();
    const dal = new ConversationNodeAttachmentDal(db);

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
    const dal = new ConversationNodeAttachmentDal(db);

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

  it("keeps upsert atomic when another writer inserts the attachment first", async () => {
    db = openTestSqliteDb();
    const sqliteDb = db;
    if (!sqliteDb) {
      throw new Error("test db was not initialized");
    }
    const directDal = new ConversationNodeAttachmentDal(sqliteDb);
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
        if (!interleaved && sql.includes("INSERT INTO conversation_node_attachments")) {
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

    const dal = new ConversationNodeAttachmentDal(interleavingDb);
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

  it("attempts node hydration only once when the repair update is rejected", async () => {
    db = openTestSqliteDb();
    const sqliteDb = db;
    if (!sqliteDb) {
      throw new Error("test db was not initialized");
    }

    const environmentDal = new DesktopEnvironmentDal(sqliteDb);
    await new DesktopEnvironmentHostDal(sqliteDb).upsert({
      hostId: "host-1",
      label: "Desktop host",
      dockerAvailable: true,
      healthy: true,
    });
    const environment = await environmentDal.create({
      tenantId: ATTACHMENT_SCOPE.tenantId,
      hostId: "host-1",
      label: "hydrate-once",
      imageRef: "ghcr.io/example/workboard-desktop:test",
      desiredRunning: true,
    });

    const seedDal = new ConversationNodeAttachmentDal(sqliteDb);
    await seedDal.upsert({
      ...ATTACHMENT_SCOPE,
      desktopEnvironmentId: environment.environment_id,
      attachedNodeId: null,
      updatedAtMs: 1,
    });
    await environmentDal.updateRuntime({
      tenantId: ATTACHMENT_SCOPE.tenantId,
      environmentId: environment.environment_id,
      status: "running",
      nodeId: "node-1",
    });

    let hydrateAttempts = 0;
    const wrappedDb: SqlDb = {
      kind: sqliteDb.kind,
      async get<T>(sql: string, params?: readonly unknown[]): Promise<T | undefined> {
        return await sqliteDb.get<T>(sql, params);
      },
      async all<T>(sql: string, params?: readonly unknown[]): Promise<T[]> {
        return await sqliteDb.all<T>(sql, params);
      },
      async run(sql: string, params?: readonly unknown[]) {
        if (
          sql.includes("UPDATE conversation_node_attachments") &&
          sql.includes("SET attached_node_id = ?")
        ) {
          hydrateAttempts += 1;
          if (hydrateAttempts > 1) {
            throw new Error("node hydration retried");
          }
          const numericParams = (params ?? []).filter(
            (value): value is number => typeof value === "number",
          );
          await sqliteDb.run(
            `UPDATE conversation_node_attachments
             SET updated_at_ms = ?
             WHERE tenant_id = ? AND key = ?`,
            [Math.max(...numericParams, 0) + 1, ATTACHMENT_SCOPE.tenantId, ATTACHMENT_SCOPE.key],
          );
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

    const dal = new ConversationNodeAttachmentDal(wrappedDb);
    await expect(dal.get(ATTACHMENT_SCOPE)).resolves.toMatchObject({
      desktop_environment_id: environment.environment_id,
      attached_node_id: null,
    });
    expect(hydrateAttempts).toBe(1);
  });
});
