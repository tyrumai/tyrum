import { beforeEach, describe, expect, it, vi } from "vitest";

const readFile = vi.fn();
const delay = vi.fn().mockResolvedValue(undefined);

vi.mock("node:fs/promises", () => ({
  readFile,
}));

vi.mock("node:timers/promises", () => ({
  setTimeout: delay,
}));

describe("contracts-resolver", () => {
  beforeEach(() => {
    vi.resetModules();
    readFile.mockReset();
    delay.mockReset().mockResolvedValue(undefined);
  });

  it("retries transient missing contract artifacts", async () => {
    const missingError = Object.assign(new Error("missing"), { code: "ENOENT" });
    readFile
      .mockRejectedValueOnce(missingError)
      .mockResolvedValueOnce(JSON.stringify({ schemas: [] }));

    const { readContractsCatalog } = await import("../../../scripts/api/contracts-resolver.mjs");

    await expect(readContractsCatalog()).resolves.toEqual({ schemas: [] });
    expect(readFile).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledTimes(1);
  });

  it("falls back to the contracts export when a catalog-listed schema file is missing", async () => {
    const missingFileError = Object.assign(new Error("missing schema artifact"), {
      code: "ENOENT",
    });
    const { createContractSchemaResolver } =
      await import("../../../scripts/api/contracts-resolver.mjs");
    const readFileImpl = vi.fn(async () => {
      throw missingFileError;
    });
    const toJSONSchema = vi.fn(() => ({
      type: "object",
      properties: {
        enabled: { type: "boolean" },
      },
    }));
    const importContractsModule = vi.fn(async () => ({
      AgentConfigUpdateRequest: { toJSONSchema },
    }));

    const resolver = createContractSchemaResolver({
      catalog: {
        schemas: [
          {
            name: "AgentConfigUpdateRequest",
            file: "jsonschema/AgentConfigUpdateRequest.json",
            $id: "https://contracts.tyrum.dev/0.1.0/AgentConfigUpdateRequest.json",
          },
        ],
      },
      importContractsModule,
      readFileImpl,
      rootDir: "/tmp/tyrum-test",
    });

    const schema = await resolver.getSchema("AgentConfigUpdateRequest");
    const cachedSchema = await resolver.getSchema("AgentConfigUpdateRequest");

    expect(schema).toEqual({
      $id: "https://contracts.tyrum.dev/0.1.0/AgentConfigUpdateRequest.json",
      title: "AgentConfigUpdateRequest",
      type: "object",
      properties: {
        enabled: { type: "boolean" },
      },
    });
    expect(cachedSchema).toEqual(schema);
    expect(toJSONSchema).toHaveBeenCalledWith({ io: "input" });
    expect(importContractsModule).toHaveBeenCalledTimes(1);
    expect(readFileImpl).toHaveBeenCalledWith(
      "/tmp/tyrum-test/packages/contracts/dist/jsonschema/AgentConfigUpdateRequest.json",
      "utf8",
    );
  });

  it("refreshes contracts artifacts before importing schema fallbacks", async () => {
    const missingFileError = Object.assign(new Error("missing schema artifact"), {
      code: "ENOENT",
    });
    const { createContractSchemaResolver } =
      await import("../../../scripts/api/contracts-resolver.mjs");
    const readFileImpl = vi.fn(async () => {
      throw missingFileError;
    });
    let refreshed = false;
    const refreshArtifacts = vi.fn(async () => {
      refreshed = true;
    });
    const importContractsModule = vi.fn(async () => {
      expect(refreshed).toBe(true);
      return {
        AgentConfigUpdateRequest: {
          toJSONSchema: () => ({
            type: "object",
            properties: {
              enabled: { type: "boolean" },
            },
          }),
        },
      };
    });

    const resolver = createContractSchemaResolver({
      catalog: {
        schemas: [
          {
            name: "AgentConfigUpdateRequest",
            file: "jsonschema/AgentConfigUpdateRequest.json",
            $id: "https://contracts.tyrum.dev/0.1.0/AgentConfigUpdateRequest.json",
          },
        ],
      },
      importContractsModule,
      refreshArtifacts,
      readFileImpl,
      rootDir: "/tmp/tyrum-test",
    });

    await expect(resolver.getSchema("AgentConfigUpdateRequest")).resolves.toEqual({
      $id: "https://contracts.tyrum.dev/0.1.0/AgentConfigUpdateRequest.json",
      title: "AgentConfigUpdateRequest",
      type: "object",
      properties: {
        enabled: { type: "boolean" },
      },
    });
    expect(refreshArtifacts).toHaveBeenCalledTimes(1);
    expect(importContractsModule).toHaveBeenCalledTimes(1);
  });

  it("retries the contracts export fallback after a transient import failure", async () => {
    const missingFileError = Object.assign(new Error("missing schema artifact"), {
      code: "ENOENT",
    });
    const transientImportError = Object.assign(new Error("dist missing"), {
      code: "ENOENT",
    });
    const { createContractSchemaResolver } =
      await import("../../../scripts/api/contracts-resolver.mjs");
    const readFileImpl = vi.fn(async () => {
      throw missingFileError;
    });
    const refreshArtifacts = vi.fn(async () => {});
    const importContractsModule = vi
      .fn()
      .mockRejectedValueOnce(transientImportError)
      .mockResolvedValueOnce({
        AgentConfigUpdateRequest: {
          toJSONSchema: () => ({
            type: "object",
            properties: {
              enabled: { type: "boolean" },
            },
          }),
        },
      });

    const resolver = createContractSchemaResolver({
      catalog: {
        schemas: [
          {
            name: "AgentConfigUpdateRequest",
            file: "jsonschema/AgentConfigUpdateRequest.json",
            $id: "https://contracts.tyrum.dev/0.1.0/AgentConfigUpdateRequest.json",
          },
        ],
      },
      importContractsModule,
      refreshArtifacts,
      readFileImpl,
      rootDir: "/tmp/tyrum-test",
    });

    await expect(resolver.getSchema("AgentConfigUpdateRequest")).rejects.toThrow("dist missing");
    await expect(resolver.getSchema("AgentConfigUpdateRequest")).resolves.toEqual({
      $id: "https://contracts.tyrum.dev/0.1.0/AgentConfigUpdateRequest.json",
      title: "AgentConfigUpdateRequest",
      type: "object",
      properties: {
        enabled: { type: "boolean" },
      },
    });
    expect(refreshArtifacts).toHaveBeenCalledTimes(2);
    expect(importContractsModule).toHaveBeenCalledTimes(2);
  });
});
