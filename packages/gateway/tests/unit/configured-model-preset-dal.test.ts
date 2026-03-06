import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfiguredModelPresetDal } from "../../src/modules/models/configured-model-preset-dal.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
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
});
