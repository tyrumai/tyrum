import { z } from "zod";

/**
 * Lazily-built registry of all named Zod schemas from the barrel.
 *
 * Uses lazy initialization to avoid circular-import issues:
 * index.ts re-exports this file, and this file imports index.ts,
 * but the barrel is only read when a function is first called
 * (well after all modules have finished evaluating).
 */
let _registry: Record<string, z.ZodType> | undefined;

async function getRegistry(): Promise<Record<string, z.ZodType>> {
  if (_registry) return _registry;
  // Dynamic import avoids static circular dependency
  const barrel = (await import("./index.js")) as Record<string, unknown>;
  const entries: Array<[string, z.ZodType]> = [];
  for (const [key, value] of Object.entries(barrel)) {
    if (value instanceof z.ZodType) {
      entries.push([key, value]);
    }
  }
  _registry = Object.fromEntries(entries);
  return _registry;
}

/** List all registered schema names. */
export async function listSchemaNames(): Promise<string[]> {
  const registry = await getRegistry();
  return Object.keys(registry).sort();
}

/** Convert a single named schema to JSON Schema (draft 2020-12). */
export async function getJsonSchema(name: string): Promise<Record<string, unknown>> {
  const registry = await getRegistry();
  const schema = registry[name];
  if (!schema) {
    throw new Error(`Unknown schema: '${name}'`);
  }
  return z.toJSONSchema(schema) as Record<string, unknown>;
}

/** Convert all registered schemas to JSON Schema. */
export async function getAllJsonSchemas(): Promise<Record<string, Record<string, unknown>>> {
  const registry = await getRegistry();
  const result: Record<string, Record<string, unknown>> = {};
  for (const [name, schema] of Object.entries(registry)) {
    result[name] = z.toJSONSchema(schema) as Record<string, unknown>;
  }
  return result;
}
