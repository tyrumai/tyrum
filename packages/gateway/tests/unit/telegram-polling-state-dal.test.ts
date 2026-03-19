import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { TelegramPollingStateDal } from "../../src/modules/channels/telegram-polling-state-dal.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

describe("TelegramPollingStateDal", () => {
  let db: SqliteDb;
  let dal: TelegramPollingStateDal;

  beforeEach(() => {
    db = openTestSqliteDb();
    dal = new TelegramPollingStateDal(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it("acquires and releases a per-account lease", async () => {
    await expect(
      dal.tryAcquire({
        tenantId: DEFAULT_TENANT_ID,
        accountKey: "alerts",
        owner: "worker-a",
        nowMs: 1_000,
        leaseTtlMs: 30_000,
      }),
    ).resolves.toBe(true);

    await expect(
      dal.tryAcquire({
        tenantId: DEFAULT_TENANT_ID,
        accountKey: "alerts",
        owner: "worker-b",
        nowMs: 2_000,
        leaseTtlMs: 30_000,
      }),
    ).resolves.toBe(false);

    await dal.release({
      tenantId: DEFAULT_TENANT_ID,
      accountKey: "alerts",
      owner: "worker-a",
    });

    await expect(
      dal.tryAcquire({
        tenantId: DEFAULT_TENANT_ID,
        accountKey: "alerts",
        owner: "worker-b",
        nowMs: 3_000,
        leaseTtlMs: 30_000,
      }),
    ).resolves.toBe(true);
  });

  it("updates polling cursor, bot identity, and error state for the current lease owner", async () => {
    await dal.tryAcquire({
      tenantId: DEFAULT_TENANT_ID,
      accountKey: "alerts",
      owner: "worker-a",
      nowMs: 1_000,
      leaseTtlMs: 30_000,
    });

    await dal.markRunning({
      tenantId: DEFAULT_TENANT_ID,
      accountKey: "alerts",
      owner: "worker-a",
      botUserId: "12345",
      polledAt: "2026-03-19T08:00:00.000Z",
    });
    await dal.updateCursor({
      tenantId: DEFAULT_TENANT_ID,
      accountKey: "alerts",
      owner: "worker-a",
      botUserId: "12345",
      nextUpdateId: 77,
      polledAt: "2026-03-19T08:01:00.000Z",
    });

    await expect(
      dal.get({
        tenantId: DEFAULT_TENANT_ID,
        accountKey: "alerts",
      }),
    ).resolves.toMatchObject({
      bot_user_id: "12345",
      next_update_id: 77,
      status: "running",
      last_polled_at: "2026-03-19T08:01:00.000Z",
      last_error_at: null,
      last_error_message: null,
    });

    await dal.markError({
      tenantId: DEFAULT_TENANT_ID,
      accountKey: "alerts",
      owner: "worker-a",
      occurredAt: "2026-03-19T08:02:00.000Z",
      message: "temporary failure",
    });

    await expect(
      dal.get({
        tenantId: DEFAULT_TENANT_ID,
        accountKey: "alerts",
      }),
    ).resolves.toMatchObject({
      status: "error",
      last_error_at: "2026-03-19T08:02:00.000Z",
      last_error_message: "temporary failure",
    });

    await dal.resetCursorForBot({
      tenantId: DEFAULT_TENANT_ID,
      accountKey: "alerts",
      owner: "worker-a",
      botUserId: "67890",
      polledAt: "2026-03-19T08:03:00.000Z",
    });

    await expect(
      dal.get({
        tenantId: DEFAULT_TENANT_ID,
        accountKey: "alerts",
      }),
    ).resolves.toMatchObject({
      bot_user_id: "67890",
      next_update_id: null,
      status: "running",
      last_polled_at: "2026-03-19T08:03:00.000Z",
      last_error_at: null,
      last_error_message: null,
    });
  });
});
