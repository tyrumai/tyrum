import { describe, it, expect, afterEach } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { ModelsDevCacheDal } from "../../src/modules/models/models-dev-cache-dal.js";
import { ModelsDevRefreshLeaseDal } from "../../src/modules/models/models-dev-refresh-lease-dal.js";
import { ModelsDevService } from "../../src/modules/models/models-dev-service.js";
import { vi } from "vitest";

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

  it("persists last_error even when no cache row exists yet", async () => {
    db = openTestSqliteDb();
    const cacheDal = new ModelsDevCacheDal(db);
    const leaseDal = new ModelsDevRefreshLeaseDal(db);

    const fetchImpl: typeof fetch = async () => new Response("boom", { status: 502 });

    const svc = new ModelsDevService({ cacheDal, leaseDal, fetchImpl });
    const refreshed = await svc.refreshNow();
    expect(refreshed.status.last_error).toContain("models.dev fetch failed");

    const restarted = new ModelsDevService({ cacheDal, leaseDal, fetchImpl });
    const loaded = await restarted.ensureLoaded();
    expect(loaded.status.last_error).toContain("models.dev fetch failed");
  });

  it("surfaces latest last_error even when already loaded in-memory", async () => {
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

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    await cacheDal.upsert({
      fetchedAt: nowIso,
      etag: "etag",
      sha256: "sha",
      json: JSON.stringify(catalog),
      source: "remote",
      lastError: null,
      nowIso,
    });

    const svc = new ModelsDevService({ cacheDal, leaseDal });
    const loaded = await svc.ensureLoaded();
    expect(loaded.status.last_error).toBeNull();

    const laterIso = new Date(nowMs + 1000).toISOString();
    await cacheDal.setError({ error: "models.dev down", nowIso: laterIso });

    const reloaded = await svc.ensureLoaded();
    expect(reloaded.status.last_error).toBe("models.dev down");
  });

  it("reloads catalog when cache sha changes even if updated_at matches", async () => {
    db = openTestSqliteDb();
    const cacheDal = new ModelsDevCacheDal(db);
    const leaseDal = new ModelsDevRefreshLeaseDal(db);

    const catalogA = {
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

    const t = new Date().toISOString();
    await cacheDal.upsert({
      fetchedAt: t,
      etag: null,
      sha256: "sha-a",
      json: JSON.stringify(catalogA),
      source: "remote",
      lastError: null,
      nowIso: t,
    });

    const svc = new ModelsDevService({ cacheDal, leaseDal });
    const loadedA = await svc.ensureLoaded();
    expect(loadedA.status.sha256).toBe("sha-a");
    expect(Object.keys(loadedA.catalog)).toEqual(["openai"]);

    const catalogB = {
      anthropic: {
        id: "anthropic",
        name: "Anthropic",
        env: [],
        npm: "@ai-sdk/anthropic",
        models: {
          "claude-3.5-sonnet": {
            id: "claude-3.5-sonnet",
            name: "Claude 3.5 Sonnet",
          },
        },
      },
    };

    // Simulate an external writer updating JSON while updated_at remains the same.
    await cacheDal.upsert({
      fetchedAt: t,
      etag: null,
      sha256: "sha-b",
      json: JSON.stringify(catalogB),
      source: "remote",
      lastError: null,
      nowIso: t,
    });

    const loadedB = await svc.ensureLoaded();
    expect(loadedB.status.sha256).toBe("sha-b");
    expect(Object.keys(loadedB.catalog)).toEqual(["anthropic"]);
  });

  it("re-acquires refresh lease with a stable owner after release failure", async () => {
    db = openTestSqliteDb();
    const cacheDal = new ModelsDevCacheDal(db);
    const leaseDal = new ModelsDevRefreshLeaseDal(db);

    const originalInstanceId = process.env["TYRUM_INSTANCE_ID"];
    delete process.env["TYRUM_INSTANCE_ID"];

    const t = new Date().toISOString();
    await cacheDal.upsert({
      fetchedAt: t,
      etag: "etag",
      sha256: "sha",
      json: JSON.stringify({}),
      source: "remote",
      lastError: null,
      nowIso: t,
    });

    let fetchCalls = 0;
    const fetchImpl: typeof fetch = async () => {
      fetchCalls += 1;
      return new Response(null, { status: 304, headers: { etag: "etag" } });
    };

    vi.spyOn(leaseDal, "release").mockRejectedValue(new Error("boom"));

    const svc = new ModelsDevService({ cacheDal, leaseDal, fetchImpl });
    await svc.refreshNow();
    await svc.refreshNow();

    expect(fetchCalls).toBe(2);

    if (typeof originalInstanceId === "string") {
      process.env["TYRUM_INSTANCE_ID"] = originalInstanceId;
    } else {
      delete process.env["TYRUM_INSTANCE_ID"];
    }
  });
});
