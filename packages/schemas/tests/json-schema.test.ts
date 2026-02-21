import { describe, expect, it } from "vitest";
import { listSchemaNames, getJsonSchema, getAllJsonSchemas } from "../src/json-schema.js";

describe("JSON Schema export", () => {
  it("listSchemaNames returns a non-empty sorted array", async () => {
    const names = await listSchemaNames();
    expect(names.length).toBeGreaterThan(50);
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });

  it("getJsonSchema returns valid JSON Schema for AgentConfig", async () => {
    const schema = await getJsonSchema("AgentConfig");
    expect(schema).toHaveProperty("type", "object");
    expect(schema).toHaveProperty("properties");
    expect(schema).toHaveProperty("$schema");
  });

  it("getJsonSchema throws for nonexistent schema", async () => {
    await expect(getJsonSchema("NonExistentSchema")).rejects.toThrow(
      "Unknown schema: 'NonExistentSchema'",
    );
  });

  it("getAllJsonSchemas returns schemas for every registered name", async () => {
    const all = await getAllJsonSchemas();
    const names = await listSchemaNames();
    expect(Object.keys(all).sort()).toEqual(names);
    for (const schema of Object.values(all)) {
      expect(schema).toHaveProperty("$schema");
    }
  });
});
