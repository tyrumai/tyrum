import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ModelCatalogService } from "../../src/modules/model/catalog-service.js";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "tyrum-catalog-test-"));
}

const MOCK_CATALOG = {
  "test-provider": {
    id: "test-provider",
    name: "Test Provider",
    env: ["TEST_PROVIDER_API_KEY"],
    models: {
      "test-model-a": {
        id: "test-model-a",
        name: "Test Model A",
        reasoning: false,
        tool_call: true,
        attachment: false,
        limit: { context: 128000, output: 4096 },
        cost: { input: 1.0, output: 2.0 },
      },
      "test-model-b": {
        id: "test-model-b",
        name: "Test Model B",
        reasoning: true,
        tool_call: true,
        attachment: true,
        limit: { context: 200000, output: 16384 },
      },
    },
  },
  "other-provider": {
    id: "other-provider",
    name: "Other Provider",
    env: ["OTHER_API_KEY"],
    models: {
      "other-model": {
        id: "other-model",
        name: "Other Model",
        reasoning: false,
        tool_call: false,
        attachment: false,
        limit: { context: 32000, output: 2048 },
      },
    },
  },
};

describe("ModelCatalogService", () => {
  let cacheDir: string;
  let service: ModelCatalogService;
  const origEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    cacheDir = makeTmpDir();
    service = new ModelCatalogService({ cacheDir, refreshIntervalMs: 60_000 });
    origEnv["TEST_PROVIDER_API_KEY"] = process.env["TEST_PROVIDER_API_KEY"];
    origEnv["OTHER_API_KEY"] = process.env["OTHER_API_KEY"];
  });

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true });
    process.env["TEST_PROVIDER_API_KEY"] = origEnv["TEST_PROVIDER_API_KEY"];
    process.env["OTHER_API_KEY"] = origEnv["OTHER_API_KEY"];
  });

  it("loads from bundled snapshot when no cache exists", () => {
    service.loadSnapshot();
    expect(service.isLoaded).toBe(true);
    const providers = service.listProviders();
    expect(providers.length).toBeGreaterThan(0);
  });

  it("writes and reads cache file", async () => {
    // Write mock data as cache
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, "models.json"), JSON.stringify(MOCK_CATALOG));

    await service.refresh();
    expect(service.isLoaded).toBe(true);
    expect(service.listProviders()).toHaveLength(2);
  });

  it("returns undefined for unknown model", async () => {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, "models.json"), JSON.stringify(MOCK_CATALOG));
    await service.refresh();

    expect(service.getModel("nonexistent-model")).toBeUndefined();
  });

  it("detects enabled providers from env vars", async () => {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, "models.json"), JSON.stringify(MOCK_CATALOG));
    await service.refresh();

    // No env vars set → no enabled providers
    delete process.env["TEST_PROVIDER_API_KEY"];
    delete process.env["OTHER_API_KEY"];
    expect(service.getEnabledProviders()).toHaveLength(0);

    // Set one env var → one enabled
    process.env["TEST_PROVIDER_API_KEY"] = "sk-test";
    expect(service.getEnabledProviders()).toHaveLength(1);
    expect(service.getEnabledProviders()[0]!.id).toBe("test-provider");
  });

  it("getModel returns correct limits and provider", async () => {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, "models.json"), JSON.stringify(MOCK_CATALOG));
    await service.refresh();

    const model = service.getModel("test-model-a");
    expect(model).toBeDefined();
    expect(model!.id).toBe("test-model-a");
    expect(model!.limit.context).toBe(128000);
    expect(model!.limit.output).toBe(4096);
    expect(model!.cost?.input).toBe(1.0);
    expect(model!.provider_id).toBe("test-provider");

    const modelB = service.getModel("test-model-b");
    expect(modelB!.reasoning).toBe(true);
    expect(modelB!.limit.context).toBe(200000);
  });
});
