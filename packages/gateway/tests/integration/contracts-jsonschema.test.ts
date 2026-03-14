import { describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

interface ContractCatalogPayload {
  format: string;
  generated_at: string;
  package: { name: string; version: string };
  schemas: Array<{ name: string; file: string; $id: string }>;
  errors?: unknown;
}

async function readCatalogArtifact(): Promise<ContractCatalogPayload | undefined> {
  const catalogPath = fileURLToPath(
    new URL("../../../schemas/dist/jsonschema/catalog.json", import.meta.url),
  );

  try {
    return JSON.parse(await readFile(catalogPath, "utf-8")) as ContractCatalogPayload;
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
    if (code === "ENOENT") return undefined;
    throw error;
  }
}

function normalizeCatalogSchemas(
  catalog: ContractCatalogPayload,
): ContractCatalogPayload["schemas"] {
  return catalog.schemas.map((schema) => {
    const normalizedSchema = Object.assign({}, schema);
    normalizedSchema.file = basename(schema.file);
    return normalizedSchema;
  });
}

describe("Gateway JSON Schema publishing", () => {
  it("serves the @tyrum/schemas catalog artifact (with file names normalized)", async () => {
    const { app } = await createTestApp();

    const res = await app.request("/contracts/jsonschema/catalog.json");
    expect(res.status).toBe(200);
    const served = (await res.json()) as ContractCatalogPayload;

    expect(served.format).toBe("tyrum.contracts.jsonschema.catalog.v1");
    expect(served.package.name).toBe("@tyrum/schemas");
    expect(served.schemas.every((schema) => schema.file === basename(schema.file))).toBe(true);

    const expected = await readCatalogArtifact();
    if (!expected) return;

    expect(expected.format).toBe("tyrum.contracts.jsonschema.catalog.v1");
    expect(served.package).toEqual(expected.package);
    expect(served.schemas).toEqual(normalizeCatalogSchemas(expected));
  });

  it("serves a JSON Schema catalog for contracts", async () => {
    const { app } = await createTestApp();

    const res = await app.request("/contracts/jsonschema/catalog.json");
    expect(res.status).toBe(200);

    const json = (await res.json()) as {
      format: string;
      schemas: Array<{ name: string; file: string; $id: string }>;
      errors?: unknown;
    };

    expect(json.format).toBe("tyrum.contracts.jsonschema.catalog.v1");
    expect(Array.isArray(json.schemas)).toBe(true);
    expect(json.schemas.length).toBeGreaterThan(0);
    if (json.errors !== undefined) {
      expect(Array.isArray(json.errors)).toBe(true);
      for (const entry of json.errors as unknown[]) {
        expect(entry).toMatchObject({
          name: expect.any(String),
          error: expect.any(String),
        });
      }
    }

    const names = new Set(json.schemas.map((s) => s.name));
    expect(names.has("WsConnectInitRequest")).toBe(true);
    expect(names.has("PluginManifest")).toBe(true);
    expect(names.has("PolicyBundle")).toBe(true);

    const connectInit = json.schemas.find((schema) => schema.name === "WsConnectInitRequest");
    expect(connectInit).toBeDefined();
    expect(connectInit?.file.includes("/")).toBe(false);

    const schemaRes = await app.request(`/contracts/jsonschema/${connectInit?.file}`);
    expect(schemaRes.status).toBe(200);
  });

  it("serves individual contract JSON Schemas by file name", async () => {
    const { app } = await createTestApp();

    const res = await app.request("/contracts/jsonschema/WsConnectInitRequest.json");
    expect(res.status).toBe(200);

    const json = (await res.json()) as {
      $schema?: string;
      $id?: string;
      title?: string;
    };

    expect(json.$schema).toBeTypeOf("string");
    expect(json.$id).toMatch(/WsConnectInitRequest\.json$/);
    expect(json.title).toBe("WsConnectInitRequest");
  });

  it("returns 404 quickly for missing schema files (no ENOENT retry)", async () => {
    const { app } = await createTestApp();

    const startedAt = Date.now();
    const res = await app.request("/contracts/jsonschema/__missing__.json");
    const durationMs = Date.now() - startedAt;

    expect(res.status).toBe(404);
    expect(durationMs).toBeLessThan(1000);
  });
});
