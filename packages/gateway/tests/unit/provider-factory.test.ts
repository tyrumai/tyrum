import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitForCondition } from "../helpers/wait-for.js";

const sapMockState = vi.hoisted(() => ({
  startedKeys: [] as string[],
  inFlightKeys: new Set<string>(),
  maxConcurrent: 0,
  releases: new Map<string, () => void>(),
}));

vi.mock("@jerome-benoit/sap-ai-provider-v2", () => ({
  createSAPAIProvider: () => ({
    languageModel() {
      return {
        async doGenerate() {
          const serviceKey = process.env.AICORE_SERVICE_KEY ?? "";
          sapMockState.startedKeys.push(serviceKey);
          sapMockState.inFlightKeys.add(serviceKey);
          sapMockState.maxConcurrent = Math.max(
            sapMockState.maxConcurrent,
            sapMockState.inFlightKeys.size,
          );

          await new Promise<void>((resolve) => {
            sapMockState.releases.set(serviceKey, resolve);
          });

          sapMockState.inFlightKeys.delete(serviceKey);
          return { text: serviceKey };
        },
      };
    },
  }),
}));

const { createProviderFromNpm } = await import("../../src/modules/models/provider-factory.js");

describe("provider-factory SAP wrapper", () => {
  let originalServiceKey: string | undefined;

  beforeEach(() => {
    originalServiceKey = process.env.AICORE_SERVICE_KEY;
    sapMockState.startedKeys.length = 0;
    sapMockState.inFlightKeys.clear();
    sapMockState.maxConcurrent = 0;
    sapMockState.releases.clear();
  });

  afterEach(() => {
    if (originalServiceKey === undefined) {
      delete process.env.AICORE_SERVICE_KEY;
    } else {
      process.env.AICORE_SERVICE_KEY = originalServiceKey;
    }
  });

  it("serializes env-scoped SAP requests so service keys do not overlap", async () => {
    process.env.AICORE_SERVICE_KEY = "original-service-key";

    const firstProvider = createProviderFromNpm({
      npm: "@jerome-benoit/sap-ai-provider-v2",
      providerId: "sap-ai-core",
      secrets: { service_key: "service-key-a" },
    });
    const secondProvider = createProviderFromNpm({
      npm: "@jerome-benoit/sap-ai-provider-v2",
      providerId: "sap-ai-core",
      secrets: { service_key: "service-key-b" },
    });

    const firstModel = firstProvider.languageModel("gpt-4.1") as {
      doGenerate: (options: unknown) => Promise<{ text: string }>;
    };
    const secondModel = secondProvider.languageModel("gpt-4.1") as {
      doGenerate: (options: unknown) => Promise<{ text: string }>;
    };

    const firstRun = firstModel.doGenerate({});
    await waitForCondition(() => sapMockState.startedKeys.includes("service-key-a"), {
      description: "first SAP request to start",
      debug: () => JSON.stringify(sapMockState.startedKeys),
    });

    const secondRun = secondModel.doGenerate({});
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(sapMockState.startedKeys).toEqual(["service-key-a"]);
    expect(sapMockState.maxConcurrent).toBe(1);

    sapMockState.releases.get("service-key-a")?.();
    await waitForCondition(() => sapMockState.startedKeys.includes("service-key-b"), {
      description: "second SAP request to start",
      debug: () => JSON.stringify(sapMockState.startedKeys),
    });

    expect(process.env.AICORE_SERVICE_KEY).toBe("service-key-b");

    sapMockState.releases.get("service-key-b")?.();

    await expect(firstRun).resolves.toEqual({ text: "service-key-a" });
    await expect(secondRun).resolves.toEqual({ text: "service-key-b" });
    expect(sapMockState.maxConcurrent).toBe(1);
    expect(process.env.AICORE_SERVICE_KEY).toBe("original-service-key");
  });

  it("rejects unsupported provider package identifiers", () => {
    expect(() =>
      createProviderFromNpm({
        npm: "@acme/unsupported-provider",
        providerId: "acme",
      }),
    ).toThrow("unsupported provider npm package '@acme/unsupported-provider'");
  });
});
