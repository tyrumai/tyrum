import { describe, it, expect, afterEach } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { ModelsDevCacheDal } from "../../src/modules/models/models-dev-cache-dal.js";
import { ModelsDevRefreshLeaseDal } from "../../src/modules/models/models-dev-refresh-lease-dal.js";
import { ModelsDevService } from "../../src/modules/models/models-dev-service.js";

describe("ModelsDevService", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
  });

  it("persists source consistently on 304 refreshes", async () => {
    db = openTestSqliteDb();
    const cacheDal = new ModelsDevCacheDal(db);
    const leaseDal = new ModelsDevRefreshLeaseDal(db);

    const catalog = {
      openai: {
        id: "openai",
        name: "OpenAI",
        env: [],
        npm: "@ai-sdk/openai",
        models: {
          "gpt-4.1": {
            id: "gpt-4.1",
            name: "GPT-4.1",
          },
        },
      },
    };

    const nowIso = new Date().toISOString();
    await cacheDal.upsert({
      fetchedAt: nowIso,
      etag: "etag",
      sha256: "sha",
      json: JSON.stringify(catalog),
      source: "remote",
      lastError: null,
      nowIso,
    });

    const fetchImpl: typeof fetch = async () =>
      new Response(null, {
        status: 304,
        headers: { etag: "etag" },
      });

    const svc = new ModelsDevService({ cacheDal, leaseDal, fetchImpl });
    const refreshed = await svc.refreshNow();
    expect(refreshed.status.source).toBe("cache");

    const restarted = new ModelsDevService({ cacheDal, leaseDal, fetchImpl });
    const loaded = await restarted.ensureLoaded();
    expect(loaded.status.source).toBe("cache");
  });
});
