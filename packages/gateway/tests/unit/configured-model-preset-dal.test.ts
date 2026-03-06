import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfiguredModelPresetDal } from "../../src/modules/models/configured-model-preset-dal.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import type { SqlDb } from "../../src/statestore/types.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

describe("ConfiguredModelPresetDal", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
    vi.useRealTimers();
  });

  it("changes updated_at only when the preset changes semantically", async () => {
    vi.useFakeTimers();
    db = openTestSqliteDb();
    const dal = new ConfiguredModelPresetDal(db);

    vi.setSystemTime(new Date("2026-03-06T10:00:00.000Z"));
    const created = await dal.create({
      tenantId: DEFAULT_TENANT_ID,
      presetKey: "preset-updated-at",
      displayName: "OpenAI Balanced",
      providerKey: "openai",
      modelId: "gpt-4.1-mini",
      options: { a: 1, b: 2 },
    });

    vi.setSystemTime(new Date("2026-03-06T11:00:00.000Z"));
    const noChange = await dal.updateByKey({
      tenantId: DEFAULT_TENANT_ID,
      presetKey: created.preset_key,
      displayName: created.display_name,
      options: { b: 2, a: 1 },
    });
    expect(noChange?.updated_at).toBe(created.updated_at);

    vi.setSystemTime(new Date("2026-03-06T12:00:00.000Z"));
    const changed = await dal.updateByKey({
      tenantId: DEFAULT_TENANT_ID,
      presetKey: created.preset_key,
      displayName: created.display_name,
      options: { a: 1, b: 3 },
    });

    expect(changed).toMatchObject({
      options: { a: 1, b: 3 },
      updated_at: "2026-03-06T12:00:00.000Z",
    });
  });

  it("updates presets inside a transaction", async () => {
    let openedTransaction = false;

    const txDb: SqlDb = {
      kind: "postgres",
      get: async (sql) => {
        if (sql.includes("SELECT")) {
          return {
            tenant_id: DEFAULT_TENANT_ID,
            preset_id: "preset-1",
            preset_key: "preset-updated-at",
            display_name: "OpenAI Balanced",
            provider_key: "openai",
            model_id: "gpt-4.1-mini",
            options_json: '{"a":1,"b":2}',
            created_at: "2026-03-06T10:00:00.000Z",
            updated_at: "2026-03-06T12:00:00.000Z",
          };
        }
        if (sql.includes("UPDATE")) {
          return {
            tenant_id: DEFAULT_TENANT_ID,
            preset_id: "preset-1",
            preset_key: "preset-updated-at",
            display_name: "OpenAI Balanced",
            provider_key: "openai",
            model_id: "gpt-4.1-mini",
            options_json: '{"a":1,"b":3}',
            created_at: "2026-03-06T10:00:00.000Z",
            updated_at: "2026-03-06T13:00:00.000Z",
          };
        }
        throw new Error(`unexpected sql: ${sql}`);
      },
      all: async () => [],
      run: async () => {
        throw new Error("updateByKey should use RETURNING inside the transaction");
      },
      exec: async () => {},
      transaction: async () => {
        throw new Error("nested transaction should not be opened");
      },
      close: async () => {},
    };

    const db: SqlDb = {
      kind: "postgres",
      get: async () => {
        throw new Error("outer db should not perform read/write work");
      },
      all: async () => [],
      run: async () => {
        throw new Error("outer db should not perform read/write work");
      },
      exec: async () => {},
      transaction: async (fn) => {
        openedTransaction = true;
        return await fn(txDb);
      },
      close: async () => {},
    };

    const row = await new ConfiguredModelPresetDal(db).updateByKey({
      tenantId: DEFAULT_TENANT_ID,
      presetKey: "preset-updated-at",
      options: { a: 1, b: 3 },
    });

    expect(openedTransaction).toBe(true);
    expect(row).toMatchObject({
      options: { a: 1, b: 3 },
      updated_at: "2026-03-06T13:00:00.000Z",
    });
  });
});
